import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcademicTerm, ClassSection } from '@prisma/client';

// Termin reczny jako odrobienie: wskazany klucz musi byc odwolanym terminem tych samych
// zajec i nie miec jeszcze odrobienia (te same reguly co przy zgloszeniu prowadzacego).
const prismaMock = vi.hoisted(() => ({
  occurrence: { findUnique: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
}));
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));

import { createManualOccurrence } from './occurrenceChanges';
import type { GridTime } from '../lib/timeGrid';

const term = { id: 't1' } as AcademicTerm;
const section = { id: 's1', cohortId: 'c1', facultyId: 'wm', groupId: 'g1' } as ClassSection;
const grid = {} as GridTime;
const input = (makeupOfKey: string) => ({ date: '2027-03-11', startOrder: 1, endOrder: 2, online: true, makeupOfKey });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.occurrence.count.mockResolvedValue(0);
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
    prismaMock.occurrence.findFirst.mockResolvedValue({ sectionId: 's1', status: 'CANCELLED', instructorId: 'i1' });
    prismaMock.occurrence.count.mockResolvedValue(1);
    await expect(createManualOccurrence(term, section, grid, input('p:pl1|2027-03-08'))).rejects.toMatchObject({
      status: 409,
      message: 'Te zajecia maja juz termin odrobienia',
    });
  });
});
