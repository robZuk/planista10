import { beforeEach, describe, expect, it, vi } from 'vitest';

// Propozycja kalendarza — Prisma mockowana. Nowy wariant w semestrze, ktory ma juz kalendarz,
// kopiuje tamten (daty, przerwy, dni wolne, zjazdy); pierwszy kalendarz bierze poprzedni rok.
const prismaMock = vi.hoisted(() => ({ termCalendar: { findMany: vi.fn() } }));
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));

import { proposeCalendar } from './termCalendars';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const row = (startYear: number, name: string) => ({
  id: `c-${startYear}-${name}`,
  name,
  kind: 'ZJAZD',
  studyMode: 'PART_TIME',
  startDate: d(`${startYear}-10-01`),
  endDate: d(`${startYear + 1}-01-31`),
  term: { id: `t${startYear}`, startYear, type: 'WINTER' },
  faculty: { id: 'wm', name: 'Wydzial Mechaniczny', shortName: 'WM' },
  breaks: [{ name: 'Przerwa swiateczna', startDate: d(`${startYear}-12-23`), endDate: d(`${startYear + 1}-01-01`) }],
  days: [{ date: d(`${startYear}-11-13`), kind: 'DAY_OFF', name: 'Rektorskie', followsWeekday: null, closedFromBlockOrder: null }],
  zjazdy: [{ number: 1, startDate: d(`${startYear}-10-02`), endDate: d(`${startYear}-10-04`) }],
});

beforeEach(() => vi.clearAllMocks());

describe('proposeCalendar', () => {
  it('wariant w semestrze z kalendarzem: kopia "Podstawowego" z dniami wolnymi i zjazdami', async () => {
    prismaMock.termCalendar.findMany.mockResolvedValueOnce([row(2026, 'Zjazdy B'), row(2026, 'Podstawowy')]);
    const p = await proposeCalendar({ startYear: 2026, type: 'WINTER' }, 'wm', 'PART_TIME', 'Wariant 2');
    expect(p.source).toMatchObject({ termKey: '2026-Z', name: 'Podstawowy' });
    expect(p.calendar).toMatchObject({ name: 'Wariant 2', kind: 'ZJAZD', startDate: '2026-10-01', endDate: '2027-01-31' });
    expect(p.calendar.zjazdy).toEqual([{ number: 1, startDate: '2026-10-02', endDate: '2026-10-04' }]);
    expect(p.calendar.days).toEqual([{ date: '2026-11-13', kind: 'DAY_OFF', name: 'Rektorskie', followsWeekday: null, closedFromBlockOrder: null }]);
    expect(prismaMock.termCalendar.findMany).toHaveBeenCalledTimes(1);
  });

  it('pierwszy kalendarz w semestrze: z poprzedniego roku, bez dni wolnych', async () => {
    prismaMock.termCalendar.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([row(2025, 'Podstawowy')]);
    const p = await proposeCalendar({ startYear: 2026, type: 'WINTER' }, 'wm', 'PART_TIME', 'Podstawowy');
    expect(p.source).toMatchObject({ termKey: '2025-Z' });
    expect(p.calendar.startDate).toBe('2026-10-01');
    expect(p.calendar.days).toEqual([]);
  });
});
