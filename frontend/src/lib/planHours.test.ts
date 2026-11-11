import { describe, expect, it } from 'vitest';
import { suggestedLength, earlyEndWeeks, formatDayMonth } from './planHours';

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

describe('suggestedLength — dlugosc w podpowiedzi wolnych godzin', () => {
  it('godziny rozlozone na tygodnie semestru, w gore', () => {
    expect(suggestedLength({ hours: 15, plannedHours: 0 }, 16)).toBe(1);
    expect(suggestedLength({ hours: 30, plannedHours: 0 }, 15)).toBe(2);
    expect(suggestedLength({ hours: 45, plannedHours: 0 }, 15)).toBe(3);
  });

  it('liczy brakujace godziny, gdy czesc juz zaplanowana', () => {
    expect(suggestedLength({ hours: 60, plannedHours: 30 }, 15)).toBe(2);
  });

  it('zjazdy: 18 h na 10 zjazdow -> 2 h; nie dluzej niz brakujace godziny i limit', () => {
    expect(suggestedLength({ hours: 18, plannedHours: 0 }, 10)).toBe(2);
    expect(suggestedLength({ hours: 3, plannedHours: 0 }, 1)).toBe(3);
    expect(suggestedLength({ hours: 90, plannedHours: 0 }, 2)).toBe(6);
  });

  it('bez kalendarza: 2 h (najwyzej tyle, ile godzin)', () => {
    expect(suggestedLength({ hours: 30, plannedHours: 0 }, 0)).toBe(2);
    expect(suggestedLength({ hours: 1, plannedHours: 0 }, 0)).toBe(1);
  });
});
