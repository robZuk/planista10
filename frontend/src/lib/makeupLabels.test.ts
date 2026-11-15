import { describe, expect, it } from 'vitest';
import { formatDate, MAKEUP_STATE_LABELS } from './makeupLabels';

describe('makeupLabels', () => {
  it('data dd.mm.rrrr', () => expect(formatDate('2026-11-12')).toBe('12.11.2026'));

  it('odwolane zajecia sa do odrobienia albo odrobione — bez stanu "zgloszone"', () => {
    expect(Object.keys(MAKEUP_STATE_LABELS)).toEqual(['TODO', 'MADE_UP']);
  });
});
