import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Siatki godzin wydzialow przez HTTP — Prisma mockowana: uprawnienia, blokada blokow przy
// istniejacym planie (dni wolno zmieniac), walidacja blokow i okna godzin, siatki dnia
// (wlasne bloki dla wybranych dni: dni przechodza z siatki podstawowej i do niej wracaja).
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => {
  const tx = {
    timeBlock: { deleteMany: vi.fn(), createMany: vi.fn() },
    timeGrid: { update: vi.fn(), create: vi.fn() },
  };
  return {
    tx,
    user: { findUnique: vi.fn().mockResolvedValue({ facultyId: 'we' }) },
    faculty: { findUnique: vi.fn() },
    timeGrid: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn((args: unknown) => ({ op: 'timeGrid.update', args })),
      delete: vi.fn((args: unknown) => ({ op: 'timeGrid.delete', args })),
    },
    placement: { count: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  };
});
vi.mock('./lib/prisma', () => ({ prisma: prismaMock }));

import { createApp } from './index';
import { signAccessToken } from './lib/jwt';

const app = createApp();
let admin: string;
let dean: string;

beforeAll(() => {
  admin = signAccessToken({ sub: 'u-admin', role: 'ADMIN' });
  dean = signAccessToken({ sub: 'u-dean', role: 'DEAN_OFFICE' });
});

