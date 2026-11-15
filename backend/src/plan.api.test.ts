import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Testy HTTP planu — Prisma mockowana: uprawnienia, walidacja wejscia, terminy reczne.
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn().mockResolvedValue({ facultyId: 'wm' }) },
  academicTerm: {
    findUnique: vi.fn().mockResolvedValue({ id: 't1', startYear: 2026, type: 'SUMMER' }),
    findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 't1', startYear: 2026, type: 'SUMMER' }),
  },
  cohort: { findMany: vi.fn().mockResolvedValue([]) },
  termCalendar: { findMany: vi.fn().mockResolvedValue([]) },
  timeGrid: { findUnique: vi.fn() },
  classSection: { findUnique: vi.fn() },
  occurrence: {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
    update: vi.fn((args: unknown) => ({ op: 'occurrence.update', args })),
    updateMany: vi.fn((args: unknown) => ({ op: 'occurrence.updateMany', args })),
  },
  placement: { findUnique: vi.fn(), delete: vi.fn((args: unknown) => ({ op: 'placement.delete', args })) },
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

describe('API — plan', () => {
  it('prowadzacy nie czyta planu w ukladaniu ani listy terminow rocznika -> 403', async () => {
    const instructor = signAccessToken({ sub: 'u-i', role: 'INSTRUCTOR' });
    for (const path of ['/api/terms/2026-L/plan?cohortId=c1', '/api/terms/2026-L/occurrences?cohortId=c1']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${instructor}`);
      expect(res.status).toBe(403);
    }
  });

  it('odwolac, przeniesc albo dodac termin moze tylko planista — prowadzacy i student -> 403', async () => {
    const instructor = signAccessToken({ sub: 'u-i', role: 'INSTRUCTOR' });
    prismaMock.occurrence.findUnique.mockClear();
    for (const token of [instructor, student]) {
      for (const call of [
        request(app).put('/api/occurrences/o1').set('Authorization', `Bearer ${token}`).send({ action: 'CANCEL', note: 'choroba' }),
        request(app).put('/api/occurrences/o1').set('Authorization', `Bearer ${token}`).send({ action: 'MODIFY', date: '2026-03-10' }),
        request(app).post('/api/terms/2026-L/occurrences').set('Authorization', `Bearer ${token}`).send({ sectionId: 's1' }),
        request(app).delete('/api/occurrences/o1').set('Authorization', `Bearer ${token}`),
      ]) {
        const res = await call;
        expect(res.status).toBe(403);
      }
    }
    expect(prismaMock.occurrence.findUnique).not.toHaveBeenCalled();
  });

  it('nie ma juz zgloszen zmian ani powiadomien — dawne trasy -> 404', async () => {
    const instructor = signAccessToken({ sub: 'u-i', role: 'INSTRUCTOR' });
    for (const call of [
      request(app).post('/api/occurrences/o1/requests').set('Authorization', `Bearer ${instructor}`).send({ kind: 'CANCEL', reason: 'choroba' }),
      request(app).get('/api/terms/2026-L/requests').set('Authorization', `Bearer ${dean}`),
      request(app).get('/api/change-requests/pending-count').set('Authorization', `Bearer ${dean}`),
      request(app).get('/api/notifications').set('Authorization', `Bearer ${instructor}`),
    ]) {
      const res = await call;
      expect(res.status).toBe(404);
    }
  });

  it('liste "Do odrobienia" widzi tylko planista; dziekanat — swojego wydzialu, ze stanem odrobienia', async () => {
    const instructor = signAccessToken({ sub: 'u-i', role: 'INSTRUCTOR' });
    const denied = await request(app).get('/api/terms/2026-L/makeups').set('Authorization', `Bearer ${instructor}`);
    expect(denied.status).toBe(403);

    const cancelled = (id: string) => ({
      id,
      date: new Date('2026-03-10T00:00:00Z'),
      startMinute: 480,
      endMinute: 570,
      startOrder: 1,
      endOrder: 2,
      groupId: 'g1',
      note: 'choroba',
      instructor: { title: 'dr', firstName: 'Jan', lastName: 'Nowak' },
      section: { id: 's1', classType: 'LAB', cohortId: 'c1', programEntry: { subject: { name: 'Fizyka' } }, cohort: { program: { code: 'EDST-S1' } } },
    });
    prismaMock.occurrence.findMany
      .mockResolvedValueOnce([cancelled('o1'), cancelled('o2')])
      .mockResolvedValueOnce([{ makeupOfId: 'o2', date: new Date('2026-03-17T00:00:00Z'), startMinute: 480, endMinute: 570 }]);
    const res = await request(app).get('/api/terms/2026-L/makeups').set('Authorization', `Bearer ${dean}`);
    expect(res.status).toBe(200);
    expect(prismaMock.occurrence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ termId: 't1', status: 'CANCELLED', facultyId: 'wm' }) }),
    );
    expect(res.body.data.map((m: { occurrenceId: string; state: string }) => [m.occurrenceId, m.state])).toEqual([
      ['o1', 'TODO'],
      ['o2', 'MADE_UP'],
    ]);
    expect(res.body.data[1].makeup).toEqual({ date: '2026-03-17', time: '08:00–09:30' });
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

  it('umieszczenie z numerami tygodni spoza zakresu -> 400 (np. 100 000 numerow)', async () => {
    const res = await request(app)
      .post('/api/terms/2026-L/placements')
      .set('Authorization', `Bearer ${dean}`)
      .send({ sectionId: 's1', dayOfWeek: 'MONDAY', startOrder: 1, endOrder: 2, online: true, pattern: 'LIST', numbers: [1, 2, 999] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Numery tygodni i zjazdow musza byc od 1 do 60');
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

  // Studia stacjonarne: ten sam plan w kazdym tygodniu — terminy tylko do wgladu (bez odwolan,
  // przeniesien i odrobien; zmiana planu od tygodnia idzie przez wzorzec). `cohortRow` jest
  // stacjonarny, jego kalendarz opublikowany.
  const stationaryCohort = () => {
    prismaMock.cohort.findMany.mockResolvedValueOnce([cohortRow]);
    prismaMock.termCalendar.findMany.mockResolvedValueOnce([calendarRow('PUBLISHED')]);
  };

  it('odwolanie albo przeniesienie terminu rocznika stacjonarnego -> 409, bez zapisu', async () => {
    for (const body of [{ action: 'CANCEL', note: 'choroba' }, { action: 'MODIFY', date: '2027-03-10' }]) {
      prismaMock.occurrence.findUnique.mockResolvedValueOnce({
        id: 'o1',
        facultyId: 'wm',
        termId: 't1',
        kind: 'DERIVED',
        placement: null,
        section: { cohortId: 'c1' },
      });
      stationaryCohort();
      const before = prismaMock.$transaction.mock.calls.length;
      const res = await request(app).put('/api/occurrences/o1').set('Authorization', `Bearer ${dean}`).send(body);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/Studia stacjonarne: terminy sa tylko do wgladu/);
      expect(prismaMock.$transaction.mock.calls.length).toBe(before);
    }
  });

  it('termin reczny (odrobienie) dla rocznika stacjonarnego -> 409', async () => {
    prismaMock.classSection.findUnique.mockResolvedValueOnce({ id: 's1', termId: 't1', facultyId: 'wm', cohortId: 'c1' });
    stationaryCohort();
    const res = await request(app)
      .post('/api/terms/2026-L/occurrences')
      .set('Authorization', `Bearer ${dean}`)
      .send({ sectionId: 's1', date: '2027-03-10', startOrder: 1, endOrder: 2, online: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Studia stacjonarne/);
  });

  it('usuniecie terminu recznego rocznika stacjonarnego -> 409, bez usuniecia', async () => {
    prismaMock.occurrence.findUnique.mockResolvedValueOnce({ id: 'o1', facultyId: 'wm', termId: 't1', kind: 'MANUAL', section: { cohortId: 'c1' } });
    stationaryCohort();
    const before = prismaMock.occurrence.delete.mock.calls.length;
    const res = await request(app).delete('/api/occurrences/o1').set('Authorization', `Bearer ${dean}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Studia stacjonarne/);
    expect(prismaMock.occurrence.delete.mock.calls.length).toBe(before);
  });

  it('rocznik niestacjonarny dalej odwoluje termin -> 200', async () => {
    const partTime = { ...cohortRow, program: { ...cohortRow.program, code: 'EDST-N1', studyMode: 'PART_TIME' } };
    prismaMock.occurrence.findUnique.mockResolvedValueOnce({
      id: 'o1',
      facultyId: 'wm',
      termId: 't1',
      kind: 'MANUAL',
      placement: null,
      originalDate: null,
      note: null,
      section: { cohortId: 'c1' },
    });
    prismaMock.cohort.findMany.mockResolvedValueOnce([partTime]);
    prismaMock.termCalendar.findMany.mockResolvedValueOnce([{ ...calendarRow('PUBLISHED'), studyMode: 'PART_TIME' }]);
    prismaMock.timeGrid.findUnique.mockResolvedValueOnce({
      id: 'g1',
      facultyId: 'wm',
      studyMode: 'PART_TIME',
      days: [{ day: 'SATURDAY', from: null, to: null }],
      blocks: [{ id: 'b1', order: 1, startTime: '08:00', endTime: '09:00', label: '08:00-09:00' }],
    });
    const res = await request(app).put('/api/occurrences/o1').set('Authorization', `Bearer ${dean}`).send({ action: 'CANCEL', note: 'choroba' });
    expect(res.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenLastCalledWith([
      { op: 'occurrence.update', args: { where: { id: 'o1' }, data: { status: 'CANCELLED', note: 'choroba' } } },
    ]);
  });

  it('zla data "od kiedy" przy generowaniu -> 400', async () => {
    const res = await request(app)
      .post('/api/terms/2026-L/generate')
      .set('Authorization', `Bearer ${dean}`)
      .send({ fromDate: '2027-02-30' });
    expect(res.status).toBe(400);
  });
});
