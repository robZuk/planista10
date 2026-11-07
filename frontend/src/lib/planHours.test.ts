import { describe, expect, it } from 'vitest';
import { earlyEndWeeks, formatDayMonth } from './planHours';

const END = '2027-01-31';

describe('earlyEndWeeks', () => {
  it('rytm wyczerpuje godziny w listopadzie -> tygodnie zapasu', () => {
    expect(earlyEndWeeks({ hours: 30, plannedHours: 30, endsOn: '2026-11-18' }, END)).toBe(10);
  });

  it('koniec w ostatnich 4 tygodniach semestru -> w porzadku', () => {
    expect(earlyEndWeeks({ hours: 30, plannedHours: 30, endsOn: '2027-01-10' }, END)).toBeNull();
    expect(earlyEndWeeks({ hours: 30, plannedHours: 30, endsOn: '2027-01-03' }, END)).toBeNull(); // dokladnie 28 dni
  });

  it('niedoplanowane zajecia nie sa wczesnym koncem', () => {
    expect(earlyEndWeeks({ hours: 30, plannedHours: 20, endsOn: '2026-11-18' }, END)).toBeNull();
  });

  it('brak terminow albo kalendarza -> null', () => {
    expect(earlyEndWeeks({ hours: 30, plannedHours: 30, endsOn: null }, END)).toBeNull();
    expect(earlyEndWeeks({ hours: 30, plannedHours: 30, endsOn: '2026-11-18' }, null)).toBeNull();
  });
});

describe('formatDayMonth', () => {
  it('YYYY-MM-DD -> DD.MM', () => expect(formatDayMonth('2026-11-08')).toBe('08.11'));
});
