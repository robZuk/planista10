import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcademicTerm } from '@prisma/client';

// Terminy kalendarza "w przygotowaniu" przeliczaja sie same po zmianie planu (refreshPlanningTerms) —
// Prisma mockowana. Opublikowany kalendarz i program w projekcie: bez generowania.
const prismaMock = vi.hoisted(() => ({
  cohort: { findMany: vi.fn() },
  termCalendar: { findMany: vi.fn(), updateMany: vi.fn((args: unknown) => ({ op: 'termCalendar.updateMany', args })) },
  timeGrid: { findMany: vi.fn() },
  classSection: { findMany: vi.fn() },
  occurrence: {
    findMany: vi.fn(),
    deleteMany: vi.fn((args: unknown) => ({ op: 'occurrence.deleteMany', args })),
    createMany: vi.fn((args: unknown) => ({ op: 'occurrence.createMany', args })),
    update: vi.fn((args: unknown) => ({ op: 'occurrence.update', args })),
  },
  externalBusy: { findMany: vi.fn() },
  studentGroup: { findMany: vi.fn() },
  cohortGeneration: { upsert: vi.fn((args: unknown) => ({ op: 'cohortGeneration.upsert', args })) },
  $transaction: vi.fn().mockResolvedValue([]),
}));
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));

import { refreshPlanningTerms, termsNote } from './plan';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const term = { id: 't-2026Z', startYear: 2026, type: 'WINTER' } as AcademicTerm;

const group = { id: 'g1', cohortId: 'c1', parentGroupId: null, partitionKey: 'ROOT', code: null, specializationId: null, fromSemester: 1, toSemester: null };
const cohort = (versionStatus: 'APPROVED' | 'DRAFT' = 'APPROVED') => ({
  id: 'c1',
  name: null,
  programVersionId: 'v1',
  lectureMode: 'JOINT',
  program: { code: 'EDST-S1', studyMode: 'FULL_TIME', fieldOfStudy: { facultyId: 'wm', shortName: 'EDST', specializations: [] } },
  programVersion: { id: 'v1', totalSemesters: 7, label: 'Wersja 1', status: versionStatus },
  startTerm: { id: 't-2024Z', startYear: 2024, type: 'WINTER' },
  terms: [],
  groups: [group],
});

const calendar = (status: 'PLANNING' | 'PUBLISHED') => ({
  id: 'cal1',
  termId: term.id,
  facultyId: 'wm',
  name: 'Podstawowy',
  kind: 'WEEKLY',
  studyMode: 'FULL_TIME',
  status,
  startDate: d('2026-10-01'),
  endDate: d('2027-01-31'),
  datesChangedAt: d('2026-09-01'),
  term,
  faculty: { id: 'wm', name: 'WM', shortName: 'WM' },
  breaks: [],
  days: [],
  zjazdy: [],
});

// Siatka WM stacjonarna 07:00-20:00 co godzine: blok 2 = 08:00-09:00, blok 3 = 09:00-10:00.
const grid = {
  id: 'grid1',
  facultyId: 'wm',
  studyMode: 'FULL_TIME',
  base: true,
  days: [{ day: 'MONDAY', from: null, to: null }],
  blocks: Array.from({ length: 13 }, (_, i) => ({
    id: `b${i + 1}`,
    order: i + 1,
    startTime: `${String(7 + i).padStart(2, '0')}:00`,
    endTime: `${String(8 + i).padStart(2, '0')}:00`,
    label: '',
  })),
};

// Zajecia 4 h po 2 h w poniedzialki, sala r1, prowadzacy i1 -> terminy 05.10 i 12.10.
const section = {
  id: 's1',
  cohortId: 'c1',
  facultyId: 'wm',
  groupId: 'g1',
  classType: 'LECTURE',
  hours: 4,
  programEntry: { subject: { name: 'Fizyka' } },
  placements: [
    {
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
      exceptions: [],
    },
  ],
};

