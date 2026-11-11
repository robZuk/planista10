import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Slownik przedmiotow i prowadzacy — edycja i czytelne komunikaty duplikatow (Prisma mockowana).
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn().mockResolvedValue({ facultyId: 'wm' }) },
  subject: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn((args: { data: object }) => Promise.resolve({ id: 's-new', ...args.data })),
    update: vi.fn((args: { data: object }) => Promise.resolve({ id: 's1', ...args.data })),
  },
  instructor: {
    findFirst: vi.fn(),
    create: vi.fn((args: { data: object }) => Promise.resolve({ id: 'i-new', ...args.data })),
    update: vi.fn((args: { data: object }) => Promise.resolve({ id: 'i1', ...args.data })),
  },
}));
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

beforeEach(() => {
  prismaMock.subject.findFirst.mockReset().mockResolvedValue(null);
  prismaMock.instructor.findFirst.mockReset().mockResolvedValue(null);
});

describe('API — przedmioty', () => {
  it('zmiana nazwy tylko dla admina', async () => {
    const res = await request(app).put('/api/subjects/s1').set('Authorization', `Bearer ${dean}`).send({ name: 'Fizyka' });
    expect(res.status).toBe(403);
  });

  it('zmienia nazwe, pusty kod zapisuje jako brak kodu', async () => {
    prismaMock.subject.findUnique.mockResolvedValueOnce({ id: 's1', name: 'Fizyka I', code: 'F1' });
    const res = await request(app)
      .put('/api/subjects/s1')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: '  Fizyka I, II ', code: '' });
    expect(res.status).toBe(200);
    expect(prismaMock.subject.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1' }, data: { name: 'Fizyka I, II', code: null } }));
  });

  it('duplikat nazwy (bez wzgledu na wielkosc liter) — komunikat wskazuje przedmiot', async () => {
    prismaMock.subject.findFirst.mockResolvedValueOnce({ id: 's2', name: 'Matematyka I', code: null });
    const res = await request(app).post('/api/subjects').set('Authorization', `Bearer ${admin}`).send({ name: 'matematyka i' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Przedmiot o nazwie „Matematyka I” juz istnieje');
    expect(prismaMock.subject.create).not.toHaveBeenCalled();
  });

  it('duplikat kodu — komunikat wskazuje przedmiot z tym kodem', async () => {
    prismaMock.subject.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 's3', name: 'Chemia', code: 'CH-1' });
    const res = await request(app).post('/api/subjects').set('Authorization', `Bearer ${admin}`).send({ name: 'Chemia II', code: 'CH-1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Kod CH-1 ma juz przedmiot „Chemia”');
  });

  it('przy edycji pomija sam edytowany przedmiot', async () => {
    prismaMock.subject.findUnique.mockResolvedValueOnce({ id: 's1', name: 'Fizyka', code: null });
    await request(app).put('/api/subjects/s1').set('Authorization', `Bearer ${admin}`).send({ name: 'Fizyka' });
    expect(prismaMock.subject.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ NOT: { id: 's1' } }) });
  });
});

describe('API — prowadzacy: duplikat e-maila', () => {
  const body = { firstName: 'Jan', lastName: 'Nowak', email: 'jan.nowak@umg.edu.pl' };

  it('dodanie z zajetym adresem mowi, kto go ma', async () => {
    prismaMock.instructor.findFirst.mockResolvedValueOnce({ id: 'i9', title: 'dr', firstName: 'Jan', lastName: 'Kowalski' });
    const res = await request(app).post('/api/instructors').set('Authorization', `Bearer ${admin}`).send(body);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Adres jan.nowak@umg.edu.pl ma juz prowadzacy dr Jan Kowalski');
    expect(prismaMock.instructor.create).not.toHaveBeenCalled();
  });

  it('edycja nie zderza sie z wlasnym adresem', async () => {
    const res = await request(app).put('/api/instructors/i1').set('Authorization', `Bearer ${admin}`).send(body);
    expect(res.status).toBe(200);
    expect(prismaMock.instructor.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ NOT: { id: 'i1' } }) });
  });
});
