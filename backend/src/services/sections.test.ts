import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcademicTerm } from '@prisma/client';

// Synchronizacja zajec — Prisma mockowana. Sprawdzamy, ktore zbedne zajecia sa usuwane,
// a ktore tylko oznaczane jako ORPHANED (obsada, umieszczenia, terminy).
const prismaMock = vi.hoisted(() => ({
  cohort: { findMany: vi.fn() },
  termCalendar: { findMany: vi.fn() },
  programEntry: { findMany: vi.fn() },
  classSection: {
    findMany: vi.fn(),
    create: vi.fn((args: unknown) => ({ op: 'create', args })),
    update: vi.fn((args: unknown) => ({ op: 'update', args })),
    delete: vi.fn((args: unknown) => ({ op: 'delete', args })),
  },
  $transaction: vi.fn().mockResolvedValue([]),
}));
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));

import { syncSections } from './sections';

const term = { id: 't-2026Z', startYear: 2026, type: 'WINTER' } as AcademicTerm;

// Rocznik z naboru 2024 zimowego -> w 2026 zimowym jest na semestrze 5.
const cohort = {
  id: 'c1',
  name: null,
  programVersionId: 'v1',
  lectureMode: 'JOINT',
  program: {
    code: 'EDST-N1',
    studyMode: 'PART_TIME',
    fieldOfStudy: { facultyId: 'wm', shortName: 'EDST', specializations: [] },
  },
  programVersion: { id: 'v1', totalSemesters: 7 },
  startTerm: { id: 't-2024Z', startYear: 2024, type: 'WINTER' },
  terms: [],
  groups: [
    {
      id: 'g-root',
      cohortId: 'c1',
      parentGroupId: null,
      partitionKey: 'ROOT',
      code: null,
      specializationId: null,
      fromSemester: 1,
      toSemester: null,
    },
  ],
};

/** Zajecia, ktorych juz nie ma w programie (program na semestr 5 jest pusty). */
function stale(id: string, counts: { instructors?: number; placements?: number; occurrences?: number }, status = 'ACTIVE') {
  return {
    id,
    status,
    programEntryId: `e-${id}`,
    classType: 'LECTURE',
    groupId: 'g-root',
    hours: 30,
    programEntry: { subject: { name: `Przedmiot ${id}` } },
    _count: { instructors: 0, placements: 0, occurrences: 0, changeRequests: 0, ...counts },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.cohort.findMany.mockResolvedValue([cohort]);
  prismaMock.programEntry.findMany.mockResolvedValue([]);
  prismaMock.termCalendar.findMany.mockResolvedValue([calendar('PUBLISHED')]);
});

/** Kalendarz wydzialu i trybu rocznika (domyslny "Podstawowy"). */
function calendar(status: 'PLANNING' | 'PUBLISHED' | 'ARCHIVED') {
  return { id: 'cal1', termId: term.id, facultyId: 'wm', studyMode: 'PART_TIME', name: 'Podstawowy', status };
}

