import { addDays, formatDate, weekday, WEEKDAYS_EN } from './dates';
import type { DeptCode, Importance, ISODate } from './types';

/*
 * Hospital-owned settings. In a real deployment these are set by the hospital's
 * clinical governance / OPD administration, not by developers and not by a model.
 * Values here are simulated for the prototype.
 */

export const HOSPITAL = {
  name: 'District Hospital',
  nameHi: 'जिला अस्पताल',
  deskPhone: '0751-XXXXXXX',
  deskHours: 'Mon–Sat, 9 am – 4 pm',
  deskHoursHi: 'सोमवार–शनिवार, सुबह 9 से शाम 4 बजे',
  emergencyNumber: '108',
};

export interface Department {
  code: DeptCode;
  name: string;
  short: string;
  nameHi: string;
  /** Days the OPD runs: 1 = Monday … 6 = Saturday. */
  opdDays: number[];
  /** Department name is never put in an SMS or shared-phone script; this marks extra-care departments. */
  sensitive: boolean;
}

const ALL_WEEK = [1, 2, 3, 4, 5, 6];

export const DEPARTMENTS: Record<DeptCode, Department> = {
  MED: { code: 'MED', name: 'Medicine', short: 'Medicine', nameHi: 'मेडिसिन', opdDays: ALL_WEEK, sensitive: false },
  OBG: { code: 'OBG', name: 'Obstetrics & Gynaecology', short: 'OBG', nameHi: 'स्त्री एवं प्रसूति रोग', opdDays: ALL_WEEK, sensitive: false },
  PAED: { code: 'PAED', name: 'Paediatrics', short: 'Paediatrics', nameHi: 'शिशु रोग', opdDays: ALL_WEEK, sensitive: false },
  ORTHO: { code: 'ORTHO', name: 'Orthopaedics', short: 'Ortho', nameHi: 'अस्थि रोग', opdDays: [1, 3, 5], sensitive: false },
  SURG: { code: 'SURG', name: 'General Surgery', short: 'Surgery', nameHi: 'सर्जरी', opdDays: [2, 4, 6], sensitive: false },
  EYE: { code: 'EYE', name: 'Ophthalmology', short: 'Eye', nameHi: 'नेत्र रोग', opdDays: ALL_WEEK, sensitive: false },
  ENT: { code: 'ENT', name: 'ENT', short: 'ENT', nameHi: 'नाक, कान, गला रोग', opdDays: [2, 5], sensitive: false },
  PSY: { code: 'PSY', name: 'Psychiatry', short: 'Psychiatry', nameHi: 'मानसिक रोग', opdDays: [2, 5], sensitive: true },
  CHEST: { code: 'CHEST', name: 'Chest & TB', short: 'Chest & TB', nameHi: 'टीबी एवं छाती रोग', opdDays: ALL_WEEK, sensitive: true },
};

/** Fixed-date national holidays when OPD is closed. */
export const HOLIDAYS: ISODate[] = [
  '2026-01-26', '2026-08-15', '2026-10-02',
  '2027-01-26', '2027-08-15', '2027-10-02',
];

export function isOpdDay(iso: ISODate, dept: DeptCode): boolean {
  return DEPARTMENTS[dept].opdDays.includes(weekday(iso)) && !HOLIDAYS.includes(iso);
}

export function opdDaysLabel(dept: DeptCode): string {
  const days = DEPARTMENTS[dept].opdDays;
  if (days.length === 6) return 'Mon–Sat';
  return days.map((d) => WEEKDAYS_EN[d]).join(', ');
}

/** First day on or after `iso` when the department's OPD runs. */
export function nextOpdDay(iso: ISODate, dept: DeptCode): ISODate {
  let d = iso;
  for (let i = 0; i < 14; i++) {
    if (isOpdDay(d, dept)) return d;
    d = addDays(d, 1);
  }
  return iso;
}

export function alignToOpdDay(rawDue: ISODate, dept: DeptCode): { dueDate: ISODate; shiftNote: string | null } {
  const dueDate = nextOpdDay(rawDue, dept);
  if (dueDate === rawDue) return { dueDate, shiftNote: null };
  const why = HOLIDAYS.includes(rawDue)
    ? 'is a public holiday'
    : `has no ${DEPARTMENTS[dept].short} OPD (it runs ${opdDaysLabel(dept)})`;
  return {
    dueDate,
    shiftNote: `${formatDate(rawDue, 'long')} ${why}, so the due date moves to ${formatDate(dueDate, 'long')}.`,
  };
}

/** Days after the due date before a visit counts as missed. */
export const GRACE_DAYS: Record<Importance, number> = {
  must_not_miss: 3,
  important: 5,
  routine: 7,
};

/** Short follow-ups (dressings, suture removal) get a tighter window: at most half the interval, never under 2 days. */
export function graceDays(importance: Importance, intervalDays: number | null): number {
  const base = GRACE_DAYS[importance];
  if (intervalDays !== null && intervalDays <= 14) {
    return Math.min(base, Math.max(2, Math.floor(intervalDays / 2)));
  }
  return base;
}

/** Grace after a date agreed with the patient on a recovery call. */
export const PROMISE_GRACE_DAYS = 2;

export const REMINDER_DAYS_BEFORE = 2;
export const RETRY_AFTER_DAYS = 1;
export const CHW_RETRY_AFTER_DAYS = 3;
export const MAX_PHONE_ATTEMPTS = 3;
export const MAX_CHW_ATTEMPTS = 2;
/** Failed contact attempts on a must-not-miss follow-up before a nurse reviews it. */
export const MUST_NOT_MISS_REVIEW_AFTER = 2;

/**
 * Worklist order. Published to staff on the worklist screen.
 * Reachability is deliberately absent: it changes the route, never the rank.
 */
export const RANK_WEIGHTS = {
  importance: { must_not_miss: 60, important: 35, routine: 15 } as Record<Importance, number>,
  perDayLate: 1,
  maxLateDays: 30,
  firstContact: 5,
  brokenPromise: 5,
};

/** On-time return gap between contact groups (percentage points) that triggers an equity review. */
export const EQUITY_GAP_ALERT_PP = 10;

export const IMPORTANCE_LABEL: Record<Importance, string> = {
  must_not_miss: 'Must not miss',
  important: 'Important',
  routine: 'Routine',
};

export const IMPORTANCE_ORDER: Importance[] = ['must_not_miss', 'important', 'routine'];
