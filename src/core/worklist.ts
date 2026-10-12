import { addDays, formatDate, plural } from './dates';
import {
  IMPORTANCE_LABEL,
  MAX_CHW_ATTEMPTS,
  MAX_PHONE_ATTEMPTS,
  MUST_NOT_MISS_REVIEW_AFTER,
  RANK_WEIGHTS,
  REMINDER_DAYS_BEFORE,
} from './policy';
import { brokenPromise, daysPastWindow, effectiveDue, statusOf } from './tracking';
import type { AppState, Channel, FollowUp, ISODate, Lane, Outcome, Patient, Status } from './types';

export interface ScorePart {
  label: string;
  points: number;
}

export interface WorkItem {
  fu: FollowUp;
  patient: Patient;
  status: Status;
  lane: Lane;
  channel: Channel;
  score: number;
  scoreParts: ScorePart[];
  reasons: string[];
  daysLate: number;
  /** A retry is scheduled for a later day; the item waits below today's list. */
  waitingUntil: ISODate | null;
}

const FAILED: ReadonlySet<Outcome> = new Set<Outcome>(['no_answer', 'wrong_number', 'not_found']);

export function failedAttempts(fu: FollowUp, channel?: Channel, sinceIndex = 0): number {
  return fu.attempts
    .slice(sinceIndex)
    .filter((a) => FAILED.has(a.outcome) && (channel === undefined || a.channel === channel)).length;
}

export function phoneUsable(p: Patient): boolean {
  return p.phone !== null && p.phoneOwner !== 'none' && p.phoneStatus !== 'unreachable';
}

export function canRemind(p: Patient): boolean {
  return phoneUsable(p) && p.consent.sms;
}

/** First consented route that has not been exhausted. Consent is never assumed. */
export function channelFor(fu: FollowUp, p: Patient): Channel {
  if (fu.routeOverride) return fu.routeOverride;
  if (phoneUsable(p) && p.consent.call && failedAttempts(fu, 'phone') < MAX_PHONE_ATTEMPTS) return 'phone';
  if (p.caregiver?.phone && p.consent.caregiver && failedAttempts(fu, 'caregiver') < MAX_PHONE_ATTEMPTS) return 'caregiver';
  if (p.consent.chw && p.chwArea && failedAttempts(fu, 'chw') < MAX_CHW_ATTEMPTS) return 'chw';
  return 'none';
}

export function laneFor(fu: FollowUp, p: Patient, status: Status, today: ISODate): Lane | null {
  if (status === 'due' && !fu.reminderSentOn && !fu.rescheduledTo && canRemind(p)) {
    const due = effectiveDue(fu);
    if (due && today >= addDays(due, -REMINDER_DAYS_BEFORE) && today <= due) return 'reminder';
  }
  if (status !== 'missed') return null;
  if (fu.escalation) return 'nurse';
  if (
    fu.plan.importance === 'must_not_miss' &&
    failedAttempts(fu, undefined, fu.reviewedAtAttempt) >= MUST_NOT_MISS_REVIEW_AFTER
  ) {
    return 'nurse';
  }
  const channel = channelFor(fu, p);
  if (channel === 'phone' || channel === 'caregiver') return 'call';
  if (channel === 'chw') return 'chw';
  return fu.plan.importance === 'must_not_miss' && fu.routeOverride !== 'none' ? 'nurse' : 'next_visit';
}

/**
 * Published ordering rule. Clinician-set importance first, then lateness, so routine
 * patients rise as they wait and are never starved. Reachability is not an input.
 */
export function scoreFor(fu: FollowUp, today: ISODate): { score: number; parts: ScorePart[] } {
  const parts: ScorePart[] = [
    { label: `${IMPORTANCE_LABEL[fu.plan.importance]} (clinician)`, points: RANK_WEIGHTS.importance[fu.plan.importance] },
  ];
  const late = Math.min(daysPastWindow(fu, today), RANK_WEIGHTS.maxLateDays);
  if (late > 0) parts.push({ label: `${plural(late, 'day')} past the window`, points: late * RANK_WEIGHTS.perDayLate });
  if (fu.attempts.length === 0) parts.push({ label: 'Not contacted yet', points: RANK_WEIGHTS.firstContact });
  if (brokenPromise(fu, today)) parts.push({ label: 'Missed a date agreed on a call', points: RANK_WEIGHTS.brokenPromise });
  return { score: parts.reduce((s, p) => s + p.points, 0), parts };
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  will_come: 'Reached, will come',
  needs_support: 'Reached, needs support to come',
  clinical_question: 'Reached, has a clinical question',
  care_elsewhere: 'Care continued elsewhere',
  declined: 'Declined follow-up',
  moved_away: 'Moved away',
  deceased: 'Deceased',
  no_answer: 'No answer',
  wrong_number: 'Wrong / switched-off number',
  not_found: 'Not found at home',
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  phone: 'Phone',
  caregiver: 'Caregiver',
  chw: 'ASHA visit',
  none: 'No consented route',
};

