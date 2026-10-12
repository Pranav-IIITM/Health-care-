import { describe, expect, it } from 'vitest';
import { ACCEPTANCE_CHECKS } from '../src/core/acceptance';

describe('Version 1 acceptance checks', () => {
  for (const check of ACCEPTANCE_CHECKS) {
    it(`${check.id} ${check.title}`, () => {
      const result = check.run();
      expect(result.pass, result.detail).toBe(true);
    });
  }
});
