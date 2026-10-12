import { addDays, diffDays, formatDate } from './dates';
import { isOpdDay, nextOpdDay } from './policy';
import { proposalFrom, readInstruction } from './reader';
import { BARRIER_LABEL, CLOSURE_LABEL } from './actions';
import { fateFor, mulberry32 } from './simulation';
import { windowCloses } from './tracking';
import { CHANNEL_LABEL, channelFor, OUTCOME_LABEL } from './worklist';
import type {
  AppState,
  Attempt,
  AuditEntry,
  Barrier,
  Caregiver,
  Channel,
  CorrectionField,
  DeptCode,
  DeskItem,
  FollowUp,
  Importance,
  ISODate,
  Lang,
  Outcome,
  Patient,
  PhoneOwner,
  PhoneStatus,
  Role,
} from './types';

/*
 * SIMULATED DATA. Names, places, numbers and outcomes are generated for the
 * prototype. Proportions echo the case file (28% missed, 19% shared phones,
 * 7% unreachable); they are not real statistics about any hospital or community.
 */

export const SEED_TODAY: ISODate = '2026-10-12';
const SEED = 20261012;
const HISTORY_SIZE = 340;
const HISTORY_DAYS = 120;
const NOT_TRACKED_SIZE = 12;

const VILLAGES: { name: string; km: number }[] = [
  { name: 'Ward 7 (town)', km: 2 },
  { name: 'Ward 12 (town)', km: 3 },
  { name: 'Ward 18 (town)', km: 4 },
  { name: 'Nayagaon', km: 9 },
  { name: 'Rampur', km: 12 },
  { name: 'Barkheda', km: 15 },
  { name: 'Kishanpur', km: 18 },
  { name: 'Sultanpur', km: 24 },
  { name: 'Gopalpur', km: 27 },
  { name: 'Chandpur', km: 31 },
  { name: 'Khajuri', km: 35 },
  { name: 'Bhagwanpura', km: 38 },
  { name: 'Lakhanpur', km: 44 },
  { name: 'Devgarh', km: 47 },
  { name: 'Madhopur', km: 52 },
  { name: 'Pipraun', km: 58 },
  { name: 'Hasanpur', km: 61 },
  { name: 'Sirsa Khurd', km: 72 },
];

export const ASHA_AREAS = VILLAGES.map((v) => v.name);

const NAMES = {
  F: ['Sunita', 'Geeta', 'Kamla', 'Pooja', 'Rekha', 'Meena', 'Savitri', 'Lakshmi', 'Neha', 'Ramvati', 'Phoolwati', 'Babita', 'Anita', 'Suman', 'Radha', 'Asha', 'Kiran', 'Sushila', 'Saroj', 'Mamta', 'Seema', 'Usha', 'Parvati', 'Komal', 'Priyanka', 'Rani', 'Jyoti', 'Kusum', 'Hemlata', 'Nirmala', 'Shanti'],
  M: ['Ramesh', 'Suresh', 'Mahesh', 'Rajendra', 'Anil', 'Arjun', 'Ravi', 'Ganga Ram', 'Santosh', 'Dinesh', 'Mukesh', 'Rakesh', 'Vikram', 'Sunil', 'Rajesh', 'Harish', 'Bhagwan Das', 'Ram Prakash', 'Deepak', 'Govind', 'Hari Om', 'Manoj', 'Shyam', 'Prem Singh', 'Raju', 'Naresh', 'Brijesh', 'Lalaram', 'Mohan', 'Jagdish'],
  surnames: ['Kushwaha', 'Jatav', 'Baghel', 'Yadav', 'Prajapati', 'Sharma', 'Rawat', 'Gurjar', 'Verma', 'Lodhi', 'Rathore', 'Tomar', 'Sahu', 'Shakya', 'Pal', 'Dhakad', 'Kori', 'Mahor', 'Gupta', 'Tiwari', 'Mishra', 'Singh', 'Parihar', 'Batham', 'Chauhan'],
  FMuslim: ['Shabnam', 'Rubina', 'Farzana', 'Reshma', 'Nasreen', 'Salma'],
  MMuslim: ['Imran', 'Irfan', 'Salim', 'Asif', 'Javed', 'Rafiq'],
  muslimSurnames: ['Khan', 'Ansari', 'Qureshi', 'Mansuri', 'Sheikh'],
};

