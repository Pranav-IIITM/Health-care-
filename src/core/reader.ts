import { addDays, addMonths, diffDays, formatDate, makeISO, weekday } from './dates';
import { alignToOpdDay } from './policy';
import type {
  BringItem,
  DeptCode,
  Flag,
  FlagCode,
  FlagLevel,
  Highlight,
  HighlightKind,
  ImportanceHint,
  IntervalUnit,
  ISODate,
  NoDateKind,
  Reading,
  Span,
  TimingOption,
} from './types';

/*
 * Rule reader for clinicians' follow-up instructions.
 *
 * It proposes; it never decides. Anything it cannot read with confidence becomes a
 * flag for the nurse to resolve. It does not interpret symptoms, diagnoses or
 * treatment: return precautions are carried word-for-word, medicine durations are
 * set aside, and importance is only suggested from explicit emphasis words.
 */

export interface ReadInput {
  instruction: string;
  visitDate: ISODate;
  department: DeptCode;
}

interface Range {
  start: number;
  end: number;
}

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, saat: 7, das: 10, pandrah: 15,
  '\u090F\u0915': 1, // एक
  '\u0926\u094B': 2, // दो
  '\u0924\u0940\u0928': 3, // तीन
  '\u091A\u093E\u0930': 4, // चार
  '\u0926\u0938': 10, // दस
};

const NUM_WORD_SRC =
  'an|a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|ek|do|teen|chaar|char|paanch|panch|saat|das|pandrah';
const UNIT_SRC =
  'days?|dys?|din|weeks?|wks?|hafton|hafte|hafta|fortnights?|months?|mnths?|mths?|mahino|mahine|mahina|maah|years?|yrs?|saal';

const INTERVAL_RE = new RegExp(
  `\\b(\\d{1,3}|${NUM_WORD_SRC})(?:\\s*(?:-|to)\\s*(\\d{1,3}))?\\s*(${UNIT_SRC})\\b`,
  'gi',
);
const COMPACT_RE = /\b(\d{1,3})\s?(d|w|mo|m)\b/gi;
const WORD_INTERVAL_RE =
  /\b(?:(?:next|agle|agli)\s+(week|month|year|hafte|mahine|saal)|(fortnight)|(weekly|fortnightly|monthly|yearly|annually)|(?:every|har)\s+(week|fortnight|month|year|hafte|mahine)|(tomorrow))\b/gi;
// Devanagari: digits or एक/दो/तीन/चार/दस + दिन / हफ़्ते / सप्ताह / महीने / माह / साल
const HI_NUM_SRC = '\\d{1,3}|\u090F\u0915|\u0926\u094B|\u0924\u0940\u0928|\u091A\u093E\u0930|\u0926\u0938';
const HI_UNIT_SRC =
  '\u0926\u093F\u0928|\u0939(?:\u095E|\u092B\u093C?)\u094D\u0924[\u0947\u093E]|\u0938\u092A\u094D\u0924\u093E\u0939|\u092E\u0939\u0940\u0928[\u0947\u093E]|\u092E\u093E\u0939|\u0938\u093E\u0932';
const HI_INTERVAL_RE = new RegExp(`(${HI_NUM_SRC})\\s*(${HI_UNIT_SRC})`, 'g');
/** Clinical shorthand: n/7 days, n/52 weeks, n/12 months. */
const SHORTHAND_RE = /(?<![\d/.-])(\d{1,2})\s*\/\s*(52|12|7)(?![\d/.-])/g;

const SLASH_DATE_RE = /(?<![\d/.-])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g;
const DOT_DASH_DATE_RE = /(?<![\d/.-])(\d{1,2})[.-](\d{1,2})[.-](\d{4}|\d{2})(?![\d.-])/g;
const MONTH_SRC =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const NAMED_DATE_RE = new RegExp(
  `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(${MONTH_SRC})\\b\\.?(?:,?\\s*(\\d{4}))?`,
  'gi',
);
const NAMED_DATE_RE2 = new RegExp(
  `\\b(${MONTH_SRC})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?`,
  'gi',
);
const WEEKDAY_RE =
  /\b(on|next|coming|this)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)\b/gi;

const PRECAUTION_RES: RegExp[] = [
  /\b(?:(?:come|report|return|visit|rush|go|show)\s+(?:back\s+)?)?(?:immediately|earlier|early|sooner|at\s+once|asap|turant|fauran|sos)\s*,?\s*(?:if|in\s+case(?:\s+of)?|when|agar|on)\b[^.;\n\u0964]*/gi,
  /\b(?:come|report|rush|go)\s+(?:back\s+)?(?:to\s+)?(?:the\s+)?(?:emergency|casualty)\b[^.;\n\u0964]*/gi,
  /\b(?:if|in\s+case(?:\s+of)?|agar)\b[^.;\n\u0964]*?\b(?:come|report|rush|go|visit|return)\s+(?:back\s+)?(?:immediately|at\s+once|earlier|sooner|to\s+(?:the\s+)?(?:emergency|casualty)|turant|fauran)\b[^.;\n\u0964]*/gi,
  /\b(?:agar|if)\b[^.;\n\u0964]*?\b(?:turant|fauran)\b[^.;\n\u0964]*/gi,
  /\u0924\u0941\u0930\u0902\u0924[^.;\n\u0964]*/g, // तुरंत …
];

