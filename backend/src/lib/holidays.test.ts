import { describe, expect, it } from 'vitest';
import { easterSunday, holidaysInRange, polishHolidays } from './holidays';

describe('easterSunday', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2030, '2030-04-21'],
  ])('Wielkanoc %i = %s', (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });
});

describe('polishHolidays', () => {
  it('ruchome swieta: +1 (poniedzialek), +49 (Zeslanie), +60 (Boze Cialo)', () => {
    const dates = polishHolidays(2025).map((h) => h.date);
    expect(dates).toContain('2025-04-21');
    expect(dates).toContain('2025-06-08');
    expect(dates).toContain('2025-06-19');
  });

  it('Wigilia jest dniem wolnym dopiero od 2025', () => {
    expect(polishHolidays(2024).map((h) => h.date)).not.toContain('2024-12-24');
    expect(polishHolidays(2025).map((h) => h.date)).toContain('2025-12-24');
  });

  it('zawiera wszystkie dni wolne zapisane recznie w bazie 2024/2025 (bramka migracji)', () => {
    const stored = [
      '2024-11-01', '2024-11-11', '2024-12-25', '2024-12-26', '2025-01-01', '2025-01-06',
      '2025-04-20', '2025-04-21', '2025-05-01', '2025-05-03', '2025-06-08', '2025-06-19',
      '2025-08-15',
    ];
    const computed = new Set(holidaysInRange('2024-10-01', '2025-09-30').map((h) => h.date));
    for (const date of stored) expect(computed.has(date)).toBe(true);
  });

  it('holidaysInRange obejmuje przelom roku i jest posortowane', () => {
    const range = holidaysInRange('2026-12-20', '2027-01-10').map((h) => h.date);
    expect(range).toEqual(['2026-12-24', '2026-12-25', '2026-12-26', '2027-01-01', '2027-01-06']);
  });
});
