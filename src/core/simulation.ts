import { addDays, diffDays, formatDate } from './dates';
import { nextOpdDay } from './policy';
import type { AppState, AuditEntry, FollowUp, ISODate, Patient } from './types';

/*
 * Demo-only machinery: a seeded random generator and a simulated registration feed.
 * The baseline numbers are illustrative, tuned so that roughly 28% of follow-ups miss
 * their window, as in the case file. They are not evidence about any real hospital.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type ContactGroup = 'own' | 'shared' | 'unreachable';

export const CONTACT_GROUP_LABEL: Record<ContactGroup, string> = {
  own: 'Own phone',
  shared: 'Shared household phone',
  unreachable: 'Unreachable or no phone',
};

export function contactGroup(p: Patient): ContactGroup {
  if (!p.phone || p.phoneOwner === 'none' || p.phoneStatus === 'unreachable') return 'unreachable';
  return p.phoneOwner === 'shared' ? 'shared' : 'own';
}

export const BASELINE = {
  onTime: { own: 0.76, shared: 0.69, unreachable: 0.58 } as Record<ContactGroup, number>,
  farKm: 40,
  farPenalty: 0.07,
  mustNotMissBonus: 0.04,
  lateReturn: 0.35,
};

/** When this patient would turn up at registration with no outreach at all (null = never). */
export function fateFor(fu: FollowUp, p: Patient, rand: () => number): ISODate | null {
  const { dueDate, windowCloses } = fu.plan;
  if (fu.plan.tracking !== 'dated' || !dueDate || !windowCloses) return null;
  let pOnTime = BASELINE.onTime[contactGroup(p)];
  if (p.distanceKm > BASELINE.farKm) pOnTime -= BASELINE.farPenalty;
  if (fu.plan.importance === 'must_not_miss') pOnTime += BASELINE.mustNotMissBonus;
  if (rand() < pOnTime) {
    const grace = diffDays(dueDate, windowCloses);
    const offset = Math.min(grace, Math.floor(rand() * (grace + 4)) - 2);
    let day = addDays(dueDate, offset);
    if (day <= fu.visitDate) day = addDays(fu.visitDate, 1);
    return nextOpdDay(day, fu.department);
  }
  if (rand() < BASELINE.lateReturn) return nextOpdDay(addDays(windowCloses, 3 + Math.floor(rand() * 26)), fu.department);
  return null;
}

export function assignFate(state: AppState, followUpId: string): AppState {
  const fu = state.followUps.find((f) => f.id === followUpId);
  if (!fu) return state;
  const p = state.patients[fu.patientId];
  return { ...state, fates: { ...state.fates, [fu.id]: fateFor(fu, p, mulberry32(hashSeed(fu.id))) } };
}

/** Moves the simulated clock forward, applying the registration feed day by day. */
export function advanceDays(state: AppState, days: number): AppState {
  let followUps = state.followUps;
  const audit: AuditEntry[] = [...state.audit];
  let seq = state.seq;
  let today = state.today;
  for (let i = 0; i < days; i++) {
    today = addDays(today, 1);
    const day = today;
    followUps = followUps.map((fu) => {
      if (fu.closure || fu.returnedOn || fu.plan.tracking !== 'dated' || state.fates[fu.id] !== day) return fu;
      const p = state.patients[fu.patientId];
      audit.push({
        seq: ++seq,
        on: day,
        role: 'system',
        action: 'returned',
        regNo: p?.regNo ?? null,
        detail: 'Registered at OPD for the follow-up visit (simulated registration feed).',
      });
      return { ...fu, returnedOn: day };
    });
  }
  audit.push({
    seq: ++seq,
    on: today,
    role: 'system',
    action: 'clock_advanced',
    regNo: null,
    detail: `Simulated date moved forward ${days === 1 ? 'one day' : `${days} days`} to ${formatDate(today, 'long')}.`,
  });
  return { ...state, today, followUps, audit, seq };
}
