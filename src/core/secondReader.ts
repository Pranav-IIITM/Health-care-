import { addDays, diffDays, formatDate, makeISO } from './dates';
import { alignToOpdDay } from './policy';
import { dueFromInterval, readInstruction } from './reader';
import type {
  BringItem,
  DeptCode,
  Flag,
  FlagCode,
  FlagLevel,
  Highlight,
  ImportanceHint,
  IntervalUnit,
  ISODate,
  NoDateKind,
  Reading,
  Span,
  TimingOption,
} from './types';

/*
 * Contract for the optional language-model reader (Gemini, free tier).
 *
 * The model only ever sees the instruction text with identifiers scrubbed. Whatever it
 * returns is treated as a second opinion: every value must quote words that appear in
 * the clinician's text, or it is thrown away. Agreement with the rule reader is noted;
 * disagreement becomes a decision for the nurse. Nothing it says is shown to a patient.
 */

export interface SecondProposal {
  interval_value: number;
  interval_unit: 'none' | IntervalUnit;
  interval_evidence: string;
  date: string;
  date_evidence: string;
  no_fixed_date: 'none' | NoDateKind;
  no_fixed_date_evidence: string;
  condition_evidence: string;
  bring: { item: string; evidence: string }[];
  emphasis: 'none' | 'important' | 'must_not_miss';
  emphasis_evidence: string;
  precautions: string[];
}

/** JSON Schema sent as the response schema. Sentinels ("none", "", 0) instead of nulls keep it simple for the model. */
export const SECOND_READER_SCHEMA = {
  type: 'object',
  properties: {
    interval_value: { type: 'integer', minimum: 0, maximum: 400, description: 'Number in the follow-up interval, 0 if none is written.' },
    interval_unit: { type: 'string', enum: ['none', 'day', 'week', 'month', 'year'] },
    interval_evidence: { type: 'string', description: 'The exact words of the interval, copied from the instruction. Empty if none.' },
    date: { type: 'string', description: 'An explicitly written return date as YYYY-MM-DD. Empty if none.' },
    date_evidence: { type: 'string', description: 'The exact words of that date, copied from the instruction. Empty if none.' },
    no_fixed_date: { type: 'string', enum: ['none', 'sos', 'as_needed', 'event'] },
    no_fixed_date_evidence: { type: 'string' },
    condition_evidence: { type: 'string', description: 'If returning depends on a condition (e.g. "if fever persists"), the exact words. Empty if none.' },
    bring: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Short name of a report, document or item to bring.' },
          evidence: { type: 'string', description: 'The exact words, copied from the instruction.' },
        },
        required: ['item', 'evidence'],
      },
    },
    emphasis: { type: 'string', enum: ['none', 'important', 'must_not_miss'] },
    emphasis_evidence: { type: 'string', description: 'Exact emphasis words written by the clinician, e.g. "without fail". Empty if none.' },
    precautions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Return-precaution phrases ("come immediately if …"), each copied exactly.',
    },
  },
  required: [
    'interval_value', 'interval_unit', 'interval_evidence', 'date', 'date_evidence', 'no_fixed_date',
    'no_fixed_date_evidence', 'condition_evidence', 'bring', 'emphasis', 'emphasis_evidence', 'precautions',
  ],
} as const;

export const SECOND_READER_INSTRUCTIONS = [
  'You read one follow-up instruction written by an outpatient clinician at an Indian district hospital.',
  'It may use clinical shorthand (2/52 = 2 weeks, 6/12 = 6 months, 3/7 = 3 days), abbreviations (R/V, F/U, SOS, PRN), Hindi or Hinglish.',
  'Extract only what is written. Copy every evidence string exactly as it appears in the instruction.',
  'Never infer a date or an interval that is not written. Medicine or treatment durations ("x 14 days", "for 5 days") are not follow-up intervals.',
  'Mark emphasis only when the clinician wrote emphasis words such as "without fail", "must", "important".',
  'Do not interpret symptoms, diagnose, or add advice. If something is absent, use 0, "none" or an empty string.',
].join('\n');

/** Strip anything that looks like an identifier before text leaves the hospital network. */
export function scrubIdentifiers(text: string): string {
  return text
    .replace(/\S+@\S+\.\S+/g, '[email]')
    .replace(/\b[A-Z]{2,}\/\d{4}\/\d+\b/g, '[reg-no]')
    .replace(/\+?\d[\d\s-]{8,}\d/g, '[number]');
}

