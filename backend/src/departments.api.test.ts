import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Katedry i katedra prowadzacego — Prisma mockowana, testy bez bazy.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => {
  const mock = {
    department: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    faculty: { findUnique: vi.fn() },
    instructor: {
      count: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    // Transakcja interaktywna dostaje ten sam mock jako `tx`.
    $transaction: vi.fn(),
  };
  mock.$transaction.mockImplementation((fn: (tx: typeof mock) => unknown) => fn(mock));
  return mock;
});
vi.mock('./lib/prisma', () => ({ prisma: prismaMock }));

import { createApp } from './index';
import { signAccessToken } from './lib/jwt';

const app = createApp();
let admin: string;
let dean: string;

beforeAll(() => {
  admin = signAccessToken({ sub: 'u-admin', role: 'ADMIN' });
  dean = signAccessToken({ sub: 'u-dean', role: 'DEAN_OFFICE', facultyId: 'f-wm' });
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock));
  prismaMock.department.findFirst.mockResolvedValue(null);
  prismaMock.faculty.findUnique.mockResolvedValue({ id: 'f-we' });
  prismaMock.instructor.findFirst.mockResolvedValue(null);
  prismaMock.instructor.updateMany.mockResolvedValue({ count: 0 });
});

const WE = { id: 'f-we', name: 'Wydzial Elektryczny', shortName: 'WE' };
const keo = (c: object = {}) => ({
  id: 'd-keo',
  name: 'Katedra Elektroenergetyki Okretowej',
  shortName: 'KEO',
  facultyId: 'f-we',
  faculty: WE,
  _count: { instructors: 0 },
  ...c,
});
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('API — katedry: uprawnienia', () => {
  it('dziekanat widzi liste katedr', async () => {
    prismaMock.department.findMany.mockResolvedValueOnce([keo()]);
    const res = await request(app).get('/api/departments').set(as(dean));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('dziekanat nie zaklada katedr (zmiany tylko admin, jak prowadzacy)', async () => {
    const res = await request(app).post('/api/departments').set(as(dean)).send({ name: 'Katedra X', shortName: 'KX' });
    expect(res.status).toBe(403);
    expect(prismaMock.department.create).not.toHaveBeenCalled();
  });
});

describe('API — zakladanie i zmiana katedry', () => {
  it('skrot zajety w tym samym wydziale (bez wielkosci liter) -> 409 z oznaczeniem katedry', async () => {
    prismaMock.department.findFirst.mockResolvedValueOnce(keo());
    const res = await request(app).post('/api/departments').set(as(admin)).send({ name: 'Inna', shortName: 'keo', facultyId: 'f-we' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('KEO-WE');
    expect(prismaMock.department.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ shortName: { equals: 'keo', mode: 'insensitive' }, facultyId: 'f-we' }) }),
    );
    expect(prismaMock.department.create).not.toHaveBeenCalled();
  });

  it('jednostka bez wydzialu sprawdza skrot wsrod jednostek bez wydzialu', async () => {
    prismaMock.department.create.mockResolvedValueOnce(keo({ id: 'd-sjo', name: 'Studium Jezykow Obcych', shortName: 'SJO', facultyId: null, faculty: null }));
    const res = await request(app).post('/api/departments').set(as(admin)).send({ name: 'Studium Jezykow Obcych', shortName: 'SJO' });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Katedra SJO utworzona');
    expect(prismaMock.department.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ facultyId: null }) }));
    expect(prismaMock.department.create).toHaveBeenCalledWith(expect.objectContaining({ data: { name: 'Studium Jezykow Obcych', shortName: 'SJO', facultyId: null } }));
  });

  it('nieistniejacy wydzial -> 400', async () => {
    prismaMock.faculty.findUnique.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/departments').set(as(admin)).send({ name: 'Katedra X', shortName: 'KX', facultyId: 'f-brak' });
    expect(res.status).toBe(400);
    expect(prismaMock.department.create).not.toHaveBeenCalled();
  });

  it('przeniesienie katedry na inny wydzial przenosi jej prowadzacych', async () => {
    prismaMock.department.findUnique.mockResolvedValueOnce(keo());
    prismaMock.department.update.mockResolvedValueOnce(keo({ facultyId: 'f-wm', faculty: { id: 'f-wm', name: 'Wydzial Mechaniczny', shortName: 'WM' } }));
    const res = await request(app).put('/api/departments/d-keo').set(as(admin)).send({ facultyId: 'f-wm' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Katedra KEO-WM zaktualizowana');
    expect(prismaMock.instructor.updateMany).toHaveBeenCalledWith({ where: { departmentId: 'd-keo' }, data: { facultyId: 'f-wm' } });
  });

  it('katedra zmieniona na miedzywydzialowa zostawia prowadzacym ich wydzial', async () => {
    prismaMock.department.findUnique.mockResolvedValueOnce(keo());
    prismaMock.department.update.mockResolvedValueOnce(keo({ facultyId: null, faculty: null }));
    const res = await request(app).put('/api/departments/d-keo').set(as(admin)).send({ facultyId: null });
    expect(res.status).toBe(200);
    expect(prismaMock.instructor.updateMany).not.toHaveBeenCalled();
  });
});

