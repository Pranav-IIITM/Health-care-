import { addDays, diffDays, formatDate } from './dates';
import { CHW_RETRY_AFTER_DAYS, IMPORTANCE_LABEL, RETRY_AFTER_DAYS } from './policy';
import { proposalFrom } from './reader';
import { draftMessage, maskPhone } from './contact';
import { statusOf, windowCloses } from './tracking';
import { canRemind, CHANNEL_LABEL, laneFor, OUTCOME_LABEL } from './worklist';
import type {
  AppState,
  Attempt,
  AuditAction,
  Barrier,
  Channel,
  ClosureReason,
  CorrectionField,
  FollowUp,
  Importance,
  ISODate,
  Lang,
  Outcome,
  Patient,
  PhoneOwner,
  Reading,
  Role,
} from './types';

/** A rule of the workflow was broken; the message is shown to the user as-is. */
export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleError';
  }
}

function fail(message: string): never {
  throw new RuleError(message);
}

export const ROLE_LABEL: Record<Role, string> = {
  nurse: 'OPD nurse',
  records: 'Records staff',
  chw: 'ASHA worker',
  admin: 'Hospital admin',
};

export const BARRIER_LABEL: Record<Barrier, string> = {
  transport: 'Transport or distance',
  cost: 'Cost of travel or tests',
  no_escort: 'No one to come with them',
  work: 'Cannot leave work',
  feels_better: 'Feels better',
  forgot: 'Forgot',
  other: 'Other',
};

