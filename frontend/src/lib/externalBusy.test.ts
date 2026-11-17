import { describe, expect, it } from 'vitest';
import { datesSummary, mergeDates, shortDate, todayKey, weeklyDates } from './externalBusy';

describe('weeklyDates', () => {
  it('co tydzien od pierwszego wskazanego dnia po dacie poczatkowej', () => {
    // 2027-03-01 to poniedzialek; od srody 3.03 do 24.03.
    expect(weeklyDates('WEDNESDAY', '2027-03-01', '2027-03-24')).toEqual(['2027-03-03', '2027-03-10', '2027-03-17', '2027-03-24']);
  });

  it('co 2 tygodnie — parzystosc od pierwszej daty', () => {
    expect(weeklyDates('MONDAY', '2027-03-08', '2027-04-12', 2)).toEqual(['2027-03-08', '2027-03-22', '2027-04-05']);
  });

  it('przez zmiane czasu (koniec marca) bez przesuniecia dnia', () => {
    expect(weeklyDates('SUNDAY', '2027-03-21', '2027-04-04')).toEqual(['2027-03-21', '2027-03-28', '2027-04-04']);
  });

  it('zle albo odwrocone daty — pusto', () => {
    expect(weeklyDates('MONDAY', '2027-03-10', '2027-03-01')).toEqual([]);
    expect(weeklyDates('MONDAY', '', '2027-03-01')).toEqual([]);
    expect(weeklyDates('MONDAY', '2027-02-30', '2027-03-31')).toEqual([]);
  });
});

it('mergeDates: bez powtorzen, rosnaco, bez blednych', () => {
  expect(mergeDates(['2027-03-08'], ['2027-03-01', '2027-03-08', 'x'])).toEqual(['2027-03-01', '2027-03-08']);
});

it('shortDate', () => expect(shortDate('2027-03-01')).toBe('1.03'));

describe('datesSummary', () => {
  it('dni tygodnia, liczba i zakres', () => {
    expect(datesSummary(['2027-03-15', '2027-03-01', '2027-03-08'])).toBe('pn · 3 daty · 1.03–15.03');
    expect(datesSummary(['2027-03-07', '2027-03-06'])).toBe('sob, nd · 2 daty · 6.03–7.03');
  });

  it('jedna data i odmiana', () => {
    expect(datesSummary(['2027-03-01'])).toBe('pn · 1 data · 1.03');
    expect(datesSummary(weeklyDates('MONDAY', '2027-03-01', '2027-05-31'))).toMatch(/· 14 dat ·/);
    expect(datesSummary([])).toBe('brak dat');
  });
});

it('todayKey — data lokalna', () => {
  expect(todayKey(new Date(2027, 1, 3, 23, 30))).toBe('2027-02-03');
});
