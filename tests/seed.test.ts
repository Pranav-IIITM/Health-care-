import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/core/metrics';
import { isOpdDay } from '../src/core/policy';
import { needsDecision, readInstruction } from '../src/core/reader';
import { createSeedState, HISTORY_INSTRUCTIONS, SEED_TODAY } from '../src/core/seed';
import { contactGroup } from '../src/core/simulation';
import type { DeptCode } from '../src/core/types';

const state = createSeedState();

describe('simulated dataset', () => {
  it('is deterministic', () => {
    expect(JSON.stringify(createSeedState())).toBe(JSON.stringify(state));
  });

  it('uses only instructions the reader can read without an open decision for history', () => {
    for (const [dept, list] of Object.entries(HISTORY_INSTRUCTIONS)) {
      for (const instruction of list) {
        const r = readInstruction({ instruction, visitDate: '2026-09-01', department: dept as DeptCode });
        expect(r.options, instruction).toHaveLength(1);
        expect(needsDecision(r), instruction).toBe(false);
      }
    }
  });

  it('echoes the case file: about 28% miss the window', () => {
    const m = computeMetrics(state);
    expect(m.onTime.n).toBeGreaterThan(150);
    expect(1 - m.onTime.rate!).toBeGreaterThan(0.2);
    expect(1 - m.onTime.rate!).toBeLessThan(0.36);
  });

  it('echoes the case file: about 19% shared and 7% unreachable numbers', () => {
    const tracked = state.followUps.filter((f) => f.id.startsWith('fu-h'));
    const groups = tracked.map((f) => contactGroup(state.patients[f.patientId]));
    const share = (g: string) => groups.filter((x) => x === g).length / groups.length;
    expect(share('shared')).toBeGreaterThan(0.12);
    expect(share('shared')).toBeLessThan(0.32);
    expect(share('unreachable')).toBeGreaterThan(0.03);
    expect(share('unreachable')).toBeLessThan(0.16);
  });

  it('has work in every lane and a desk queue for a real OPD day', () => {
    const m = computeMetrics(state);
    expect(m.openMissed).toBeGreaterThan(15);
    expect(m.lanes.call).toBeGreaterThan(5);
    expect(m.lanes.nurse).toBeGreaterThan(0);
    expect(m.lanes.reminder).toBeGreaterThan(0);
    expect(state.desk).toHaveLength(9);
    for (const d of state.desk) expect(isOpdDay(SEED_TODAY, d.department)).toBe(true);
  });
});
