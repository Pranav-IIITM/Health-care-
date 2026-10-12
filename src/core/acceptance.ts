import { closeRuleError, confirmFollowUp, canSeeClinicalText, logAttempt, RuleError, type ContactUpdate } from './actions';
import { draftMessage } from './contact';
import { formatDate } from './dates';
import { DEPARTMENTS } from './policy';
import { proposalFrom, readInstruction } from './reader';
import { groundProposal, mergeSecondReading, scrubIdentifiers, type SecondProposal } from './secondReader';
import { createSeedState } from './seed';
import { statusOf } from './tracking';
import { channelFor, laneFor, scoreFor } from './worklist';
import type { AppState, DeptCode, FollowUp, Importance, Patient } from './types';

/*
 * Acceptance checks for Version 1. The same functions run in the test suite and on the
 * Case brief screen, so what the brief claims is what the code does.
 */

export interface CheckResult {
  pass: boolean;
  detail: string;
}

export interface AcceptanceCheck {
  id: string;
  title: string;
  requirement: string;
  run: () => CheckResult;
}

const VISIT = '2026-10-12';

const read = (instruction: string, department: DeptCode = 'MED') => readInstruction({ instruction, visitDate: VISIT, department });

function patient(over: Partial<Patient> = {}): Patient {
  return {
    id: 'pt',
    regNo: 'DH/2026/000001',
    name: 'Test Patient',
    age: 40,
    sex: 'F',
    village: 'Rampur',
    distanceKm: 12,
    phone: '9876543210',
    phoneOwner: 'self',
    phoneStatus: 'verified',
    caregiver: null,
    language: 'en',
    chwArea: 'Rampur',
    consent: { sms: true, call: true, caregiver: false, chw: true, recordedOn: VISIT, recordedBy: 'nurse' },
    ...over,
  };
}

function followUp(importance: Importance, dueDate: string, over: Partial<FollowUp> = {}): FollowUp {
  const reading = read('Review after 2 weeks');
  return {
    id: 'fx',
    patientId: 'pt',
    department: 'MED',
    clinician: 'Dr. Test',
    visitDate: '2026-09-01',
    instruction: 'Review after 2 weeks',
    reading,
    plan: {
      tracking: 'dated',
      dueDate,
      windowCloses: dueDate,
      importance,
      bring: [],
      notTrackedReason: null,
      confirmedBy: 'nurse',
      confirmedOn: '2026-09-01',
      corrections: [],
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
    ...over,
  };
}

const noContact: ContactUpdate = {
  phone: '',
  phoneOwner: 'none',
  phoneConfirmed: false,
  caregiverName: '',
  caregiverRelation: '',
  caregiverPhone: '',
  language: 'hi',
  chwArea: '',
  consent: { sms: false, call: false, caregiver: false, chw: false },
};

function throwsRule(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof RuleError ? e.message : null;
  }
}

function blankProposal(): SecondProposal {
  return {
    interval_value: 0,
    interval_unit: 'none',
    interval_evidence: '',
    date: '',
    date_evidence: '',
    no_fixed_date: 'none',
    no_fixed_date_evidence: '',
    condition_evidence: '',
    bring: [],
    emphasis: 'none',
    emphasis_evidence: '',
    precautions: [],
  };
}

let seedCache: AppState | null = null;
const seed = () => (seedCache ??= createSeedState());

