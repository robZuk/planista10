import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcademicTerm } from '@prisma/client';

// Wspolna zajetosc semestru (termOccupancy) — Prisma mockowana. Wzorzec z wyjatkami i limitem
// godzin, terminy reczne, pomijanie umieszczenia i pojedynczego terminu.
const prismaMock = vi.hoisted(() => ({
  cohort: { findMany: vi.fn() },
  termCalendar: { findMany: vi.fn() },
  timeGrid: { findMany: vi.fn() },
  classSection: { findMany: vi.fn() },
  occurrence: { findMany: vi.fn() },
  placement: { findMany: vi.fn() },
}));
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));

import { jointProblems, termOccupancy, type PlacementInput } from './plan';
import { gridTime } from '../lib/timeGrid';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const term = { id: 't-2026Z', startYear: 2026, type: 'WINTER' } as AcademicTerm;

const cohort = {
  id: 'c1',
  name: null,
  programVersionId: 'v1',
  lectureMode: 'JOINT',
  program: { code: 'EDST-S1', studyMode: 'FULL_TIME', fieldOfStudy: { facultyId: 'wm', shortName: 'EDST', specializations: [] } },
  programVersion: { id: 'v1', totalSemesters: 7, label: 'Wersja 1', status: 'APPROVED' },
  startTerm: { id: 't-2024Z', startYear: 2024, type: 'WINTER' },
  terms: [],
  groups: [{ id: 'g1', cohortId: 'c1', parentGroupId: null, partitionKey: 'ROOT', code: null, specializationId: null, fromSemester: 1, toSemester: null }],
};

const calendar = {
  id: 'cal1',
  facultyId: 'wm',
  name: 'Podstawowy',
  kind: 'WEEKLY',
  studyMode: 'FULL_TIME',
  status: 'PLANNING',
  startDate: d('2026-10-01'),
  endDate: d('2027-01-31'),
  term,
  faculty: { id: 'wm', name: 'WM', shortName: 'WM' },
  breaks: [],
  days: [],
  zjazdy: [],
};

// Siatka WM stacjonarna 07:00-20:00 co godzine: blok 2 = 08:00-09:00, blok 3 = 09:00-10:00.
const grid = {
  id: 'grid1',
  facultyId: 'wm',
  studyMode: 'FULL_TIME',
  days: [{ day: 'MONDAY', from: null, to: null }, { day: 'TUESDAY', from: null, to: null }],
  blocks: Array.from({ length: 13 }, (_, i) => ({
    id: `b${i + 1}`,
    order: i + 1,
    startTime: `${String(7 + i).padStart(2, '0')}:00`,
    endTime: `${String(8 + i).padStart(2, '0')}:00`,
    label: '',
  })),
};

const placement = (exceptions: unknown[] = []) => ({
  id: 'p1',
  sectionId: 's1',
  dayOfWeek: 'MONDAY',
  startOrder: 2,
  endOrder: 3,
  roomId: 'r1',
  instructorId: 'i1',
  cycle: 'WEEK',
  pattern: 'ALL',
  numbers: [],
  fromIndex: null,
  toIndex: null,
  jointKey: null,
  exceptions,
});

// Zajecia 4 h po 2 h w poniedzialki -> 05.10 i 12.10 (potem godziny sie koncza).
const section = (exceptions: unknown[] = []) => ({
  id: 's1',
  cohortId: 'c1',
  groupId: 'g1',
  classType: 'LECTURE',
  hours: 4,
  programEntry: { subject: { name: 'Fizyka' } },
  placements: [placement(exceptions)],
});

const manualRow = {
  id: 'm1',
  kind: 'MANUAL',
  sectionId: 's9',
  placementId: null,
  originalDate: null,
  date: d('2026-10-07'),
  startOrder: 5,
  endOrder: 5,
  startMinute: 660,
  endMinute: 720,
  roomId: 'r5',
  instructorId: null,
  groupId: 'g1',
  jointKey: null,
  section: { cohortId: 'c1', groupId: 'g1', classType: 'LAB', programEntry: { subject: { name: 'Chemia' } } },
};

// Termin z usunietego umieszczenia (placementId -> null, zyje do ponownego generowania).
const orphanRow = (id: string, cohortId: string, roomId: string) => ({
  ...manualRow,
  id,
  kind: 'DERIVED',
  sectionId: `s-${id}`,
  date: d('2026-10-05'),
  startOrder: 2,
  endOrder: 3,
  startMinute: 480,
  endMinute: 600,
  roomId,
  section: { ...manualRow.section, cohortId },
});

