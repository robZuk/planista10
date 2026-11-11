import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Siatki godzin wydzialow przez HTTP — Prisma mockowana: uprawnienia, blokada blokow przy
// istniejacym planie (dni wolno zmieniac), walidacja blokow i okna godzin.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => {
  const tx = {
    timeBlock: { deleteMany: vi.fn(), createMany: vi.fn() },
    timeGrid: { update: vi.fn() },
  };
  return {
    tx,
    user: { findUnique: vi.fn().mockResolvedValue({ facultyId: 'we' }) },
    timeGrid: { findUnique: vi.fn() },
    placement: { count: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
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

const grid = {
  id: 'g1',
  facultyId: 'we',
  studyMode: 'PART_TIME',
  days: [{ day: 'FRIDAY', from: '15:00', to: null }],
  faculty: { id: 'we', name: 'Wydzial Elektryczny', shortName: 'WE' },
  blocks: [{ id: 'b1', order: 1, startTime: '08:00', endTime: '08:45', label: '08:00-08:45' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.timeGrid.findUnique.mockResolvedValue(grid);
  prismaMock.tx.timeGrid.update.mockResolvedValue(grid);
  prismaMock.$transaction.mockImplementation((fn) => fn(prismaMock.tx));
});

const put = (token: string, body: unknown) => request(app).put('/api/time-grids/g1').set('Authorization', `Bearer ${token}`).send(body);

describe('API — siatki godzin wydzialow', () => {
  it('dziekanat nie zmienia siatki -> 403', async () => {
    expect((await put(dean, { days: [{ day: 'FRIDAY', from: null, to: null }] })).status).toBe(403);
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
    prismaMock.placement.count.mockResolvedValueOnce(0);
    const res = await put(admin, { blocks: [{ startTime: '08:00', endTime: '09:00' }, { startTime: '08:30', endTime: '09:15' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nachodza/);
  });

  it('okno godzin konczace sie przed startem -> 400', async () => {
    const res = await put(admin, { days: [{ day: 'THURSDAY', from: '18:00', to: '16:00' }] });
    expect(res.status).toBe(400);
  });

  it('nowe bloki bez planu -> zapisane z numeracja wg godziny', async () => {
    prismaMock.placement.count.mockResolvedValue(0);
    const res = await put(admin, { blocks: [{ startTime: '08:50', endTime: '09:35' }, { startTime: '08:00', endTime: '08:45' }] });
    expect(res.status).toBe(200);
    const rows = prismaMock.tx.timeBlock.createMany.mock.calls[0]![0].data;
    expect(rows.map((r: { order: number; startTime: string }) => [r.order, r.startTime])).toEqual([
      [1, '08:00'],
      [2, '08:50'],
    ]);
  });
});
