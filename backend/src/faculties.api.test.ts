import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Usuwanie wydzialu — czytelne blokady zamiast ogolnego bledu relacji (Prisma mockowana).
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  faculty: {
    findUnique: vi.fn(),
    delete: vi.fn().mockResolvedValue({ id: 'f1' }),
  },
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
  prismaMock.faculty.delete.mockClear();
});

const faculty = (c: object) => ({
  id: 'f1',
  _count: { fieldsOfStudy: 0, buildings: 0, instructors: 0, termCalendars: 0, users: 0, ...c },
});
const remove = () => request(app).delete('/api/faculties/f1').set('Authorization', `Bearer ${admin}`);

describe('API — usuwanie wydzialu', () => {
  it('wydzial z kalendarzem semestru -> 409 z podpowiedzia', async () => {
    prismaMock.faculty.findUnique.mockResolvedValueOnce(faculty({ termCalendars: 1 }));
    const res = await remove();
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('kalendarzami semestru');
    expect(prismaMock.faculty.delete).not.toHaveBeenCalled();
  });

  it('wydzial z kontami dziekanatu -> 409, konta nie traca wydzialu po cichu', async () => {
    prismaMock.faculty.findUnique.mockResolvedValueOnce(faculty({ users: 2 }));
    const res = await remove();
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('kontami');
    expect(prismaMock.faculty.delete).not.toHaveBeenCalled();
  });

  it('pusty wydzial jest usuwany', async () => {
    prismaMock.faculty.findUnique.mockResolvedValueOnce(faculty({}));
    const res = await remove();
    expect(res.status).toBe(200);
    expect(prismaMock.faculty.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
  });
});