function setup(exceptions: unknown[] = [], manual: unknown[] = [], orphans: unknown[] = []) {
  prismaMock.cohort.findMany.mockResolvedValue([cohort]);
  prismaMock.termCalendar.findMany.mockResolvedValue([calendar]);
  prismaMock.timeGrid.findMany.mockResolvedValue([grid]);
  prismaMock.classSection.findMany.mockResolvedValue([section(exceptions)]);
  prismaMock.occurrence.findMany.mockImplementation((args: { where: { kind: string } }) =>
    Promise.resolve(args.where.kind === 'MANUAL' ? manual : orphans),
  );
}

beforeEach(() => vi.clearAllMocks());

describe('termOccupancy — wspolna zajetosc wzorca i terminow', () => {
  it('wzorzec rozpisany na daty z limitem godzin, w minutach', async () => {
    setup();
    const busy = await termOccupancy(term);
    expect(busy.map((b) => [b.date, b.startMinute, b.endMinute, b.roomId])).toEqual([
      ['2026-10-05', 480, 600, 'r1'],
      ['2026-10-12', 480, 600, 'r1'],
    ]);
    expect(busy[0]!.label).toMatch(/EDST-S1 s5: Fizyka/);
  });

  it('przeniesiony termin zajmuje nowa date i sale, a nie stara', async () => {
    setup([{ placementId: 'p1', originalDate: d('2026-10-05'), action: 'MODIFY', newDate: d('2026-10-06'), newStartOrder: null, newEndOrder: null, newRoomId: 'r2', newInstructorId: null }]);
    const busy = await termOccupancy(term);
    expect(busy.map((b) => [b.date, b.roomId])).toEqual([
      ['2026-10-06', 'r2'],
      ['2026-10-12', 'r1'],
    ]);
  });

  it('odwolany termin nie blokuje (i zuzywa godziny jak przy generowaniu)', async () => {
    setup([{ placementId: 'p1', originalDate: d('2026-10-12'), action: 'CANCEL', newDate: null, newStartOrder: null, newEndOrder: null, newRoomId: null, newInstructorId: null }]);
    const busy = await termOccupancy(term);
    expect(busy.map((b) => b.date)).toEqual(['2026-10-05']);
  });

  it('pomija edytowane umieszczenie albo jeden termin wzorca', async () => {
    setup();
    expect(await termOccupancy(term, { excludePlacementId: 'p1' })).toEqual([]);
    setup();
    expect((await termOccupancy(term, { excludePatternKey: 'p1|2026-10-05' })).map((b) => b.date)).toEqual(['2026-10-12']);
  });

  it('terminy reczne sa w zbiorze (i mozna pominac jeden po id)', async () => {
    setup([], [manualRow]);
    const busy = await termOccupancy(term);
    expect(busy.find((b) => b.roomId === 'r5')).toMatchObject({ date: '2026-10-07', startMinute: 660, label: expect.stringContaining('(termin reczny)') });
    setup([], [manualRow]);
    expect((await termOccupancy(term, { excludeOccurrenceId: 'm1' })).some((b) => b.roomId === 'r5')).toBe(false);
  });

  it('generowanie: wzorce rocznikow z zakresu sa pomijane (liczy je samo)', async () => {
    setup();
    await termOccupancy(term, { excludeCohortIds: ['c1'] });
    expect(prismaMock.classSection.findMany.mock.calls[0]![0].where.cohortId).toEqual({ in: [] });
  });

  it('kalendarze rocznikow jednym zapytaniem (bez N+1)', async () => {
    setup();
    await termOccupancy(term);
    expect(prismaMock.termCalendar.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.termCalendar.findMany.mock.calls[0]![0].where).toEqual({ termId: term.id });
  });

  it('relevantTo: rozpisuje tylko rocznik oraz wzorce i wyjatki dotykajace sali lub prowadzacego', async () => {
    setup();
    const busy = await termOccupancy(term, { relevantTo: { cohortId: 'c1', roomId: 'r1', instructorId: 'i1' } });
    expect(busy).toHaveLength(2);
    expect(prismaMock.classSection.findMany.mock.calls[0]![0].where.OR).toEqual([
      { cohortId: 'c1' },
      {
        placements: {
          some: {
            OR: [
              { roomId: 'r1' },
              { exceptions: { some: { newRoomId: 'r1' } } },
              { instructorId: 'i1' },
              { exceptions: { some: { newInstructorId: 'i1' } } },
            ],
          },
        },
      },
    ]);
    // Terminy osierocone / wygenerowane: tylko rocznika, tej sali albo tego prowadzacego.
    const derived = prismaMock.occurrence.findMany.mock.calls.find((c) => c[0].where.kind === 'DERIVED')![0];
    expect(derived.where.OR).toEqual([{ section: { cohortId: 'c1' } }, { roomId: 'r1' }, { instructorId: 'i1' }]);
    // Terminy reczne bez filtra — zuzywaja godziny zajec, ktore rozpisujemy (limit godzin).
    const manual = prismaMock.occurrence.findMany.mock.calls.find((c) => c[0].where.kind === 'MANUAL')![0];
    expect(manual.where.OR).toBeUndefined();
  });

  it('wzorzec rocznika: jego terminy z usunietych umieszczen nie blokuja (znikna przy generowaniu)', async () => {
    const orphans = [orphanRow('o-own', 'c1', 'r7'), orphanRow('o-other', 'c2', 'r8')];
    setup([], [], orphans);
    // Bez opcji (np. przeniesienie terminu): oba osierocone terminy sa zajetoscia.
    const all = await termOccupancy(term);
    expect(all.filter((b) => ['r7', 'r8'].includes(b.roomId ?? '')).map((b) => b.roomId)).toEqual(['r7', 'r8']);
    // Sprawdzanie wzorca rocznika c1: pomijamy tylko jego wlasne; innego rocznika zostaje.
    setup([], [], orphans);
    const pattern = await termOccupancy(term, { patternOfCohortId: 'c1' });
    expect(pattern.filter((b) => ['r7', 'r8'].includes(b.roomId ?? '')).map((b) => b.roomId)).toEqual(['r8']);
  });

  it('wzorzec rocznika: terminy reczne rocznika dalej blokuja (generowanie ich nie usuwa)', async () => {
    setup([], [manualRow]);
    const busy = await termOccupancy(term, { patternOfCohortId: 'c1' });
    expect(busy.some((b) => b.roomId === 'r5')).toBe(true);
  });

  it('relevantTo bez sali i prowadzacego: tylko wlasny rocznik', async () => {
    setup();
    await termOccupancy(term, { relevantTo: { cohortId: 'c1', roomId: null, instructorId: null } });
    expect(prismaMock.classSection.findMany.mock.calls[0]![0].where.OR).toEqual([{ cohortId: 'c1' }]);
  });
});

