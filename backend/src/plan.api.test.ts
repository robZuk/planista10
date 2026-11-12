import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Testy HTTP planu — Prisma mockowana: uprawnienia, walidacja wejscia, terminy reczne.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn().mockResolvedValue({ facultyId: 'wm' }) },
  academicTerm: { findUnique: vi.fn().mockResolvedValue({ id: 't1', startYear: 2026, type: 'SUMMER' }) },
  cohort: { findMany: vi.fn().mockResolvedValue([]) },
  termCalendar: { findMany: vi.fn().mockResolvedValue([]) },
  classSection: { findUnique: vi.fn() },
  occurrence: {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
    updateMany: vi.fn((args: unknown) => ({ op: 'occurrence.updateMany', args })),
  },
  changeRequest: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn((args: unknown) => ({ op: 'changeRequest.updateMany', args })) },
  placement: { findUnique: vi.fn(), delete: vi.fn((args: unknown) => ({ op: 'placement.delete', args })) },
  $transaction: vi.fn().mockResolvedValue([]),
}));
vi.mock('./lib/prisma', () => ({ prisma: prismaMock }));

import { createApp } from './index';
import { signAccessToken } from './lib/jwt';

// Rocznik z naboru 2025 zimowego (w 2026 letnim: semestr 4) i kalendarz jego wydzialu i trybu.
const cohortRow = {
  id: 'c1',
  name: null,
  programId: 'p1',
  programVersionId: 'v1',
  lectureMode: 'JOINT',
  program: { code: 'EDST-S1', studyMode: 'FULL_TIME', fieldOfStudy: { facultyId: 'wm', shortName: 'EDST', specializations: [] } },
  programVersion: { id: 'v1', label: 'Wersja 1', status: 'APPROVED', totalSemesters: 7 },
  startTerm: { id: 't0', startYear: 2025, type: 'WINTER' },
  terms: [],
  groups: [],
};
const calendarRow = (status: string) => ({ id: 'cal1', termId: 't1', facultyId: 'wm', studyMode: 'FULL_TIME', name: 'Podstawowy', status });

const app = createApp();
let dean: string;
let student: string;

beforeAll(() => {
  dean = signAccessToken({ sub: 'u-dean', role: 'DEAN_OFFICE' });
  student = signAccessToken({ sub: 'u-st', role: 'STUDENT' });
});

