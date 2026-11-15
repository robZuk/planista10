import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcademicTerm, ClassSection } from '@prisma/client';

// Przywrocenie przeniesionego terminu (wraca na miejsce z wzorca, bez powodu przeniesienia) i termin
// reczny (zajecia dodatkowe). Odwolan i odrobien nie ma.
const prismaMock = vi.hoisted(() => ({
  occurrence: { update: vi.fn(), create: vi.fn() },
  academicTerm: { findUniqueOrThrow: vi.fn() },
  studentGroup: { findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
  placementException: { deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));
// Zajetosc uczelni (kolizje) — w testach pusta; rocznik, jego kalendarz i siatka — z mockow.
vi.mock('./plan', async (importOriginal) => ({ ...(await importOriginal<typeof import('./plan')>()), termOccupancy: vi.fn(), calendarFor: vi.fn() }));
vi.mock('./sections', async (importOriginal) => ({ ...(await importOriginal<typeof import('./sections')>()), activeCohorts: vi.fn() }));
vi.mock('./timeGrids', async (importOriginal) => ({ ...(await importOriginal<typeof import('./timeGrids')>()), gridFor: vi.fn() }));
vi.mock('./termCalendars', async (importOriginal) => ({ ...(await importOriginal<typeof import('./termCalendars')>()), toCalendarInput: vi.fn() }));
// Kazdy dzien kalendarza rocznika jest dniem zajec (ocena miejsca terminu bez ostrzezen).
vi.mock('../lib/teachingCalendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/teachingCalendar')>()),
  TeachingCalendar: class {
    dayInfo() {
      return { teaching: true, reason: null, label: null };
    }
  },
}));

import { createManualOccurrence, restoreOccurrence, type OccurrenceFull } from './occurrenceChanges';
import type { GridTime } from '../lib/timeGrid';
import { gridFor, type FacultyGrids } from './timeGrids';
import { activeCohorts } from './sections';
import { calendarFor, termOccupancy } from './plan';

// Siatki wydzialu i trybu: kazdy dzien ten sam blok 10:15-12:00 (siatka dnia bez znaczenia w tych testach).
const time = { range: () => ({ startMinute: 615, endMinute: 720 }) } as unknown as GridTime;
const grid = { forDay: () => ({ time }), days: [] } as unknown as FacultyGrids;

beforeEach(() => {
  vi.resetAllMocks();
});

describe('restoreOccurrence', () => {
  // Przeniesiony z poniedzialku 8.03 na wtorek 9.03.
  const moved = {
    id: 'occ1',
    kind: 'DERIVED',
    placementId: 'pl1',
    date: new Date('2027-03-09T00:00:00Z'),
    originalDate: new Date('2027-03-08T00:00:00Z'),
    placement: { id: 'pl1', startOrder: 4, endOrder: 5 },
  } as unknown as OccurrenceFull;

  it('wraca na miejsce z wzorca bez powodu przeniesienia', async () => {
    prismaMock.academicTerm.findUniqueOrThrow.mockResolvedValue({ id: 't1' });
    prismaMock.studentGroup.findUniqueOrThrow.mockResolvedValue({ cohortId: 'c1' });
    prismaMock.studentGroup.findMany.mockResolvedValue([]);
    vi.mocked(termOccupancy).mockResolvedValue([]);
    await restoreOccurrence({ ...moved, groupId: 'g1', note: 'Choroba prowadzacego' } as OccurrenceFull, grid);
    expect(prismaMock.occurrence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ date: new Date('2027-03-08T00:00:00Z'), note: null, startMinute: 615, endMinute: 720 }),
      }),
    );
  });
});

describe('createManualOccurrence', () => {
  it('termin reczny to zajecia dodatkowe: MANUAL, bez powiazan z innymi terminami', async () => {
    vi.mocked(activeCohorts).mockResolvedValue([{ cohort: { program: { fieldOfStudy: { facultyId: 'wm' }, studyMode: 'PART_TIME' } } }] as never);
    vi.mocked(calendarFor).mockResolvedValue({} as never);
    vi.mocked(gridFor).mockResolvedValue({ ...grid, days: [{ day: 'THURSDAY', from: null, to: null }] } as never);
    prismaMock.studentGroup.findUniqueOrThrow.mockResolvedValue({ cohortId: 'c1' });
    prismaMock.studentGroup.findMany.mockResolvedValue([]);
    vi.mocked(termOccupancy).mockResolvedValue([]);
    prismaMock.occurrence.create.mockResolvedValue({ id: 'm1' });
    const term = { id: 't1' } as AcademicTerm;
    const section = { id: 's1', cohortId: 'c1', facultyId: 'wm', groupId: 'g1' } as ClassSection;
    // 2027-03-11 to czwartek — dzien zajec w siatce.
    await createManualOccurrence(term, section, grid, { date: '2027-03-11', startOrder: 1, endOrder: 2, online: true, instructorId: null, note: 'Zajecia dodatkowe' });
    expect(prismaMock.occurrence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'MANUAL', roomId: null, startMinute: 615, endMinute: 720, note: 'Zajecia dodatkowe' }),
    });
  });
});