const CLINICIANS: Record<DeptCode, string[]> = {
  MED: ['Dr. A. Sharma', 'Dr. R. Yadav'],
  OBG: ['Dr. S. Mishra'],
  PAED: ['Dr. N. Gupta'],
  ORTHO: ['Dr. R. Verma'],
  SURG: ['Dr. V. Tiwari'],
  EYE: ['Dr. P. Singh'],
  ENT: ['Dr. M. Khan'],
  PSY: ['Dr. S. Jain'],
  CHEST: ['Dr. K. Tomar'],
};

const DEPT_WEIGHTS: [DeptCode, number][] = [
  ['MED', 30], ['OBG', 15], ['PAED', 12], ['ORTHO', 12], ['SURG', 10], ['EYE', 8], ['ENT', 5], ['PSY', 4], ['CHEST', 4],
];

/** Clear instructions used for the history. Every one must read with exactly one date and no open decision. */
export const HISTORY_INSTRUCTIONS: Record<DeptCode, string[]> = {
  MED: [
    'Review after 2 weeks with FBS, PPBS reports',
    'R/V after 1 month with lipid profile. Continue Tab Atorvastatin 10 mg x 30 days',
    'Review after 2/52 with CBC, LFT',
    'F/U 15 days with BP record',
    'Review after 1 month with HbA1c, bring all medicines',
    'Review after 10 days with KFT report',
    '1 mahine baad dikhayen, sugar report lekar aayen',
    'Review after 1 week with BP record, earlier if needed',
  ],
  OBG: [
    'ANC review after 4 weeks with Hb, urine routine. Bring MCP card',
    'Review after 2 weeks with USG report without fail',
    'Review after 1 week for BP check, come immediately if bleeding or headache',
    'Review after 6 weeks',
  ],
  PAED: ['Review after 5 days, weight check', 'R/V 1 wk with CBC', 'Review after 1 month for growth monitoring, bring MCP card'],
  ORTHO: ['Review after 6 weeks with X-ray', 'POP check after 3 weeks', 'Review after 2/52 with X-ray, come earlier if swelling increases'],
  SURG: ['Suture removal after 10 days', 'Dressing after 3 days', 'Review with biopsy report after 2 weeks without fail', 'Review after 1 month with USG'],
  EYE: ['Post-op review after 1 wk', 'Review after 1 month', 'Review after 3/12 for glasses'],
  ENT: ['Review after 10 days', 'Review after 2 weeks with audiometry report'],
  PSY: ['Review after 2 weeks, compliance check. Must come', 'F/U 1 month, bring all medicines'],
  CHEST: ['Review after 2 months with sputum AFB report without fail', 'Monthly review, collect medicines', 'Review after 1 month with CXR'],
};

const NOT_TRACKED_INSTRUCTIONS: [DeptCode, string][] = [
  ['EYE', 'SOS'],
  ['ENT', 'Review SOS'],
  ['MED', 'PRN'],
  ['ORTHO', 'Review if needed'],
];

interface DeskSeed {
  name: string;
  age: number;
  sex: 'F' | 'M';
  village: string;
  dept: DeptCode;
  clinician: string;
  instruction: string;
  phone: string | null;
  owner: PhoneOwner;
  caregiver: Caregiver | null;
  language: Lang;
}

