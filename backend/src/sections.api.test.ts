import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Testy HTTP obsady — Prisma mockowana: uprawnienia wydzialu i walidacja godzin.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn().mockResolvedValue({ facultyId: 'wm' }) },
  academicTerm: {
    findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 't1', startYear: 2026, type: 'SUMMER' }),
    findUnique: vi.fn().mockResolvedValue({ id: 't1', startYear: 2026, type: 'SUMMER' }),
  },
  instructor: {
    findMany: vi.fn().mockResolvedValue([{ id: 'i1', email: 'jan@umg.edu.pl' }]),
    count: vi.fn((args: { where: { id: { in: string[] } } }) => Promise.resolve(args.where.id.in.length)),
  },
  cohort: { findMany: vi.fn().mockResolvedValue([]) },
  termCalendar: { findMany: vi.fn().mockResolvedValue([]) },
  classSection: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  sectionInstructor: { deleteMany: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn().mockResolvedValue([]),
}));
vi.mock('./lib/prisma', () => ({ prisma: prismaMock }));
// Blokada zapisow planu (services/planLock) — testowana osobno; tu przepuszczamy.
vi.mock('./middleware/planLocked', async (orig) => ({
  ...(await orig<typeof import('./middleware/planLocked')>()),
  planLocked: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

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

const put = (token: string, assignments: unknown) =>
  request(app).put('/api/sections/s1/instructors').set('Authorization', `Bearer ${token}`).send({ assignments });

describe('API — obsada zajec', () => {
  it('student nie zmienia obsady -> 403', async () => {
    expect((await put(student, [])).status).toBe(403);
  });

  it('zajecia innego wydzialu -> 403', async () => {
    prismaMock.classSection.findUnique.mockResolvedValueOnce({ id: 's1', facultyId: 'inny', hours: 30 });
    expect((await put(dean, [{ instructorId: 'i1', hours: 30 }])).status).toBe(403);
  });

  it('suma godzin wieksza niz zajecia -> 400', async () => {
    prismaMock.classSection.findUnique.mockResolvedValueOnce({ id: 's1', facultyId: 'wm', hours: 30 });
    const res = await put(dean, [
      { instructorId: 'i1', hours: 20 },
      { instructorId: 'i2', hours: 15 },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/przekracza/);
  });

  it('ten sam prowadzacy dwa razy -> 400', async () => {
    prismaMock.classSection.findUnique.mockResolvedValueOnce({ id: 's1', facultyId: 'wm', hours: 30 });
    const res = await put(dean, [
      { instructorId: 'i1', hours: 10 },
      { instructorId: 'i1', hours: 10 },
    ]);
    expect(res.status).toBe(400);
  });

  it('podzial godzin z NN — zapis i komunikat o brakach', async () => {
    prismaMock.classSection.findUnique.mockResolvedValueOnce({ id: 's1', facultyId: 'wm', hours: 30 });
    const res = await put(dean, [
      { instructorId: 'i1', hours: 15 },
      { instructorId: null, hours: 10 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/brakuje 5 h/);
  });

  it('prowadzacy usuniety w miedzyczasie -> 409 z prosba o odswiezenie, bez zapisu', async () => {
    prismaMock.classSection.findUnique.mockResolvedValueOnce({ id: 's1', facultyId: 'wm', hours: 30 });
    prismaMock.instructor.count.mockResolvedValueOnce(0);
    const before = prismaMock.$transaction.mock.calls.length;
    const res = await put(dean, [{ instructorId: 'i-usuniety', hours: 30 }]);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/zostal usuniety/);
    expect(prismaMock.$transaction.mock.calls.length).toBe(before);
  });

  it('kalendarz rocznika w archiwum -> 409, obsada bez zmian', async () => {
    prismaMock.classSection.findUnique.mockResolvedValueOnce({ id: 's1', facultyId: 'wm', hours: 30, termId: 't1', cohortId: 'c1' });
    prismaMock.cohort.findMany.mockResolvedValueOnce([cohortRow]);
    prismaMock.termCalendar.findMany.mockResolvedValueOnce([calendarRow('ARCHIVED')]);
    const before = prismaMock.$transaction.mock.calls.length;
    const res = await put(dean, [{ instructorId: 'i1', hours: 30 }]);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/w archiwum — obsada tylko do odczytu/);
    expect(prismaMock.$transaction.mock.calls.length).toBe(before);
  });
});

describe('API — import obsady z CSV', () => {
  const header = 'id_zajec;rocznik;semestr;przedmiot;forma;grupa;godziny;prowadzacy_email;godziny_prowadzacego';
  const section = (id: string) => ({ id, termId: 't1', facultyId: 'wm', cohortId: 'c1', hours: 30 });

  it('blad w jednym wierszu zajec pomija cale zajecia (bez cichej utraty godzin)', async () => {
    prismaMock.classSection.findMany.mockResolvedValueOnce([section('s1'), section('s2')]);
    const csv = [header, 's1;X;1;P;wyklad;G;30;jan@umg.edu.pl;25', 's1;X;1;P;wyklad;G;30;literowka@umg.edu.pl;5', 's2;X;1;P;wyklad;G;30;NN;30'].join('\n');
    const res = await request(app).post('/api/terms/2026-L/sections/import').set('Authorization', `Bearer ${dean}`).send({ csv, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.data.applied).toBe(1);
    expect(res.body.message).toBe('Do wczytania: 1 zajecia');
    expect(res.body.data.errors).toEqual([
      'Wiersz 3: nie ma prowadzacego literowka@umg.edu.pl',
      'Wiersze 2, 3 (P · wyklad · G): zajecia pominiete w calosci — popraw bledne wiersze (3), obsada zostaje bez zmian',
    ]);
  });

  it('za duzo godzin i zajecia spoza semestru — komunikat z wierszem i opisem z pliku, nie z id', async () => {
    prismaMock.classSection.findMany.mockResolvedValueOnce([section('s1')]);
    const csv = [header, 's1;X;1;Nawigacja;laboratorium;NAW-1-L-E1;30;jan@umg.edu.pl;40', 'obce;X;1;Fizyka;wyklad;F-1-W;30;NN;30'].join('\n');
    const res = await request(app).post('/api/terms/2026-L/sections/import').set('Authorization', `Bearer ${dean}`).send({ csv, dryRun: true });
    expect(res.body.data.applied).toBe(0);
    expect(res.body.data.errors).toEqual([
      'Wiersz 2 (Nawigacja · laboratorium · NAW-1-L-E1): suma godzin prowadzacych 40 h przekracza godziny zajec (30 h)',
      'Wiersz 3 (Fizyka · wyklad · F-1-W): zajecia nie naleza do tego semestru/wydzialu',
    ]);
  });
});
