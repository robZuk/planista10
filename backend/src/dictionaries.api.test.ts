import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Duplikaty w slownikach (wydzialy, budynki, sale, programy, wersje) — czytelny 409 zamiast
// ogolnego "Rekord o podanych danych juz istnieje" z bazy (Prisma mockowana).
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  faculty: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  building: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  room: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  program: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  programVersion: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  fieldOfStudy: { findUnique: vi.fn() },
}));
vi.mock('./lib/prisma', () => ({ prisma: prismaMock }));

import { createApp } from './index';
import { signAccessToken } from './lib/jwt';

const app = createApp();
let admin: string;
beforeAll(() => {
  admin = signAccessToken({ sub: 'u-admin', role: 'ADMIN' });
});
beforeEach(() => {
  for (const model of Object.values(prismaMock)) for (const fn of Object.values(model)) fn.mockReset();
});

const send = (method: 'post' | 'put', url: string, body: object) =>
  request(app)[method](url).set('Authorization', `Bearer ${admin}`).send(body);

describe('API — duplikaty w slownikach', () => {
  it('wydzial: zajety skrot (inna wielkosc liter) -> 409 z nazwa wydzialu', async () => {
    prismaMock.faculty.findMany.mockResolvedValueOnce([]);
    prismaMock.faculty.findFirst.mockResolvedValueOnce({ name: 'Wydział Mechaniczny', shortName: 'WM' });
    const res = await send('post', '/api/faculties', { name: 'Nowy wydzial', shortName: 'wm' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Skrot WM ma juz wydzial „Wydział Mechaniczny”');
    expect(prismaMock.faculty.create).not.toHaveBeenCalled();
  });

  it('wydzial: nazwa bez polskich znakow to ten sam wydzial -> 409', async () => {
    prismaMock.faculty.findMany.mockResolvedValueOnce([{ name: 'Wydział Mechaniczny' }]);
    const res = await send('post', '/api/faculties', { name: 'wydzial  mechaniczny', shortName: 'XYZ' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Wydzial „Wydział Mechaniczny” juz istnieje');
  });

  it('wydzial: edycja nie zderza sie sama ze soba', async () => {
    prismaMock.faculty.findMany.mockResolvedValue([]);
    prismaMock.faculty.findFirst.mockResolvedValue(null);
    prismaMock.faculty.update.mockResolvedValueOnce({ id: 'f1' });
    const res = await send('put', '/api/faculties/f1', { name: 'Wydział Mechaniczny', shortName: 'WM' });
    expect(res.status).toBe(200);
    expect(prismaMock.faculty.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { NOT: { id: 'f1' } } }));
    expect(prismaMock.faculty.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ NOT: { id: 'f1' } }) });
  });

  it('budynek o tej samej nazwie -> 409', async () => {
    prismaMock.building.findMany.mockResolvedValueOnce([{ name: 'Budynek Główny' }]);
    const res = await send('post', '/api/buildings', { name: 'budynek glowny' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Budynek „Budynek Główny” juz istnieje');
  });

  it('sala: numer zajety w tym budynku -> 409; przy edycji szukamy w budynku sali', async () => {
    prismaMock.room.findFirst.mockResolvedValueOnce({ number: '101' });
    const created = await send('post', '/api/buildings/b1/rooms', { number: '101', type: 'LECTURE', capacity: 30 });
    expect(created.status).toBe(409);
    expect(created.body.error).toBe('Sala 101 juz jest w tym budynku');

    prismaMock.room.findUnique.mockResolvedValueOnce({ buildingId: 'b2' });
    prismaMock.room.findFirst.mockResolvedValueOnce({ number: '7' });
    const updated = await send('put', '/api/buildings/b2/rooms/r1', { number: '7' });
    expect(updated.status).toBe(409);
    expect(prismaMock.room.findFirst).toHaveBeenLastCalledWith({ where: expect.objectContaining({ buildingId: 'b2', NOT: { id: 'r1' } }) });
  });

  it('program: kod zajety -> 409 z nazwa programu', async () => {
    prismaMock.fieldOfStudy.findUnique.mockResolvedValueOnce({ id: 'f1', facultyId: 'wm' });
    prismaMock.program.findFirst.mockResolvedValueOnce({ code: 'EDST-S1', name: 'Eksploatacja (stacjonarne)' });
    const res = await send('post', '/api/programs', {
      code: 'edst-s1',
      name: 'X',
      fieldOfStudyId: 'f1',
      studyMode: 'FULL_TIME',
      degreeLevel: 'BACHELOR',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Kod EDST-S1 ma juz program „Eksploatacja (stacjonarne)”');
  });

  it('wersja: etykieta zajeta w programie -> 409', async () => {
    prismaMock.program.findUnique.mockResolvedValueOnce({ id: 'p1', fieldOfStudy: { facultyId: 'wm' } });
    prismaMock.programVersion.findFirst.mockResolvedValueOnce({ label: 'od naboru 2025/26' });
    const res = await send('post', '/api/programs/p1/versions', { label: 'od naboru 2025/26', totalSemesters: 7 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Program ma juz wersje „od naboru 2025\/26”/);
    expect(prismaMock.programVersion.create).not.toHaveBeenCalled();
  });
});
