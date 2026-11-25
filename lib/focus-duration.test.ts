import { describe, it, expect } from 'vitest';
import { focusDurationSeconds } from './focus-duration';
describe('custom focus whole-minute validation', () => {
  it('accepts all presets and range endpoints', () => {
    for (const minutes of [1,5,8,10,12,15,120]) expect(focusDurationSeconds(String(minutes))).toBe(minutes*60);
  });
  it('rejects empty, zero, negative, decimal, exponent, whitespace and over-limit values', () => {
    for (const value of ['', '0', '-1', '1.5', '.5', '121', '9999', '1e2', 'NaN', ' 5 ', 'Infinity']) expect(focusDurationSeconds(value)).toBeNull();
  });
});
