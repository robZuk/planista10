import { describe, expect, it } from 'vitest';
import { upcomingDaysOff, type CalendarDayOff } from './daysOff';

const xmas = (calendar: string): CalendarDayOff => ({ kind: 'BREAK', name: 'Przerwa swiateczna', start: '2026-12-23', end: '2027-01-01', calendar });
const holidays = [
  { date: '2026-11-11', name: 'Narodowe Swieto Niepodleglosci' },
  { date: '2026-12-25', name: 'Boze Narodzenie' },
  { date: '2027-01-06', name: 'Trzech Kroli' },
];

describe('upcomingDaysOff', () => {
  it('przerwa wspolna dla wszystkich kalendarzy: jedna pozycja bez listy, swieto w srodku pominiete', () => {
    const res = upcomingDaysOff('2026-11-11', '2027-01-10', holidays, [xmas('WM stacj.'), xmas('WE stacj.')], ['WM stacj.', 'WE stacj.']);
    expect(res.map((d) => [d.kind, d.start, d.calendars])).toEqual([
      ['HOLIDAY', '2026-11-11', null],
      ['BREAK', '2026-12-23', null],
      ['HOLIDAY', '2027-01-06', null],
    ]);
  });

  it('przerwa tylko w czesci kalendarzy: lista kalendarzy, swieto zostaje', () => {
    const res = upcomingDaysOff('2026-12-01', '2026-12-31', holidays, [xmas('WM stacj.')], ['WM stacj.', 'WE stacj.']);
    expect(res).toEqual([
      expect.objectContaining({ kind: 'BREAK', calendars: ['WM stacj.'] }),
      expect.objectContaining({ kind: 'HOLIDAY', start: '2026-12-25' }),
    ]);
  });

  it('przerwa trwajaca juz od kilku dni sie liczy (i pochlania swieto), przeszla nie; limit pozycji', () => {
    const entries: CalendarDayOff[] = [
      { kind: 'BREAK', name: 'Sesja', start: '2026-11-01', end: '2026-11-12', calendar: 'A' },
      { kind: 'BREAK', name: 'Przeszla', start: '2026-10-01', end: '2026-10-05', calendar: 'A' },
      { kind: 'DAY_OFF', name: 'Dzien rektorski', start: '2027-03-01', end: '2027-03-01', calendar: 'A' },
    ];
    const res = upcomingDaysOff('2026-11-11', '2027-01-10', holidays, entries, ['A'], 2);
    expect(res.map((d) => d.name)).toEqual(['Sesja', 'Boze Narodzenie']);
  });

  it('dni wolne o tej samej nazwie i dacie w roznych kalendarzach lacza sie', () => {
    const day = (calendar: string): CalendarDayOff => ({ kind: 'DAY_OFF', name: 'Dzien rektorski ', start: '2026-11-20', end: '2026-11-20', calendar });
    const res = upcomingDaysOff('2026-11-12', '2026-11-30', [], [day('WN stacj.'), day('WM stacj.')], ['WM stacj.', 'WN stacj.', 'WE stacj.']);
    expect(res).toEqual([expect.objectContaining({ name: 'Dzien rektorski', calendars: ['WM stacj.', 'WN stacj.'] })]);
  });
});
