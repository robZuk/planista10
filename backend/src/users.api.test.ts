import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Testy HTTP kont — Prisma mockowana: konto dziekanatu musi miec istniejacy wydzial.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  faculty: { findUnique: vi.fn() },
}));
vi.mock('./lib/prisma', () => ({ prisma: prismaMock }));

import { createApp } from './index';
import { signAccessToken } from './lib/jwt';

const app = createApp();
let admin: string;
beforeAll(() => {
  admin = signAccessToken({ sub: 'u-admin', role: 'ADMIN' });
});

const body = { name: 'Test Dziekanat', email: 'test.dz@umg.edu.pl', password: 'Haslo12345', role: 'DEAN_OFFICE' };
const user = { id: 'u1', email: body.email, name: body.name, role: 'DEAN_OFFICE', instructorId: null, facultyId: 'wm', createdAt: new Date(), instructor: null, studentGroups: [] };

describe('API — konta dziekanatu', () => {
  it('nowe konto dziekanatu bez wydzialu -> 400, bez zapisu', async () => {
    const res = await request(app).post('/api/users').set('Authorization', `Bearer ${admin}`).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/wymaga wydzialu/);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('nieistniejacy wydzial -> 400', async () => {
    prismaMock.faculty.findUnique.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/users').set('Authorization', `Bearer ${admin}`).send({ ...body, facultyId: 'nie-ma' });
    expect(res.status).toBe(400);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('z wydzialem — konto zalozone', async () => {
    prismaMock.faculty.findUnique.mockResolvedValueOnce({ id: 'wm' });
    prismaMock.user.create.mockResolvedValueOnce(user);
    const res = await request(app).post('/api/users').set('Authorization', `Bearer ${admin}`).send({ ...body, facultyId: 'wm' });
    expect(res.status).toBe(201);
  });

  it('zmiana roli na dziekanat bez wydzialu -> 400', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: 'INSTRUCTOR', facultyId: null });
    const res = await request(app).put('/api/users/u1').set('Authorization', `Bearer ${admin}`).send({ role: 'DEAN_OFFICE' });
    expect(res.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('zdjecie wydzialu dziekanatowi -> 400; zmiana nazwy dziekanatu z wydzialem — ok', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: 'DEAN_OFFICE', facultyId: 'wm' });
    expect((await request(app).put('/api/users/u1').set('Authorization', `Bearer ${admin}`).send({ facultyId: null })).status).toBe(400);
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: 'DEAN_OFFICE', facultyId: 'wm' });
    prismaMock.faculty.findUnique.mockResolvedValueOnce({ id: 'wm' });
    prismaMock.user.update.mockResolvedValueOnce(user);
    expect((await request(app).put('/api/users/u1').set('Authorization', `Bearer ${admin}`).send({ name: 'Nowa nazwa' })).status).toBe(200);
  });
});