const SOS_RE = /\bsos\b/gi;
const AS_NEEDED_RE =
  /\b(?:prn|as\s+(?:and\s+when\s+)?(?:needed|required|necessary)|if\s+(?:needed|required|necessary)|when(?:ever)?\s+(?:needed|required|necessary)|(?:zarurat|zaroorat|jarurat)\s+(?:ho|pade|padne\s+par)(?:\s+to)?)\b/gi;
const EVENT_RE =
  /\b(?:after|post|on\s+completion\s+of|once|when)\s+(?:completing\s+|completion\s+of\s+|finishing\s+|the\s+|all\s+)?(?:att|akt|course|surgery|operation|delivery|treatment|chemo\w*|cycles?|reports?|investigations?|tests?|biopsy|discharge|ip\s+phase|intensive\s+phase|continuation\s+phase)\b[^.;\n\u0964]*/gi;
const EVENT_ANCHOR_AFTER_RE =
  /^\s*(?:after|post|from|of)\s+(?:the\s+)?(?:surgery|operation|procedure|delivery|discharge|completing|completion|start(?:ing)?|att|akt|course|chemo\w*|cycle|injury|plaster|pop|fracture)\b[^.;\n\u0964]*/i;
const CONDITION_RE = /\b(?:if|in\s+case(?:\s+of)?|agar|unless)\b[^.;\n\u0964]*/gi;

