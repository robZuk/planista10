import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Testy HTTP programow studiow — Prisma mockowana: uprawnienia wydzialu, blokada
// zatwierdzonej wersji, walidacja wejscia i kolizja przedmiotu wspolnego ze specjalnosciowym.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn().mockResolvedValue({ facultyId: 'wm' }) },
  programVersion: { findUnique: vi.fn() },
  programEntry: { findMany: vi.fn().mockResolvedValue([]), aggregate: vi.fn(), create: vi.fn() },
  specialization: { findUnique: vi.fn() },
}));
vi.mock('./lib/prisma', () => ({ prisma: prismaMock }));

import { createApp } from './index';
import { signAccessToken } from './lib/jwt';

const app = createApp();
let dean: string;
let instructor: string;

beforeAll(() => {
  dean = signAccessToken({ sub: 'u-dean', role: 'DEAN_OFFICE' });
  instructor = signAccessToken({ sub: 'u-inst', role: 'INSTRUCTOR' });
});

const version = (facultyId: string, status: 'DRAFT' | 'APPROVED') => ({
  id: 'v1',
  status,
  totalSemesters: 7,
  program: { fieldOfStudyId: 'f1', fieldOfStudy: { facultyId } },
});

const entry = { subjectId: 's1', semester: 1, specializationId: null, hoursLecture: 30 };

describe('API — programy studiow', () => {
  it('prowadzacy nie dodaje przedmiotow -> 403', async () => {
    const res = await request(app)
      .post('/api/program-versions/v1/entries')
      .set('Authorization', `Bearer ${instructor}`)
      .send(entry);
    expect(res.status).toBe(403);
  });

  it('dziekanat innego wydzialu -> 403', async () => {
    prismaMock.programVersion.findUnique.mockResolvedValueOnce(version('inny', 'DRAFT'));
    const res = await request(app)
      .post('/api/program-versions/v1/entries')
      .set('Authorization', `Bearer ${dean}`)
      .send(entry);
    expect(res.status).toBe(403);
  });

  it('zatwierdzona wersja jest zablokowana -> 409', async () => {
    prismaMock.programVersion.findUnique.mockResolvedValueOnce(version('wm', 'APPROVED'));
    const res = await request(app)
      .post('/api/program-versions/v1/entries')
      .set('Authorization', `Bearer ${dean}`)
      .send(entry);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/zatwierdzona/);
  });

  it('semestr poza zakresem wersji -> 400', async () => {
    prismaMock.programVersion.findUnique.mockResolvedValueOnce(version('wm', 'DRAFT'));
    const res = await request(app)
      .post('/api/program-versions/v1/entries')
      .set('Authorization', `Bearer ${dean}`)
      .send({ ...entry, semester: 9 });
    expect(res.status).toBe(400);
  });

  it('przedmiot specjalnosciowy, gdy w semestrze jest juz wspolny -> 409', async () => {
    prismaMock.programVersion.findUnique.mockResolvedValueOnce(version('wm', 'DRAFT'));
    prismaMock.specialization.findUnique.mockResolvedValueOnce({ id: 'dut', fieldOfStudyId: 'f1' });
    prismaMock.programEntry.findMany.mockResolvedValueOnce([{ specializationId: null }]);
    const res = await request(app)
      .post('/api/program-versions/v1/entries')
      .set('Authorization', `Bearer ${dean}`)
      .send({ ...entry, specializationId: 'dut' });
    expect(res.status).toBe(409);
  });

  it('ujemne godziny odrzuca walidacja -> 400', async () => {
    const res = await request(app)
      .post('/api/program-versions/v1/entries')
      .set('Authorization', `Bearer ${dean}`)
      .send({ ...entry, hoursLab: -5 });
    expect(res.status).toBe(400);
  });
});
