import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Testy HTTP obsady — Prisma mockowana: uprawnienia wydzialu i walidacja godzin.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn().mockResolvedValue({ facultyId: 'wm' }) },
  classSection: { findUnique: vi.fn() },
  sectionInstructor: { deleteMany: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn().mockResolvedValue([]),
}));
vi.mock('./lib/prisma', () => ({ prisma: prismaMock }));

import { createApp } from './index';
import { signAccessToken } from './lib/jwt';

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
});
