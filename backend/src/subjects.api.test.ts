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
  fieldOfStudy: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn((args: { data: object }) => Promise.resolve({ id: 'f-new', ...args.data })),
    update: vi.fn((args: { data: object }) => Promise.resolve({ id: 'f1', ...args.data })),
  },
  specialization: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn((args: { data: object }) => Promise.resolve({ id: 'sp-new', ...args.data })),
    update: vi.fn((args: { data: object }) => Promise.resolve({ id: 'sp1', ...args.data })),
  },
  instructor: {
    findFirst: vi.fn(),
    create: vi.fn((args: { data: object }) => Promise.resolve({ id: 'i-new', ...args.data })),
    update: vi.fn((args: { data: object }) => Promise.resolve({ id: 'i1', ...args.data })),
    findUnique: vi.fn(),
    delete: vi.fn().mockResolvedValue({ id: 'i1' }),
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
  prismaMock.fieldOfStudy.findFirst.mockReset().mockResolvedValue(null);
  prismaMock.specialization.findFirst.mockReset().mockResolvedValue(null);
  prismaMock.fieldOfStudy.findMany.mockReset().mockResolvedValue([]);
  prismaMock.specialization.findMany.mockReset().mockResolvedValue([]);
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

describe('API — prowadzacy: usuwanie', () => {
  const counts = (c: object) => ({ id: 'i1', _count: { placements: 0, occurrences: 0, sectionAssignments: 0, changeRequests: 0, ...c } });

  it('prowadzacy ze zgloszeniami zmian -> 409 z powodem, bez usuwania', async () => {
    prismaMock.instructor.findUnique.mockResolvedValueOnce(counts({ changeRequests: 2 }));
    const res = await request(app).delete('/api/instructors/i1').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('zgloszenia zmian');
    expect(prismaMock.instructor.delete).not.toHaveBeenCalled();
  });

  it('prowadzacy bez obsady, planu i zgloszen jest usuwany', async () => {
    prismaMock.instructor.findUnique.mockResolvedValueOnce(counts({}));
    const res = await request(app).delete('/api/instructors/i1').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    expect(prismaMock.instructor.delete).toHaveBeenCalledWith({ where: { id: 'i1' } });
  });
});

describe('API — kierunki i specjalnosci: edycja', () => {
  it('kierunek: zmiana nazwy i skrotu (tylko admin)', async () => {
    expect((await request(app).put('/api/fields-of-study/f1').set('Authorization', `Bearer ${dean}`).send({ name: 'X', shortName: 'X' })).status).toBe(403);
    prismaMock.fieldOfStudy.findUnique.mockResolvedValueOnce({ id: 'f1', facultyId: 'wm', name: 'Eksploatacja', shortName: 'EDST' });
    const res = await request(app).put('/api/fields-of-study/f1').set('Authorization', `Bearer ${admin}`).send({ name: ' Eksploatacja i Diagnostyka ', shortName: 'EDST' });
    expect(res.status).toBe(200);
    expect(prismaMock.fieldOfStudy.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: { name: 'Eksploatacja i Diagnostyka', shortName: 'EDST' } });
  });

  it('kierunek: nazwa zajeta na tym wydziale -> 409 z nazwa', async () => {
    prismaMock.fieldOfStudy.findUnique.mockResolvedValueOnce({ id: 'f1', facultyId: 'wm' });
    prismaMock.fieldOfStudy.findMany.mockResolvedValueOnce([{ name: 'Mechanika i Budowa Maszyn', shortName: 'MIBM' }]);
    const res = await request(app).put('/api/fields-of-study/f1').set('Authorization', `Bearer ${admin}`).send({ name: 'mechanika i budowa maszyn', shortName: 'MBM' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Kierunek „Mechanika i Budowa Maszyn” juz istnieje na tym wydziale');
  });

  it('specjalnosc: zmiana skrotu; duplikat nazwy na kierunku -> 409', async () => {
    prismaMock.specialization.findUnique.mockResolvedValueOnce({ id: 'sp1', fieldOfStudyId: 'f1' });
    const ok = await request(app).put('/api/specializations/sp1').set('Authorization', `Bearer ${admin}`).send({ name: 'Diagnostyka', shortName: 'DIAG' });
    expect(ok.status).toBe(200);
    prismaMock.specialization.findUnique.mockResolvedValueOnce({ id: 'sp1', fieldOfStudyId: 'f1' });
    prismaMock.specialization.findMany.mockResolvedValueOnce([{ name: 'Zarządzanie', shortName: 'ZAR' }]);
    const clash = await request(app).put('/api/specializations/sp1').set('Authorization', `Bearer ${admin}`).send({ name: 'Zarzadzanie', shortName: 'Z' });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toBe('Specjalnosc „Zarządzanie” juz istnieje na tym kierunku');
  });

  it('dodanie kierunku: nazwa innej wielkosci liter albo zajety skrot -> 409, bez zapisu', async () => {
    const body = { name: 'transport', shortName: 'TRX', facultyId: 'wn' };
    prismaMock.fieldOfStudy.findMany.mockResolvedValueOnce([{ name: 'Transport', shortName: 'TR' }]);
    const byName = await request(app).post('/api/fields-of-study').set('Authorization', `Bearer ${admin}`).send(body);
    expect(byName.status).toBe(409);
    expect(byName.body.error).toBe('Kierunek „Transport” juz istnieje na tym wydziale');
    prismaMock.fieldOfStudy.findMany.mockResolvedValueOnce([{ name: 'Transport', shortName: 'TR' }]);
    const byShort = await request(app).post('/api/fields-of-study').set('Authorization', `Bearer ${admin}`).send({ ...body, name: 'Logistyka', shortName: 'tr' });
    expect(byShort.status).toBe(409);
    expect(byShort.body.error).toBe('Skrot TR ma juz kierunek „Transport” na tym wydziale');
    expect(prismaMock.fieldOfStudy.create).not.toHaveBeenCalled();
  });

  it('dodanie specjalnosci z zajetym skrotem -> 409; nowa — zapisana', async () => {
    prismaMock.specialization.findMany.mockResolvedValueOnce([{ name: 'Diagnostyka', shortName: 'DUT' }]);
    const clash = await request(app).post('/api/specializations').set('Authorization', `Bearer ${admin}`).send({ name: 'Inna', shortName: 'dut', fieldOfStudyId: 'f1' });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatch(/Skrot DUT ma juz specjalnosc/);
    const ok = await request(app).post('/api/specializations').set('Authorization', `Bearer ${admin}`).send({ name: 'Inna', shortName: 'INN', fieldOfStudyId: 'f1' });
    expect(ok.status).toBe(201);
  });
});