describe('API — plan', () => {
  it('prowadzacy nie czyta planu w ukladaniu ani listy terminow rocznika -> 403', async () => {
    const instructor = signAccessToken({ sub: 'u-i', role: 'INSTRUCTOR' });
    for (const path of ['/api/terms/2026-L/plan?cohortId=c1', '/api/terms/2026-L/occurrences?cohortId=c1']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${instructor}`);
      expect(res.status).toBe(403);
    }
  });

  it('dziekanat WM generuje terminy rocznika innego wydzialu -> 403, a nie "0 terminow"', async () => {
    prismaMock.cohort.findMany.mockResolvedValueOnce([{ program: { fieldOfStudy: { facultyId: 'we' } } }]);
    const res = await request(app).post('/api/terms/2026-L/generate').set('Authorization', `Bearer ${dean}`).send({ dryRun: false, cohortIds: ['c-we'] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Mozesz zmieniac tylko dane swojego wydzialu');
  });

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

  it('usuniecie umieszczenia, gdy wersja programu rocznika jest w projekcie -> 409', async () => {
    prismaMock.placement.findUnique.mockResolvedValueOnce({
      id: 'p1',
      facultyId: 'wm',
      section: {
        cohort: {
          name: null,
          program: { code: 'EDST-N1' },
          programVersion: { label: 'Wersja 1', status: 'DRAFT' },
          startTerm: { startYear: 2024, type: 'WINTER' },
        },
      },
    });
    const res = await request(app).delete('/api/placements/p1').set('Authorization', `Bearer ${dean}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Wersja programu "Wersja 1" .* jest w projekcie/);
  });

  it('usuniecie umieszczenia odlacza jego terminy jawnie (czas usuniecia -> terminy nieaktualne)', async () => {
    prismaMock.placement.findUnique.mockResolvedValueOnce({
      id: 'p1',
      facultyId: 'wm',
      term: { id: 't1', startYear: 2026, type: 'SUMMER' },
      section: {
        cohort: {
          id: 'c1',
          name: null,
          program: { code: 'EDST-S1' },
          programVersion: { label: 'Wersja 1', status: 'APPROVED' },
          startTerm: { startYear: 2026, type: 'WINTER' },
        },
      },
    });
    const res = await request(app).delete('/api/placements/p1').set('Authorization', `Bearer ${dean}`);
    expect(res.status).toBe(200);
    // Najpierw odlaczenie terminow (updatedAt = chwila usuniecia), potem usuniecie — w jednej transakcji.
    expect(prismaMock.$transaction).toHaveBeenCalledWith([
      { op: 'occurrence.updateMany', args: { where: { placementId: 'p1' }, data: { placementId: null } } },
      { op: 'placement.delete', args: { where: { id: 'p1' } } },
    ]);
  });

  it('usuniecie umieszczenia przepina odrobienia i zgloszenia na klucz odlaczonego terminu', async () => {
    prismaMock.placement.findUnique.mockResolvedValueOnce({
      id: 'p1',
      facultyId: 'wm',
      term: { id: 't1', startYear: 2026, type: 'SUMMER' },
      section: {
        cohort: {
          id: 'c1',
          name: null,
          program: { code: 'EDST-S1' },
          programVersion: { label: 'Wersja 1', status: 'APPROVED' },
          startTerm: { startYear: 2026, type: 'WINTER' },
        },
      },
    });
    prismaMock.occurrence.findMany
      .mockResolvedValueOnce([
        { id: 'o1', originalDate: new Date('2027-02-22T00:00:00Z') },
        { id: 'o2', originalDate: new Date('2027-03-01T00:00:00Z') },
      ])
      .mockResolvedValueOnce([{ makeupOfKey: 'p:p1|2027-02-22' }]);
    prismaMock.changeRequest.findMany.mockResolvedValueOnce([{ occurrenceKey: 'p:p1|2027-03-01' }]);
    const res = await request(app).delete('/api/placements/p1').set('Authorization', `Bearer ${dean}`);
    expect(res.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenLastCalledWith([
      { op: 'occurrence.updateMany', args: { where: { makeupOfKey: 'p:p1|2027-02-22' }, data: { makeupOfKey: 'o:o1' } } },
      { op: 'changeRequest.updateMany', args: { where: { occurrenceKey: 'p:p1|2027-03-01' }, data: { occurrenceKey: 'o:o2' } } },
      { op: 'occurrence.updateMany', args: { where: { placementId: 'p1' }, data: { placementId: null } } },
      { op: 'placement.delete', args: { where: { id: 'p1' } } },
    ]);
  });

  it('usuniecie umieszczenia, gdy kalendarz rocznika jest w archiwum -> 409', async () => {
    prismaMock.placement.findUnique.mockResolvedValueOnce({
      id: 'p1',
      facultyId: 'wm',
      term: { id: 't1', startYear: 2026, type: 'SUMMER' },
      section: { cohort: cohortRow },
    });
    prismaMock.cohort.findMany.mockResolvedValueOnce([cohortRow]);
    prismaMock.termCalendar.findMany.mockResolvedValueOnce([calendarRow('ARCHIVED')]);
    const before = prismaMock.$transaction.mock.calls.length;
    const res = await request(app).delete('/api/placements/p1').set('Authorization', `Bearer ${dean}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/w archiwum — plan tylko do odczytu/);
    expect(prismaMock.$transaction.mock.calls.length).toBe(before);
  });

  it('zla data "od kiedy" przy generowaniu -> 400', async () => {
    const res = await request(app)
      .post('/api/terms/2026-L/generate')
      .set('Authorization', `Bearer ${dean}`)
      .send({ fromDate: '2027-02-30' });
    expect(res.status).toBe(400);
  });
});
