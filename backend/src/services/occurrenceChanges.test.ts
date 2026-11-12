import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcademicTerm, ClassSection } from '@prisma/client';

// Termin reczny jako odrobienie: wskazany klucz musi byc odwolanym terminem tych samych
// zajec i nie miec jeszcze odrobienia (te same reguly co przy zgloszeniu prowadzacego).
const prismaMock = vi.hoisted(() => ({
  occurrence: { findUnique: vi.fn(), findFirst: vi.fn() },
}));
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));

import { createManualOccurrence, restoreOccurrence, type OccurrenceFull } from './occurrenceChanges';
import type { GridTime } from '../lib/timeGrid';

const term = { id: 't1' } as AcademicTerm;
const section = { id: 's1', cohortId: 'c1', facultyId: 'wm', groupId: 'g1' } as ClassSection;
const grid = {} as GridTime;
const input = (makeupOfKey: string) => ({ date: '2027-03-11', startOrder: 1, endOrder: 2, online: true, makeupOfKey });

beforeEach(() => {
  vi.resetAllMocks();
});

describe('createManualOccurrence — odrobienie', () => {
  it('odrzuca klucz terminu innych zajec', async () => {
    prismaMock.occurrence.findFirst.mockResolvedValue({ sectionId: 's2', status: 'CANCELLED' });
    await expect(createManualOccurrence(term, section, grid, input('p:pl1|2027-03-08'))).rejects.toMatchObject({
      status: 400,
      message: 'Odrabiany termin nie jest odwolanym terminem tych zajec',
    });
  });

  it('odrzuca termin, ktory nie jest odwolany', async () => {
    prismaMock.occurrence.findUnique.mockResolvedValue({ sectionId: 's1', status: 'SCHEDULED' });
    await expect(createManualOccurrence(term, section, grid, input('o:occ1'))).rejects.toMatchObject({ status: 400 });
  });

  it('odrzuca nieistniejacy albo zly klucz', async () => {
    prismaMock.occurrence.findFirst.mockResolvedValue(null);
    await expect(createManualOccurrence(term, section, grid, input('p:pl1|2027-03-08'))).rejects.toMatchObject({ status: 400 });
    await expect(createManualOccurrence(term, section, grid, input('zly-klucz'))).rejects.toMatchObject({ status: 400 });
  });

  it('odrzuca drugie odrobienie tych samych zajec', async () => {
    prismaMock.occurrence.findFirst
      .mockResolvedValueOnce({ sectionId: 's1', status: 'CANCELLED', instructorId: 'i1' })
      .mockResolvedValueOnce({ date: new Date('2027-03-11T00:00:00Z'), startMinute: 975, endMinute: 1080 });
    await expect(createManualOccurrence(term, section, grid, input('p:pl1|2027-03-08'))).rejects.toMatchObject({
      status: 409,
      message: 'Te zajecia maja juz termin odrobienia',
    });
  });
});

describe('restoreOccurrence — odwolany termin z odrobieniem', () => {
  const cancelled = {
    id: 'occ1',
    kind: 'DERIVED',
    status: 'CANCELLED',
    placementId: 'pl1',
    originalDate: new Date('2027-03-08T00:00:00Z'),
    placement: { id: 'pl1', startOrder: 4, endOrder: 5 },
  } as unknown as OccurrenceFull;

  it('nie wraca do planu, gdy zajecia sa juz odrobione (szuka odrobienia po trwalym kluczu)', async () => {
    prismaMock.occurrence.findFirst.mockResolvedValue({ date: new Date('2027-03-11T00:00:00Z'), startMinute: 975, endMinute: 1080 });
    await expect(restoreOccurrence(cancelled, grid)).rejects.toMatchObject({
      status: 409,
      message: 'Te zajecia sa juz odrobione (11.03 16:15–18:00) — usun albo odwolaj odrobienie, zanim przywrocisz termin',
    });
    expect(prismaMock.occurrence.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { makeupOfKey: 'p:pl1|2027-03-08', status: { not: 'CANCELLED' } } }),
    );
  });
});