export const CLOSURE_LABEL: Record<ClosureReason, string> = {
  care_elsewhere: 'Care continued elsewhere',
  declined: 'Patient declined after counselling',
  clinician_cancelled: 'Clinician cancelled the follow-up',
  moved_away: 'Moved away',
  deceased: 'Deceased',
  duplicate: 'Duplicate record',
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function withAudit(state: AppState, role: Role | 'system', action: AuditAction, regNo: string | null, detail: string): AppState {
  const seq = state.seq + 1;
  return { ...state, seq, audit: [...state.audit, { seq, on: state.today, role, action, regNo, detail }] };
}

function getFu(state: AppState, id: string): FollowUp {
  return state.followUps.find((f) => f.id === id) ?? fail('Follow-up not found.');
}

function patientOf(state: AppState, fu: FollowUp): Patient {
  return state.patients[fu.patientId] ?? fail('Patient record not found.');
}

function putFu(state: AppState, fu: FollowUp): AppState {
  return { ...state, followUps: state.followUps.map((f) => (f.id === fu.id ? fu : f)) };
}

function putPatient(state: AppState, p: Patient): AppState {
  return { ...state, patients: { ...state.patients, [p.id]: p } };
}

function requireRole(state: AppState, roles: Role[], message: string): void {
  if (!roles.includes(state.role)) fail(message);
}

function sameItems(a: string[], b: string[]): boolean {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** Indian mobile number: 10 digits starting 6–9, with an optional +91 / 0 prefix. */
export function normalisePhone(raw: string): string | null | 'invalid' {
  const digits = raw.replace(/\D/g, '').replace(/^(?:91|0)(?=\d{10}$)/, '');
  if (!digits) return null;
  return /^[6-9]\d{9}$/.test(digits) ? digits : 'invalid';
}

/* ------------------------------------------------------------------ */
/* Follow-up desk                                                      */
/* ------------------------------------------------------------------ */

export interface ContactUpdate {
  phone: string;
  phoneOwner: PhoneOwner;
  /** Number confirmed at the desk (test SMS or missed call reached the patient). */
  phoneConfirmed: boolean;
  caregiverName: string;
  caregiverRelation: string;
  caregiverPhone: string;
  language: Lang;
  chwArea: string;
  consent: { sms: boolean; call: boolean; caregiver: boolean; chw: boolean };
}

export interface ConfirmInput {
  deskItemId: string;
  reading: Reading;
  tracking: 'dated' | 'not_tracked' | null;
  dueDate: ISODate | null;
  importance: Importance | null;
  bring: string[];
  notTrackedReason: string;
  contact: ContactUpdate;
}

function consentSummary(p: Patient): string {
  const yn = (v: boolean) => (v ? 'yes' : 'no');
  const phone = p.phone ? `${maskPhone(p.phone)} (${p.phoneOwner === 'shared' ? 'shared' : 'own'}, ${p.phoneStatus})` : 'none';
  return `Phone ${phone} · SMS ${yn(p.consent.sms)} · calls ${yn(p.consent.call)} · caregiver ${yn(p.consent.caregiver)} · ASHA visit ${yn(p.consent.chw)}${p.consent.chw && p.chwArea ? ` (${p.chwArea})` : ''}`;
}

/** The nurse confirms what the system proposed, with the patient still at the desk. */
export function confirmFollowUp(state: AppState, input: ConfirmInput): { state: AppState; followUpId: string } {
  requireRole(state, ['nurse'], 'Only the OPD nurse at the follow-up desk confirms follow-ups.');
  const item = state.desk.find((d) => d.id === input.deskItemId) ?? fail('This patient is no longer in the desk queue.');
  const patient = state.patients[item.patientId] ?? fail('Patient record not found.');
  if (!input.tracking) fail('Decide whether this follow-up gets a date or is not tracked.');
  if (!input.importance) fail('Choose the importance level the clinician set.');

  let dueDate: ISODate | null = null;
  let close: ISODate | null = null;
  if (input.tracking === 'dated') {
    if (!input.dueDate) fail('Set the follow-up date.');
    if (input.dueDate <= item.visitDate) fail("The follow-up date must be after today's visit.");
    if (diffDays(item.visitDate, input.dueDate) > 730) fail('The follow-up date is more than two years away. Check it.');
    dueDate = input.dueDate;
    close = windowCloses(dueDate, item.visitDate, input.importance);
  } else if (!input.notTrackedReason.trim()) {
    fail('Say why this follow-up is not tracked, for example "SOS: come if needed".');
  }

  const c = input.contact;
  const phone = normalisePhone(c.phone);
  if (phone === 'invalid') fail('Enter a 10-digit mobile number, or leave it empty.');
  const caregiverPhone = normalisePhone(c.caregiverPhone);
  if (caregiverPhone === 'invalid') fail("Enter a 10-digit mobile number for the caregiver, or leave it empty.");
  if ((c.consent.sms || c.consent.call) && !phone) fail('SMS or call consent needs a phone number.');
  if (c.consent.caregiver && (!c.caregiverName.trim() || !caregiverPhone)) fail('Caregiver contact needs a name and a phone number.');
  if (c.consent.chw && !c.chwArea) fail('Choose the ASHA area for home visits.');

  const proposal = proposalFrom(input.reading);
  const corrections: CorrectionField[] = [];
  if (proposal.tracking && proposal.tracking !== input.tracking) corrections.push('tracking');
  if (input.tracking === 'dated' && proposal.dueDate && proposal.dueDate !== dueDate) corrections.push('dueDate');
  if (!sameItems(proposal.bring, input.bring)) corrections.push('bring');

  const keptVerified = phone !== null && phone === patient.phone && patient.phoneStatus === 'verified';
  const updatedPatient: Patient = {
    ...patient,
    phone,
    phoneOwner: phone ? (c.phoneOwner === 'none' ? 'self' : c.phoneOwner) : 'none',
    phoneStatus: phone && (c.phoneConfirmed || keptVerified) ? 'verified' : 'unverified',
    caregiver: c.caregiverName.trim()
      ? { name: c.caregiverName.trim(), relation: c.caregiverRelation.trim() || 'family', phone: caregiverPhone }
      : null,
    language: c.language,
    chwArea: c.chwArea || null,
    consent: { ...c.consent, recordedOn: state.today, recordedBy: 'nurse' },
  };

  const id = `fu-${item.id}`;
  const fu: FollowUp = {
    id,
    patientId: patient.id,
    department: item.department,
    clinician: item.clinician,
    visitDate: item.visitDate,
    instruction: item.instruction,
    reading: input.reading,
    plan: {
      tracking: input.tracking,
      dueDate,
      windowCloses: close,
      importance: input.importance,
      bring: input.bring,
      notTrackedReason: input.tracking === 'not_tracked' ? input.notTrackedReason.trim() : null,
      confirmedBy: 'nurse',
      confirmedOn: state.today,
      corrections,
    },
    returnedOn: null,
    reminderSentOn: null,
    messageSentOn: null,
    attempts: [],
    nextAttemptOn: null,
    rescheduledTo: null,
    escalation: null,
    routeOverride: null,
    reviewedAtAttempt: 0,
    closure: null,
  };

  let next: AppState = { ...state, desk: state.desk.filter((d) => d.id !== item.id), followUps: [...state.followUps, fu] };
  next = putPatient(next, updatedPatient);
  next = withAudit(next, 'nurse', 'contact_updated', patient.regNo, consentSummary(updatedPatient));
  const corrected = corrections.length ? ` · nurse corrected: ${corrections.join(', ')}` : ' · proposal accepted unchanged';
  next =
    input.tracking === 'dated'
      ? withAudit(
          next,
          'nurse',
          'confirmed',
          patient.regNo,
          `Due ${formatDate(dueDate!, 'long')}, window to ${formatDate(close!, 'short')} · ${IMPORTANCE_LABEL[input.importance]}${corrected} · read by ${input.reading.engine === 'rules' ? 'rule reader' : 'rule reader + Gemini'}`,
        )
      : withAudit(next, 'nurse', 'not_tracked', patient.regNo, `Not tracked: ${input.notTrackedReason.trim()}${corrected}`);
  return { state: next, followUpId: id };
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export function sendReminders(state: AppState, ids: string[]): AppState {
  requireRole(state, ['records', 'nurse'], 'Reminders are sent by records staff.');
  let next = state;
  for (const id of ids) {
    const fu = getFu(next, id);
    const p = patientOf(next, fu);
    if (laneFor(fu, p, statusOf(fu, next.today), next.today) !== 'reminder') continue;
    const msg = draftMessage('reminder', fu, p, 'phone');
    if (!msg) continue;
    next = putFu(next, { ...fu, reminderSentOn: next.today });
    next = withAudit(
      next,
      state.role,
      'reminder_sent',
      p.regNo,
      `Reminder SMS (${msg.lang === 'hi' ? 'Hindi' : 'English'}, ${msg.audience} template) to ${maskPhone(msg.to)} (simulated gateway)`,
    );
  }
  return next;
}

export function sendMissedMessage(state: AppState, id: string, channel: Channel): AppState {
  requireRole(state, ['records', 'nurse'], 'Messages are sent by records staff or a nurse.');
  const fu = getFu(state, id);
  const p = patientOf(state, fu);
  if (channel === 'phone' && !canRemind(p)) fail('The patient has not agreed to SMS on a working number.');
  if (channel === 'caregiver' && !(p.consent.caregiver && p.caregiver?.phone)) fail('The patient has not agreed to caregiver contact.');
  const msg = draftMessage('missed', fu, p, channel) ?? fail('No number to send to.');
  const next = putFu(state, { ...fu, messageSentOn: state.today });
  return withAudit(
    next,
    state.role,
    'message_sent',
    p.regNo,
    `Missed-visit SMS (${msg.lang === 'hi' ? 'Hindi' : 'English'}, ${msg.audience} template) to ${maskPhone(msg.to)} (simulated gateway)`,
  );
}

/* ------------------------------------------------------------------ */
/* Recovery                                                            */
/* ------------------------------------------------------------------ */

export function closeRuleError(role: Role, fu: FollowUp, reason: ClosureReason | null): string | null {
  if (fu.closure || fu.returnedOn) return 'This follow-up is already resolved.';
  if (role !== 'records' && role !== 'nurse') return 'Only records staff or a nurse can close a follow-up.';
  if (!reason) return 'Choose a reason. A follow-up is never closed without one.';
  if (role === 'records' && fu.plan.importance === 'must_not_miss') return 'Must-not-miss follow-ups are closed only by a nurse.';
  if (role === 'records' && (reason === 'declined' || reason === 'deceased' || reason === 'clinician_cancelled')) {
    return 'A nurse must close a follow-up for this reason.';
  }
  return null;
}

export interface AttemptInput {
  channel: Channel;
  outcome: Outcome;
  plannedDate: ISODate | null;
  barrier: Barrier | null;
  note: string;
}

const CLOSING_OUTCOMES: Partial<Record<Outcome, ClosureReason>> = {
  care_elsewhere: 'care_elsewhere',
  declined: 'declined',
  moved_away: 'moved_away',
  deceased: 'deceased',
};

export function logAttempt(state: AppState, id: string, input: AttemptInput): AppState {
  const fu = getFu(state, id);
  const p = patientOf(state, fu);
  const { today, role } = state;
  if (statusOf(fu, today) !== 'missed') fail('Only missed follow-ups are worked from the list.');
  if (input.channel === 'none') fail('There is no consented route to contact this patient.');
  if (input.channel === 'chw') requireRole(state, ['chw', 'nurse'], 'Home-visit outcomes are logged by the ASHA worker or a nurse.');
  else requireRole(state, ['records', 'nurse'], 'Calls are logged by records staff or a nurse.');
  if (input.outcome === 'will_come') {
    if (!input.plannedDate) fail('Enter the date the patient agreed to come.');
    if (input.plannedDate < today) fail('The agreed date cannot be in the past.');
    if (diffDays(today, input.plannedDate) > 60) fail('The agreed date is more than 60 days away. Check it.');
  }
  if (input.outcome === 'needs_support' && !input.barrier) fail('Choose what is stopping the patient from coming.');
  if (input.outcome === 'not_found' && input.channel !== 'chw') fail('"Not found at home" is for home visits.');
  if (input.outcome === 'wrong_number' && input.channel === 'chw') fail('"Wrong number" is for calls.');

  const attempt: Attempt = {
    on: today,
    by: role,
    channel: input.channel,
    outcome: input.outcome,
    plannedDate: input.outcome === 'will_come' ? input.plannedDate : null,
    barrier: input.outcome === 'needs_support' ? input.barrier : null,
    note: input.note.trim().slice(0, 280),
  };
  let updated: FollowUp = { ...fu, attempts: [...fu.attempts, attempt], nextAttemptOn: null };
  let patient = p;
  let escalated: string | null = null;
  let closed: ClosureReason | null = null;

  switch (input.outcome) {
    case 'will_come':
      updated = { ...updated, rescheduledTo: attempt.plannedDate, escalation: null };
      break;
    case 'needs_support':
      escalated = `Needs support to come: ${BARRIER_LABEL[attempt.barrier!].toLowerCase()}`;
      break;
    case 'clinical_question':
      escalated = 'Clinical question or new symptoms: nurse to call back';
      break;
    case 'no_answer':
      updated = { ...updated, nextAttemptOn: addDays(today, RETRY_AFTER_DAYS) };
      break;
    case 'not_found':
      updated = { ...updated, nextAttemptOn: addDays(today, CHW_RETRY_AFTER_DAYS) };
      break;
    case 'wrong_number':
      if (input.channel === 'phone') patient = { ...patient, phoneStatus: 'unreachable' };
      if (input.channel === 'caregiver' && patient.caregiver) patient = { ...patient, caregiver: { ...patient.caregiver, phone: null } };
      break;
    default: {
      const reason = CLOSING_OUTCOMES[input.outcome]!;
      if (closeRuleError(role, updated, reason)) escalated = `Closure review: ${OUTCOME_LABEL[input.outcome].toLowerCase()}`;
      else closed = reason;
    }
  }
  if (escalated) updated = { ...updated, escalation: { on: today, by: role, reason: escalated } };
  if (closed) updated = { ...updated, escalation: null, closure: { on: today, by: role, reason: closed, note: attempt.note } };

  let next = putFu(state, updated);
  if (patient !== p) next = putPatient(next, patient);
  const extra = attempt.plannedDate
    ? `, agreed ${formatDate(attempt.plannedDate, 'long')}`
    : attempt.barrier
      ? `, ${BARRIER_LABEL[attempt.barrier].toLowerCase()}`
      : '';
  next = withAudit(next, role, 'attempt_logged', p.regNo, `${CHANNEL_LABEL[input.channel]}: ${OUTCOME_LABEL[input.outcome]}${extra}`);
  if (escalated) next = withAudit(next, role, 'escalated', p.regNo, escalated);
  if (closed) next = withAudit(next, role, 'closed', p.regNo, CLOSURE_LABEL[closed]);
  return next;
}

export function escalate(state: AppState, id: string, reason: string): AppState {
  requireRole(state, ['records', 'chw', 'nurse'], 'Escalations come from records staff, ASHA workers or nurses.');
  if (!reason.trim()) fail('Say why this needs a nurse.');
  const fu = getFu(state, id);
  const p = patientOf(state, fu);
  const next = putFu(state, { ...fu, escalation: { on: state.today, by: state.role, reason: reason.trim() } });
  return withAudit(next, state.role, 'escalated', p.regNo, reason.trim());
}

/** Nurse has reviewed: back to the normal route. Failures before this point no longer trigger review. */
export function returnToQueue(state: AppState, id: string): AppState {
  requireRole(state, ['nurse'], 'Only a nurse clears a nurse review.');
  const fu = getFu(state, id);
  const p = patientOf(state, fu);
  const next = putFu(state, { ...fu, escalation: null, reviewedAtAttempt: fu.attempts.length, nextAttemptOn: null, routeOverride: null });
  return withAudit(next, 'nurse', 'returned_to_queue', p.regNo, 'Nurse reviewed; back to the normal contact route.');
}

export function assignChw(state: AppState, id: string): AppState {
  requireRole(state, ['nurse'], 'Only a nurse reassigns a follow-up to an ASHA visit.');
  const fu = getFu(state, id);
  const p = patientOf(state, fu);
  if (!p.consent.chw || !p.chwArea) fail('The patient has not agreed to ASHA home visits.');
  const next = putFu(state, { ...fu, escalation: null, routeOverride: 'chw', reviewedAtAttempt: fu.attempts.length, nextAttemptOn: null });
  return withAudit(next, 'nurse', 'chw_assigned', p.regNo, `Sent for an ASHA home visit (${p.chwArea}).`);
}

export function nextVisitOnly(state: AppState, id: string): AppState {
  requireRole(state, ['nurse'], 'Only a nurse decides to wait for the next visit.');
  const fu = getFu(state, id);
  const p = patientOf(state, fu);
  const next = putFu(state, { ...fu, escalation: null, routeOverride: 'none', reviewedAtAttempt: fu.attempts.length });
  return withAudit(next, 'nurse', 'returned_to_queue', p.regNo, 'Nurse decision: no further outreach; registration alert stays on.');
}

export function closeFollowUp(state: AppState, id: string, reason: ClosureReason | null, note: string): AppState {
  const fu = getFu(state, id);
  const p = patientOf(state, fu);
  const err = closeRuleError(state.role, fu, reason);
  if (err) fail(err);
  const next = putFu(state, {
    ...fu,
    escalation: null,
    closure: { on: state.today, by: state.role, reason: reason!, note: note.trim().slice(0, 280) },
  });
  return withAudit(next, state.role, 'closed', p.regNo, `${CLOSURE_LABEL[reason!]}${note.trim() ? `: ${note.trim()}` : ''}`);
}

/** Registration desk: the patient is here for their follow-up visit today. */
export function markReturned(state: AppState, id: string): AppState {
  requireRole(state, ['records', 'nurse'], 'Check-in is done at registration.');
  const fu = getFu(state, id);
  const p = patientOf(state, fu);
  if (fu.closure || fu.returnedOn) fail('This follow-up is already resolved.');
  if (fu.visitDate >= state.today) fail('The follow-up was created today.');
  const next = putFu(state, { ...fu, returnedOn: state.today, escalation: null, nextAttemptOn: null });
  return withAudit(next, state.role, 'returned', p.regNo, 'Registered at OPD for the follow-up visit.');
}

export function setRole(state: AppState, role: Role): AppState {
  return { ...state, role };
}

export function noteNumberViewed(state: AppState, id: string, whose: 'patient' | 'caregiver'): AppState {
  const fu = getFu(state, id);
  const p = patientOf(state, fu);
  return withAudit(state, state.role, 'number_viewed', p.regNo, `Viewed the ${whose}'s full phone number.`);
}

export function canSeeClinicalText(role: Role): boolean {
  return role === 'nurse';
}

export function noteClinicalTextViewed(state: AppState, id: string): AppState {
  if (!canSeeClinicalText(state.role)) fail("The clinician's text is visible to nurses only.");
  const fu = getFu(state, id);
  const p = patientOf(state, fu);
  return withAudit(state, state.role, 'clinical_text_viewed', p.regNo, "Opened the clinician's original instruction.");
}