describe('API — usuwanie katedry', () => {
  it('katedra z prowadzacymi -> 409, prowadzacy nie traca katedry po cichu', async () => {
    prismaMock.department.findUnique.mockResolvedValueOnce(keo({ _count: { instructors: 3 } }));
    const res = await request(app).delete('/api/departments/d-keo').set(as(admin));
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('3 prowadzacych');
    expect(prismaMock.department.delete).not.toHaveBeenCalled();
  });

  it('pusta katedra jest usuwana', async () => {
    prismaMock.department.findUnique.mockResolvedValueOnce(keo());
    prismaMock.department.delete.mockResolvedValueOnce({ id: 'd-keo' });
    const res = await request(app).delete('/api/departments/d-keo').set(as(admin));
    expect(res.status).toBe(200);
    expect(prismaMock.department.delete).toHaveBeenCalledWith({ where: { id: 'd-keo' } });
  });
});

describe('API — sklad katedry', () => {
  it('prowadzacy usuniety w miedzyczasie -> 409, nic sie nie zmienia', async () => {
    prismaMock.department.findUnique.mockResolvedValueOnce(keo());
    prismaMock.instructor.count.mockResolvedValueOnce(1);
    const res = await request(app).put('/api/departments/d-keo/instructors').set(as(admin)).send({ instructorIds: ['i1', 'i2'] });
    expect(res.status).toBe(409);
    expect(prismaMock.instructor.updateMany).not.toHaveBeenCalled();
  });

  it('odpina spoza listy, przypina z listy i nadaje wydzial katedry', async () => {
    prismaMock.department.findUnique.mockResolvedValueOnce(keo());
    prismaMock.instructor.count.mockResolvedValueOnce(2);
    prismaMock.instructor.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 2 });
    const res = await request(app).put('/api/departments/d-keo/instructors').set(as(admin)).send({ instructorIds: ['i1', 'i2', 'i1'] });
    expect(res.status).toBe(200);
    expect(prismaMock.instructor.updateMany).toHaveBeenNthCalledWith(1, {
      where: { departmentId: 'd-keo', id: { notIn: ['i1', 'i2'] } },
      data: { departmentId: null },
    });
    expect(prismaMock.instructor.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ['i1', 'i2'] } },
      data: { departmentId: 'd-keo', facultyId: 'f-we' },
    });
    expect(res.body.message).toBe('Sklad katedry KEO-WE: 2 prowadzacych (bez tej katedry: 1)');
  });

  it('jednostka miedzywydzialowa nie zmienia wydzialu prowadzacych', async () => {
    prismaMock.department.findUnique.mockResolvedValueOnce(keo({ id: 'd-sjo', shortName: 'SJO', facultyId: null, faculty: null }));
    prismaMock.instructor.count.mockResolvedValueOnce(1);
    const res = await request(app).put('/api/departments/d-sjo/instructors').set(as(admin)).send({ instructorIds: ['i1'] });
    expect(res.status).toBe(200);
    expect(prismaMock.instructor.updateMany).toHaveBeenNthCalledWith(2, { where: { id: { in: ['i1'] } }, data: { departmentId: 'd-sjo' } });
  });
});

describe('API — katedra prowadzacego', () => {
  it('katedra wydzialowa ustala wydzial nowego prowadzacego', async () => {
    prismaMock.department.findUnique.mockResolvedValueOnce({ facultyId: 'f-we' });
    prismaMock.instructor.create.mockResolvedValueOnce({ id: 'i1' });
    const res = await request(app)
      .post('/api/instructors')
      .set(as(admin))
      .send({ firstName: 'Jan', lastName: 'Kowalski', email: 'j.kowalski@umg.edu.pl', facultyId: 'f-wm', departmentId: 'd-keo' });
    expect(res.status).toBe(201);
    expect(prismaMock.instructor.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ departmentId: 'd-keo', facultyId: 'f-we' }),
    });
  });

  it('nieistniejaca katedra -> 400', async () => {
    prismaMock.department.findUnique.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/instructors')
      .set(as(admin))
      .send({ firstName: 'Jan', lastName: 'Kowalski', email: 'j.kowalski@umg.edu.pl', departmentId: 'd-brak' });
    expect(res.status).toBe(400);
    expect(prismaMock.instructor.create).not.toHaveBeenCalled();
  });

  it('zmiana samego wydzialu nie rozjezdza sie z dotychczasowa katedra', async () => {
    prismaMock.instructor.findUnique.mockResolvedValueOnce({ departmentId: 'd-keo' });
    prismaMock.department.findUnique.mockResolvedValueOnce({ facultyId: 'f-we' });
    prismaMock.instructor.update.mockResolvedValueOnce({ id: 'i1' });
    const res = await request(app).put('/api/instructors/i1').set(as(admin)).send({ facultyId: 'f-wm' });
    expect(res.status).toBe(200);
    expect(prismaMock.instructor.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: expect.objectContaining({ facultyId: 'f-we' }) });
  });

  it('null odpina katedre i wydzial', async () => {
    prismaMock.instructor.update.mockResolvedValueOnce({ id: 'i1' });
    const res = await request(app).put('/api/instructors/i1').set(as(admin)).send({ facultyId: null, departmentId: null });
    expect(res.status).toBe(200);
    expect(prismaMock.instructor.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: expect.objectContaining({ facultyId: null, departmentId: null }),
    });
    expect(prismaMock.department.findUnique).not.toHaveBeenCalled();
  });
});
