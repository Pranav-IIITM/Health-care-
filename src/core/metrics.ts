import { addDays, diffDays } from './dates';
import { EQUITY_GAP_ALERT_PP } from './policy';
import { needsDecision, readInstruction } from './reader';
import { CONTACT_GROUP_LABEL, contactGroup, type ContactGroup } from './simulation';
import { effectiveDue, statusOf } from './tracking';
import { buildWorkItems, LANE_ORDER } from './worklist';
import type { AppState, CorrectionField, FollowUp, ISODate, Lane } from './types';

export const PERIOD_DAYS = 91;

export interface Rate {
  n: number;
  hits: number;
  rate: number | null;
}

const rate = (hits: number, n: number): Rate => ({ n, hits, rate: n ? hits / n : null });

export interface GroupStat {
  group: ContactGroup;
  label: string;
  onTime: Rate;
  recovered: Rate;
}

export interface Metrics {
  periodStart: ISODate;
  periodEnd: ISODate;
  /** Returned by the time the window closed, among windows that closed in the period. */
  onTime: Rate;
  /** Came back after missing the window, among misses in the period. */
  recovered: Rate;
  openMissed: number;
  /** Open misses with no call, visit or message yet: the blind spot itself. */
  neverContacted: number;
  dueNext7: number;
  medianDaysToFirstAttempt: number | null;
  lanes: Record<Lane, number>;
  groups: GroupStat[];
  /** Largest on-time gap between contact groups, in percentage points. */
  equityGapPp: number | null;
  equityAlert: boolean;
  weekly: { start: ISODate; end: ISODate; onTime: Rate }[];
  corrections: { confirmed: number; unchanged: number; byField: Record<CorrectionField, number> };
  deskPending: number;
  deskNeedsDecision: number;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const onTimeFor = (fu: FollowUp) => fu.returnedOn !== null && fu.returnedOn <= fu.plan.windowCloses!;

export function computeMetrics(state: AppState): Metrics {
  const { today } = state;
  const periodEnd = addDays(today, -1);
  const periodStart = addDays(today, -PERIOD_DAYS);
  const inPeriod = (d: ISODate) => d >= periodStart && d <= periodEnd;

  const closedWindows = state.followUps.filter(
    (fu) => fu.plan.tracking === 'dated' && fu.plan.windowCloses !== null && inPeriod(fu.plan.windowCloses),
  );
  const misses = closedWindows.filter((fu) => !onTimeFor(fu));
  const recovered = misses.filter((fu) => fu.returnedOn !== null);

  const open = state.followUps.filter((fu) => statusOf(fu, today) === 'missed');
  const neverContacted = open.filter((fu) => fu.attempts.length === 0 && !fu.messageSentOn).length;

  const dueNext7 = state.followUps.filter((fu) => {
    const s = statusOf(fu, today);
    const due = effectiveDue(fu);
    return (s === 'upcoming' || s === 'due') && due !== null && due >= today && due <= addDays(today, 6);
  }).length;

  const firstAttemptDelays = misses
    .filter((fu) => fu.attempts.length > 0)
    .map((fu) => diffDays(fu.plan.windowCloses!, fu.attempts[0].on));

  const lanes = Object.fromEntries(LANE_ORDER.map((l) => [l, 0])) as Record<Lane, number>;
  for (const item of buildWorkItems(state)) lanes[item.lane]++;

  const groups: GroupStat[] = (['own', 'shared', 'unreachable'] as ContactGroup[]).map((group) => {
    const inGroup = (fu: FollowUp) => contactGroup(state.patients[fu.patientId]) === group;
    const closedG = closedWindows.filter(inGroup);
    const missesG = misses.filter(inGroup);
    return {
      group,
      label: CONTACT_GROUP_LABEL[group],
      onTime: rate(closedG.filter(onTimeFor).length, closedG.length),
      recovered: rate(missesG.filter((fu) => fu.returnedOn !== null).length, missesG.length),
    };
  });
  const comparable = groups.map((g) => g.onTime).filter((r) => r.rate !== null && r.n >= 10).map((r) => r.rate!);
  const equityGapPp = comparable.length >= 2 ? Math.round((Math.max(...comparable) - Math.min(...comparable)) * 100) : null;

  const weekly = Array.from({ length: 13 }, (_, i) => {
    const end = addDays(periodEnd, -7 * (12 - i));
    const start = addDays(end, -6);
    const bucket = closedWindows.filter((fu) => fu.plan.windowCloses! >= start && fu.plan.windowCloses! <= end);
    return { start, end, onTime: rate(bucket.filter(onTimeFor).length, bucket.length) };
  });

  const confirmed = state.followUps.filter((fu) => fu.plan.confirmedOn >= periodStart);
  const byField: Record<CorrectionField, number> = { dueDate: 0, bring: 0, tracking: 0 };
  for (const fu of confirmed) for (const c of fu.plan.corrections) byField[c]++;

  return {
    periodStart,
    periodEnd,
    onTime: rate(closedWindows.length - misses.length, closedWindows.length),
    recovered: rate(recovered.length, misses.length),
    openMissed: open.length,
    neverContacted,
    dueNext7,
    medianDaysToFirstAttempt: median(firstAttemptDelays),
    lanes,
    groups,
    equityGapPp,
    equityAlert: equityGapPp !== null && equityGapPp > EQUITY_GAP_ALERT_PP,
    weekly,
    corrections: {
      confirmed: confirmed.length,
      unchanged: confirmed.filter((fu) => fu.plan.corrections.length === 0).length,
      byField,
    },
    deskPending: state.desk.length,
    deskNeedsDecision: state.desk.filter((d) =>
      needsDecision(readInstruction({ instruction: d.instruction, visitDate: d.visitDate, department: d.department })),
    ).length,
  };
}

export function pct(r: Rate | number | null, digits = 0): string {
  const v = typeof r === 'number' || r === null ? r : r.rate;
  return v === null ? '—' : `${(v * 100).toFixed(digits)}%`;
}
