import { describe, expect, it } from 'vitest';
import {
  academicYearOf,
  cohortSemesterInTerm,
  defaultTermDates,
  parseTermKey,
  shiftDateByYears,
  shiftTerm,
  termKey,
  termLabel,
  termOfDate,
  termOrdinal,
} from './terms';
import { daysBetween, weekdayOf } from './isoDate';

describe('klucze i etykiety semestrow', () => {
  it('klucz URL w obie strony', () => {
    expect(termKey({ startYear: 2026, type: 'SUMMER' })).toBe('2026-L');
    expect(parseTermKey('2026-Z')).toEqual({ startYear: 2026, type: 'WINTER' });
    expect(parseTermKey('2026-X')).toBeNull();
  });

  it('etykieta i rok akademicki', () => {
    expect(termLabel({ startYear: 2026, type: 'WINTER' })).toBe('2026/27 zimowy');
    expect(termLabel({ startYear: 2099, type: 'SUMMER' })).toBe('2099/00 letni');
    expect(academicYearOf({ startYear: 2024, type: 'SUMMER' })).toBe('2024/2025');
  });

  it('kolejnosc i przesuniecia', () => {
    const winter = { startYear: 2026, type: 'WINTER' as const };
    expect(termOrdinal(shiftTerm(winter, 1))).toBe(termOrdinal(winter) + 1);
    expect(shiftTerm(winter, 1)).toEqual({ startYear: 2026, type: 'SUMMER' });
    expect(shiftTerm(winter, -1)).toEqual({ startYear: 2025, type: 'SUMMER' });
    expect(shiftTerm(winter, -2)).toEqual({ startYear: 2025, type: 'WINTER' });
  });
});

describe('termOfDate', () => {
  it.each([
    ['2026-11-06', 2026, 'WINTER'],
    ['2027-01-20', 2026, 'WINTER'],
    ['2027-02-20', 2026, 'SUMMER'],
    ['2027-08-10', 2026, 'SUMMER'],
    ['2027-10-01', 2027, 'WINTER'],
  ])('%s -> %i %s', (date, startYear, type) => {
    expect(termOfDate(date)).toEqual({ startYear, type });
  });
});

describe('cohortSemesterInTerm', () => {
  it('nabor pazdziernikowy: zima = nieparzyste, lato = parzyste', () => {
    const start = { startYear: 2024, type: 'WINTER' as const };
    expect(cohortSemesterInTerm(start, start)).toBe(1);
    expect(cohortSemesterInTerm(start, { startYear: 2024, type: 'SUMMER' })).toBe(2);
    expect(cohortSemesterInTerm(start, { startYear: 2026, type: 'WINTER' })).toBe(5);
  });

  it('nabor lutowy: semestr 1 jest letni, 2 zimowy w kolejnym roku', () => {
    const start = { startYear: 2025, type: 'SUMMER' as const };
    expect(cohortSemesterInTerm(start, start)).toBe(1);
    expect(cohortSemesterInTerm(start, { startYear: 2026, type: 'WINTER' })).toBe(2);
    expect(cohortSemesterInTerm(start, { startYear: 2026, type: 'SUMMER' })).toBe(3);
    // przed startem -> semestr <= 0 (rocznik nieaktywny)
    expect(cohortSemesterInTerm(start, { startYear: 2025, type: 'WINTER' })).toBe(0);
  });
});

describe('daty', () => {
  it('przesuniecie o rok zachowuje dzien tygodnia (najblizszy)', () => {
    const shifted = shiftDateByYears('2024-10-01', 2); // wtorek
    expect(weekdayOf(shifted)).toBe(weekdayOf('2024-10-01'));
    expect(shifted).toBe('2026-09-29'); // wtorek najblizej 1.10.2026 (czwartku)
    expect(Math.abs(daysBetween('2026-10-01', shifted))).toBeLessThanOrEqual(3);
  });

  it('29 lutego przechodzi na poprawna date', () => {
    const shifted = shiftDateByYears('2024-02-29', 1);
    expect(shifted.startsWith('2025-0')).toBe(true);
    expect(weekdayOf(shifted)).toBe(weekdayOf('2024-02-29'));
  });

  it('domyslne daty: lato startuje w poniedzialek', () => {
    const { startDate } = defaultTermDates({ startYear: 2026, type: 'SUMMER' });
    expect(startDate.startsWith('2027-02')).toBe(true);
    expect(weekdayOf(startDate)).toBe(1);
  });
});
