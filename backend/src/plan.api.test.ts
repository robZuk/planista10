import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Testy HTTP planu — Prisma mockowana: uprawnienia, walidacja wejscia, terminy reczne.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn().mockResolvedValue({ facultyId: 'wm' }) },
  academicTerm: { findUnique: vi.fn().mockResolvedValue({ id: 't1', startYear: 2026, type: 'SUMMER' }) },
  classSection: { findUnique: vi.fn() },
  occurrence: { findUnique: vi.fn(), delete: vi.fn() },
  placement: { findUnique: vi.fn() },
}));
vi.mock('./lib/prisma', () => ({ prisma: prismaMock }));

import { createApp } from './index';
import { signAccessToken } from './lib/jwt';

const app = createApp();
let dean: string;
let student: string;

beforeAll(() => {
  dean = signAccessToken({ sub: 'u-dean', role: 'DEAN_OFFICE' });
  student = signAccessToken({ sub: 'u-st', role: 'STUDENT' });
});

describe('API — plan', () => {
  it('student nie generuje terminow -> 403', async () => {
    const res = await request(app).post('/api/terms/2026-L/generate').set('Authorization', `Bearer ${student}`).send({});
    expect(res.status).toBe(403);
  });

  it('umieszczenie bez sali/godzin -> 400', async () => {
    const res = await request(app)
      .post('/api/terms/2026-L/placements')
      .set('Authorization', `Bearer ${dean}`)
      .send({ sectionId: 's1', dayOfWeek: 'MONDAY' });
    expect(res.status).toBe(400);
  });

  it('umieszczenie zajec innego wydzialu -> 403', async () => {
    prismaMock.classSection.findUnique.mockResolvedValueOnce({ id: 's1', facultyId: 'inny' });
    const res = await request(app)
      .post('/api/terms/2026-L/placements')
      .set('Authorization', `Bearer ${dean}`)
      .send({ sectionId: 's1', dayOfWeek: 'MONDAY', startOrder: 2, endOrder: 3, roomId: 'r1' });
    expect(res.status).toBe(403);
  });

  it('terminu z wzorca nie usuwa sie (tylko odwolanie) -> 409', async () => {
    prismaMock.occurrence.findUnique.mockResolvedValueOnce({ id: 'o1', facultyId: 'wm', kind: 'DERIVED' });
    const res = await request(app).delete('/api/occurrences/o1').set('Authorization', `Bearer ${dean}`);
    expect(res.status).toBe(409);
  });

  it('zla data "od kiedy" przy generowaniu -> 400', async () => {
    const res = await request(app)
      .post('/api/terms/2026-L/generate')
      .set('Authorization', `Bearer ${dean}`)
      .send({ fromDate: '2027-02-30' });
    expect(res.status).toBe(400);
  });
});