export const ACCEPTANCE_CHECKS: AcceptanceCheck[] = [
  {
    id: 'AT-01',
    title: 'Shorthand becomes a proposed date; nothing is saved until the nurse confirms',
    requirement: 'FR-1, FR-2',
    run: () => {
      const r = read('Review after 2/52 with CBC, LFT');
      const p = proposalFrom(r);
      const state = { ...seed(), role: 'records' as const };
      const blocked = throwsRule(() =>
        confirmFollowUp(state, {
          deskItemId: state.desk[0].id,
          reading: r,
          tracking: 'dated',
          dueDate: p.dueDate,
          importance: 'routine',
          bring: p.bring,
          notTrackedReason: '',
          contact: noContact,
        }),
      );
      const pass = p.dueDate === '2026-10-26' && p.bring.join() === 'CBC report,LFT report' && blocked !== null;
      return { pass, detail: `Proposed ${p.dueDate}, bring [${p.bring.join(', ')}]; confirming as records staff is refused: "${blocked}"` };
    },
  },
  {
    id: 'AT-02',
    title: 'No date is invented for SOS',
    requirement: 'FR-3',
    run: () => {
      const r = read('SOS', 'EYE');
      const p = proposalFrom(r);
      const pass = r.options.length === 0 && p.dueDate === null && r.flags.some((f) => f.code === 'no_fixed_date' && f.level === 'decide');
      return { pass, detail: `${r.options.length} dates proposed; flag: ${r.flags.map((f) => f.code).join(', ')}` };
    },
  },
  {
    id: 'AT-03',
    title: 'Contradictory instructions are shown side by side, not resolved by the system',
    requirement: 'FR-3',
    run: () => {
      const r = read('R/V 1 wk / 10 days with X-ray', 'ORTHO');
      const p = proposalFrom(r);
      const pass = r.options.length === 2 && p.dueDate === null && r.flags.some((f) => f.code === 'conflict');
      return { pass, detail: `Options: ${r.options.map((o) => o.dueDate).join(' vs ')}; proposed date: ${p.dueDate ?? 'none'}` };
    },
  },
  {
    id: 'AT-04',
    title: 'Medicine durations are not mistaken for the follow-up time',
    requirement: 'FR-2',
    run: () => {
      const r = read('Review after 1 month with FBS. Tab Metformin 500 mg BD x 30 days');
      const pass = r.options.length === 1 && r.options[0].label === '1 month';
      return { pass, detail: `Read: ${r.options.map((o) => o.label).join(', ')}; set aside: ${r.flags.filter((f) => f.code === 'duration_ignored').length}` };
    },
  },
  {
    id: 'AT-05',
    title: 'Conditional and event-based returns need a human decision',
    requirement: 'FR-3',
    run: () => {
      const cond = read('Review after 3 days if fever persists', 'PAED');
      const event = read('Review after completing ATT intensive phase', 'CHEST');
      const pass =
        proposalFrom(cond).tracking === null &&
        cond.flags.some((f) => f.code === 'conditional') &&
        proposalFrom(event).dueDate === null &&
        event.flags.some((f) => f.code === 'event_based');
      return { pass, detail: `Conditional: ${proposalFrom(cond).tracking ?? 'a person decides'}. Event-based: ${proposalFrom(event).dueDate ?? 'no date proposed'}.` };
    },
  },
  {
    id: 'AT-06',
    title: 'Importance is never set by the system',
    requirement: 'FR-4',
    run: () => {
      const state = { ...seed(), role: 'nurse' as const };
      const r = read('Review after 2 weeks without fail');
      const blocked = throwsRule(() =>
        confirmFollowUp(state, {
          deskItemId: state.desk[0].id,
          reading: r,
          tracking: 'dated',
          dueDate: '2026-10-26',
          importance: null,
          bring: [],
          notTrackedReason: '',
          contact: noContact,
        }),
      );
      const pass = r.importanceHint?.level === 'must_not_miss' && blocked !== null;
      return { pass, detail: `Hint from "${r.importanceHint?.span.text}" is only a suggestion; confirming without a choice is refused: "${blocked}"` };
    },
  },
  {
    id: 'AT-07',
    title: 'No message names the department, a test or the clinician’s words',
    requirement: 'FR-9, privacy',
    run: () => {
      const s = seed();
      const banned = Object.values(DEPARTMENTS).flatMap((d) => [d.name, d.short, d.nameHi]);
      const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const contains = (text: string, w: string) => new RegExp(`(^|[^\\p{L}])${escape(w)}([^\\p{L}]|$)`, 'iu').test(text);
      let checked = 0;
      const leaks: string[] = [];
      for (const fu of s.followUps) {
        const p = s.patients[fu.patientId];
        for (const kind of ['reminder', 'missed'] as const) {
          for (const channel of ['phone', 'caregiver'] as const) {
            const m = draftMessage(kind, fu, p, channel);
            if (!m) continue;
            checked++;
            const words = [...banned, ...fu.plan.bring.filter((b) => b !== 'OPD card'), fu.instruction];
            const hit = words.find((w) => contains(m.text, w));
            if (hit) leaks.push(`${p.regNo}: "${hit}"`);
            if (p.phoneOwner === 'shared' && m.audience !== 'household') leaks.push(`${p.regNo}: shared phone got a personal template`);
          }
        }
      }
      return { pass: checked > 0 && leaks.length === 0, detail: `${checked} messages checked; ${leaks.length ? leaks.slice(0, 3).join('; ') : 'no leaks'}` };
    },
  },
  {
    id: 'AT-08',
    title: 'Reachability changes the route, never the rank',
    requirement: 'FR-7, fairness',
    run: () => {
      const today = '2026-10-12';
      const fu = followUp('important', '2026-10-01');
      const reachable = patient();
      const unreachable = patient({ phoneStatus: 'unreachable' });
      const a = scoreFor(fu, today).score;
      const b = scoreFor(fu, today).score;
      const laneA = laneFor(fu, reachable, statusOf(fu, today), today);
      const laneB = laneFor(fu, unreachable, statusOf(fu, today), today);
      const pass = a === b && laneA === 'call' && laneB === 'chw';
      return { pass, detail: `Score ${a} vs ${b}; route ${laneA} vs ${laneB}` };
    },
  },
  {
    id: 'AT-09',
    title: 'Must-not-miss comes first; routine patients rise as they wait',
    requirement: 'FR-7',
    run: () => {
      const today = '2026-11-15';
      const mnm = scoreFor(followUp('must_not_miss', '2026-11-14'), today).score;
      const routineOld = scoreFor(followUp('routine', '2026-10-16'), today).score;
      const routine25 = scoreFor(followUp('routine', '2026-10-21'), today).score;
      const importantNew = scoreFor(followUp('important', '2026-11-14'), today).score;
      const pass = mnm > routineOld && routine25 > importantNew;
      return { pass, detail: `Must-not-miss 1 day late ${mnm} > routine 30 days late ${routineOld}; routine 25 days late ${routine25} > important 1 day late ${importantNew}` };
    },
  },
  {
    id: 'AT-10',
    title: 'Nothing is closed silently',
    requirement: 'FR-11, accountability',
    run: () => {
      const routine = followUp('routine', '2026-10-01');
      const mnm = followUp('must_not_miss', '2026-10-01');
      const noReason = closeRuleError('records', routine, null);
      const mnmByRecords = closeRuleError('records', mnm, 'care_elsewhere');
      const base = seed();
      const declined = logAttempt(
        { ...base, role: 'records', today: '2026-10-12', followUps: [routine], patients: { pt: patient() } },
        'fx',
        { channel: 'phone', outcome: 'declined', plannedDate: null, barrier: null, note: '' },
      ).followUps[0];
      const pass = noReason !== null && mnmByRecords !== null && declined.closure === null && declined.escalation !== null;
      return { pass, detail: `No reason: "${noReason}" Must-not-miss by records staff: "${mnmByRecords}" "Declined" logged by records staff goes to a nurse.` };
    },
  },
  {
    id: 'AT-11',
    title: "The clinician's words are visible to nurses only",
    requirement: 'Privacy',
    run: () => {
      const pass = canSeeClinicalText('nurse') && !canSeeClinicalText('records') && !canSeeClinicalText('chw') && !canSeeClinicalText('admin');
      return { pass, detail: 'nurse: yes · records: no · ASHA: no · admin: no' };
    },
  },
  {
    id: 'AT-12',
    title: '"Missed" is arithmetic on confirmed dates, and "returned" comes from registration',
    requirement: 'FR-5',
    run: () => {
      const fu = followUp('routine', '2026-10-01', { plan: { ...followUp('routine', '2026-10-01').plan, windowCloses: '2026-10-08' } });
      const onTheDay = statusOf(fu, '2026-10-08');
      const after = statusOf(fu, '2026-10-09');
      const back = statusOf({ ...fu, returnedOn: '2026-10-05' }, '2026-10-20');
      const pass = onTheDay === 'due' && after === 'missed' && back === 'returned_on_time';
      return { pass, detail: `8 Oct: ${onTheDay} · 9 Oct: ${after} · registered 5 Oct: ${back}` };
    },
  },
  {
    id: 'AT-13',
    title: 'Due dates land on days the OPD actually runs',
    requirement: 'FR-2',
    run: () => {
      const r = read('Review after 10 days', 'ENT');
      const o = r.options[0];
      const pass = o.rawDue === '2026-10-22' && o.dueDate === '2026-10-23';
      return { pass, detail: `${formatDate(o.rawDue, 'long')} moved to ${formatDate(o.dueDate, 'long')} (ENT runs Tue, Fri)` };
    },
  },
  {
    id: 'AT-14',
    title: "Gemini's answer is kept only where it quotes the instruction",
    requirement: 'FR-12, AI safety',
    run: () => {
      const ctx = { instruction: 'Review after 2/52 with CBC', visitDate: VISIT, department: 'MED' as DeptCode };
      const rules = readInstruction(ctx);
      const invented = groundProposal(
        { ...blankProposal(), interval_value: 3, interval_unit: 'week', interval_evidence: 'after 3 weeks', bring: [{ item: 'LFT report', evidence: 'LFT' }] },
        ctx,
      );
      const agreeing = mergeSecondReading(
        rules,
        groundProposal({ ...blankProposal(), interval_value: 2, interval_unit: 'week', interval_evidence: 'after 2/52' }, ctx),
      );
      const ctx2 = { ...ctx, instruction: 'Review after 2 weeks or Diwali ke baad' };
      const disagreeing = mergeSecondReading(
        readInstruction(ctx2),
        groundProposal({ ...blankProposal(), date: '2026-11-09', date_evidence: 'Diwali ke baad' }, ctx2),
      );
      const pass =
        invented.options.length === 0 &&
        invented.bring.length === 0 &&
        invented.discarded.length === 2 &&
        agreeing.flags.some((f) => f.code === 'llm_agrees') &&
        disagreeing.flags.some((f) => f.code === 'llm_disagrees' && f.level === 'decide') &&
        proposalFrom(disagreeing).dueDate === null;
      return { pass, detail: `Invented values discarded: ${invented.discarded.length}; agreement noted; a disagreement goes to the nurse` };
    },
  },
  {
    id: 'AT-15',
    title: 'Identifiers are removed before any text goes to Gemini',
    requirement: 'Privacy',
    run: () => {
      const out = scrubIdentifiers('Call 98261 04473 or DH/2026/041273. Review after 2/52 with CBC');
      const pass = !/\d{5}\s?\d{5}/.test(out) && !out.includes('DH/2026') && out.includes('2/52');
      return { pass, detail: out };
    },
  },
  {
    id: 'AT-16',
    title: 'Every contact route needs recorded consent',
    requirement: 'FR-8, consent',
    run: () => {
      const fu = followUp('routine', '2026-10-01');
      const noCall = channelFor(fu, patient({ consent: { ...patient().consent, call: false, chw: false } }));
      const state = { ...seed(), role: 'nurse' as const };
      const smsWithoutPhone = throwsRule(() =>
        confirmFollowUp(state, {
          deskItemId: state.desk[0].id,
          reading: read('Review after 2 weeks'),
          tracking: 'dated',
          dueDate: '2026-10-26',
          importance: 'routine',
          bring: [],
          notTrackedReason: '',
          contact: { ...noContact, consent: { ...noContact.consent, sms: true } },
        }),
      );
      const pass = noCall === 'none' && smsWithoutPhone !== null;
      return { pass, detail: `Without call or visit consent the route is "${noCall}". SMS consent without a number is refused: "${smsWithoutPhone}"` };
    },
  },
];

export function runAcceptanceChecks(): (AcceptanceCheck & CheckResult)[] {
  return ACCEPTANCE_CHECKS.map((c) => {
    try {
      return { ...c, ...c.run() };
    } catch (e) {
      return { ...c, pass: false, detail: `Error: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
