import { describe, expect, it } from 'vitest';
import { addDaysKey, formatDayKey, formatRange } from './calendarUtils';

describe('calendarUtils', () => {
  it('dodawanie dni przez koniec miesiaca i roku', () => {
    expect(addDaysKey('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDaysKey('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('formatowanie dat i zakresow', () => {
    expect(formatDayKey('2026-10-09')).toBe('9.10');
    expect(formatRange('2026-10-01', '2027-01-31')).toBe('1.10.2026 – 31.01.2027');
    expect(formatRange('2027-02-19', '2027-02-21')).toBe('19.02 – 21.02.2027');
  });
});
