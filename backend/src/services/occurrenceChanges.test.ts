import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcademicTerm, ClassSection } from '@prisma/client';

// Termin reczny jako odrobienie: wskazany termin musi byc odwolanym terminem tych samych
// zajec i nie miec jeszcze odrobienia (te same reguly co na liscie "Do odrobienia").
const prismaMock = vi.hoisted(() => ({
  occurrence: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  academicTerm: { findUniqueOrThrow: vi.fn() },
  studentGroup: { findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
  placementException: { deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));
// Zajetosc uczelni (kolizje) — w testach przywracania pusta.
vi.mock('./plan', async (importOriginal) => ({ ...(await importOriginal<typeof import('./plan')>()), termOccupancy: vi.fn() }));

import { createManualOccurrence, restoreOccurrence, type OccurrenceFull } from './occurrenceChanges';
import type { GridTime } from '../lib/timeGrid';
import { termOccupancy } from './plan';

const term = { id: 't1' } as AcademicTerm;
const section = { id: 's1', cohortId: 'c1', facultyId: 'wm', groupId: 'g1' } as ClassSection;
const grid = { range: () => ({ startMinute: 615, endMinute: 720 }) } as unknown as GridTime;
const input = (makeupOfId: string) => ({ date: '2027-03-11', startOrder: 1, endOrder: 2, online: true, makeupOfId });

beforeEach(() => {
  vi.resetAllMocks();
});

describe('createManualOccurrence — odrobienie', () => {
  it('odrzuca termin innych zajec', async () => {
    prismaMock.occurrence.findUnique.mockResolvedValue({ id: 'occ1', sectionId: 's2', status: 'CANCELLED' });
    await expect(createManualOccurrence(term, section, grid, input('occ1'))).rejects.toMatchObject({
      status: 400,
      message: 'Odrabiany termin nie jest odwolanym terminem tych zajec',
    });
  });

  it('odrzuca termin, ktory nie jest odwolany', async () => {
    prismaMock.occurrence.findUnique.mockResolvedValue({ id: 'occ1', sectionId: 's1', status: 'SCHEDULED' });
    await expect(createManualOccurrence(term, section, grid, input('occ1'))).rejects.toMatchObject({ status: 400 });
  });

  it('odrzuca nieistniejacy termin', async () => {
    prismaMock.occurrence.findUnique.mockResolvedValue(null);
    await expect(createManualOccurrence(term, section, grid, input('nie-ma'))).rejects.toMatchObject({ status: 400 });
  });

  it('odrzuca drugie odrobienie tych samych zajec (szuka po kluczu obcym)', async () => {
    prismaMock.occurrence.findUnique.mockResolvedValue({ id: 'occ1', sectionId: 's1', status: 'CANCELLED', instructorId: 'i1' });
    prismaMock.occurrence.findFirst.mockResolvedValue({ date: new Date('2027-03-11T00:00:00Z'), startMinute: 975, endMinute: 1080 });
    await expect(createManualOccurrence(term, section, grid, input('occ1'))).rejects.toMatchObject({
      status: 409,
      message: 'Te zajecia maja juz termin odrobienia',
    });
    expect(prismaMock.occurrence.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { makeupOfId: 'occ1', status: { not: 'CANCELLED' } } }));
  });
});

describe('restoreOccurrence', () => {
  const cancelled = {
    id: 'occ1',
    kind: 'DERIVED',
    status: 'CANCELLED',
    placementId: 'pl1',
    originalDate: new Date('2027-03-08T00:00:00Z'),
    placement: { id: 'pl1', startOrder: 4, endOrder: 5 },
  } as unknown as OccurrenceFull;

  it('nie wraca do planu, gdy zajecia sa juz odrobione (szuka odrobienia po kluczu obcym)', async () => {
    prismaMock.occurrence.findFirst.mockResolvedValue({ date: new Date('2027-03-11T00:00:00Z'), startMinute: 975, endMinute: 1080 });
    await expect(restoreOccurrence(cancelled, grid)).rejects.toMatchObject({
      status: 409,
      message: 'Te zajecia sa juz odrobione (11.03 16:15–18:00) — usun albo odwolaj odrobienie, zanim przywrocisz termin',
    });
    expect(prismaMock.occurrence.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { makeupOfId: 'occ1', status: { not: 'CANCELLED' } } }),
    );
  });

  it('wraca na miejsce z wzorca bez powodu odwolania', async () => {
    prismaMock.occurrence.findFirst.mockResolvedValue(null);
    prismaMock.academicTerm.findUniqueOrThrow.mockResolvedValue({ id: 't1' });
    prismaMock.studentGroup.findUniqueOrThrow.mockResolvedValue({ cohortId: 'c1' });
    prismaMock.studentGroup.findMany.mockResolvedValue([]);
    vi.mocked(termOccupancy).mockResolvedValue([]);
    await restoreOccurrence({ ...cancelled, groupId: 'g1', note: 'Choroba prowadzacego' } as OccurrenceFull, grid);
    expect(prismaMock.occurrence.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SCHEDULED', note: null, startMinute: 615, endMinute: 720 }) }),
    );
  });
});
