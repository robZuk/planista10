import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Testy HTTP kont — Prisma mockowana: konto dziekanatu musi miec istniejacy wydzial.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn(), count: vi.fn() },
  faculty: { findUnique: vi.fn() },
}));
vi.mock('./lib/prisma', () => ({ prisma: prismaMock }));

import { createApp } from './index';
import { signAccessToken, verifyAccessToken } from './lib/jwt';

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

describe('API — konta: zajety e-mail i prowadzacy z kontem', () => {
  const instr = { name: 'Jan Nowak', email: 'jan.nowak@umg.edu.pl', password: 'Haslo12345', role: 'INSTRUCTOR', instructorId: 'i1' };

  it('zajety e-mail (bez wzgledu na wielkosc liter) -> 409 z nazwa konta', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({ name: 'Student testowy' });
    prismaMock.user.create.mockClear();
    const res = await request(app).post('/api/users').set('Authorization', `Bearer ${admin}`).send({ ...instr, email: 'Student@umg.edu.pl' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Adres Student@umg.edu.pl ma juz konto: Student testowy');
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: { equals: 'Student@umg.edu.pl', mode: 'insensitive' } } }),
    );
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('prowadzacy z innym kontem -> 409 z adresem tamtego konta', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ email: 'prowadzacy@umg.edu.pl' });
    const res = await request(app).post('/api/users').set('Authorization', `Bearer ${admin}`).send(instr);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/ma juz konto prowadzacy@umg.edu.pl/);
  });

  it('edycja nie zderza sie z wlasnym kontem', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', role: 'INSTRUCTOR', facultyId: null });
    prismaMock.user.update.mockResolvedValueOnce({ ...user, role: 'INSTRUCTOR', facultyId: null });
    prismaMock.user.findFirst.mockClear();
    const res = await request(app).put('/api/users/u1').set('Authorization', `Bearer ${admin}`).send({ email: instr.email, instructorId: 'i1' });
    expect(res.status).toBe(200);
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ NOT: { id: 'u1' } }) }));
  });
});

describe('API — podglad (impersonacja) jest tylko do odczytu', () => {
  it('token podgladu niesie admina; odczyt dziala, zapis -> 403 bez zmian', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ ...user, id: 'u-instr', role: 'INSTRUCTOR', facultyId: null });
    const started = await request(app).post('/api/users/u-instr/impersonate').set('Authorization', `Bearer ${admin}`);
    expect(started.status).toBe(200);
    const token = started.body.data.accessToken as string;
    expect(verifyAccessToken(token)).toMatchObject({ sub: 'u-instr', role: 'INSTRUCTOR', imp: 'u-admin' });

    // Odczyt w podgladzie przechodzi przez uwierzytelnienie (dalej decyduje juz rola).
    const read = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`);
    expect(read.status).toBe(403);
    expect(read.body.error).toBe('Brak uprawnien do tej operacji');

    prismaMock.user.update.mockClear();
    for (const call of [
      request(app).put('/api/occurrences/o1').set('Authorization', `Bearer ${token}`).send({ action: 'CANCEL' }),
      request(app).put('/api/users/u1').set('Authorization', `Bearer ${token}`).send({ name: 'X' }),
      request(app).delete('/api/users/u1').set('Authorization', `Bearer ${token}`),
    ]) {
      const res = await call;
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Podglad jest tylko do odczytu/);
    }
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('zwykly token (bez podgladu) zapisuje normalnie', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', role: 'DEAN_OFFICE', facultyId: 'wm' });
    prismaMock.faculty.findUnique.mockResolvedValueOnce({ id: 'wm' });
    prismaMock.user.update.mockResolvedValueOnce(user);
    const res = await request(app).put('/api/users/u1').set('Authorization', `Bearer ${admin}`).send({ name: 'Nowa nazwa' });
    expect(res.status).toBe(200);
  });
});

describe('API — rola administratora nie znika', () => {
  it('admin nie odbiera roli sobie -> 400, bez zapisu', async () => {
    prismaMock.user.update.mockClear();
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u-admin', role: 'ADMIN', facultyId: null });
    const res = await request(app).put('/api/users/u-admin').set('Authorization', `Bearer ${admin}`).send({ role: 'STUDENT', studentGroupIds: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Nie mozesz odebrac sobie roli administratora');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('ostatni administrator zostaje adminem -> 409; gdy jest drugi — zmiana przechodzi', async () => {
    prismaMock.user.update.mockClear();
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u-inny', role: 'ADMIN', facultyId: null });
    prismaMock.user.count.mockResolvedValueOnce(1);
    const res = await request(app).put('/api/users/u-inny').set('Authorization', `Bearer ${admin}`).send({ role: 'STUDENT', studentGroupIds: [] });
    expect(res.status).toBe(409);
    expect(prismaMock.user.update).not.toHaveBeenCalled();

    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u-inny', role: 'ADMIN', facultyId: null });
    prismaMock.user.count.mockResolvedValueOnce(2);
    prismaMock.user.update.mockResolvedValueOnce({ ...user, id: 'u-inny', role: 'STUDENT', facultyId: null });
    const ok = await request(app).put('/api/users/u-inny').set('Authorization', `Bearer ${admin}`).send({ role: 'STUDENT', studentGroupIds: [] });
    expect(ok.status).toBe(200);
  });
});