const MUST_RE =
  /\b(?:without\s+fail|must(?:\s+(?:come|review|visit|follow\s*up))?|do\s*n[o']?t\s+miss|dont\s+miss|mandatory|compulsory|strictly|definitely|zaroor|zarur|jaroor|jarur|avashya|avashy)\b|(?:\u091C\u093C?|\u095B)\u0930\u0942\u0930|\u0905\u0935\u0936\u094D\u092F/gi;
const IMPORTANT_RE = /\b(?:imp|important|importantly|priority|please\s+ensure|ensure)\b/gi;

const CUE_WORDS = new Set([
  'after', 'in', 'within', 'review', 'r/v', 'rv', 'f/u', 'fu', 'followup', 'follow', 'up', 'come',
  'visit', 'revisit', 'recheck', 'checkup', 'check', 'removal', 'dressing', 'next', 'about', 'approx',
  'approximately', 'dikhayen', 'dikhaye', 'dikhana', 'dikhaiye', 'dikhayein', 'aana', 'aaye', 'aayen',
  'aaiye', 'aao', 'baad', '\u092C\u093E\u0926',
]);
const DATE_CUE_WORDS = new Set([...CUE_WORDS, 'on', 'dated', 'date', 'dt', 'by', 'till', 'before', 'upto', 'until']);
const DATE_PREPOSITIONS = new Set(['on', 'dated', 'date', 'dt', 'by', 'till', 'before', 'upto', 'until']);
const CUE_AFTER_RE =
  /^\s*(?:baad|bad|later|ke\s+baad|me|mein|review|f\/u|follow|\u092C\u093E\u0926|\u0915\u0947\s*\u092C\u093E\u0926|\u092E\u0947\u0902)/i;
const DURATION_BEFORE_RE = /(?:\bfor|\bx|\u00D7|\*|\btill|\bupto|\bup\s+to)\s*(?:the\s+)?(?:next\s+)?(?:another\s+)?$/i;
const DURATION_AFTER_RE = /^\s*(?:course|of\s+(?:tab\w*|medicines?|treatment|att|antibiotics?)|only)\b/i;
const ALTERNATIVE_GAP_RE = /^\s*(?:\/|or|ya|\u092F\u093E|,)\s*$/i;

/* Things patients are asked to bring. Order matters: earlier entries win overlaps. */
const BRING_DICT: { label: string; re: RegExp }[] = [
  { label: 'Sputum test report', re: /\bsputum(?:\s+(?:for\s+)?(?:afb|test|report|cbnaat))?\b|\bcbnaat\b|\bafb\b/gi },
  { label: 'Biopsy report', re: /\bbiopsy(?:\s+report)?\b|\bhpe\b|\bhistopath\w*/gi },
  { label: 'HbA1c report', re: /\bhba1c\b|\bglycated\s+h\w+/gi },
  { label: 'CBC report', re: /\bcbc\b|\bcomplete\s+blood\s+count\b|\bh(?:a)?emogram\b/gi },
  { label: 'Hb report', re: /\bhb\b|\bh(?:a)?emoglobin\b/gi },
  { label: 'LFT report', re: /\blft\b|\bliver\s+function(?:\s+tests?)?\b/gi },
  { label: 'KFT report', re: /\bkft\b|\brft\b|\b(?:renal|kidney)\s+function(?:\s+tests?)?\b/gi },
  { label: 'FBS report', re: /\bfbs\b|\bfasting\s+(?:blood\s+)?sugar\b/gi },
  { label: 'PPBS report', re: /\bppbs\b|\bpost[\s-]*prandial(?:\s+(?:blood\s+)?sugar)?\b/gi },
  { label: 'RBS report', re: /\brbs\b|\brandom\s+(?:blood\s+)?sugar\b/gi },
  { label: 'Sugar chart', re: /\bsugar\s+(?:chart|diary|log)\b/gi },
  { label: 'Sugar report', re: /\bsugar\s+(?:report|test)\b|\bblood\s+sugar\b/gi },
  { label: 'Lipid profile report', re: /\blipid(?:\s+profile)?\b/gi },
  { label: 'Thyroid (TSH) report', re: /\btsh\b|\bthyroid\s+(?:profile|test|function)\b|\bt3\b|\bt4\b/gi },
  { label: 'Urine routine report', re: /\burine\s*(?:r\/?m|routine|re|test|examination|culture)?\b/gi },
  { label: 'X-ray', re: /\bx[\s-]?ray\b|\bxray\b|\bcxr\b/gi },
  { label: 'Ultrasound (USG) report', re: /\busg\b|\bultrasound\b|\bsonography\b/gi },
  { label: 'ECG', re: /\becg\b|\bekg\b/gi },
  { label: 'Echo report', re: /\b(?:2d\s*)?echo(?:cardiography)?\b/gi },
  { label: 'CT scan report', re: /\b(?:nc|ce)?ct(?:\s+scan)?\b/gi },
  { label: 'MRI report', re: /\bmri\b/gi },
  { label: 'Audiometry report', re: /\bpta\b|\baudiometry\b|\baudiogram\b/gi },
  { label: 'BP record', re: /\bbp\s+(?:chart|record|diary|log|readings?)\b/gi },
  { label: 'MCP card', re: /\bmcp\s+card\b|\banc\s+card\b|\bmamta\s+card\b|\bmother\s+(?:and|&)\s+child\s+(?:protection\s+)?card\b/gi },
  { label: 'OPD card', re: /\bopd\s+(?:card|slip|ticket|parchi|purchi)\b|\bparchi\b|\bpurchi\b/gi },
  { label: 'Old reports and prescriptions', re: /\b(?:old|previous)\s+(?:prescriptions?|files?|papers|records|reports)\b/gi },
  { label: 'Discharge summary', re: /\bdischarge\s+(?:summary|card|slip|ticket|papers)\b/gi },
  { label: 'Current medicines', re: /\b(?:all\s+|current\s+|your\s+|present\s+)?(?:medicines|medications|meds|dawaiyan|dawaiyaan|dawai|dawa)\b/gi },
  { label: 'All recent reports', re: /\b(?:with|bring|carry)\s+(?:all\s+)?(?:the\s+)?(?:recent\s+)?reports?\b|\breports?\s+(?=lekar|le\s*kar|le\s*ke)|\u0930\u093F\u092A\u094B\u0930\u094D\u091F/gi },
];
const GENERIC_REPORT_RE = /\b([a-z][a-z0-9-]{2,})\s+reports?\b/gi;
const GENERIC_STOP = new Set([
  'with', 'all', 'the', 'old', 'previous', 'your', 'and', 'test', 'tests', 'blood', 'latest', 'new',
  'recent', 'investigation', 'investigations', 'bring', 'carry', 'his', 'her', 'their',
]);

const BRING_FWD_RE =
  /\b(?:with|bring(?:ing)?|carry(?:ing)?|along\s*with|alongwith|get\s+(?:the\s+)?|repeat|investigations?\s*:|reports?\s*:|tests?\s*:)/gi;
const BRING_BACK_RE =
  /\b(?:lekar|le\s*kar|le\s*ke|leke|lana|laana|layen|laayen|laiye)\b|\u0932\u0947\u0915\u0930|\u0938\u093E\u0925\s*\u0932\u093E\u090F/gi;
const ZONE_STOP_RE =
  /[.;\n\u0964]|\b(?:after|on|review|r\/v|f\/u|follow|come|visit|without|if|then|baad|within|next|must|sos|prn|lekar|le\s*kar|le\s*ke|leke|done)\b|\bin\s+\d/i;
const ZONE_START_RE = /[,.;\n\u0964]|\b(?:baad|after|review)\b|\u092C\u093E\u0926/gi;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Devanagari digits → ASCII and unicode dashes → '-' without changing length, so spans stay aligned. */
function normalise(text: string): string {
  return text
    .replace(/[\u0966-\u096F]/g, (c) => String(c.charCodeAt(0) - 0x0966))
    .replace(/[\u2012-\u2015]/g, '-');
}

function makeSpan(src: string, start: number, end: number): Span {
  return { start, end, text: src.slice(start, end) };
}

/** Trim whitespace and trailing commas from a range. */
function tidy(src: string, r: Range): Range {
  let { start, end } = r;
  while (start < end && /\s/.test(src[start])) start++;
  while (end > start && /[\s,]/.test(src[end - 1])) end--;
  return { start, end };
}

function overlaps(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}

function within(inner: Range, outer: Range): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

function* matches(re: RegExp, text: string): Generator<RegExpExecArray> {
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) {
    if (m[0].length === 0) {
      r.lastIndex++;
      continue;
    }
    yield m;
  }
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

function lastTokens(text: string, start: number, count: number): string[] {
  const before = text.slice(Math.max(0, start - 40), start).toLowerCase();
  return before
    .split(/[^a-z0-9/\u0900-\u097F]+/)
    .filter((t) => t && t !== '/')
    .slice(-count);
}

function hasCue(text: string, r: Range, words: Set<string>): boolean {
  if (lastTokens(text, r.start, 3).some((t) => words.has(t))) return true;
  return CUE_AFTER_RE.test(text.slice(r.end, r.end + 16));
}

function numberFrom(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  const n = NUMBER_WORDS[token.toLowerCase()];
  return n === undefined ? null : n;
}

function unitFrom(token: string): { unit: IntervalUnit; mult: number } | null {
  const t = token.toLowerCase();
  if (/^(d|days?|dys?|din)$/.test(t) || t === '\u0926\u093F\u0928') return { unit: 'day', mult: 1 };
  if (/^fortnights?$/.test(t)) return { unit: 'week', mult: 2 };
  if (/^(w|wks?|weeks?|hafte|hafta|hafton)$/.test(t)) return { unit: 'week', mult: 1 };
  if (t.startsWith('\u0939') || t.startsWith('\u0938\u092A')) return { unit: 'week', mult: 1 }; // हफ़्ते, सप्ताह
  if (/^(m|mo|months?|mnths?|mths?|mahine|mahina|mahino|maah)$/.test(t) || t.startsWith('\u092E')) {
    return { unit: 'month', mult: 1 }; // महीने, माह
  }
  if (/^(years?|yrs?|saal)$/.test(t) || t === '\u0938\u093E\u0932') return { unit: 'year', mult: 1 };
  return null;
}

function unitWord(unit: IntervalUnit, n: number): string {
  return n === 1 ? unit : `${unit}s`;
}

export function dueFromInterval(visit: ISODate, value: number, unit: IntervalUnit): ISODate {
  switch (unit) {
    case 'day':
      return addDays(visit, value);
    case 'week':
      return addDays(visit, value * 7);
    case 'month':
      return addMonths(visit, value);
    case 'year':
      return addMonths(visit, value * 12);
  }
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/* ------------------------------------------------------------------ */
/* Reader                                                              */
/* ------------------------------------------------------------------ */

interface IntervalCand extends Range {
  value: number;
  upper: number | null;
  unit: IntervalUnit;
  form: 'plain' | 'compact' | 'word' | 'hindi' | 'shorthand';
  recurring: boolean;
  cued: boolean;
  kind: 'timing' | 'duration' | 'precaution';
}

interface DateCand extends Range {
  iso: ISODate;
  form: 'numeric' | 'named' | 'weekday';
}

export function readInstruction(input: ReadInput): Reading {
  const instruction = input.instruction ?? '';
  const text = normalise(instruction);
  const { visitDate, department } = input;

  const flags: Flag[] = [];
  const highlights: Highlight[] = [];
  const flag = (code: FlagCode, level: FlagLevel, message: string) => {
    if (!flags.some((f) => f.code === code && f.message === message)) flags.push({ code, level, message });
  };
  const mark = (r: Range, kind: HighlightKind, note: string) => {
    highlights.push({ ...makeSpan(instruction, r.start, r.end), kind, note, source: 'rules' });
  };

  const empty: Reading = {
    engine: 'rules',
    instruction,
    visitDate,
    department,
    options: [],
    noDate: null,
    conditional: null,
    eventAnchor: null,
    bring: [],
    importanceHint: null,
    precautions: [],
    flags,
    highlights,
  };

  if (!text.trim()) {
    flag('no_timing', 'decide', 'No instruction was entered. Ask the clinician when the patient should return.');
    return empty;
  }

  /* 1. Return precautions ("come immediately if …") are copied, never interpreted. */
  const precautionRanges = mergeRanges(
    PRECAUTION_RES.flatMap((re) => [...matches(re, text)].map((m) => tidy(text, { start: m.index, end: m.index + m[0].length }))),
  );
  for (const r of precautionRanges) mark(r, 'precaution', 'Return precaution, printed word for word on the slip');
  const inPrecaution = (r: Range) => precautionRanges.some((p) => overlaps(r, p));

  /* 2. Intervals */
  const rawIntervals: IntervalCand[] = [];
  const pushInterval = (c: Omit<IntervalCand, 'cued' | 'kind'>) => {
    if (rawIntervals.some((o) => overlaps(o, c) && o.end - o.start >= c.end - c.start)) return;
    for (let i = rawIntervals.length - 1; i >= 0; i--) {
      if (overlaps(rawIntervals[i], c)) rawIntervals.splice(i, 1);
    }
    rawIntervals.push({ ...c, cued: false, kind: 'timing' });
  };

  for (const m of matches(SHORTHAND_RE, text)) {
    const start = m.index;
    const end = start + m[0].length;
    const tokens = lastTokens(text, start, 1);
    if (tokens.length && DATE_PREPOSITIONS.has(tokens[0])) continue; // "on 6/12" is a date
    const denom = m[2];
    const unit: IntervalUnit = denom === '7' ? 'day' : denom === '52' ? 'week' : 'month';
    pushInterval({ start, end, value: Number(m[1]), upper: null, unit, form: 'shorthand', recurring: false });
  }
  for (const m of matches(INTERVAL_RE, text)) {
    const value = numberFrom(m[1]);
    const u = unitFrom(m[3]);
    if (value === null || !u) continue;
    pushInterval({
      start: m.index,
      end: m.index + m[0].length,
      value: value * u.mult,
      upper: m[2] ? Number(m[2]) * u.mult : null,
      unit: u.unit,
      form: 'plain',
      recurring: false,
    });
  }
  for (const m of matches(COMPACT_RE, text)) {
    const u = unitFrom(m[2]);
    if (!u) continue;
    pushInterval({ start: m.index, end: m.index + m[0].length, value: Number(m[1]), upper: null, unit: u.unit, form: 'compact', recurring: false });
  }
  for (const m of matches(HI_INTERVAL_RE, text)) {
    const value = numberFrom(m[1]);
    const u = unitFrom(m[2]);
    if (value === null || !u) continue;
    pushInterval({ start: m.index, end: m.index + m[0].length, value, upper: null, unit: u.unit, form: 'hindi', recurring: false });
  }
  for (const m of matches(WORD_INTERVAL_RE, text)) {
    const start = m.index;
    const end = start + m[0].length;
    // groups: 1 next/agle <unit>, 2 fortnight, 3 weekly/monthly…, 4 every <unit>, 5 tomorrow
    const word = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '').toLowerCase();
    let unit: IntervalUnit = 'week';
    let value = 1;
    if (/month|mahine/.test(word)) unit = 'month';
    else if (/year|saal|annual/.test(word)) unit = 'year';
    else if (/fortnight/.test(word)) value = 2;
    else if (/tomorrow/.test(word)) unit = 'day';
    pushInterval({ start, end, value, upper: null, unit, form: 'word', recurring: Boolean(m[3] || m[4]) });
  }
  rawIntervals.sort((a, b) => a.start - b.start);

  for (const [i, c] of rawIntervals.entries()) {
    if (inPrecaution(c)) {
      c.kind = 'precaution';
      continue;
    }
    const before = text.slice(Math.max(0, c.start - 14), c.start);
    const after = text.slice(c.end, c.end + 24);
    if (DURATION_BEFORE_RE.test(before) || DURATION_AFTER_RE.test(after)) {
      c.kind = 'duration';
      const lead = before.match(/(?:\bfor|\bx|\u00D7|\*|\btill|\bupto|\bup\s+to)\s*(?:the\s+)?(?:next\s+)?(?:another\s+)?$/i);
      const r = { start: c.start - (lead ? lead[0].length : 0), end: c.end };
      mark(r, 'ignored', 'Treatment duration, not used as the follow-up time');
      flag(
        'duration_ignored',
        'info',
        `"${instruction.slice(r.start, r.end).trim()}" looks like a medicine or treatment duration, so it is not used as the follow-up time.`,
      );
      continue;
    }
    c.cued = c.form === 'word' || hasCue(text, c, CUE_WORDS);
    const prev = rawIntervals[i - 1];
    if (!c.cued && prev && prev.kind === 'timing' && ALTERNATIVE_GAP_RE.test(text.slice(prev.end, c.start))) {
      c.cued = prev.cued;
    }
  }

  /* 3. Dates */
  const dates: DateCand[] = [];
  const pushDate = (start: number, end: number, d: number, m: number, y: string | undefined, form: DateCand['form']) => {
    const r = { start, end };
    if (inPrecaution(r) || dates.some((o) => overlaps(o, r))) return;
    if (!hasCue(text, r, DATE_CUE_WORDS)) return;
    let iso: ISODate | null;
    if (y) {
      const year = y.length === 2 ? 2000 + Number(y) : Number(y);
      iso = makeISO(year, m, d);
    } else {
      const vy = Number(visitDate.slice(0, 4));
      iso = makeISO(vy, m, d);
      if (iso && iso <= visitDate) iso = makeISO(vy + 1, m, d);
    }
    const raw = instruction.slice(start, end);
    if (!iso) {
      flag('date_invalid', 'decide', `"${raw}" is not a real calendar date. Check it with the clinician.`);
      return;
    }
    if (iso <= visitDate) {
      flag('date_past', 'decide', `"${raw}" is on or before today's visit. Check the date with the clinician.`);
      return;
    }
    dates.push({ start, end, iso, form });
  };

  for (const m of matches(SLASH_DATE_RE, text)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (!m[3] && (mo === 7 || mo === 12 || mo === 52)) {
      const tokens = lastTokens(text, m.index, 1);
      if (!(tokens.length && DATE_PREPOSITIONS.has(tokens[0]))) continue; // clinical shorthand, read above
    }
    if (mo > 12) continue;
    if (/^\s*(?:tab|tablet|bd|od|tds|tid|hs|mg|ml)\b/i.test(text.slice(m.index + m[0].length, m.index + m[0].length + 8))) continue;
    pushDate(m.index, m.index + m[0].length, d, mo, m[3], 'numeric');
  }
  for (const m of matches(DOT_DASH_DATE_RE, text)) {
    pushDate(m.index, m.index + m[0].length, Number(m[1]), Number(m[2]), m[3], 'numeric');
  }
  for (const m of matches(NAMED_DATE_RE, text)) {
    pushDate(m.index, m.index + m[0].length, Number(m[1]), MONTH_INDEX[m[2].slice(0, 3).toLowerCase()], m[3], 'named');
  }
  for (const m of matches(NAMED_DATE_RE2, text)) {
    pushDate(m.index, m.index + m[0].length, Number(m[2]), MONTH_INDEX[m[1].slice(0, 3).toLowerCase()], m[3], 'named');
  }
  for (const m of matches(WEEKDAY_RE, text)) {
    const r = { start: m.index, end: m.index + m[0].length };
    if (inPrecaution(r) || dates.some((o) => overlaps(o, r))) continue;
    const target = WEEKDAY_INDEX[m[2].slice(0, 3).toLowerCase()];
    const ahead = (target - weekday(visitDate) + 7) % 7 || 7;
    const iso = addDays(visitDate, ahead);
    dates.push({ ...r, iso, form: 'weekday' });
    flag('weekday', 'check', `"${instruction.slice(r.start, r.end)}" was read as ${formatDate(iso, 'long')}. Confirm with the patient.`);
  }

  /* 4. Pick the timing candidates */
  let timing: (IntervalCand | DateCand)[] = [
    ...rawIntervals.filter((c) => c.kind === 'timing' && c.cued),
    ...dates,
  ];
  if (timing.length === 0) {
    const uncued = rawIntervals.filter((c) => c.kind === 'timing' && !c.cued);
    for (const c of uncued) {
      flag(
        'uncued',
        'check',
        `"${instruction.slice(c.start, c.end)}" has no "after / review" word next to it; it was assumed to be the follow-up time.`,
      );
    }
    timing = uncued;
  }
  timing.sort((a, b) => a.start - b.start);

  /* 5. Turn candidates into options aligned to OPD days */
  let eventAnchor: Span | null = null;
  const options: TimingOption[] = [];
  for (const c of timing) {
    let rawDue: ISODate;
    let label: string;
    if ('iso' in c) {
      rawDue = c.iso;
      label = formatDate(c.iso, 'short');
      if (diffDays(visitDate, rawDue) > 400) {
        flag('far_future', 'check', `${formatDate(rawDue, 'medium')} is more than a year away. Confirm with the clinician.`);
      }
    } else {
      rawDue = dueFromInterval(visitDate, c.value, c.unit);
      label = `${c.value}${c.upper ? `–${c.upper}` : ''} ${unitWord(c.unit, c.upper ?? c.value)}`;
      if (c.form === 'shorthand') {
        const raw = instruction.slice(c.start, c.end);
        const denom = raw.split('/')[1]?.trim();
        if (denom === '12' || denom === '7') {
          const asDate = makeISO(2000, denom === '12' ? 12 : 7, c.value);
          flag(
            'shorthand_ambiguous',
            'check',
            `"${raw}" was read as ${label} (clinical shorthand). It could also be a date${asDate ? ` (${formatDate(asDate, 'short')})` : ''}; confirm.`,
          );
        } else {
          flag('shorthand', 'info', `"${raw}" read as ${label} (clinical shorthand).`);
        }
      }
      if (c.upper) {
        flag('range', 'info', `"${instruction.slice(c.start, c.end)}" is a range; the due date uses the earlier end.`);
      }
      if (c.recurring) {
        flag('recurring', 'info', `"${instruction.slice(c.start, c.end)}" is a repeating follow-up; only the next visit is tracked.`);
      }
      const anchor = text.slice(c.end).match(EVENT_ANCHOR_AFTER_RE);
      if (anchor) {
        const r = tidy(text, { start: c.start, end: c.end + anchor[0].length });
        eventAnchor = makeSpan(instruction, r.start, r.end);
        flag(
          'event_anchor',
          'decide',
          `"${eventAnchor.text}" counts from an event, not from today's visit. Set the date with the clinician.`,
        );
      }
    }
    const { dueDate, shiftNote } = alignToOpdDay(rawDue, department);
    if (options.some((o) => o.dueDate === dueDate)) continue;
    options.push({
      label,
      rawDue,
      dueDate,
      shiftNote,
      intervalDays: diffDays(visitDate, rawDue),
      span: makeSpan(instruction, c.start, c.end),
      source: 'rules',
    });
  }
  for (const o of options) {
    mark(o.span, 'timing', `Follow-up time: due ${formatDate(o.dueDate, 'long')}`);
    if (o.shiftNote) flag('opd_shift', 'info', o.shiftNote);
  }

  /* 6. No fixed date, conditional return, event-based return */
  let noDate = null as Reading['noDate'];
  const setNoDate = (kind: NoDateKind, r: Range) => {
    if (!noDate) noDate = { kind, span: makeSpan(instruction, r.start, r.end) };
  };
  const asNeededRanges: Range[] = [];
  for (const m of matches(SOS_RE, text)) {
    const r = { start: m.index, end: m.index + m[0].length };
    if (inPrecaution(r)) continue;
    setNoDate('sos', r);
    mark(r, 'nodate', 'SOS: come if needed, no fixed date');
  }
  for (const m of matches(AS_NEEDED_RE, text)) {
    const r = { start: m.index, end: m.index + m[0].length };
    if (inPrecaution(r)) continue;
    asNeededRanges.push(r);
    setNoDate('as_needed', r);
    mark(r, 'nodate', 'As needed: no fixed date');
  }
  for (const m of matches(EVENT_RE, text)) {
    const r = tidy(text, { start: m.index, end: m.index + m[0].length });
    if (inPrecaution(r)) continue;
    if (eventAnchor && overlaps(r, eventAnchor)) continue;
    if (rawIntervals.some((c) => c.kind === 'timing' && r.start - c.end >= 0 && r.start - c.end <= 3)) continue;
    setNoDate('event', r);
    mark(r, 'nodate', 'Return depends on an event, not a date');
  }
  let conditional: Span | null = null;
  for (const m of matches(CONDITION_RE, text)) {
    const r = tidy(text, { start: m.index, end: m.index + m[0].length });
    if (inPrecaution(r) || asNeededRanges.some((a) => overlaps(a, r))) continue;
    conditional = makeSpan(instruction, r.start, r.end);
    mark(r, 'condition', 'Return only if this condition holds');
    break;
  }

  /* 7. Things to bring */
  const zones: Range[] = [];
  for (const m of matches(BRING_FWD_RE, text)) {
    const start = m.index + m[0].length;
    const rest = text.slice(start);
    const stop = rest.search(ZONE_STOP_RE);
    zones.push({ start: m.index, end: start + (stop === -1 ? rest.length : stop) });
  }
  for (const m of matches(BRING_BACK_RE, text)) {
    let start = 0;
    for (const b of matches(ZONE_START_RE, text.slice(0, m.index))) start = b.index + b[0].length;
    zones.push({ start, end: m.index + m[0].length });
  }
  const inZone = (r: Range) => zones.some((z) => within(r, z) || overlaps(r, z));

  const found: (Range & { label: string })[] = [];
  for (const entry of BRING_DICT) {
    for (const m of matches(entry.re, text)) {
      const r = tidy(text, { start: m.index, end: m.index + m[0].length });
      if (inPrecaution(r) || found.some((f) => overlaps(f, r))) continue;
      const zoneOnly = entry.label === 'Current medicines' || entry.label === 'All recent reports' || entry.label === 'OPD card';
      if (zoneOnly && !inZone(r)) continue;
      found.push({ ...r, label: entry.label });
    }
  }
  for (const m of matches(GENERIC_REPORT_RE, text)) {
    const r = { start: m.index, end: m.index + m[0].length };
    const word = m[1].toLowerCase();
    if (GENERIC_STOP.has(word) || !inZone(r) || found.some((f) => overlaps(f, { start: r.start - 1, end: r.end }))) continue;
    found.push({ ...r, label: `${word.charAt(0).toUpperCase()}${word.slice(1)} report` });
  }
  found.sort((a, b) => a.start - b.start);
  const bring: BringItem[] = [];
  for (const f of found) {
    if (bring.some((b) => b.item === f.label)) continue;
    const confident = inZone(f);
    bring.push({ item: f.label, confident, source: 'rules', span: makeSpan(instruction, f.start, f.end) });
    mark(f, 'bring', confident ? `Bring: ${f.label}` : `Mentioned: ${f.label} (not clearly "bring")`);
    if (!confident) {
      flag(
        'bring_unsure',
        'info',
        `"${instruction.slice(f.start, f.end)}" is mentioned but not clearly as something to bring, so it is left unticked.`,
      );
    }
  }

  /* 8. Importance: suggested only from explicit emphasis words */
  let importanceHint: ImportanceHint | null = null;
  const must = [...matches(MUST_RE, text)].find((m) => !inPrecaution({ start: m.index, end: m.index + m[0].length }));
  const imp = [...matches(IMPORTANT_RE, text)][0];
  const hit = must ?? imp;
  if (hit) {
    const r = { start: hit.index, end: hit.index + hit[0].length };
    importanceHint = { level: must ? 'must_not_miss' : 'important', span: makeSpan(instruction, r.start, r.end), source: 'rules' };
    const label = must ? 'Must not miss' : 'Important';
    mark(r, 'importance', `Emphasis word, suggests ${label}`);
    flag(
      'importance_hint',
      'info',
      `"${importanceHint.span.text}" suggests ${label}. The importance level is still chosen by the clinician and nurse.`,
    );
  }

  /* 9. Summary flags */
  if (options.length === 0) {
    if (noDate?.kind === 'event') {
      flag('event_based', 'decide', `Return depends on an event ("${noDate.span.text}"). Ask the clinician for a date to check in.`);
    } else if (noDate) {
      flag(
        'no_fixed_date',
        'decide',
        `"${noDate.span.text}" means come back only if needed. Mark it as not tracked, or set a date with the clinician.`,
      );
    } else {
      flag('no_timing', 'decide', 'No follow-up time was found in the text. Ask the clinician when the patient should return.');
    }
  } else if (noDate) {
    flag('also_sos', 'info', `"${noDate.span.text}" is also written; the dated follow-up is the one tracked.`);
  }
  if (options.length > 1) {
    flag(
      'conflict',
      'decide',
      `The text gives ${options.length} different times (${options.map((o) => `"${o.span.text}" gives ${formatDate(o.dueDate, 'short')}`).join(', ')}). Choose one with the clinician.`,
    );
  }
  if (conditional && options.length > 0) {
    flag(
      'conditional',
      'decide',
      `Return is conditional ("${conditional.text}"). Decide whether this patient should be chased if they do not come.`,
    );
  }
  if (precautionRanges.length) {
    flag('precaution', 'info', 'Return precautions are printed on the slip exactly as written. The system does not interpret them.');
  }

  return {
    ...empty,
    options,
    noDate,
    conditional,
    eventAnchor,
    bring,
    importanceHint,
    precautions: precautionRanges.map((r) => makeSpan(instruction, r.start, r.end)),
  };
}

/* ------------------------------------------------------------------ */
/* What the confirmation form starts from                              */
/* ------------------------------------------------------------------ */

export interface Proposal {
  /** null means the reader will not suggest; a person has to choose. */
  tracking: 'dated' | 'not_tracked' | null;
  dueDate: ISODate | null;
  bring: string[];
  importanceHint: ImportanceHint | null;
}

export function proposalFrom(reading: Reading): Proposal {
  const clear = reading.options.length === 1 && !needsDecision(reading);
  return {
    tracking: clear ? 'dated' : null,
    dueDate: clear ? reading.options[0].dueDate : null,
    bring: reading.bring.filter((b) => b.confident).map((b) => b.item),
    importanceHint: reading.importanceHint,
  };
}

export function needsDecision(reading: Reading): boolean {
  return reading.flags.some((f) => f.level === 'decide');
}

/* ------------------------------------------------------------------ */
/* Highlight segments for display                                      */
/* ------------------------------------------------------------------ */

const PRIORITY: Record<HighlightKind, number> = {
  ignored: 1,
  precaution: 2,
  condition: 3,
  nodate: 4,
  bring: 5,
  importance: 6,
  timing: 7,
};

export interface Segment {
  text: string;
  highlight: Highlight | null;
}

/** Splits text into runs, each owned by the highest-priority highlight covering it. */
export function segmentHighlights(text: string, highlights: Highlight[]): Segment[] {
  const owner: (Highlight | null)[] = new Array(text.length).fill(null);
  for (const h of [...highlights].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind])) {
    for (let i = Math.max(0, h.start); i < Math.min(h.end, text.length); i++) owner[i] = h;
  }
  const out: Segment[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.highlight === owner[i]) last.text += text[i];
    else out.push({ text: text[i], highlight: owner[i] });
  }
  return out;
}
