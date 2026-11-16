import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Obsada wielu zajec naraz, godziny jednej osoby (Obciazenia) i obciazenia — Prisma mockowana.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn().mockResolvedValue({ facultyId: 'wm' }) },
  academicTerm: { findUnique: vi.fn().mockResolvedValue({ id: 't1', startYear: 2026, type: 'WINTER' }) },
  instructor: {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn((args: { where: { id: { in: string[] } } }) => Promise.resolve(args.where.id.in.length)),
  },
  cohort: { findMany: vi.fn().mockResolvedValue([]) },
  termCalendar: { findMany: vi.fn().mockResolvedValue([]) },
  classSection: { findMany: vi.fn().mockResolvedValue([]) },
  sectionInstructor: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn().mockResolvedValue([]),
}));
vi.mock('./lib/prisma', () => ({ prisma: prismaMock }));
// Blokada zapisow planu (services/planLock) — testowana osobno; tu przepuszczamy.
vi.mock('./middleware/planLocked', async (orig) => ({
  ...(await orig<typeof import('./middleware/planLocked')>()),
  planLocked: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { createApp } from './index';
import { signAccessToken } from './lib/jwt';

// Rocznik niestacjonarny z naboru 2026 zimowego (w 2026 zimowym: semestr 1) z jedna grupa cwiczeniowa.
const cohortRow = {
  id: 'c1',
  name: null,
  programId: 'p1',
  programVersionId: 'v1',
  lectureMode: 'JOINT',
  program: { code: 'MiBM-N1', studyMode: 'PART_TIME', fieldOfStudy: { facultyId: 'wm', shortName: 'MiBM', specializations: [] } },
  programVersion: { id: 'v1', label: 'Wersja 1', status: 'APPROVED', totalSemesters: 7 },
  startTerm: { id: 't1', startYear: 2026, type: 'WINTER' },
  terms: [],
  groups: [],
};
const calendarRow = (status: string) => ({ id: 'cal1', termId: 't1', facultyId: 'wm', studyMode: 'PART_TIME', name: 'Podstawowy', status });
const section = (id: string, rows: { instructorId: string | null; hours: number }[] = [], over: object = {}) => ({
  id,
  termId: 't1',
  facultyId: 'wm',
  cohortId: 'c1',
  groupId: `g-${id}`,
  classType: 'EXERCISE',
  hours: 30,
  programEntry: { subject: { name: 'Matematyka' } },
  instructors: rows,
  ...over,
});

const app = createApp();
let dean: string;

beforeAll(() => {
  dean = signAccessToken({ sub: 'u-dean', role: 'DEAN_OFFICE' });
});

beforeEach(() => {
  prismaMock.$transaction.mockClear();
  prismaMock.sectionInstructor.createMany.mockClear();
});

const replace = (changes: unknown) =>
  request(app).put('/api/terms/2026-Z/staff').set('Authorization', `Bearer ${dean}`).send({ changes });
const person = (instructorId: string, items: unknown) =>
  request(app).put(`/api/terms/2026-Z/instructors/${instructorId}/staff`).set('Authorization', `Bearer ${dean}`).send({ items });

describe('API — obsada wielu zajec naraz', () => {
  it('wszystkie grupy zapisane w jednej transakcji', async () => {
    prismaMock.classSection.findMany.mockResolvedValueOnce([section('s1'), section('s2')]);
    const res = await replace([
      { sectionId: 's1', assignments: [{ instructorId: 'i1', hours: 30 }] },
      { sectionId: 's2', assignments: [{ instructorId: 'i2', hours: 30 }] },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Obsada zapisana: 2 zajecia');
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.sectionInstructor.createMany).toHaveBeenCalledWith({ data: [{ sectionId: 's2', instructorId: 'i2', hours: 30 }] });
  });

  it('blad w jednych zajeciach odrzuca calosc, komunikat wskazuje zajecia', async () => {
    prismaMock.classSection.findMany.mockResolvedValueOnce([section('s1'), section('s2')]);
    const res = await replace([
      { sectionId: 's1', assignments: [{ instructorId: 'i1', hours: 30 }] },
      { sectionId: 's2', assignments: [{ instructorId: 'i1', hours: 20 }, { instructorId: 'i2', hours: 15 }] },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Matematyka · cwiczenia: Suma godzin obsady (35) przekracza godziny zajec (30)');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('zajecia innego wydzialu -> 403', async () => {
    prismaMock.classSection.findMany.mockResolvedValueOnce([section('s1', [], { facultyId: 'inny' })]);
    const res = await replace([{ sectionId: 's1', assignments: [] }]);
    expect(res.status).toBe(403);
  });

  it('zajecia znikniete z semestru (np. po synchronizacji) -> 404 z prosba o odswiezenie', async () => {
    prismaMock.classSection.findMany.mockResolvedValueOnce([section('s1')]);
    const res = await replace([
      { sectionId: 's1', assignments: [] },
      { sectionId: 's-brak', assignments: [] },
    ]);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/odswiez/);
  });

  it('kalendarz rocznika w archiwum -> 409, obsada bez zmian', async () => {
    prismaMock.classSection.findMany.mockResolvedValueOnce([section('s1')]);
    prismaMock.cohort.findMany.mockResolvedValueOnce([cohortRow]);
    prismaMock.termCalendar.findMany.mockResolvedValueOnce([calendarRow('ARCHIVED')]);
    const res = await replace([{ sectionId: 's1', assignments: [{ instructorId: 'i1', hours: 30 }] }]);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/w archiwum — obsada tylko do odczytu/);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('API — godziny jednej osoby (Obciazenia)', () => {
  beforeEach(() => {
    prismaMock.instructor.findUnique.mockResolvedValue({ id: 'i1' });
  });

  it('osoba zajmuje miejsce NN, obsada innych zostaje', async () => {
    prismaMock.classSection.findMany.mockResolvedValueOnce([
      section('s1', [{ instructorId: null, hours: 30 }]),
      section('s2', [{ instructorId: 'i2', hours: 15 }]),
    ]);
    const res = await person('i1', [
      { sectionId: 's1', hours: 30 },
      { sectionId: 's2', hours: 15 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Obciazenie zapisane: 2 grupy, 45 h');
    expect(prismaMock.sectionInstructor.createMany).toHaveBeenNthCalledWith(1, { data: [{ sectionId: 's1', instructorId: 'i1', hours: 30 }] });
    expect(prismaMock.sectionInstructor.createMany).toHaveBeenNthCalledWith(2, {
      data: [
        { sectionId: 's2', instructorId: 'i2', hours: 15 },
        { sectionId: 's2', instructorId: 'i1', hours: 15 },
      ],
    });
  });

  it('zajecia prowadzi juz ktos inny -> 400 z liczba wolnych godzin', async () => {
    prismaMock.classSection.findMany.mockResolvedValueOnce([section('s1', [{ instructorId: 'i2', hours: 20 }])]);
    const res = await person('i1', [{ sectionId: 's1', hours: 15 }]);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Matematyka · cwiczenia: wolnych godzin 10 z 30 — reszte prowadza inni');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('0 h zdejmuje osobe z zajec', async () => {
    prismaMock.classSection.findMany.mockResolvedValueOnce([section('s1', [{ instructorId: 'i1', hours: 15 }, { instructorId: 'i2', hours: 15 }])]);
    const res = await person('i1', [{ sectionId: 's1', hours: 0 }]);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Prowadzacy nie prowadzi juz tych zajec');
    expect(prismaMock.sectionInstructor.createMany).toHaveBeenCalledWith({ data: [{ sectionId: 's1', instructorId: 'i2', hours: 15 }] });
  });

  it('nieistniejacy prowadzacy -> 404; ujemne godziny -> 400', async () => {
    prismaMock.instructor.findUnique.mockResolvedValueOnce(null);
    expect((await person('i-brak', [{ sectionId: 's1', hours: 15 }])).status).toBe(404);
    expect((await person('i1', [{ sectionId: 's1', hours: -5 }])).status).toBe(400);
  });
});

describe('API — obciazenia prowadzacych', () => {
  it('osoba z katedra, godziny niestacjonarne i pozycja przedmiotu z grupami', async () => {
    prismaMock.cohort.findMany.mockResolvedValueOnce([cohortRow]);
    prismaMock.sectionInstructor.findMany.mockResolvedValueOnce(
      ['s1', 's2'].map((id) => ({
        instructorId: 'i1',
        hours: 15,
        section: {
          id,
          hours: 15,
          facultyId: 'wm',
          cohortId: 'c1',
          programEntryId: 'pe1',
          classType: 'EXERCISE',
          groupId: `g-${id}`,
          programEntry: { orderInSemester: 1, subject: { id: 'sub1', name: 'Elektrotechnika i elektronika I' } },
        },
      })),
    );
    prismaMock.instructor.findMany.mockResolvedValueOnce([
      {
        id: 'i1',
        title: 'dr inz.',
        firstName: 'Krzysztof',
        lastName: 'Lis',
        department: { id: 'd-keo', name: 'Katedra Elektroenergetyki Okretowej', shortName: 'KEO', faculty: { shortName: 'WE' } },
      },
    ]);
    const res = await request(app).get('/api/terms/2026-Z/workload').set('Authorization', `Bearer ${dean}`);
    expect(res.status).toBe(200);
    const [row] = res.body.data;
    expect(row).toMatchObject({
      id: 'i1',
      name: 'dr inz. Krzysztof Lis',
      department: { id: 'd-keo', label: 'KEO-WE' },
      here: 30,
      partTime: 30,
      fullTime: 0,
      total: 30,
    });
    expect(row.items).toHaveLength(1);
    expect(row.items[0]).toMatchObject({ subject: { name: 'Elektrotechnika i elektronika I' }, classType: 'EXERCISE', hours: 30 });
    expect(row.items[0].groups).toHaveLength(2);
  });
});
