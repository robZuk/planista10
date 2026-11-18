import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcademicTerm } from '@prisma/client';

// Samoczynne zmiany (services/autoPlan): ktore semestry dostaja zajecia, kiedy przeliczaja sie
// terminy, kolejnosc przy publikacji. Synchronizacja, generowanie i blokada — zamockowane.
const prismaMock = vi.hoisted(() => ({
  cohort: { findMany: vi.fn() },
  academicTerm: { findMany: vi.fn() },
}));
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));

const calls = vi.hoisted(() => [] as string[]);
const lockMock = vi.hoisted(() => vi.fn((termId: string, fn: () => Promise<unknown>) => (calls.push(`lock:${termId}`), fn())));
vi.mock('./planLock', () => ({ withPlanLock: lockMock }));

const emptyReport = () => ({ created: [], hoursChanged: [], reactivated: [], orphaned: [], deleted: [], unchanged: 0, problems: [], pending: 0 });
const syncMock = vi.hoisted(() => vi.fn());
vi.mock('./sections', () => ({ syncSections: syncMock }));

const refreshMock = vi.hoisted(() => vi.fn());
const cohortsOfCalendarMock = vi.hoisted(() => vi.fn());
vi.mock('./plan', () => ({ refreshPlanningTerms: refreshMock, cohortIdsOfCalendar: cohortsOfCalendarMock }));

import { autoSyncCohorts, autoSyncTermFaculties, changeCalendarStatus, syncNote } from './autoPlan';

const term = (id: string) => ({ id, startYear: 2026, type: 'WINTER' }) as AcademicTerm;
const row = (cohortId: string) => ({ cohortId, cohort: cohortId, subject: 'Fizyka', classType: 'LECTURE', group: 'W', hours: 30 });

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  prismaMock.cohort.findMany.mockResolvedValue([{ program: { fieldOfStudy: { facultyId: 'wm' } } }]);
  prismaMock.academicTerm.findMany.mockResolvedValue([term('t1'), term('t2')]);
  syncMock.mockResolvedValue(emptyReport());
  refreshMock.mockImplementation(async (_term: AcademicTerm, cohortIds: string[]) => {
    calls.push(`refresh:${cohortIds.join(',')}`);
    return { cohortIds, report: null };
  });
  cohortsOfCalendarMock.mockResolvedValue(['c1', 'c2']);
});

describe('autoSyncCohorts — zajecia po zmianie naboru, grup albo programu', () => {
  it('tylko semestry, w ktorych wydzial ma kalendarz poza archiwum; tryb dodajacy pod blokada', async () => {
    syncMock.mockResolvedValueOnce({ ...emptyReport(), created: [row('c1'), row('c1')], pending: 1 });
    const summary = await autoSyncCohorts(['c1', 'c1']);

    expect(prismaMock.academicTerm.findMany).toHaveBeenCalledWith({
      where: { calendars: { some: { facultyId: { in: ['wm'] }, status: { not: 'ARCHIVED' } } } },
    });
    expect(syncMock).toHaveBeenCalledTimes(2);
    expect(syncMock).toHaveBeenCalledWith(term('t1'), { facultyId: null, cohortIds: ['c1'], dryRun: false, mode: 'additive' });
    expect(calls.filter((c) => c.startsWith('lock'))).toEqual(['lock:t1', 'lock:t2']);
    expect(summary).toEqual({ created: 2, reactivated: 0, hoursChanged: 0, pending: 1 });
    // Nowe zajecia nie maja planu — terminow nie ma czego przeliczac.
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('przywrocone zajecia (moga miec umieszczenia) — terminy ich rocznika przeliczone', async () => {
    syncMock.mockResolvedValueOnce({ ...emptyReport(), reactivated: [row('c1')] });
    await autoSyncCohorts(['c1']);
    expect(refreshMock).toHaveBeenCalledWith(term('t1'), ['c1']);
  });

  it('pusta lista rocznikow — nic nie robi', async () => {
    expect(await autoSyncCohorts([])).toEqual({ created: 0, reactivated: 0, hoursChanged: 0, pending: 0 });
    expect(prismaMock.academicTerm.findMany).not.toHaveBeenCalled();
  });
});

describe('autoSyncTermFaculties — nowy kalendarz semestru', () => {
  it('synchronizacja dodajaca kazdego wydzialu w tym semestrze', async () => {
    await autoSyncTermFaculties(term('t1'), ['wm', 'we', 'wm']);
    expect(syncMock.mock.calls.map((c) => c[1])).toEqual([
      { facultyId: 'wm', dryRun: false, mode: 'additive' },
      { facultyId: 'we', dryRun: false, mode: 'additive' },
    ]);
  });
});

describe('changeCalendarStatus — status i terminy w jednym kroku', () => {
  const update = () => {
    calls.push('update');
    return Promise.resolve('zapisany');
  };

  it('publikacja: najpierw terminy (kalendarz jeszcze w przygotowaniu), potem status', async () => {
    const { result, refresh } = await changeCalendarStatus(term('t1'), { id: 'cal1', facultyId: 'wm', studyMode: 'FULL_TIME', status: 'PLANNING' }, 'PUBLISHED', update);
    expect(calls).toEqual(['lock:t1', 'refresh:c1,c2', 'update']);
    expect(result).toBe('zapisany');
    expect(refresh.cohortIds).toEqual(['c1', 'c2']);
  });

  it('cofniecie publikacji: status, potem terminy (od teraz licza sie same)', async () => {
    await changeCalendarStatus(term('t1'), { id: 'cal1', facultyId: 'wm', studyMode: 'FULL_TIME', status: 'PUBLISHED' }, 'PLANNING', update);
    expect(calls).toEqual(['lock:t1', 'update', 'refresh:c1,c2']);
  });

  it('archiwum i powrot z archiwum — terminow nie rusza', async () => {
    await changeCalendarStatus(term('t1'), { id: 'cal1', facultyId: 'wm', studyMode: 'FULL_TIME', status: 'PUBLISHED' }, 'ARCHIVED', update);
    await changeCalendarStatus(term('t1'), { id: 'cal1', facultyId: 'wm', studyMode: 'FULL_TIME', status: 'ARCHIVED' }, 'PLANNING', update);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe('syncNote', () => {
  it('dopisek tylko, gdy cos zastosowano', () => {
    expect(syncNote({ created: 0, reactivated: 0, hoursChanged: 0, pending: 3 })).toBe('');
    expect(syncNote({ created: 29, reactivated: 0, hoursChanged: 0, pending: 0 })).toBe('; zajecia semestru: +29');
    expect(syncNote({ created: 2, reactivated: 1, hoursChanged: 1, pending: 0 })).toBe('; zajecia semestru: +2, poprawione 2');
  });
});
