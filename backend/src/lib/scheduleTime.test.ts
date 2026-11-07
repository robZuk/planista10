import { describe, it, expect } from 'vitest';
import { checkTimeWindow, rangesOverlap } from './scheduleTime';

describe('rangesOverlap', () => {
  it('wykrywa nakladanie i stycznosc (przedzialy domkniete)', () => {
    expect(rangesOverlap(1, 2, 2, 3)).toBe(true); // stycznosc w punkcie 2
    expect(rangesOverlap(1, 3, 2, 2)).toBe(true); // zawieranie
    expect(rangesOverlap(1, 2, 3, 4)).toBe(false); // rozlaczne
    expect(rangesOverlap(3, 4, 1, 2)).toBe(false); // rozlaczne (odwrotna kolejnosc)
  });
});

describe('checkTimeWindow', () => {
  it('FULL_TIME odrzuca weekend, przepuszcza dni robocze', () => {
    expect(checkTimeWindow(3, '08:00', 'FULL_TIME')).toBeNull();
    expect(checkTimeWindow(6, '08:00', 'FULL_TIME')).toMatch(/stacjonarne/);
  });
  it('PART_TIME odrzuca pon-czw', () => {
    expect(checkTimeWindow(2, '08:00', 'PART_TIME')).toMatch(/pt\/sob\/nd/);
  });
  it('PART_TIME: piatek dozwolony dopiero od 15:00', () => {
    expect(checkTimeWindow(5, '14:59', 'PART_TIME')).toMatch(/piatek dopiero/);
    expect(checkTimeWindow(5, '15:00', 'PART_TIME')).toBeNull();
    expect(checkTimeWindow(6, '08:00', 'PART_TIME')).toBeNull();
  });
});
