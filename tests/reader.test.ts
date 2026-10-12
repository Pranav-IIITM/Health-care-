import { describe, expect, it } from 'vitest';
import { proposalFrom, readInstruction, segmentHighlights } from '../src/core/reader';
import type { DeptCode, FlagCode, Reading } from '../src/core/types';

const VISIT = '2026-10-12'; // Monday

function read(instruction: string, department: DeptCode = 'MED'): Reading {
  return readInstruction({ instruction, visitDate: VISIT, department });
}

const codes = (r: Reading): FlagCode[] => r.flags.map((f) => f.code);
const decides = (r: Reading): FlagCode[] => r.flags.filter((f) => f.level === 'decide').map((f) => f.code);
const confidentBring = (r: Reading) => r.bring.filter((b) => b.confident).map((b) => b.item);

describe('timing', () => {
  it('reads clinical shorthand and sets the due date', () => {
    const r = read('Review after 2/52 with CBC, LFT. Tab Metformin 500 mg BD x 14 days.');
    expect(r.options).toHaveLength(1);
    expect(r.options[0].label).toBe('2 weeks');
    expect(r.options[0].dueDate).toBe('2026-10-26');
    expect(decides(r)).toEqual([]);
  });

  it('ignores medicine durations', () => {
    const r = read('R/V after 1 month with lipid profile. Continue Tab Atorvastatin 10 mg x 30 days');
    expect(r.options.map((o) => o.label)).toEqual(['1 month']);
    expect(r.options[0].dueDate).toBe('2026-11-12');
    expect(codes(r)).toContain('duration_ignored');
  });

  it('does not invent a date for SOS', () => {
    const r = read('SOS', 'EYE');
    expect(r.options).toEqual([]);
    expect(r.noDate?.kind).toBe('sos');
    expect(decides(r)).toEqual(['no_fixed_date']);
    expect(proposalFrom(r).dueDate).toBeNull();
  });

  it('shows both options when the text contradicts itself', () => {
    const r = read('R/V 1 wk / 10 days with X-ray', 'ORTHO');
    expect(r.options.map((o) => o.dueDate)).toEqual(['2026-10-19', '2026-10-23']);
    expect(r.options[1].shiftNote).toBe(
      'Thu, 22 Oct 2026 has no Ortho OPD (it runs Mon, Wed, Fri), so the due date moves to Fri, 23 Oct 2026.',
    );
    expect(decides(r)).toContain('conflict');
    expect(proposalFrom(r).dueDate).toBeNull();
  });

  it('marks conditional returns for a human decision', () => {
    const r = read('Review after 3 days if fever persists', 'PAED');
    expect(r.options[0].dueDate).toBe('2026-10-15');
    expect(r.conditional?.text).toBe('if fever persists');
    expect(decides(r)).toEqual(['conditional']);
    expect(proposalFrom(r).tracking).toBeNull();
  });

  it('marks event-based returns without inventing a date', () => {
    const r = read('Review after completing ATT intensive phase with sputum AFB', 'CHEST');
    expect(r.options).toEqual([]);
    expect(r.noDate?.kind).toBe('event');
    expect(decides(r)).toEqual(['event_based']);
    expect(confidentBring(r)).toEqual(['Sputum test report']);
  });

  it('flags intervals that count from an event', () => {
    const r = read('Review 2 weeks after surgery', 'SURG');
    expect(r.eventAnchor?.text).toBe('2 weeks after surgery');
    expect(decides(r)).toContain('event_anchor');
  });

  it('reads Hinglish', () => {
    const r = read('2 hafte baad dikhayen, sugar report lekar aayen');
    expect(r.options[0].dueDate).toBe('2026-10-26');
    expect(confidentBring(r)).toEqual(['Sugar report']);
  });

  it('reads Devanagari', () => {
    const r = read('15 दिन बाद दिखाएँ, रिपोर्ट लेकर आएँ');
    expect(r.options[0].label).toBe('15 days');
    expect(r.options[0].dueDate).toBe('2026-10-27');
    expect(confidentBring(r)).toEqual(['All recent reports']);
  });

  it('reads explicit dates and keeps them on OPD days', () => {
    const r = read('Suture removal on 22/10', 'SURG');
    expect(r.options).toHaveLength(1);
    expect(r.options[0].dueDate).toBe('2026-10-22');
    expect(r.options[0].shiftNote).toBeNull();
  });

  it('moves due dates off days the OPD does not run', () => {
    const r = read('Review after 10 days', 'ENT'); // 22 Oct is a Thursday; ENT runs Tue and Fri
    expect(r.options[0].rawDue).toBe('2026-10-22');
    expect(r.options[0].dueDate).toBe('2026-10-23');
    expect(codes(r)).toContain('opd_shift');
  });

  it('warns when n/12 could also be a date', () => {
    const r = read('Review 6/12 with ECG');
    expect(r.options[0].label).toBe('6 months');
    expect(r.options[0].dueDate).toBe('2027-04-12');
    expect(codes(r)).toContain('shorthand_ambiguous');
  });

  it('treats "on 6/12" as a date', () => {
    const r = read('Review on 6/12');
    expect(r.options[0].dueDate).toBe('2026-12-07'); // 6 Dec is a Sunday
  });

  it('collapses two ways of writing the same day', () => {
    const r = read('Review after 1 month i.e. on 12/11');
    expect(r.options).toHaveLength(1);
    expect(r.options[0].dueDate).toBe('2026-11-12');
  });

  it('rejects dates before the visit', () => {
    const r = read('Review on 2/10/2026');
    expect(r.options).toEqual([]);
    expect(decides(r)).toEqual(expect.arrayContaining(['date_past', 'no_timing']));
  });

  it('handles ranges, next week and monthly', () => {
    expect(read('Review in 7-10 days').options[0].dueDate).toBe('2026-10-19');
    expect(read('review next week').options[0].dueDate).toBe('2026-10-19');
    const monthly = read('Monthly review, collect medicines', 'CHEST');
    expect(monthly.options[0].dueDate).toBe('2026-11-12');
    expect(codes(monthly)).toContain('recurring');
    expect(monthly.bring).toEqual([]);
  });

  it('asks the clinician when no time is written', () => {
    expect(decides(read('Continue ATT for 2 months', 'CHEST'))).toEqual(['no_timing']);
    expect(decides(read('   '))).toEqual(['no_timing']);
  });
});