const faculty = { id: 'we', name: 'Wydzial Elektryczny', shortName: 'WE' };
const grid = {
  id: 'g1',
  facultyId: 'we',
  studyMode: 'PART_TIME',
  base: true,
  createdAt: new Date('2026-01-01'),
  days: [{ day: 'FRIDAY', from: '15:00', to: null }],
  faculty,
  blocks: [{ id: 'b1', order: 1, startTime: '08:00', endTime: '08:45', label: '08:00-08:45' }],
};
// Niestacjonarne: siatka podstawowa pt-nd i siatka dnia piatku od 16:00.
const weekend = {
  ...grid,
  days: [
    { day: 'FRIDAY', from: '15:00', to: null },
    { day: 'SATURDAY', from: null, to: null },
    { day: 'SUNDAY', from: null, to: null },
  ],
};
const friday = {
  ...grid,
  id: 'g2',
  base: false,
  createdAt: new Date('2026-02-01'),
  days: [{ day: 'FRIDAY', from: '16:00', to: null }],
  blocks: [
    { id: 'f1', order: 1, startTime: '16:00', endTime: '16:45', label: '16:00-16:45' },
    { id: 'f2', order: 2, startTime: '16:50', endTime: '17:35', label: '16:50-17:35' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.timeGrid.findUnique.mockResolvedValue(grid);
  prismaMock.timeGrid.findMany.mockResolvedValue([grid]);
  prismaMock.tx.timeGrid.update.mockResolvedValue(grid);
  prismaMock.placement.count.mockResolvedValue(0);
  // Transakcja interaktywna (funkcja) albo tablica zapytan.
  prismaMock.$transaction.mockImplementation((arg: unknown) => (typeof arg === 'function' ? arg(prismaMock.tx) : Promise.resolve(arg)));
});

const put = (token: string, body: unknown) => request(app).put('/api/time-grids/g1').set('Authorization', `Bearer ${token}`).send(body);
const post = (body: unknown) => request(app).post('/api/time-grids').set('Authorization', `Bearer ${admin}`).send(body);
const friday16 = {
  facultyId: 'we',
  studyMode: 'PART_TIME',
  days: [{ day: 'FRIDAY', from: '16:00', to: null }],
  blocks: [
    { startTime: '16:50', endTime: '17:35' },
    { startTime: '16:00', endTime: '16:45' },
  ],
};

describe('API — siatki godzin wydzialow', () => {
  it('dziekanat nie zmienia siatki -> 403', async () => {
    expect((await put(dean, { days: [{ day: 'FRIDAY', from: null, to: null }] })).status).toBe(403);
    const created = await request(app).post('/api/time-grids').set('Authorization', `Bearer ${dean}`).send(friday16);
    expect(created.status).toBe(403);
  });

  it('bloki przy istniejacym planie -> 409, nic nie zapisane', async () => {
    prismaMock.placement.count.mockResolvedValueOnce(5);
    const res = await put(admin, { blocks: [{ startTime: '08:00', endTime: '08:45' }] });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Dni i okno godzin mozna zmieniac/);
    expect(prismaMock.tx.timeBlock.deleteMany).not.toHaveBeenCalled();
  });

  it('same dni przy istniejacym planie -> zapisane (czwartek od 16:00)', async () => {
    prismaMock.placement.count.mockResolvedValue(5);
    const days = [
      { day: 'SATURDAY', from: null, to: null },
      { day: 'THURSDAY', from: '16:00', to: null },
    ];
    const res = await put(admin, { days });
    expect(res.status).toBe(200);
    // zapis w kolejnosci tygodnia
    expect(prismaMock.tx.timeGrid.update.mock.calls[0]![0].data.days.map((d: { day: string }) => d.day)).toEqual(['THURSDAY', 'SATURDAY']);
  });

  it('dni wyrzucajace ulozone zajecia poza siatke -> 409 z liczba umieszczen, nic nie zapisane', async () => {
    // Piatek 08:00-08:45 w dwoch rocznikach; nowa siatka: piatek dopiero od 15:00, sobota bez zmian.
    prismaMock.placement.findMany.mockResolvedValueOnce([
      { dayOfWeek: 'FRIDAY', startOrder: 1, endOrder: 1, section: { cohortId: 'c1' } },
      { dayOfWeek: 'FRIDAY', startOrder: 1, endOrder: 1, section: { cohortId: 'c2' } },
    ]);
    const res = await put(admin, { days: [{ day: 'FRIDAY', from: '15:00', to: null }] });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(
      'Zmiana wyrzucilaby poza siatke ulozone zajecia: piatek: zajecia od 15:00 — 2 umieszczenia (2 roczniki). Najpierw przenies te zajecia w Ukladaniu planu.',
    );
    expect(prismaMock.tx.timeGrid.update).not.toHaveBeenCalled();
  });

  it('nachodzace bloki -> 400', async () => {
    const res = await put(admin, { blocks: [{ startTime: '08:00', endTime: '09:00' }, { startTime: '08:30', endTime: '09:15' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nachodza/);
  });

  it('okno godzin konczace sie przed startem -> 400', async () => {
    const res = await put(admin, { days: [{ day: 'THURSDAY', from: '18:00', to: '16:00' }] });
    expect(res.status).toBe(400);
  });

  it('nowe bloki bez planu -> zapisane z numeracja wg godziny', async () => {
    const res = await put(admin, { blocks: [{ startTime: '08:50', endTime: '09:35' }, { startTime: '08:00', endTime: '08:45' }] });
    expect(res.status).toBe(200);
    const rows = prismaMock.tx.timeBlock.createMany.mock.calls[0]![0].data;
    expect(rows.map((r: { order: number; startTime: string }) => [r.order, r.startTime])).toEqual([
      [1, '08:00'],
      [2, '08:50'],
    ]);
  });

  it('dzien z osobna siatka dnia nie wraca do podstawowej przez jej edycje -> 400', async () => {
    prismaMock.timeGrid.findUnique.mockResolvedValueOnce(weekend);
    prismaMock.timeGrid.findMany.mockResolvedValueOnce([weekend, friday]);
    const res = await put(admin, { days: weekend.days });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/piatek: ten dzien jest juz w innej siatce/);
  });
});

describe('API — siatki dnia', () => {
  it('siatka dnia zabiera dzien siatce podstawowej (bloki ponumerowane wg godziny)', async () => {
    prismaMock.faculty.findUnique.mockResolvedValueOnce({ id: 'we' });
    prismaMock.timeGrid.findMany.mockResolvedValueOnce([weekend]).mockResolvedValueOnce([weekend, friday]);
    prismaMock.tx.timeGrid.create.mockResolvedValueOnce(friday);
    const res = await post(friday16);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: 'g2', base: false, days: [{ day: 'FRIDAY', from: '16:00', to: null }] });
    // Podstawowa traci piatek; nowa siatka dostaje piatek i swoje bloki.
    expect(prismaMock.tx.timeGrid.update.mock.calls[0]![0]).toMatchObject({ where: { id: 'g1' } });
    expect(prismaMock.tx.timeGrid.update.mock.calls[0]![0].data.days.map((d: { day: string }) => d.day)).toEqual(['SATURDAY', 'SUNDAY']);
    const created = prismaMock.tx.timeGrid.create.mock.calls[0]![0].data;
    expect(created).toMatchObject({ facultyId: 'we', studyMode: 'PART_TIME', base: false });
    expect(created.blocks.create.map((b: { order: number; startTime: string }) => [b.order, b.startTime])).toEqual([
      [1, '16:00'],
      [2, '16:50'],
    ]);
  });

  it('ulozone zajecia w tych dniach -> 409, nic nie zapisane', async () => {
    prismaMock.faculty.findUnique.mockResolvedValueOnce({ id: 'we' });
    prismaMock.timeGrid.findMany.mockResolvedValueOnce([weekend]);
    prismaMock.placement.count.mockResolvedValueOnce(3);
    const res = await post(friday16);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/piatek: sa tu juz ulozone zajecia/);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('dzien ma juz siatke dnia -> 400', async () => {
    prismaMock.faculty.findUnique.mockResolvedValueOnce({ id: 'we' });
    prismaMock.timeGrid.findMany.mockResolvedValueOnce([weekend, friday]);
    const res = await post(friday16);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/osobna siatke dnia/);
  });

  it('podstawowa nie moze stracic wszystkich dni -> 400', async () => {
    prismaMock.faculty.findUnique.mockResolvedValueOnce({ id: 'we' });
    prismaMock.timeGrid.findMany.mockResolvedValueOnce([grid]); // podstawowa: tylko piatek
    const res = await post(friday16);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/co najmniej jeden dzien/);
  });

  it('usuniecie siatki dnia oddaje jej dni podstawowej (w kolejnosci tygodnia)', async () => {
    prismaMock.timeGrid.findUnique.mockResolvedValueOnce(friday);
    prismaMock.timeGrid.findMany.mockResolvedValueOnce([{ ...weekend, days: weekend.days.slice(1) }, friday]);
    const res = await request(app).delete('/api/time-grids/g2').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    const update = prismaMock.timeGrid.update.mock.calls[0]![0];
    expect(update.where).toEqual({ id: 'g1' });
    expect(update.data.days).toEqual([
      { day: 'FRIDAY', from: '16:00', to: null },
      { day: 'SATURDAY', from: null, to: null },
      { day: 'SUNDAY', from: null, to: null },
    ]);
    expect(prismaMock.timeGrid.delete).toHaveBeenCalledWith({ where: { id: 'g2' } });
  });

  it('siatki podstawowej nie usuwa sie -> 400; siatka dnia z ulozonymi zajeciami -> 409', async () => {
    const base = await request(app).delete('/api/time-grids/g1').set('Authorization', `Bearer ${admin}`);
    expect(base.status).toBe(400);
    prismaMock.timeGrid.findUnique.mockResolvedValueOnce(friday);
    prismaMock.placement.count.mockResolvedValueOnce(2);
    const busy = await request(app).delete('/api/time-grids/g2').set('Authorization', `Bearer ${admin}`);
    expect(busy.status).toBe(409);
    expect(prismaMock.timeGrid.delete).not.toHaveBeenCalled();
  });
});