/** Checks the model's JSON has the right shape before anything else touches it. */
export function isSecondProposal(value: unknown): value is SecondProposal {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const str = (k: string) => typeof v[k] === 'string';
  return (
    typeof v.interval_value === 'number' &&
    ['none', 'day', 'week', 'month', 'year'].includes(v.interval_unit as string) &&
    str('interval_evidence') && str('date') && str('date_evidence') &&
    ['none', 'sos', 'as_needed', 'event'].includes(v.no_fixed_date as string) &&
    str('no_fixed_date_evidence') && str('condition_evidence') &&
    Array.isArray(v.bring) &&
    (v.bring as unknown[]).every((b) => !!b && typeof (b as Record<string, unknown>).item === 'string' && typeof (b as Record<string, unknown>).evidence === 'string') &&
    ['none', 'important', 'must_not_miss'].includes(v.emphasis as string) &&
    str('emphasis_evidence') &&
    Array.isArray(v.precautions) && (v.precautions as unknown[]).every((p) => typeof p === 'string')
  );
}

/* ------------------------------------------------------------------ */
/* Grounding                                                           */
/* ------------------------------------------------------------------ */

/** Finds `evidence` in the instruction, ignoring case and runs of whitespace. */
export function locate(instruction: string, evidence: string): Span | null {
  const e = evidence.trim();
  if (!e || e.length > instruction.length + 4) return null;
  const pattern = e
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  const m = new RegExp(pattern, 'i').exec(instruction);
  return m ? { start: m.index, end: m.index + m[0].length, text: m[0] } : null;
}

export interface GroundedSecond {
  options: TimingOption[];
  noDate: { kind: NoDateKind; span: Span } | null;
  condition: Span | null;
  bring: { item: string; span: Span }[];
  emphasis: ImportanceHint | null;
  precautions: Span[];
  /** What was thrown away and why, in plain words. */
  discarded: string[];
}

