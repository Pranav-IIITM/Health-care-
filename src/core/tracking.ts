import { addDays, diffDays } from './dates';
import { graceDays, PROMISE_GRACE_DAYS, REMINDER_DAYS_BEFORE } from './policy';
import type { FollowUp, Importance, ISODate, Status } from './types';

/** The date the patient is currently expected: a date agreed on a recovery call replaces the original. */
export function effectiveDue(fu: FollowUp): ISODate | null {
  return fu.rescheduledTo ?? fu.plan.dueDate;
}

export function effectiveWindowClose(fu: FollowUp): ISODate | null {
  if (fu.rescheduledTo) return addDays(fu.rescheduledTo, PROMISE_GRACE_DAYS);
  return fu.plan.windowCloses;
}

export function windowCloses(dueDate: ISODate, visitDate: ISODate, importance: Importance): ISODate {
  return addDays(dueDate, graceDays(importance, diffDays(visitDate, dueDate)));
}

/**
 * Derived, never stored. A follow-up is "missed" only by arithmetic on human-confirmed
 * dates; "returned" only from a registration record. Nothing here is a model judgement.
 */
export function statusOf(fu: FollowUp, today: ISODate): Status {
  if (fu.closure) return 'closed';
  if (fu.plan.tracking === 'not_tracked') return 'not_tracked';
  if (fu.returnedOn) {
    return fu.plan.windowCloses !== null && fu.returnedOn <= fu.plan.windowCloses ? 'returned_on_time' : 'returned_late';
  }
  const due = effectiveDue(fu);
  const close = effectiveWindowClose(fu);
  if (!due || !close) return 'not_tracked';
  if (today < addDays(due, -REMINDER_DAYS_BEFORE)) return 'upcoming';
  if (today <= close) return 'due';
  return 'missed';
}

export function isOpen(status: Status): boolean {
  return status === 'upcoming' || status === 'due' || status === 'missed';
}

export function daysPastWindow(fu: FollowUp, today: ISODate): number {
  const close = effectiveWindowClose(fu);
  return close ? Math.max(0, diffDays(close, today)) : 0;
}

/** The patient agreed a date on a call or visit and did not come. */
export function brokenPromise(fu: FollowUp, today: ISODate): boolean {
  return fu.rescheduledTo !== null && !fu.returnedOn && today > addDays(fu.rescheduledTo, PROMISE_GRACE_DAYS);
}

export const STATUS_LABEL: Record<Status, string> = {
  not_tracked: 'Not tracked',
  upcoming: 'Upcoming',
  due: 'Due',
  missed: 'Missed',
  returned_on_time: 'Returned',
  returned_late: 'Returned late',
  closed: 'Closed',
};
