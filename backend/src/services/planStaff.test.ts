import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcademicTerm } from '@prisma/client';

// Plan a obsada (services/planStaff): ktore umieszczenia sie rozjechaly, podpowiedz osoby, kolizje
// przy przepieciu (takze miedzy zmianami z jednej listy), zapis tylko zmian bez kolizji.
const prismaMock = vi.hoisted(() => ({
  placement: { findMany: vi.fn(), update: vi.fn((args: unknown) => ({ op: 'update', args })) },
  placementException: { updateMany: vi.fn((args: unknown) => ({ op: 'exceptions', args })) },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
}));
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));

const ctx = {
  cohort: { id: 'c1', program: { code: 'MBM', studyMode: 'FULL_TIME', fieldOfStudy: { facultyId: 'wm' } } },
  semester: 1,
  nameOf: (groupId: string) => groupId.toUpperCase(),
};
vi.mock('./sections', () => ({ activeCohorts: vi.fn(async () => [ctx]) }));
const calendarStatus = vi.hoisted(() => ({ value: 'PLANNING' }));
vi.mock('./cohortCalendar', () => ({ calendarsFor: vi.fn(async () => new Map([['c1', { status: calendarStatus.value }]])) }));
vi.mock('./termCalendars', () => ({ toCalendarInput: vi.fn(() => ({})) }));
vi.mock('./cohorts', () => ({ cohortLabel: () => 'MBM-S1' }));
// Dwa terminy kazdego umieszczenia; blok n = 08:00 + 45 min * (n - 1).
vi.mock('../lib/teachingCalendar', () => ({
  TeachingCalendar: class {},
  expandDates: vi.fn(() => [{ date: '2026-10-05' }, { date: '2026-10-12' }]),
}));
vi.mock('./timeGrids', () => ({
  gridFor: vi.fn(async () => ({
    forDay: () => ({ time: { range: (s: number, e: number) => ({ startMinute: 480 + 45 * (s - 1), endMinute: 480 + 45 * e }) } }),
  })),
}));
const occupancyMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
vi.mock('./plan', () => ({ termOccupancy: occupancyMock, refreshPlanningTerms: refreshMock }));

import { changePlanStaff, staffMismatches } from './planStaff';

const term = { id: 't1', startYear: 2026, type: 'WINTER' } as AcademicTerm;
const person = (id: string) => ({ id, title: 'dr', firstName: id, lastName: 'X' });
const staff = (id: string | null, hours: number) => ({ instructorId: id, hours, instructor: id ? person(id) : null });

function placement(id: string, over: { instructorId?: string | null; staff?: ReturnType<typeof staff>[]; startOrder?: number; sectionId?: string; groupId?: string; jointKey?: string | null } = {}) {
  const instructorId = over.instructorId === undefined ? 'kow' : over.instructorId;
  return {
    id,
    termId: 't1',
    facultyId: 'wm',
    sectionId: over.sectionId ?? `s-${id}`,
    dayOfWeek: 'MONDAY',
    startOrder: over.startOrder ?? 1,
    endOrder: (over.startOrder ?? 1) + 1,
    cycle: 'WEEK',
    pattern: 'ALL',
    numbers: [],
    fromIndex: null,
    toIndex: null,
    jointKey: over.jointKey ?? null,
    instructorId,
    instructor: instructorId ? person(instructorId) : null,
    section: {
      id: over.sectionId ?? `s-${id}`,
      cohortId: 'c1',
      classType: 'LAB',
      groupId: over.groupId ?? 'l1',
      hours: 30,
      programEntry: { orderInSemester: 1, subject: { name: 'Fizyka' }, specialization: null },
      instructors: over.staff ?? [staff('kow', 30)],
    },
  };
}

const assertScope = vi.fn(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  calendarStatus.value = 'PLANNING';
  occupancyMock.mockResolvedValue([]);
  refreshMock.mockResolvedValue({ cohortIds: ['c1'], report: null });
});

