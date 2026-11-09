import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Testy HTTP programow studiow — Prisma mockowana: uprawnienia wydzialu, blokada
// zatwierdzonej wersji, walidacja wejscia i kolizja przedmiotu wspolnego ze specjalnosciowym.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn().mockResolvedValue({ facultyId: 'wm' }) },
  programVersion: { findUnique: vi.fn() },
  programEntry: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
  classSection: { count: vi.fn() },
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

describe('API — pozycja programu, z ktorej powstaly zajecia', () => {
  const stored = { id: 'e1', ...entry, hoursExercise: 0, hoursLab: 0, hoursProject: 0, hoursSeminar: 0, version: version('wm', 'DRAFT') };
  const putEntry = (body: unknown) =>
    request(app).put('/api/program-entries/e1').set('Authorization', `Bearer ${dean}`).send(body);

  it('zmiana przedmiotu -> 409 z liczba zajec, bez zapisu', async () => {
    prismaMock.programEntry.findUnique.mockResolvedValueOnce(stored);
    prismaMock.classSection.count.mockResolvedValueOnce(4);
    prismaMock.programEntry.update.mockClear();
    const res = await putEntry({ ...entry, subjectId: 's2' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/zajecia \(4\) — nie zmienia sie: przedmiot/);
    expect(prismaMock.programEntry.update).not.toHaveBeenCalled();
  });

  it('zmiana samych godzin przy zajeciach — zapisana', async () => {
    prismaMock.programEntry.findUnique.mockResolvedValueOnce(stored);
    prismaMock.classSection.count.mockClear();
    const res = await putEntry({ ...entry, hoursLecture: 45 });
    expect(res.status).toBe(200);
    // Bez zmiany tozsamosci nie trzeba nawet liczyc zajec.
    expect(prismaMock.classSection.count).not.toHaveBeenCalled();
  });

  it('zmiana semestru pozycji bez zajec — zapisana', async () => {
    prismaMock.programEntry.findUnique.mockResolvedValueOnce(stored);
    prismaMock.classSection.count.mockResolvedValueOnce(0);
    prismaMock.programEntry.aggregate.mockResolvedValueOnce({ _max: { orderInSemester: 2 } });
    const res = await putEntry({ ...entry, semester: 2 });
    expect(res.status).toBe(200);
  });

  it('usuniecie pozycji z zajeciami -> 409, bez usuwania', async () => {
    prismaMock.programEntry.findUnique.mockResolvedValueOnce(stored);
    prismaMock.classSection.count.mockResolvedValueOnce(2);
    prismaMock.programEntry.delete.mockClear();
    const res = await request(app).delete('/api/program-entries/e1').set('Authorization', `Bearer ${dean}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/nie mozna jej usunac/);
    expect(prismaMock.programEntry.delete).not.toHaveBeenCalled();
  });

  it('usuniecie pozycji bez zajec — usunieta', async () => {
    prismaMock.programEntry.findUnique.mockResolvedValueOnce(stored);
    prismaMock.classSection.count.mockResolvedValueOnce(0);
    const res = await request(app).delete('/api/program-entries/e1').set('Authorization', `Bearer ${dean}`);
    expect(res.status).toBe(200);
    expect(prismaMock.programEntry.delete).toHaveBeenCalledWith({ where: { id: 'e1' } });
  });
});