describe('precautions, importance and bring list', () => {
  it('copies precautions and suggests importance only from emphasis words', () => {
    const r = read(
      'ANC review after 4 weeks with Hb, urine routine, bring MCP card. Come immediately if bleeding or severe headache. Without fail.',
      'OBG',
    );
    expect(r.options[0].dueDate).toBe('2026-11-09');
    expect(r.precautions.map((p) => p.text)).toEqual(['Come immediately if bleeding or severe headache']);
    expect(r.importanceHint?.level).toBe('must_not_miss');
    expect(confidentBring(r)).toEqual(['Hb report', 'Urine routine report', 'MCP card']);
    expect(decides(r)).toEqual([]);
  });

  it('does not treat "earlier if needed" as a missing date', () => {
    const r = read('Review after 1 month, earlier if needed');
    expect(r.options).toHaveLength(1);
    expect(r.noDate).toBeNull();
    expect(r.precautions).toHaveLength(1);
    expect(decides(r)).toEqual([]);
  });

  it('leaves merely mentioned items unticked', () => {
    const r = read('F/U 15 days, BP record');
    expect(r.bring).toEqual([expect.objectContaining({ item: 'BP record', confident: false })]);
    expect(proposalFrom(r).bring).toEqual([]);
  });

  it('never suggests routine and never sets importance itself', () => {
    const r = read('Review after 2 weeks');
    expect(r.importanceHint).toBeNull();
    expect(proposalFrom(r)).not.toHaveProperty('importance');
  });

  it('segments highlights without losing text', () => {
    const text = 'Review after 2/52 with CBC, LFT. Come earlier if pain.';
    const r = read(text);
    const segs = segmentHighlights(text, r.highlights);
    expect(segs.map((s) => s.text).join('')).toBe(text);
    expect(segs.find((s) => s.text === '2/52')?.highlight?.kind).toBe('timing');
  });
});