describe('staffMismatches — plan rozjechany z obsada', () => {
  it('prowadzacy spoza obsady i NN mimo obsady; zgodne umieszczenia pomijamy', async () => {
    prismaMock.placement.findMany.mockResolvedValue([
      placement('ok'),
      placement('foreign', { instructorId: 'old', staff: [staff('now', 30)] }),
      placement('missing', { instructorId: null }),
      placement('vacancy', { instructorId: null, staff: [staff('kow', 15), staff(null, 15)] }),
    ]);
    const rows = await staffMismatches(term, 'wm');
    expect(rows.map((r) => [r.placementId, r.kind, r.current?.id ?? null, r.proposed])).toEqual([
      ['foreign', 'FOREIGN', 'old', 'now'],
      ['missing', 'MISSING', null, 'kow'],
    ]);
    expect(rows[0]).toMatchObject({ group: 'L1', slot: 'poniedzialek 08:00–09:30', cohort: { label: 'MBM-S1', semester: 1 } });
  });

  it('podzial godzin: kolejne umieszczenia tych samych zajec dostaja kolejne osoby', async () => {
    const split = [staff('kow', 15), staff('now', 15)];
    prismaMock.placement.findMany.mockResolvedValue([
      placement('p1', { instructorId: null, staff: split, sectionId: 's' }),
      placement('p2', { instructorId: null, staff: split, sectionId: 's', startOrder: 5 }),
    ]);
    expect((await staffMismatches(term, null)).map((r) => r.proposed)).toEqual(['kow', 'now']);
  });

  it('roczniki z kalendarzem w archiwum — bez wierszy', async () => {
    calendarStatus.value = 'ARCHIVED';
    prismaMock.placement.findMany.mockResolvedValue([placement('foreign', { instructorId: 'old' })]);
    expect(await staffMismatches(term, null)).toEqual([]);
    expect(prismaMock.placement.findMany).not.toHaveBeenCalled();
  });
});