/** Patients leaving OPD on the simulated "today" (a Monday). Each shows a different reading behaviour. */
const DESK: DeskSeed[] = [
  { name: 'Sunita Devi', age: 52, sex: 'F', village: 'Kishanpur', dept: 'MED', clinician: 'Dr. A. Sharma', instruction: 'Review after 2/52 with CBC, LFT. Tab Metformin 500 mg BD x 14 days.', phone: '9826104473', owner: 'self', caregiver: null, language: 'hi' },
  { name: 'Ramesh Kushwaha', age: 34, sex: 'M', village: 'Rampur', dept: 'ORTHO', clinician: 'Dr. R. Verma', instruction: 'R/V 1 wk / 10 days with X-ray', phone: '9754312208', owner: 'self', caregiver: null, language: 'hi' },
  { name: 'Pooja Jatav', age: 24, sex: 'F', village: 'Lakhanpur', dept: 'OBG', clinician: 'Dr. S. Mishra', instruction: 'ANC review after 4 weeks with Hb, urine routine, bring MCP card. Come immediately if bleeding or severe headache. Without fail.', phone: '9131287745', owner: 'shared', caregiver: { name: 'Manoj Jatav', relation: 'husband', phone: '9131287745' }, language: 'hi' },
  { name: 'Arjun Rawat', age: 6, sex: 'M', village: 'Nayagaon', dept: 'PAED', clinician: 'Dr. N. Gupta', instruction: 'Review after 3 days if fever persists', phone: '9893350126', owner: 'shared', caregiver: { name: 'Seema Rawat', relation: 'mother', phone: null }, language: 'hi' },
  { name: 'Kamla Bai', age: 67, sex: 'F', village: 'Devgarh', dept: 'EYE', clinician: 'Dr. P. Singh', instruction: 'SOS', phone: '7898023391', owner: 'shared', caregiver: { name: 'Hari Om', relation: 'son', phone: '9425670012' }, language: 'hi' },
  { name: 'Imran Khan', age: 45, sex: 'M', village: 'Hasanpur', dept: 'CHEST', clinician: 'Dr. K. Tomar', instruction: 'Review after completing ATT intensive phase with sputum AFB', phone: '8817045530', owner: 'self', caregiver: null, language: 'hi' },
  { name: 'Geeta Prajapati', age: 38, sex: 'F', village: 'Sultanpur', dept: 'MED', clinician: 'Dr. R. Yadav', instruction: '2 hafte baad dikhayen, sugar report lekar aayen', phone: null, owner: 'none', caregiver: null, language: 'hi' },
  { name: 'Mahesh Baghel', age: 58, sex: 'M', village: 'Ward 12 (town)', dept: 'EYE', clinician: 'Dr. P. Singh', instruction: 'Post-op review on 22/10. Continue eye drops x 2 weeks', phone: '9300418862', owner: 'self', caregiver: null, language: 'en' },
  { name: 'Savitri Lodhi', age: 63, sex: 'F', village: 'Chandpur', dept: 'MED', clinician: 'Dr. A. Sharma', instruction: 'Review 6/12 with ECG', phone: '9009561137', owner: 'self', caregiver: null, language: 'hi' },
];

function prevOpdDay(iso: ISODate, dept: DeptCode): ISODate {
  let d = iso;
  for (let i = 0; i < 14; i++) {
    if (isOpdDay(d, dept)) return d;
    d = addDays(d, -1);
  }
  return iso;
}