function setup(status: 'PLANNING' | 'PUBLISHED', versionStatus: 'APPROVED' | 'DRAFT' = 'APPROVED') {
  prismaMock.cohort.findMany.mockResolvedValue([cohort(versionStatus)]);
  prismaMock.termCalendar.findMany.mockResolvedValue([calendar(status)]);
  prismaMock.timeGrid.findMany.mockResolvedValue([grid]);
  // Pierwsze zapytanie: zajecia generowanego rocznika; drugie: zajetosc innych rocznikow.
  prismaMock.classSection.findMany.mockResolvedValueOnce([section]).mockResolvedValue([]);
  prismaMock.occurrence.findMany.mockResolvedValue([]);
  prismaMock.externalBusy.findMany.mockResolvedValue([]);
  prismaMock.studentGroup.findMany.mockResolvedValue([group]);
}

beforeEach(() => vi.clearAllMocks());

describe('refreshPlanningTerms — terminy kalendarza w przygotowaniu', () => {
  it('kalendarz w przygotowaniu: terminy przeliczone i zapisane', async () => {
    setup('PLANNING');
    const result = await refreshPlanningTerms(term, ['c1', 'c1']);
    expect(result.cohortIds).toEqual(['c1']);
    expect(result.report?.total).toBe(2);
    expect(result.report?.added).toBe(2);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.cohortGeneration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cohortId_termId: { cohortId: 'c1', termId: term.id } } }),
    );
  });

  it('zajetosc innych rocznikow tylko w salach i u prowadzacych z planu rocznika', async () => {
    setup('PLANNING');
    await refreshPlanningTerms(term, ['c1']);
    const occupancy = prismaMock.classSection.findMany.mock.calls[1]![0] as { where: Record<string, unknown> };
    expect(occupancy.where.placements).toEqual({
      some: {
        OR: [
          { roomId: { in: ['r1'] } },
          { exceptions: { some: { newRoomId: { in: ['r1'] } } } },
          { instructorId: { in: ['i1'] } },
          { exceptions: { some: { newInstructorId: { in: ['i1'] } } } },
        ],
      },
    });
  });

  it('kalendarz opublikowany: bez przeliczania (zmienia tylko "Generuj terminy")', async () => {
    setup('PUBLISHED');
    const result = await refreshPlanningTerms(term, ['c1']);
    expect(result).toEqual({ cohortIds: [], report: null });
    expect(prismaMock.classSection.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('wersja programu w projekcie: bez przeliczania', async () => {
    setup('PLANNING', 'DRAFT');
    const result = await refreshPlanningTerms(term, ['c1']);
    expect(result.cohortIds).toEqual([]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('pusta lista rocznikow — nic nie czyta', async () => {
    const result = await refreshPlanningTerms(term, []);
    expect(result.cohortIds).toEqual([]);
    expect(prismaMock.cohort.findMany).not.toHaveBeenCalled();
  });
});

describe('termsNote — dopisek do komunikatu zapisu planu', () => {
  it('przeliczone, z kolizjami albo czekajace na "Generuj terminy"', () => {
    expect(termsNote({ cohortIds: [], report: null })).toBe('terminy zmienia sie po "Generuj terminy"');
    const report = { added: 0, removed: 0, changed: 0, unchanged: 0, total: 0, conflicts: [], beyondHours: 0, shortfalls: [], orphanExceptions: [], calendarsMissing: [], draftVersions: [] };
    expect(termsNote({ cohortIds: ['c1'], report })).toBe('terminy przeliczone');
    const conflict = { date: '2026-10-05', section: 'Fizyka', reason: 'Sala zajeta', with: 'Chemia' };
    expect(termsNote({ cohortIds: ['c1'], report: { ...report, conflicts: [conflict, conflict] } })).toBe(
      'terminy przeliczone (pominiete przez kolizje: 2)',
    );
  });
});