describe('changePlanStaff — przepiecie prowadzacego w planie', () => {
  it('podglad: kolizja z planem i miedzy zmianami z jednej listy; bez zapisu', async () => {
    const both = [staff('now', 30)];
    prismaMock.placement.findMany.mockResolvedValue([
      placement('a', { instructorId: 'old', staff: both, groupId: 'l1' }),
      placement('b', { instructorId: 'old', staff: both, groupId: 'l2' }),
      placement('c', { instructorId: 'old', staff: both, startOrder: 7 }),
    ]);
    occupancyMock.mockResolvedValue([
      { date: '2026-10-12', startMinute: 750, endMinute: 840, instructorId: 'now', jointKey: null, label: 'Mechanika (W) MBM-S1' },
    ]);
    const res = await changePlanStaff(
      term,
      [
        { placementId: 'a', instructorId: 'now' },
        { placementId: 'b', instructorId: 'now' },
        { placementId: 'c', instructorId: 'now' },
      ],
      { dryRun: true, assertScope },
    );
    expect(res.results.map((r) => [r.placementId, r.error, r.conflicts])).toEqual([
      ['a', null, []],
      [
        'b',
        null,
        [
          { date: '2026-10-05', with: 'Fizyka (laboratorium) L1 — z tej listy' },
          { date: '2026-10-12', with: 'Fizyka (laboratorium) L1 — z tej listy' },
        ],
      ],
      ['c', null, [{ date: '2026-10-12', with: 'Mechanika (W) MBM-S1' }]],
    ]);
    expect(res.applied).toBe(0);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(assertScope).toHaveBeenCalledWith('wm');
  });

  it('zapis: tylko zmiany bez bledow; wyjatki z dotychczasowym prowadzacym przechodza na nowego; terminy przeliczone', async () => {
    prismaMock.placement.findMany.mockResolvedValue([
      placement('a', { instructorId: 'old', staff: [staff('now', 30)] }),
      placement('same'),
      placement('outside', { instructorId: null }),
      placement('nn', { instructorId: 'old', staff: [staff(null, 30)], startOrder: 9 }),
    ]);
    const res = await changePlanStaff(
      term,
      [
        { placementId: 'a', instructorId: 'now' },
        { placementId: 'same', instructorId: 'kow' },
        { placementId: 'outside', instructorId: 'obcy' },
        { placementId: 'nn', instructorId: null },
        { placementId: 'brak', instructorId: 'now' },
      ],
      { dryRun: false, assertScope },
    );
    expect(res.results.map((r) => r.error)).toEqual([
      null,
      'Bez zmiany',
      'Prowadzacy spoza obsady tych zajec',
      null,
      'Zajec nie ma w planie tego semestru',
    ]);
    expect(res.applied).toBe(2);
    expect(prismaMock.placement.update.mock.calls.map(([a]) => a)).toEqual([
      { where: { id: 'a' }, data: { instructorId: 'now' } },
      { where: { id: 'nn' }, data: { instructorId: null } },
    ]);
    expect(prismaMock.placementException.updateMany).toHaveBeenCalledWith({
      where: { placementId: 'a', newInstructorId: 'old' },
      data: { newInstructorId: 'now' },
    });
    expect(refreshMock).toHaveBeenCalledWith(term, ['c1']);
  });

  it('zamiana prowadzacych miedzy grupami rownoleglymi przechodzi w jednym kroku', async () => {
    prismaMock.placement.findMany.mockResolvedValue([
      placement('p1', { instructorId: 'kam', staff: [staff('now', 30)], groupId: 'l1' }),
      placement('p2', { instructorId: 'now', staff: [staff('kam', 30)], groupId: 'l2' }),
    ]);
    const res = await changePlanStaff(
      term,
      [
        { placementId: 'p1', instructorId: 'now' },
        { placementId: 'p2', instructorId: 'kam' },
      ],
      { dryRun: false, assertScope },
    );
    expect(res.results.map((r) => r.conflicts)).toEqual([[], []]);
    expect(res.applied).toBe(2);
    // Umieszczenia z listy wypadaja z zajetosci planu — ich prowadzacych liczymy wedlug wyniku sprawdzenia.
    expect(occupancyMock.mock.calls[0]![1]).toMatchObject({ excludePlacementIds: ['p1', 'p2'] });
  });

  it('gdy jedna strona zamiany ma kolizje, druga tez odpada (zostaje dotychczasowy prowadzacy)', async () => {
    prismaMock.placement.findMany.mockResolvedValue([
      placement('p1', { instructorId: 'kam', staff: [staff('now', 30)], groupId: 'l1' }),
      placement('p2', { instructorId: 'now', staff: [staff('kam', 30)], groupId: 'l2' }),
    ]);
    occupancyMock.mockImplementation(async (_term: AcademicTerm, opts: { relevantTo: { instructorId: string } }) =>
      opts.relevantTo.instructorId === 'kam'
        ? [{ date: '2026-10-05', startMinute: 480, endMinute: 570, instructorId: 'kam', jointKey: null, label: 'Mechanika (W) MBM-S2' }]
        : [],
    );
    const res = await changePlanStaff(
      term,
      [
        { placementId: 'p1', instructorId: 'now' },
        { placementId: 'p2', instructorId: 'kam' },
      ],
      { dryRun: true, assertScope },
    );
    expect(res.results.map((r) => r.conflicts)).toEqual([
      [
        { date: '2026-10-05', with: 'Fizyka (laboratorium) L2' },
        { date: '2026-10-12', with: 'Fizyka (laboratorium) L2' },
      ],
      [{ date: '2026-10-05', with: 'Mechanika (W) MBM-S2' }],
    ]);
  });

  it('kalendarz w archiwum — plan tylko do odczytu', async () => {
    calendarStatus.value = 'ARCHIVED';
    prismaMock.placement.findMany.mockResolvedValue([placement('a', { instructorId: 'old', staff: [staff('now', 30)] })]);
    const res = await changePlanStaff(term, [{ placementId: 'a', instructorId: 'now' }], { dryRun: false, assertScope });
    expect(res.results[0]!.error).toBe('Kalendarz rocznika w archiwum — plan tylko do odczytu');
    expect(res.applied).toBe(0);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
