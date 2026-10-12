/** Calendar date as `YYYY-MM-DD`. All date arithmetic is done in UTC. */
export type ISODate = string;

export type DeptCode = 'MED' | 'OBG' | 'PAED' | 'ORTHO' | 'SURG' | 'EYE' | 'ENT' | 'PSY' | 'CHEST';

/** People who use the register. Clinicians write the instruction; they do not use this screen. */
export type Role = 'nurse' | 'records' | 'chw' | 'admin';

/** Set by the clinician (ticked on the OPD slip) and confirmed by the nurse. Never set by the system. */
export type Importance = 'routine' | 'important' | 'must_not_miss';

export type Lang = 'hi' | 'en';

export type PhoneOwner = 'self' | 'shared' | 'none';
export type PhoneStatus = 'verified' | 'unverified' | 'unreachable';

export interface Consent {
  sms: boolean;
  call: boolean;
  caregiver: boolean;
  chw: boolean;
  recordedOn: ISODate | null;
  recordedBy: Role | null;
}

export interface Caregiver {
  name: string;
  relation: string;
  phone: string | null;
}

export interface Patient {
  id: string;
  regNo: string;
  name: string;
  age: number;
  sex: 'F' | 'M';
  village: string;
  distanceKm: number;
  phone: string | null;
  phoneOwner: PhoneOwner;
  phoneStatus: PhoneStatus;
  caregiver: Caregiver | null;
  language: Lang;
  /** ASHA / community health worker area that covers the patient's village. */
  chwArea: string | null;
  consent: Consent;
}

/* ------------------------------------------------------------------ */
/* Reading: what the system proposes from the clinician's free text.   */
/* ------------------------------------------------------------------ */

export interface Span {
  start: number;
  end: number;
  text: string;
}

export type IntervalUnit = 'day' | 'week' | 'month' | 'year';
export type NoDateKind = 'sos' | 'as_needed' | 'event';
export type Source = 'rules' | 'llm';

export type HighlightKind =
  | 'timing'
  | 'importance'
  | 'bring'
  | 'nodate'
  | 'condition'
  | 'precaution'
  | 'ignored';

export interface Highlight extends Span {
  kind: HighlightKind;
  note: string;
  source: Source;
}

export interface TimingOption {
  /** Human wording of what was read, e.g. "2 weeks" or "22 Oct". */
  label: string;
  /** Date the text points to, before moving it onto an OPD day. */
  rawDue: ISODate;
  /** Date moved onto the next day the department's OPD runs. */
  dueDate: ISODate;
  shiftNote: string | null;
  intervalDays: number;
  span: Span;
  source: Source;
}

/**
 * decide: the system will not propose a value; a person must choose.
 * check:  a value is proposed but deserves a second look.
 * info:   how the text was read.
 */
export type FlagLevel = 'decide' | 'check' | 'info';

export type FlagCode =
  | 'no_timing'
  | 'conflict'
  | 'event_anchor'
  | 'date_past'
  | 'date_invalid'
  | 'conditional'
  | 'no_fixed_date'
  | 'event_based'
  | 'shorthand'
  | 'shorthand_ambiguous'
  | 'uncued'
  | 'weekday'
  | 'far_future'
  | 'duration_ignored'
  | 'precaution'
  | 'opd_shift'
  | 'range'
  | 'recurring'
  | 'also_sos'
  | 'importance_hint'
  | 'bring_unsure'
  | 'llm_agrees'
  | 'llm_disagrees'
  | 'llm_only'
  | 'llm_discarded';

export interface Flag {
  code: FlagCode;
  level: FlagLevel;
  message: string;
}

export interface BringItem {
  item: string;
  /** true when the text clearly asks for it ("with CBC", "sugar report lekar"); otherwise left unticked. */
  confident: boolean;
  source: Source;
  span: Span | null;
}

export interface ImportanceHint {
  level: Exclude<Importance, 'routine'>;
  span: Span;
  source: Source;
}

export interface Reading {
  engine: 'rules' | 'rules+llm';
  instruction: string;
  visitDate: ISODate;
  department: DeptCode;
  /** 0 options = no time found, 1 = clear, more than 1 = the text contradicts itself. */
  options: TimingOption[];
  noDate: { kind: NoDateKind; span: Span } | null;
  conditional: Span | null;
  eventAnchor: Span | null;
  bring: BringItem[];
  importanceHint: ImportanceHint | null;
  precautions: Span[];
  flags: Flag[];
  highlights: Highlight[];
}