describe('jointProblems — zajecia laczone miedzy wydzialami o roznych siatkach', () => {
  // Nasze zajecia: siatka 45 min (blok 2 = 08:50-09:35); polaczone: WM, siatka 60 min, pon 09:00-10:00.
  const g45 = gridTime([
    { order: 1, startTime: '08:00', endTime: '08:45' },
    { order: 2, startTime: '09:00', endTime: '10:00' },
    { order: 3, startTime: '10:15', endTime: '11:00' },
  ]);
  const input = (startOrder: number, endOrder: number): PlacementInput => ({
    sectionId: 'sx',
    dayOfWeek: 'MONDAY',
    startOrder,
    endOrder,
    roomId: 'r1',
    instructorId: null,
    cycle: 'WEEK',
    pattern: 'ALL',
    numbers: [],
    fromIndex: null,
    toIndex: null,
    jointKey: 'J1',
  });
  const joinedRow = { ...placement(), id: 'pj', jointKey: 'J1', startOrder: 3, endOrder: 3, section: section() }; // WM blok 3 = 09:00-10:00

  beforeEach(() => {
    prismaMock.placement.findMany.mockResolvedValue([joinedRow]);
    prismaMock.timeGrid.findMany.mockResolvedValue([grid]);
    prismaMock.cohort.findMany.mockResolvedValue([cohort]);
  });

  it('dolaczenie w tym samym dniu i godzinach (inne numery blokow) -> OK', async () => {
    const t = g45.range(2, 2)!; // 09:00-10:00
    expect(await jointProblems(term, input(2, 2), g45, t)).toEqual([]);
  });

  it('dolaczenie w innym czasie -> problem z czasem polaczonych zajec', async () => {
    const t = g45.range(1, 1)!; // 08:00-08:45
    const problems = await jointProblems(term, input(1, 1), g45, t);
    expect(problems[0]).toMatch(/sa w poniedzialek 09:00-10:00 — umiesc w tym samym czasie/);
  });

  it('zmiana na godziny, ktorych nie ma w siatce drugiego wydzialu -> problem', async () => {
    const t = g45.range(3, 3)!; // 10:15-11:00 — w siatce 60 min nie ma bloku od 10:15
    const problems = await jointProblems(term, input(3, 3), g45, t, 'p-self');
    expect(problems[0]).toMatch(/godzin 10:15-11:00 nie ma w siatce wydzialu/);
  });

  it('zmiana na godziny istniejace w obu siatkach -> OK', async () => {
    const t = g45.range(2, 2)!;
    expect(await jointProblems(term, input(2, 2), g45, t, 'p-self')).toEqual([]);
  });
});
