import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Testy HTTP obsady — Prisma mockowana: uprawnienia wydzialu i walidacja godzin.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn().mockResolvedValue({ facultyId: 'wm' }) },
  academicTerm: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 't1', startYear: 2026, type: 'SUMMER' }) },
  cohort: { findMany: vi.fn().mockResolvedValue([]) },
  termCalendar: { findMany: vi.fn().mockResolvedValue([]) },
  classSection: { findUnique: vi.fn() },
  sectionInstructor: { deleteMany: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn().mockResolvedValue([]),
}));
vi.mock('./lib/prisma', () => ({ prisma: prismaMock }));

import { createApp } from './index';
import { signAccessToken } from './lib/jwt';

// Rocznik z naboru 2025 zimowego (w 2026 letnim: semestr 4) i kalendarz jego wydzialu i trybu.
const cohortRow = {
  id: 'c1',
  name: null,
  programId: 'p1',
  programVersionId: 'v1',
  lectureMode: 'JOINT',
  program: { code: 'EDST-S1', studyMode: 'FULL_TIME', fieldOfStudy: { facultyId: 'wm', shortName: 'EDST', specializations: [] } },
  programVersion: { id: 'v1', label: 'Wersja 1', status: 'APPROVED', totalSemesters: 7 },
  startTerm: { id: 't0', startYear: 2025, type: 'WINTER' },
  terms: [],
  groups: [],
};
const calendarRow = (status: string) => ({ id: 'cal1', termId: 't1', facultyId: 'wm', studyMode: 'FULL_TIME', name: 'Podstawowy', status });

const app = createApp();
let dean: string;
let student: string;

beforeAll(() => {
  dean = signAccessToken({ sub: 'u-dean', role: 'DEAN_OFFICE' });
  student = signAccessToken({ sub: 'u-st', role: 'STUDENT' });
});

const put = (token: string, assignments: unknown) =>
  request(app).put('/api/sections/s1/instructors').set('Authorization', `Bearer ${token}`).send({ assignments });

describe('API — obsada zajec', () => {
  it('student nie zmienia obsady -> 403', async () => {
    expect((await put(student, [])).status).toBe(403);
  });

  it('zajecia innego wydzialu -> 403', async () => {
    prismaMock.classSection.findUnique.mockResolvedValueOnce({ id: 's1', facultyId: 'inny', hours: 30 });
    expect((await put(dean, [{ instructorId: 'i1', hours: 30 }])).status).toBe(403);
  });

  it('suma godzin wieksza niz zajecia -> 400', async () => {
    prismaMock.classSection.findUnique.mockResolvedValueOnce({ id: 's1', facultyId: 'wm', hours: 30 });
    const res = await put(dean, [
      { instructorId: 'i1', hours: 20 },
      { instructorId: 'i2', hours: 15 },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/przekracza/);
  });

  it('ten sam prowadzacy dwa razy -> 400', async () => {
    prismaMock.classSection.findUnique.mockResolvedValueOnce({ id: 's1', facultyId: 'wm', hours: 30 });
    const res = await put(dean, [
      { instructorId: 'i1', hours: 10 },
      { instructorId: 'i1', hours: 10 },
    ]);
    expect(res.status).toBe(400);
  });

  it('podzial godzin z NN — zapis i komunikat o brakach', async () => {
    prismaMock.classSection.findUnique.mockResolvedValueOnce({ id: 's1', facultyId: 'wm', hours: 30 });
    const res = await put(dean, [
      { instructorId: 'i1', hours: 15 },
      { instructorId: null, hours: 10 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/brakuje 5 h/);
  });

  it('kalendarz rocznika w archiwum -> 409, obsada bez zmian', async () => {
    prismaMock.classSection.findUnique.mockResolvedValueOnce({ id: 's1', facultyId: 'wm', hours: 30, termId: 't1', cohortId: 'c1' });
    prismaMock.cohort.findMany.mockResolvedValueOnce([cohortRow]);
    prismaMock.termCalendar.findMany.mockResolvedValueOnce([calendarRow('ARCHIVED')]);
    const before = prismaMock.$transaction.mock.calls.length;
    const res = await put(dean, [{ instructorId: 'i1', hours: 30 }]);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/w archiwum — obsada tylko do odczytu/);
    expect(prismaMock.$transaction.mock.calls.length).toBe(before);
  });
});
