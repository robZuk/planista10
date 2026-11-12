import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Testy HTTP rocznika w semestrze — Prisma mockowana: semestr w archiwum jest tylko do odczytu.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn().mockResolvedValue({ facultyId: 'wm' }) },
  academicTerm: { findUnique: vi.fn().mockResolvedValue({ id: 't1', startYear: 2026, type: 'SUMMER' }) },
  cohort: { findUnique: vi.fn(), findMany: vi.fn() },
  termCalendar: { findMany: vi.fn(), findUnique: vi.fn() },
  cohortTerm: { upsert: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue(null) },
  program: { findUnique: vi.fn() },
  txCohortCreate: vi.fn((args: { data: object }) => Promise.resolve({ id: 'c-new', ...args.data })),
  $transaction: vi.fn(),
  studentGroup: {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn((args: { data: object }) => Promise.resolve({ id: 'g-new', ...args.data })),
  },
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

beforeAll(() => {
  dean = signAccessToken({ sub: 'u-dean', role: 'DEAN_OFFICE' });
});

const put = (body: unknown) =>
  request(app).put('/api/terms/2026-L/cohorts/c1').set('Authorization', `Bearer ${dean}`).send(body);

describe('API — rocznik w semestrze', () => {
  it('kalendarz rocznika w archiwum -> 409, bez zapisu', async () => {
    prismaMock.cohort.findUnique.mockResolvedValueOnce(cohortRow);
    prismaMock.cohort.findMany.mockResolvedValueOnce([cohortRow]);
    prismaMock.termCalendar.findMany.mockResolvedValueOnce([calendarRow('ARCHIVED')]);
    const res = await put({ semester: 3 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/w archiwum/);
    expect(prismaMock.cohortTerm.upsert).not.toHaveBeenCalled();
  });

  it('wybor kalendarza z archiwum -> 409', async () => {
    prismaMock.cohort.findUnique.mockResolvedValueOnce(cohortRow);
    prismaMock.cohort.findMany.mockResolvedValueOnce([cohortRow]);
    prismaMock.termCalendar.findMany.mockResolvedValueOnce([calendarRow('PUBLISHED')]);
    prismaMock.termCalendar.findUnique.mockResolvedValueOnce({ ...calendarRow('ARCHIVED'), id: 'cal2', name: 'Stary' });
    const res = await put({ calendarId: 'cal2' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Kalendarz jest w archiwum/);
    expect(prismaMock.cohortTerm.upsert).not.toHaveBeenCalled();
  });

  it('kalendarz nie w archiwum — zmiana zapisana', async () => {
    prismaMock.cohort.findUnique.mockResolvedValueOnce(cohortRow);
    prismaMock.cohort.findMany.mockResolvedValueOnce([cohortRow]);
    prismaMock.termCalendar.findMany.mockResolvedValueOnce([calendarRow('PUBLISHED')]);
    prismaMock.termCalendar.findUnique.mockResolvedValueOnce({ ...calendarRow('PLANNING'), id: 'cal2', name: 'Wariant B' });
    const res = await put({ calendarId: 'cal2' });
    expect(res.status).toBe(200);
    expect(prismaMock.cohortTerm.upsert).toHaveBeenCalledTimes(1);
  });

  it('zmiana kalendarza zapisuje czas zmiany (terminy nieaktualne); ten sam stan — bez znacznika', async () => {
    prismaMock.cohort.findUnique.mockResolvedValueOnce(cohortRow);
    prismaMock.cohort.findMany.mockResolvedValueOnce([cohortRow]);
    prismaMock.termCalendar.findMany.mockResolvedValueOnce([calendarRow('PUBLISHED')]);
    prismaMock.termCalendar.findUnique.mockResolvedValueOnce({ ...calendarRow('PLANNING'), id: 'cal2', name: 'Wariant B' });
    prismaMock.cohortTerm.findUnique.mockResolvedValueOnce({ semester: 4, calendarId: 'cal1' });
    prismaMock.cohortTerm.upsert.mockClear();
    expect((await put({ calendarId: 'cal2' })).status).toBe(200);
    expect(prismaMock.cohortTerm.upsert.mock.calls[0]![0].update).toMatchObject({ calendarId: 'cal2', changedAt: expect.any(Date) });

    prismaMock.cohort.findUnique.mockResolvedValueOnce(cohortRow);
    prismaMock.cohort.findMany.mockResolvedValueOnce([cohortRow]);
    prismaMock.termCalendar.findMany.mockResolvedValueOnce([calendarRow('PUBLISHED')]);
    prismaMock.termCalendar.findUnique.mockResolvedValueOnce({ ...calendarRow('PUBLISHED'), id: 'cal1' });
    prismaMock.cohortTerm.findUnique.mockResolvedValueOnce({ semester: 4, calendarId: 'cal1' });
    prismaMock.cohortTerm.upsert.mockClear();
    expect((await put({ calendarId: 'cal1' })).status).toBe(200);
    expect(prismaMock.cohortTerm.upsert.mock.calls[0]![0].update).not.toHaveProperty('changedAt');
  });
});

describe('API — nowa grupa: liczebnosc i zakres semestrow', () => {
  const post = (body: object) =>
    request(app).post('/api/cohorts/c1/groups').set('Authorization', `Bearer ${dean}`).send({ parentId: 'root', partitionKey: 'C', ...body });
  const arrange = () => {
    prismaMock.cohort.findUnique.mockResolvedValueOnce(cohortRow);
    prismaMock.studentGroup.findUnique.mockResolvedValueOnce({ id: 'root', cohortId: 'c1', partitionKey: 'ROOT', code: null, specializationId: null });
    prismaMock.studentGroup.create.mockClear();
  };

  it.each([
    [{ size: 30, fromSemester: 0 }, /poczatku grupy musi byc w zakresie 1-7/],
    [{ size: 30, fromSemester: 9 }, /poczatku grupy musi byc w zakresie 1-7/],
    [{ size: -5, fromSemester: 1 }, /Liczebnosc/],
    [{ size: 12.5, fromSemester: 1 }, /Liczebnosc/],
    [{ size: 30, fromSemester: 3, toSemester: 8 }, /konca grupy musi byc w zakresie 3-7/],
  ])('%o -> 400 bez zapisu', async (body, message) => {
    arrange();
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(prismaMock.studentGroup.create).not.toHaveBeenCalled();
  });

  it('poprawna grupa jest zapisana', async () => {
    arrange();
    const res = await post({ size: 30, fromSemester: 3 });
    expect(res.status).toBe(201);
    expect(prismaMock.studentGroup.create).toHaveBeenCalledTimes(1);
  });
});

describe('API — nowy nabor', () => {
  it('przejmuje tryb wykladow (wspolne dla rocznika) z poprzedniego naboru', async () => {
    prismaMock.program.findUnique.mockResolvedValueOnce({ id: 'p1', fieldOfStudy: { facultyId: 'wm' }, versions: [{ id: 'v1', status: 'APPROVED' }] });
    prismaMock.cohort.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(cohortRow);
    prismaMock.cohort.findMany.mockResolvedValueOnce([
      { id: 'prev', programId: 'p1', programVersionId: 'v1', lectureMode: 'JOINT', startTerm: { startYear: 2025, type: 'WINTER' } },
    ]);
    prismaMock.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ cohort: { create: prismaMock.txCohortCreate }, studentGroup: { create: vi.fn().mockResolvedValue({ id: 'root' }) } }),
    );
    const res = await request(app)
      .post('/api/cohorts')
      .set('Authorization', `Bearer ${dean}`)
      .send({ programId: 'p1', startTermKey: '2026-L', copyStructure: false });
    expect(res.status).toBe(201);
    expect(prismaMock.txCohortCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ lectureMode: 'JOINT', programVersionId: 'v1' }) });
  });
});