export function groundProposal(
  p: SecondProposal,
  ctx: { instruction: string; visitDate: ISODate; department: DeptCode },
): GroundedSecond {
  const { instruction, visitDate, department } = ctx;
  const out: GroundedSecond = { options: [], noDate: null, condition: null, bring: [], emphasis: null, precautions: [], discarded: [] };
  const rulesOn = (text: string) => readInstruction({ instruction: text, visitDate, department });

  const addOption = (rawDue: ISODate, label: string, span: Span) => {
    const { dueDate, shiftNote } = alignToOpdDay(rawDue, department);
    if (out.options.some((o) => o.dueDate === dueDate)) return;
    out.options.push({ label, rawDue, dueDate, shiftNote, intervalDays: diffDays(visitDate, rawDue), span, source: 'llm' });
  };

  if (p.interval_unit !== 'none' && p.interval_value > 0) {
    const span = locate(instruction, p.interval_evidence);
    const label = `${p.interval_value} ${p.interval_value === 1 ? p.interval_unit : `${p.interval_unit}s`}`;
    if (!span) {
      out.discarded.push(`interval "${label}": its quoted words "${p.interval_evidence}" are not in the instruction`);
    } else if (p.interval_value > 400) {
      out.discarded.push(`interval "${label}": not a plausible follow-up interval`);
    } else {
      const rawDue = dueFromInterval(visitDate, p.interval_value, p.interval_unit);
      const own = rulesOn(span.text).options;
      if (own.length && !own.some((o) => o.rawDue === rawDue)) {
        out.discarded.push(`interval "${label}": it does not match its own quoted words "${span.text}"`);
      } else {
        addOption(rawDue, label, span);
      }
    }
  }

  if (p.date.trim()) {
    const span = locate(instruction, p.date_evidence);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.date.trim());
    const iso = m ? makeISO(Number(m[1]), Number(m[2]), Number(m[3])) : null;
    if (!span) {
      out.discarded.push(`date "${p.date}": its quoted words "${p.date_evidence}" are not in the instruction`);
    } else if (!iso || iso <= visitDate || iso > addDays(visitDate, 730)) {
      out.discarded.push(`date "${p.date}": not a valid future date`);
    } else {
      const own = rulesOn(span.text).options;
      if (own.length && !own.some((o) => o.rawDue === iso)) {
        out.discarded.push(`date "${p.date}": it does not match its own quoted words "${span.text}"`);
      } else {
        addOption(iso, formatDate(iso, 'short'), span);
      }
    }
  }

  if (p.no_fixed_date !== 'none') {
    const span = locate(instruction, p.no_fixed_date_evidence);
    if (span) out.noDate = { kind: p.no_fixed_date, span };
    else out.discarded.push(`"no fixed date": quoted words "${p.no_fixed_date_evidence}" are not in the instruction`);
  }

  if (p.condition_evidence.trim()) {
    const span = locate(instruction, p.condition_evidence);
    if (span) out.condition = span;
    else out.discarded.push(`condition: quoted words "${p.condition_evidence}" are not in the instruction`);
  }

  for (const b of p.bring) {
    const span = locate(instruction, b.evidence);
    const item = b.item.trim().slice(0, 40);
    if (span && item) out.bring.push({ item, span });
    else out.discarded.push(`bring item "${b.item}": quoted words "${b.evidence}" are not in the instruction`);
  }

  if (p.emphasis !== 'none') {
    const span = locate(instruction, p.emphasis_evidence);
    if (span) out.emphasis = { level: p.emphasis, span, source: 'llm' };
    else out.discarded.push(`emphasis: quoted words "${p.emphasis_evidence}" are not in the instruction`);
  }

  for (const text of p.precautions) {
    const span = locate(instruction, text);
    if (span) out.precautions.push(span);
    else out.discarded.push(`precaution "${text}": not found word-for-word in the instruction`);
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Merge into the rule reading                                         */
/* ------------------------------------------------------------------ */

const overlapping = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

export function mergeSecondReading(rules: Reading, g: GroundedSecond): Reading {
  const flags: Flag[] = [...rules.flags];
  const highlights: Highlight[] = [...rules.highlights];
  const flag = (code: FlagCode, level: FlagLevel, message: string) => flags.push({ code, level, message });
  const mark = (s: Span, kind: Highlight['kind'], note: string) => highlights.push({ ...s, kind, note, source: 'llm' });
  const drop = (code: FlagCode) => {
    for (let i = flags.length - 1; i >= 0; i--) if (flags[i].code === code) flags.splice(i, 1);
  };

  const options = [...rules.options];
  for (const o of g.options) {
    const same = options.find((r) => r.dueDate === o.dueDate);
    if (same) {
      flag('llm_agrees', 'info', `Gemini read the same follow-up time ("${o.span.text}", ${formatDate(o.dueDate, 'short')}).`);
      continue;
    }
    options.push(o);
    mark(o.span, 'timing', `Gemini: follow-up time, due ${formatDate(o.dueDate, 'long')}`);
    if (rules.options.length === 0) {
      drop('no_timing');
      flag(
        'llm_only',
        'decide',
        `Only Gemini found a follow-up time ("${o.span.text}", ${formatDate(o.dueDate, 'short')}). Check it against the clinician's text before using it.`,
      );
    } else {
      flag(
        'llm_disagrees',
        'decide',
        `Gemini read "${o.span.text}" as ${formatDate(o.dueDate, 'short')}; the rule reader read ${rules.options
          .map((r) => `"${r.span.text}" as ${formatDate(r.dueDate, 'short')}`)
          .join(', ')}. Choose with the clinician.`,
      );
    }
  }

  let conditional = rules.conditional;
  if (!conditional && g.condition && options.length > 0) {
    conditional = g.condition;
    mark(g.condition, 'condition', 'Gemini: return only if this condition holds');
    flag('conditional', 'decide', `Gemini noticed a condition ("${g.condition.text}"). Decide whether this patient should be chased if they do not come.`);
  }

  let noDate = rules.noDate;
  if (!noDate && g.noDate) {
    noDate = g.noDate;
    mark(g.noDate.span, 'nodate', 'Gemini: no fixed date');
    if (options.length === 0) {
      drop('no_timing');
      flag('no_fixed_date', 'decide', `Gemini read "${g.noDate.span.text}" as no fixed date. Mark it as not tracked, or set a date with the clinician.`);
    }
  }

  const bring: BringItem[] = [...rules.bring];
  for (const b of g.bring) {
    const known = bring.some(
      (r) => r.item.toLowerCase() === b.item.toLowerCase() || (r.span !== null && overlapping(r.span, b.span)),
    );
    if (known) continue;
    bring.push({ item: b.item, confident: false, source: 'llm', span: b.span });
    mark(b.span, 'bring', `Gemini suggests: ${b.item} (unticked)`);
    flag('bring_unsure', 'info', `Gemini suggested "${b.item}" ("${b.span.text}"); it is left unticked.`);
  }

  let importanceHint = rules.importanceHint;
  if (!importanceHint && g.emphasis) {
    importanceHint = g.emphasis;
    mark(g.emphasis.span, 'importance', 'Gemini: emphasis word');
    flag(
      'importance_hint',
      'info',
      `Gemini noticed "${g.emphasis.span.text}". The importance level is still chosen by the clinician and nurse.`,
    );
  }

  const precautions = [...rules.precautions];
  for (const p of g.precautions) {
    if (precautions.some((r) => overlapping(r, p))) continue;
    precautions.push(p);
    mark(p, 'precaution', 'Gemini: return precaution, printed word for word');
  }

  for (const d of g.discarded) flag('llm_discarded', 'info', `Discarded part of Gemini's answer: ${d}.`);

  if (options.length > 1 && !flags.some((f) => f.code === 'conflict' || f.code === 'llm_disagrees')) {
    flag('conflict', 'decide', 'There is more than one possible follow-up time. Choose one with the clinician.');
  }

  return {
    ...rules,
    engine: 'rules+llm',
    options,
    noDate,
    conditional,
    bring,
    importanceHint,
    precautions,
    flags,
    highlights,
  };
}