function reasonsFor(fu: FollowUp, p: Patient, channel: Channel, today: ISODate, daysLate: number): string[] {
  const out: string[] = [IMPORTANCE_LABEL[fu.plan.importance]];
  if (daysLate > 0) out.push(`${plural(daysLate, 'day')} past window`);
  if (fu.attempts.length === 0) out.push('Not contacted yet');
  else {
    const last = fu.attempts[fu.attempts.length - 1];
    out.push(`${plural(fu.attempts.length, 'attempt')}, last one ${OUTCOME_LABEL[last.outcome].toLowerCase()} (${formatDate(last.on, 'short')})`);
  }
  if (brokenPromise(fu, today) && fu.rescheduledTo) out.push(`Agreed ${formatDate(fu.rescheduledTo, 'short')}, did not come`);
  if (fu.escalation) out.push(`Escalated: ${fu.escalation.reason}`);
  if (channel === 'phone' && p.phoneOwner === 'shared') out.push('Shared phone: privacy script');
  if (channel === 'caregiver' && p.caregiver) out.push(`Via ${p.caregiver.relation} (${p.caregiver.name})`);
  if (channel === 'chw' && p.chwArea) out.push(`ASHA area: ${p.chwArea}`);
  if (channel === 'none') out.push('No consented contact route');
  return out;
}

export function buildWorkItems(state: AppState): WorkItem[] {
  const items: WorkItem[] = [];
  for (const fu of state.followUps) {
    const patient = state.patients[fu.patientId];
    if (!patient) continue;
    const status = statusOf(fu, state.today);
    const lane = laneFor(fu, patient, status, state.today);
    if (!lane) continue;
    const channel = channelFor(fu, patient);
    const { score, parts } = scoreFor(fu, state.today);
    const daysLate = daysPastWindow(fu, state.today);
    items.push({
      fu,
      patient,
      status,
      lane,
      channel,
      score,
      scoreParts: parts,
      reasons: reasonsFor(fu, patient, channel, state.today, daysLate),
      daysLate,
      waitingUntil: fu.nextAttemptOn && fu.nextAttemptOn > state.today ? fu.nextAttemptOn : null,
    });
  }
  return items.sort(compareItems);
}

export function compareItems(a: WorkItem, b: WorkItem): number {
  if (!!a.waitingUntil !== !!b.waitingUntil) return a.waitingUntil ? 1 : -1;
  if (a.score !== b.score) return b.score - a.score;
  const ad = effectiveDue(a.fu) ?? '';
  const bd = effectiveDue(b.fu) ?? '';
  if (ad !== bd) return ad < bd ? -1 : 1;
  return a.patient.regNo < b.patient.regNo ? -1 : 1;
}

export const LANE_META: Record<Lane, { title: string; owner: string; blurb: string }> = {
  call: {
    title: 'Call queue',
    owner: 'Records staff',
    blurb: 'Missed follow-ups with a consented phone route. Work top-down.',
  },
  chw: {
    title: 'ASHA visits',
    owner: 'ASHA / community health worker',
    blurb: 'No working phone, but the patient agreed to a home visit.',
  },
  nurse: {
    title: 'Nurse review',
    owner: 'Nurse',
    blurb: 'Escalations, closure requests, and must-not-miss patients after two failed attempts.',
  },
  next_visit: {
    title: 'Next-visit alerts',
    owner: 'Registration (automatic)',
    blurb: 'No consented route. Registration is alerted if the patient comes to the hospital for any reason.',
  },
  reminder: {
    title: 'Reminders due',
    owner: 'Records staff',
    blurb: 'Due in the next two days with SMS consent. Sent as a batch.',
  },
};

export const LANE_ORDER: Lane[] = ['call', 'chw', 'nurse', 'next_visit', 'reminder'];