/* ------------------------------------------------------------------ */
/* Follow-up record                                                    */
/* ------------------------------------------------------------------ */

export type CorrectionField = 'dueDate' | 'bring' | 'tracking';

export interface FollowUpPlan {
  tracking: 'dated' | 'not_tracked';
  dueDate: ISODate | null;
  windowCloses: ISODate | null;
  importance: Importance;
  bring: string[];
  notTrackedReason: string | null;
  confirmedBy: Role;
  confirmedOn: ISODate;
  /** Fields where the confirming nurse changed what the system proposed. */
  corrections: CorrectionField[];
}

export type Channel = 'phone' | 'caregiver' | 'chw' | 'none';

export type Outcome =
  | 'will_come'
  | 'needs_support'
  | 'clinical_question'
  | 'care_elsewhere'
  | 'declined'
  | 'moved_away'
  | 'deceased'
  | 'no_answer'
  | 'wrong_number'
  | 'not_found';

export type Barrier = 'transport' | 'cost' | 'no_escort' | 'work' | 'feels_better' | 'forgot' | 'other';

export interface Attempt {
  on: ISODate;
  by: Role;
  channel: Channel;
  outcome: Outcome;
  plannedDate: ISODate | null;
  barrier: Barrier | null;
  note: string;
}

export interface Escalation {
  on: ISODate;
  by: Role;
  reason: string;
}

export type ClosureReason =
  | 'care_elsewhere'
  | 'declined'
  | 'clinician_cancelled'
  | 'moved_away'
  | 'deceased'
  | 'duplicate';

export interface Closure {
  on: ISODate;
  by: Role;
  reason: ClosureReason;
  note: string;
}

export interface FollowUp {
  id: string;
  patientId: string;
  department: DeptCode;
  clinician: string;
  visitDate: ISODate;
  /** The clinician's words, verbatim. Shown only to clinical roles. */
  instruction: string;
  reading: Reading;
  plan: FollowUpPlan;
  returnedOn: ISODate | null;
  reminderSentOn: ISODate | null;
  messageSentOn: ISODate | null;
  attempts: Attempt[];
  nextAttemptOn: ISODate | null;
  /** Date agreed with the patient on a call or visit after a miss. */
  rescheduledTo: ISODate | null;
  escalation: Escalation | null;
  routeOverride: Channel | null;
  /** Attempt count at the last nurse review; failures before this do not re-trigger review. */
  reviewedAtAttempt: number;
  closure: Closure | null;
}

/** A patient leaving OPD today whose follow-up has not yet been confirmed at the desk. */
export interface DeskItem {
  id: string;
  patientId: string;
  department: DeptCode;
  clinician: string;
  visitDate: ISODate;
  instruction: string;
}

export type Status =
  | 'not_tracked'
  | 'upcoming'
  | 'due'
  | 'missed'
  | 'returned_on_time'
  | 'returned_late'
  | 'closed';

export type Lane = 'call' | 'chw' | 'nurse' | 'next_visit' | 'reminder';

export type AuditAction =
  | 'confirmed'
  | 'not_tracked'
  | 'contact_updated'
  | 'reminder_sent'
  | 'message_sent'
  | 'attempt_logged'
  | 'escalated'
  | 'returned_to_queue'
  | 'chw_assigned'
  | 'closed'
  | 'returned'
  | 'number_viewed'
  | 'clinical_text_viewed'
  | 'clock_advanced';

export interface AuditEntry {
  seq: number;
  on: ISODate;
  role: Role | 'system';
  action: AuditAction;
  regNo: string | null;
  detail: string;
}

export interface AppState {
  version: 1;
  today: ISODate;
  role: Role;
  patients: Record<string, Patient>;
  followUps: FollowUp[];
  desk: DeskItem[];
  audit: AuditEntry[];
  /**
   * Simulated registration feed: the day each patient would turn up at registration
   * without any outreach (null = would not return). Never shown in the UI.
   */
  fates: Record<string, ISODate | null>;
  seq: number;
}
