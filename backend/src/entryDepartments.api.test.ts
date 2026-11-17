import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Katedry form zajec przedmiotow programu (zlecenie wydzialu) — Prisma mockowana.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn().mockResolvedValue({ facultyId: 'wm' }) },
  programEntry: { findMany: vi.fn() },
  department: { count: vi.fn((a: { where: { id: { in: string[] } } }) => Promise.resolve(a.where.id.in.length)), findUnique: vi.fn(), delete: vi.fn() },
  programEntryDepartment: { upsert: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn().mockResolvedValue([]),
}));
vi.mock('./lib/prisma', () => ({ prisma: prismaMock }));

import { createApp } from './index';
import { signAccessToken } from './lib/jwt';

const app = createApp();
let dean: string;
let admin: string;
beforeAll(() => {
  dean = signAccessToken({ sub: 'u-dean', role: 'DEAN_OFFICE' });
  admin = signAccessToken({ sub: 'u-admin', role: 'ADMIN' });
});
beforeEach(() => {
  vi.clearAllMocks();
});

const entry = (id: string, facultyId = 'wm', hours: Partial<Record<string, number>> = { hoursLecture: 15, hoursLab: 15 }) => ({
  id,
  hoursLecture: 0,
  hoursExercise: 0,
  hoursLab: 0,
  hoursProject: 0,
  hoursSeminar: 0,
  ...hours,
  subject: { name: 'Metrologia' },
  version: { program: { fieldOfStudy: { facultyId } } },
});
const put = (token: string, items: unknown) =>
  request(app).put('/api/program-entries/departments').set('Authorization', `Bearer ${token}`).send({ items });

describe('API — katedry form zajec przedmiotow', () => {
  it('"KMOiTR/KEO": wyklad jednej katedry, laboratorium drugiej; null zdejmuje katedre', async () => {
    prismaMock.programEntry.findMany.mockResolvedValueOnce([entry('pe1')]);
    const res = await put(dean, [
      { programEntryId: 'pe1', classType: 'LECTURE', departmentId: 'd-keo' },
      { programEntryId: 'pe1', classType: 'LAB', departmentId: null },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Katedry zapisane: 1, bez katedry: 1');
    expect(prismaMock.programEntryDepartment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { programEntryId: 'pe1', classType: 'LECTURE', departmentId: 'd-keo' } }),
    );
    expect(prismaMock.programEntryDepartment.deleteMany).toHaveBeenCalledWith({ where: { programEntryId: 'pe1', classType: 'LAB' } });
  });

  it('samo zdjecie katedry — czytelny komunikat', async () => {
    prismaMock.programEntry.findMany.mockResolvedValueOnce([entry('pe1')]);
    const res = await put(dean, [{ programEntryId: 'pe1', classType: 'LAB', departmentId: null }]);
    expect(res.body.message).toBe('Bez katedry: 1 pozycja');
  });

  it('forma bez godzin w programie -> 400 z nazwa przedmiotu', async () => {
    prismaMock.programEntry.findMany.mockResolvedValueOnce([entry('pe1')]);
    const res = await put(dean, [{ programEntryId: 'pe1', classType: 'EXERCISE', departmentId: 'd-keo' }]);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Metrologia: forma cwiczenia nie ma godzin w programie');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('program innego wydzialu -> 403 dla dziekanatu', async () => {
    prismaMock.programEntry.findMany.mockResolvedValueOnce([entry('pe1', 'we')]);
    expect((await put(dean, [{ programEntryId: 'pe1', classType: 'LECTURE', departmentId: 'd-keo' }])).status).toBe(403);
  });

  it('pozycja znikla albo katedra usunieta -> 404/409', async () => {
    prismaMock.programEntry.findMany.mockResolvedValueOnce([]);
    expect((await put(dean, [{ programEntryId: 'brak', classType: 'LECTURE', departmentId: 'd' }])).status).toBe(404);
    prismaMock.programEntry.findMany.mockResolvedValueOnce([entry('pe1')]);
    prismaMock.department.count.mockResolvedValueOnce(0);
    expect((await put(dean, [{ programEntryId: 'pe1', classType: 'LECTURE', departmentId: 'd-usunieta' }])).status).toBe(409);
  });

  it('katedry przypisanej do przedmiotow nie da sie usunac', async () => {
    prismaMock.department.findUnique.mockResolvedValueOnce({
      id: 'd-keo',
      name: 'Katedra Elektroenergetyki Okretowej',
      shortName: 'KEO',
      facultyId: 'we',
      faculty: { id: 'we', name: 'WE', shortName: 'WE' },
      _count: { instructors: 0, programEntries: 12 },
    });
    const res = await request(app).delete('/api/departments/d-keo').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('12 form zajec');
    expect(prismaMock.department.delete).not.toHaveBeenCalled();
  });
});