describe('syncSections — zbedne zajecia', () => {
  it('usuwa tylko zajecia bez obsady, umieszczen i terminow; reszte oznacza jako osierocone', async () => {
    prismaMock.classSection.findMany.mockResolvedValue([
      stale('wolne', {}),
      stale('z-obsada', { instructors: 1 }),
      stale('w-planie', { placements: 2 }), // NN, ale juz umieszczone w planie
      stale('z-terminem', { occurrences: 1 }), // np. termin reczny
    ]);

    const report = await syncSections(term, { facultyId: null, dryRun: false });

    expect(report.deleted.map((r) => r.subject)).toEqual(['Przedmiot wolne']);
    expect(report.orphaned.map((r) => r.subject)).toEqual([
      'Przedmiot z-obsada',
      'Przedmiot w-planie',
      'Przedmiot z-terminem',
    ]);
    expect(prismaMock.classSection.delete).toHaveBeenCalledTimes(1);
    expect(prismaMock.classSection.delete).toHaveBeenCalledWith({ where: { id: 'wolne' } });
    for (const id of ['z-obsada', 'w-planie', 'z-terminem']) {
      expect(prismaMock.classSection.update).toHaveBeenCalledWith({ where: { id }, data: { status: 'ORPHANED' } });
    }
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('pyta baze o liczbe umieszczen i terminow (bez tego nie da sie ich chronic)', async () => {
    prismaMock.classSection.findMany.mockResolvedValue([]);
    await syncSections(term, { facultyId: null, dryRun: true });
    const args = prismaMock.classSection.findMany.mock.calls[0]![0];
    expect(args.include._count.select).toEqual({ instructors: true, placements: true, occurrences: true, changeRequests: true });
  });

  it('juz osierocone zajecia w planie nie sa ponownie raportowane ani usuwane', async () => {
    prismaMock.classSection.findMany.mockResolvedValue([stale('w-planie', { placements: 1 }, 'ORPHANED')]);
    const report = await syncSections(term, { facultyId: null, dryRun: false });
    expect(report.orphaned).toEqual([]);
    expect(report.deleted).toEqual([]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('podglad (dryRun) niczego nie zapisuje', async () => {
    prismaMock.classSection.findMany.mockResolvedValue([stale('wolne', {}), stale('w-planie', { placements: 1 })]);
    const report = await syncSections(term, { facultyId: null, dryRun: true });
    expect(report.deleted).toHaveLength(1);
    expect(report.orphaned).toHaveLength(1);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('syncSections — problemy do wyjasnienia', () => {
  it('brak grupy specjalnosci: raport podaje specjalnosc, rocznik i semestr', async () => {
    const zeew = { id: 's-zeew', shortName: 'ZEEW', name: 'Zarzadzanie Eksploatacja Elektrowni Wiatrowych' };
    prismaMock.cohort.findMany.mockResolvedValue([
      { ...cohort, program: { ...cohort.program, fieldOfStudy: { ...cohort.program.fieldOfStudy, specializations: [zeew] } } },
    ]);
    prismaMock.programEntry.findMany.mockResolvedValue([
      {
        id: 'e1',
        specializationId: 's-zeew',
        hoursLecture: 15,
        hoursExercise: 0,
        hoursLab: 0,
        hoursProject: 0,
        hoursSeminar: 0,
        subject: { name: 'Ubezpieczenia morskie' },
      },
    ]);
    prismaMock.classSection.findMany.mockResolvedValue([]);

    const report = await syncSections(term, { facultyId: null, dryRun: true });

    expect(report.created).toEqual([]);
    expect(report.problems).toEqual([
      {
        cohort: 'EDST-N1 · nabor 2024/25 zimowy',
        cohortId: 'c1',
        semester: 5,
        subject: 'Ubezpieczenia morskie',
        kind: 'MISSING_SPECIALIZATION_GROUP',
        specialization: zeew,
        programVersion: null,
        message: expect.stringContaining('specjalnosci ZEEW'),
      },
    ]);
  });
});

describe('syncSections — wersja programu w projekcie', () => {
  it('rocznik pominiety (zajecia bez zmian) i zgloszony z wersja do zatwierdzenia', async () => {
    prismaMock.cohort.findMany.mockResolvedValue([
      { ...cohort, programVersion: { ...cohort.programVersion, label: 'Wersja 1', status: 'DRAFT' } },
    ]);
    prismaMock.classSection.findMany.mockResolvedValue([stale('wolne', {})]);

    const report = await syncSections(term, { facultyId: null, dryRun: false });

    expect(report.problems).toEqual([
      expect.objectContaining({
        cohortId: 'c1',
        semester: 5,
        kind: 'DRAFT_PROGRAM_VERSION',
        programVersion: { id: 'v1', label: 'Wersja 1' },
        message: expect.stringContaining('jest w projekcie'),
      }),
    ]);
    // Ani program, ani zajecia rocznika nie sa czytane — nic nie powstaje i nic nie znika.
    expect(prismaMock.programEntry.findMany).not.toHaveBeenCalled();
    expect(report.deleted).toEqual([]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('syncSections — kalendarz w archiwum', () => {
  it('rocznik pominiety: zajecia bez zmian, problem ARCHIVED_CALENDAR', async () => {
    prismaMock.termCalendar.findMany.mockResolvedValue([calendar('ARCHIVED')]);
    prismaMock.classSection.findMany.mockResolvedValue([stale('wolne', {})]);

    const report = await syncSections(term, { facultyId: null, dryRun: false });

    expect(report.problems).toEqual([
      expect.objectContaining({ cohortId: 'c1', semester: 5, kind: 'ARCHIVED_CALENDAR', message: expect.stringContaining('w archiwum') }),
    ]);
    expect(prismaMock.programEntry.findMany).not.toHaveBeenCalled();
    expect(report.deleted).toEqual([]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
