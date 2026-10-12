import type { ISODate, Lang } from './types';

const DAY_MS = 86_400_000;

export function toDate(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(date: Date): ISODate {
  return date.toISOString().slice(0, 10);
}

/** Returns null when the parts do not form a real calendar date (e.g. 31/02). */
export function makeISO(y: number, m: number, d: number): ISODate | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return toISO(dt);
}

export function addDays(iso: ISODate, n: number): ISODate {
  return toISO(new Date(toDate(iso).getTime() + n * DAY_MS));
}

/** Calendar months; the day is clamped to the end of a shorter month (31 Jan + 1 month = 28 Feb). */
export function addMonths(iso: ISODate, n: number): ISODate {
  const d = toDate(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toISO(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last))));
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: ISODate, to: ISODate): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(iso: ISODate): number {
  return toDate(iso).getUTCDay();
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_HI = [
  'जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून',
  'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर',
];
export const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_EN_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_HI = ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];

export type DateStyle = 'short' | 'medium' | 'long' | 'full';

/**
 * short  "26 Oct"
 * medium "26 Oct 2026"
 * long   "Mon, 26 Oct 2026"
 * full   "Monday, 26 Oct 2026"
 */
export function formatDate(iso: ISODate, style: DateStyle = 'medium', lang: Lang = 'en'): string {
  const d = toDate(iso);
  const day = d.getUTCDate();
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  const wd = d.getUTCDay();
  if (lang === 'hi') {
    const base = `${day} ${MONTHS_HI[month]}`;
    if (style === 'short') return base;
    if (style === 'medium') return `${base} ${year}`;
    return `${WEEKDAYS_HI[wd]}, ${base} ${year}`;
  }
  const base = `${day} ${MONTHS_EN[month]}`;
  if (style === 'short') return base;
  if (style === 'medium') return `${base} ${year}`;
  if (style === 'long') return `${WEEKDAYS_EN[wd]}, ${base} ${year}`;
  return `${WEEKDAYS_EN_LONG[wd]}, ${base} ${year}`;
}

/** "today", "tomorrow", "in 3 days", "yesterday", "9 days ago" */
export function relativeDays(iso: ISODate, today: ISODate): string {
  const n = diffDays(today, iso);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
