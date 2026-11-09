import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Testy HTTP zgloszen zmian i powiadomien — Prisma mockowana: kto moze zglaszac, zatwierdzac,
// odrzucac i wycofywac; powiadomienia tylko wlasne.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  occurrence: { findUnique: vi.fn() },
  changeRequest: { findUnique: vi.fn(), update: vi.fn() },
  notification: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
}));
vi.mock('./lib/prisma', () => ({ prisma: prismaMock }));

import { createApp } from './index';
import { signAccessToken } from './lib/jwt';

const app = createApp();
const tokens: Record<string, string> = {};

// Konta: prowadzacy i1 (konto u-i1), drugi prowadzacy i2, dziekanat WM, student.
const users: Record<string, { id: string; role: string; instructorId: string | null; facultyId: string | null }> = {
  'u-i1': { id: 'u-i1', role: 'INSTRUCTOR', instructorId: 'i1', facultyId: null },
  'u-i2': { id: 'u-i2', role: 'INSTRUCTOR', instructorId: 'i2', facultyId: null },
  'u-dean': { id: 'u-dean', role: 'DEAN_OFFICE', instructorId: null, facultyId: 'wm' },
  'u-st': { id: 'u-st', role: 'STUDENT', instructorId: null, facultyId: null },
};

beforeAll(() => {
  for (const u of Object.values(users)) tokens[u.id] = signAccessToken({ sub: u.id, role: u.role as never });
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockImplementation((args: { where: { id: string } }) => Promise.resolve(users[args.where.id] ?? null));
});

const as = (userId: string) => ({ Authorization: `Bearer ${tokens[userId]}` });
const pendingRequest = { id: 'r1', status: 'PENDING', facultyId: 'we', instructorId: 'i1', kind: 'CANCEL', termId: 't1', sectionId: 's1' };

describe('API — zgloszenia zmian', () => {
  it('student nie sklada zgloszen -> 403', async () => {
    const res = await request(app).post('/api/occurrences/o1/requests').set(as('u-st')).send({ kind: 'CANCEL', reason: 'Wyjazd' });
    expect(res.status).toBe(403);
  });

  it('dziekanat nie sklada zgloszen za prowadzacego -> 403', async () => {
    const res = await request(app).post('/api/occurrences/o1/requests').set(as('u-dean')).send({ kind: 'CANCEL', reason: 'Wyjazd' });
    expect(res.status).toBe(403);
  });

  it('prowadzacy nie zglasza cudzych zajec -> 404 (nie zdradzamy, ze termin istnieje)', async () => {
    prismaMock.occurrence.findUnique.mockResolvedValueOnce({ id: 'o1', instructorId: 'i2', placement: null, section: {} });
    const res = await request(app).post('/api/occurrences/o1/requests').set(as('u-i1')).send({ kind: 'CANCEL', reason: 'Wyjazd' });
    expect(res.status).toBe(404);
  });

  it('dziekanat innego wydzialu nie zatwierdza -> 403, bez zmian', async () => {
    prismaMock.changeRequest.findUnique.mockResolvedValueOnce(pendingRequest);
    const res = await request(app).post('/api/change-requests/r1/approve').set(as('u-dean')).send({});
    expect(res.status).toBe(403);
    expect(prismaMock.changeRequest.update).not.toHaveBeenCalled();
  });

  it('prowadzacy nie zatwierdza zgloszen -> 403', async () => {
    const res = await request(app).post('/api/change-requests/r1/approve').set(as('u-i1')).send({});
    expect(res.status).toBe(403);
  });

  it('odrzucenie wymaga uzasadnienia -> 400', async () => {
    prismaMock.changeRequest.findUnique.mockResolvedValueOnce({ ...pendingRequest, facultyId: 'wm' });
    const res = await request(app).post('/api/change-requests/r1/reject').set(as('u-dean')).send({ note: ' ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dlaczego/);
    expect(prismaMock.changeRequest.update).not.toHaveBeenCalled();
  });

  it('rozpatrzonego zgloszenia nie da sie zatwierdzic drugi raz -> 409', async () => {
    prismaMock.changeRequest.findUnique.mockResolvedValueOnce({ ...pendingRequest, facultyId: 'wm', status: 'APPROVED' });
    const res = await request(app).post('/api/change-requests/r1/approve').set(as('u-dean')).send({});
    expect(res.status).toBe(409);
  });

  it('cudzego zgloszenia nie da sie wycofac -> 403', async () => {
    prismaMock.changeRequest.findUnique.mockResolvedValueOnce(pendingRequest);
    const res = await request(app).post('/api/change-requests/r1/withdraw').set(as('u-i2')).send({});
    expect(res.status).toBe(403);
    expect(prismaMock.changeRequest.update).not.toHaveBeenCalled();
  });

  it('student nie widzi listy zgloszen -> 403', async () => {
    const res = await request(app).get('/api/terms/2026-Z/requests').set(as('u-st'));
    expect(res.status).toBe(403);
  });
});

describe('API — powiadomienia', () => {
  it('lista tylko wlasnych powiadomien', async () => {
    const res = await request(app).get('/api/notifications').set(as('u-i1'));
    expect(res.status).toBe(200);
    expect(prismaMock.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u-i1' } }));
  });

  it('cudzego powiadomienia nie da sie oznaczyc -> 404', async () => {
    prismaMock.notification.findUnique.mockResolvedValueOnce({ id: 'n1', userId: 'u-dean', readAt: null });
    const res = await request(app).post('/api/notifications/n1/read').set(as('u-i1'));
    expect(res.status).toBe(404);
    expect(prismaMock.notification.update).not.toHaveBeenCalled();
  });

  it('bez logowania -> 401', async () => {
    expect((await request(app).get('/api/notifications')).status).toBe(401);
  });
});