export function createSeedState(): AppState {
  const rand = mulberry32(SEED);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
  const chance = (p: number) => rand() < p;
  const weighted = <T,>(items: [T, number][]): T => {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [v, w] of items) {
      if ((r -= w) < 0) return v;
    }
    return items[items.length - 1][0];
  };
  const mobile = () => `${pick(['6', '7', '8', '9', '9', '9'])}${Array.from({ length: 9 }, () => Math.floor(rand() * 10)).join('')}`;

  const patients: Record<string, Patient> = {};
  const followUps: FollowUp[] = [];
  const fates: Record<string, ISODate | null> = {};
  const audit: Omit<AuditEntry, 'seq'>[] = [];
  const householdPhones: Record<string, string[]> = {};
  let regSeq = 41020;
  let patientSeq = 0;

  const regNo = () => `DH/2026/${String(regSeq++).padStart(6, '0')}`;

  function newPatient(dept: DeptCode, visit: ISODate): Patient {
    const muslim = chance(0.12);
    const sex: 'F' | 'M' = dept === 'OBG' ? 'F' : chance(0.52) ? 'F' : 'M';
    const age = dept === 'PAED' ? 1 + Math.floor(rand() * 12) : dept === 'OBG' ? 19 + Math.floor(rand() * 18) : 18 + Math.floor(rand() * 64);
    const first = pick(sex === 'F' ? (muslim ? NAMES.FMuslim : NAMES.F) : muslim ? NAMES.MMuslim : NAMES.M);
    const surname = muslim ? pick(NAMES.muslimSurnames) : sex === 'F' && chance(0.3) ? pick(['Devi', 'Bai']) : pick(NAMES.surnames);
    const village = pick(VILLAGES);

    let phone: string | null;
    let owner: PhoneOwner;
    let status: PhoneStatus;
    const r = rand();
    if (r < 0.07) {
      phone = mobile();
      owner = 'self';
      status = 'unreachable';
    } else if (r < 0.26 || dept === 'PAED') {
      const pool = (householdPhones[village.name] ??= []);
      phone = pool.length && chance(0.45) ? pick(pool) : mobile();
      if (!pool.includes(phone)) pool.push(phone);
      owner = 'shared';
      status = chance(0.6) ? 'verified' : 'unverified';
    } else {
      phone = mobile();
      owner = 'self';
      status = chance(0.7) ? 'verified' : 'unverified';
    }

    let caregiver: Caregiver | null = null;
    if (dept === 'PAED' || age > 65 || chance(0.25)) {
      const relation =
        dept === 'PAED' ? pick(['mother', 'father']) : age > 65 ? pick(['son', 'daughter', 'daughter-in-law']) : sex === 'F' ? pick(['husband', 'brother', 'son']) : pick(['wife', 'brother', 'son']);
      const cgSex = ['mother', 'daughter', 'daughter-in-law', 'wife'].includes(relation) ? 'F' : 'M';
      caregiver = {
        name: `${pick(cgSex === 'F' ? (muslim ? NAMES.FMuslim : NAMES.F) : muslim ? NAMES.MMuslim : NAMES.M)} ${surname === 'Devi' || surname === 'Bai' ? pick(NAMES.surnames) : surname}`,
        relation,
        phone: chance(0.65) ? mobile() : null,
      };
    }

    const id = `p${++patientSeq}`;
    const patient: Patient = {
      id,
      regNo: regNo(),
      name: `${first} ${surname}`,
      age,
      sex,
      village: village.name,
      distanceKm: village.km,
      phone,
      phoneOwner: owner,
      phoneStatus: status,
      caregiver,
      language: chance(0.82) ? 'hi' : 'en',
      chwArea: village.name,
      consent: {
        sms: chance(0.86),
        call: chance(0.93),
        caregiver: caregiver?.phone ? chance(0.6) : false,
        chw: chance(0.58),
        recordedOn: visit,
        recordedBy: 'nurse',
      },
    };
    patients[id] = patient;
    return patient;
  }

  function importanceFor(dept: DeptCode): Importance {
    const high = dept === 'OBG' || dept === 'CHEST' || dept === 'PSY';
    return weighted<Importance>([
      ['must_not_miss', high ? 20 : 10],
      ['important', high ? 45 : 33],
      ['routine', high ? 35 : 57],
    ]);
  }

  function sampleOutcome(channel: Channel, p: Patient): Outcome {
    if (channel === 'chw') {
      return weighted<Outcome>([['will_come', 50], ['not_found', 30], ['needs_support', 15], ['care_elsewhere', 5]]);
    }
    if (p.phoneStatus === 'unreachable' && channel === 'phone') return 'wrong_number';
    const shared = channel === 'phone' && p.phoneOwner === 'shared';
    return weighted<Outcome>([
      ['no_answer', shared ? 55 : 42],
      ['will_come', shared ? 22 : 30],
      ['needs_support', 8],
      ['clinical_question', 4],
      ['care_elsewhere', 5],
      ['wrong_number', shared ? 8 : 6],
    ]);
  }

  const recent = (d: ISODate, days: number) => diffDays(d, SEED_TODAY) <= days;

  /** Records staff worked some of the misses before "today". */
  function simulateOutreach(fu: FollowUp, p: Patient, from: ISODate, until: ISODate) {
    let day = nextOpdDay(addDays(from, Math.floor(rand() * 3)), 'MED');
    const tries = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < tries && day <= until; k++) {
      const channel = channelFor(fu, p);
      if (channel === 'none') break;
      const outcome = sampleOutcome(channel, p);
      const by: Role = channel === 'chw' ? 'chw' : 'records';
      const attempt: Attempt = { on: day, by, channel, outcome, plannedDate: null, barrier: null, note: '' };
      let stop = true;
      let extra = '';
      switch (outcome) {
        case 'will_come': {
          const planned = nextOpdDay(addDays(day, 2 + Math.floor(rand() * 5)), fu.department);
          attempt.plannedDate = planned;
          fu.rescheduledTo = planned;
          extra = `, agreed ${formatDate(planned, 'long')}`;
          if (planned < SEED_TODAY && !fu.returnedOn && chance(0.6)) {
            fu.returnedOn = planned;
            fates[fu.id] = planned;
          }
          break;
        }
        case 'needs_support': {
          const barrier = weighted<Barrier>([['transport', 40], ['cost', 20], ['no_escort', 15], ['work', 15], ['feels_better', 10]]);
          attempt.barrier = barrier;
          fu.escalation = { on: day, by, reason: `Needs support to come: ${BARRIER_LABEL[barrier].toLowerCase()}` };
          extra = `, ${BARRIER_LABEL[barrier].toLowerCase()}`;
          break;
        }
        case 'clinical_question':
          fu.escalation = { on: day, by, reason: 'Clinical question or new symptoms: nurse to call back' };
          break;
        case 'care_elsewhere':
          if (fu.plan.importance === 'must_not_miss') {
            fu.escalation = { on: day, by, reason: 'Closure review: care continued elsewhere' };
          } else {
            fu.closure = { on: day, by, reason: 'care_elsewhere', note: 'Seen at the CHC' };
          }
          break;
        case 'wrong_number':
          p.phoneStatus = 'unreachable';
          stop = false;
          break;
        default:
          stop = false;
      }
      fu.attempts.push(attempt);
      if (recent(day, 21)) {
        audit.push({ on: day, role: by, action: 'attempt_logged', regNo: p.regNo, detail: `${CHANNEL_LABEL[channel]}: ${OUTCOME_LABEL[outcome]}${extra}` });
        if (fu.escalation && fu.escalation.on === day) audit.push({ on: day, role: by, action: 'escalated', regNo: p.regNo, detail: fu.escalation.reason });
        if (fu.closure) audit.push({ on: day, role: by, action: 'closed', regNo: p.regNo, detail: CLOSURE_LABEL[fu.closure.reason] });
      }
      if (stop) break;
      day = addDays(day, outcome === 'not_found' ? 3 : 1 + Math.floor(rand() * 2));
    }
    const last = fu.attempts[fu.attempts.length - 1];
    if (last && (last.outcome === 'no_answer' || last.outcome === 'not_found') && !fu.closure && !fu.escalation) {
      fu.nextAttemptOn = addDays(last.on, last.outcome === 'not_found' ? 3 : 1);
    }
  }

  function makeFollowUp(id: string, patient: Patient, dept: DeptCode, visit: ISODate, instruction: string): FollowUp {
    const reading = readInstruction({ instruction, visitDate: visit, department: dept });
    const proposal = proposalFrom(reading);
    const tracked = proposal.tracking === 'dated' && proposal.dueDate !== null;
    const importance = reading.importanceHint?.level ?? importanceFor(dept);
    const corrections: CorrectionField[] = [];
    let dueDate = proposal.dueDate;
    if (tracked && chance(0.1)) {
      const moved = nextOpdDay(addDays(proposal.dueDate!, pick([-2, 2, 3, 5, 7])), dept);
      if (moved > visit && moved !== proposal.dueDate) {
        dueDate = moved;
        corrections.push('dueDate');
      }
    }
    let bring = proposal.bring;
    const unsure = reading.bring.filter((b) => !b.confident).map((b) => b.item);
    if (unsure.length && chance(0.7)) {
      bring = [...bring, ...unsure];
      corrections.push('bring');
    } else if (tracked && chance(0.07)) {
      bring = [...bring, 'Old reports and prescriptions'];
      corrections.push('bring');
    }
    return {
      id,
      patientId: patient.id,
      department: dept,
      clinician: pick(CLINICIANS[dept]),
      visitDate: visit,
      instruction,
      reading,
      plan: {
        tracking: tracked ? 'dated' : 'not_tracked',
        dueDate: tracked ? dueDate : null,
        windowCloses: tracked ? windowCloses(dueDate!, visit, importance) : null,
        importance: tracked ? importance : 'routine',
        bring,
        notTrackedReason: tracked ? null : 'SOS: come if needed',
        confirmedBy: 'nurse',
        confirmedOn: visit,
        corrections: tracked ? corrections : [],
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
  }

  /* History: 90 days of confirmed follow-ups */
  const repeatPool: Patient[] = [];
  for (let i = 0; i < HISTORY_SIZE; i++) {
    const dept = weighted(DEPT_WEIGHTS);
    const visit = prevOpdDay(addDays(SEED_TODAY, -(1 + Math.floor(rand() * HISTORY_DAYS))), dept);
    const patient = repeatPool.length && chance(0.06) ? pick(repeatPool) : newPatient(dept, visit);
    repeatPool.push(patient);
    const fu = makeFollowUp(`fu-h${i + 1}`, patient, dept, visit, pick(HISTORY_INSTRUCTIONS[dept]));
    const fate = fateFor(fu, patient, rand);
    fates[fu.id] = fate;
    if (fate && fate < SEED_TODAY) fu.returnedOn = fate;

    const close = fu.plan.windowCloses!;
    const missed = close < addDays(SEED_TODAY, -1) && (!fu.returnedOn || fu.returnedOn > close);
    if (missed && chance(0.5)) {
      const until = fu.returnedOn ? addDays(fu.returnedOn, -1) : addDays(SEED_TODAY, -1);
      simulateOutreach(fu, patient, addDays(close, 1), until);
    }
    if (recent(visit, 7)) {
      audit.push({ on: visit, role: 'nurse', action: 'confirmed', regNo: patient.regNo, detail: `Follow-up confirmed at the desk (${fu.department})` });
    }
    if (fu.returnedOn && recent(fu.returnedOn, 21)) {
      audit.push({ on: fu.returnedOn, role: 'records', action: 'returned', regNo: patient.regNo, detail: 'Registered at OPD for the follow-up visit.' });
    }
    followUps.push(fu);
  }

  for (let i = 0; i < NOT_TRACKED_SIZE; i++) {
    const [dept, instruction] = pick(NOT_TRACKED_INSTRUCTIONS);
    const visit = prevOpdDay(addDays(SEED_TODAY, -(1 + Math.floor(rand() * 90))), dept);
    const patient = newPatient(dept, visit);
    followUps.push(makeFollowUp(`fu-n${i + 1}`, patient, dept, visit, instruction));
  }

  /* Today's desk queue: registration details only; consent not yet recorded */
  const desk: DeskItem[] = DESK.map((d, i) => {
    const village = VILLAGES.find((v) => v.name === d.village)!;
    const id = `p${++patientSeq}`;
    patients[id] = {
      id,
      regNo: regNo(),
      name: d.name,
      age: d.age,
      sex: d.sex,
      village: d.village,
      distanceKm: village.km,
      phone: d.phone,
      phoneOwner: d.owner,
      phoneStatus: 'unverified',
      caregiver: d.caregiver,
      language: d.language,
      chwArea: d.village,
      consent: { sms: false, call: false, caregiver: false, chw: false, recordedOn: null, recordedBy: null },
    };
    return { id: `d${i + 1}`, patientId: id, department: d.dept, clinician: d.clinician, visitDate: SEED_TODAY, instruction: d.instruction };
  });

  const sortedAudit: AuditEntry[] = audit
    .sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0))
    .map((e, i) => ({ ...e, seq: i + 1 }));

  return {
    version: 1,
    today: SEED_TODAY,
    role: 'records',
    patients,
    followUps,
    desk,
    audit: sortedAudit,
    fates,
    seq: sortedAudit.length,
  };
}
