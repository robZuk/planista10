import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Testy HTTP tras semestrow i kalendarzy — Prisma mockowana, wiec sprawdzamy uprawnienia,
// walidacje wejscia i sciezki, ktore licza wynik bez bazy (swieta, podglad kalendarza).
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn().mockResolvedValue({ facultyId: 'wm' }) },
  academicTerm: {
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 't1', startYear: 2026, type: 'WINTER' }),
    delete: vi.fn().mockResolvedValue({}),
  },
  cohort: { count: vi.fn().mockResolvedValue(0) },
  classSection: { count: vi.fn().mockResolvedValue(0) },
  termCalendar: {
    count: vi.fn().mockResolvedValue(0),
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue({}),
    update: vi.fn((args: unknown) => ({ op: 'update', args })),
    findUniqueOrThrow: vi.fn(),
  },
  calendarBreak: { deleteMany: vi.fn() },
  calendarDay: { deleteMany: vi.fn() },
  zjazd: { deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('./lib/prisma', () => ({ prisma: prismaMock }));
const usageMock = vi.hoisted(() => vi.fn());
const missingPeriodsMock = vi.hoisted(() => vi.fn().mockResolvedValue({ placements: 0, numbers: [] }));
vi.mock('./services/plan', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  calendarUsage: usageMock,
  placementsWithMissingPeriods: missingPeriodsMock,
}));
// Samoczynne zmiany (zajecia, terminy) — testowane w services/autoPlan.test; tu tylko wywolania.
const noRefresh = { cohortIds: [] as string[], report: null };
const autoPlanMock = vi.hoisted(() => ({
  autoSyncTermFaculties: vi.fn(),
  refreshCalendarTerms: vi.fn(),
  changeCalendarStatus: vi.fn(),
}));
vi.mock('./services/autoPlan', async (importOriginal) => ({ ...(await importOriginal<object>()), ...autoPlanMock }));
beforeEach(() => {
  autoPlanMock.autoSyncTermFaculties.mockResolvedValue({ created: 0, reactivated: 0, hoursChanged: 0, pending: 0 });
  autoPlanMock.refreshCalendarTerms.mockResolvedValue(noRefresh);
  autoPlanMock.changeCalendarStatus.mockImplementation(async (_t: unknown, _c: unknown, _s: unknown, update: () => Promise<unknown>) => ({
    result: await update(),
    refresh: noRefresh,
  }));
});

import { createApp } from './index';
import { signAccessToken } from './lib/jwt';
import { calendarDeleteBlock } from './controllers/terms.controller';

const app = createApp();
let admin: string;
let dean: string;
let student: string;

beforeAll(() => {
  admin = signAccessToken({ sub: 'u-admin', role: 'ADMIN' });
  dean = signAccessToken({ sub: 'u-dean', role: 'DEAN_OFFICE' });
  student = signAccessToken({ sub: 'u-student', role: 'STUDENT' });
});

const validCalendar = {
  studyMode: 'FULL_TIME',
  kind: 'WEEKLY',
  startDate: '2026-10-01',
  endDate: '2027-01-31',
  breaks: [{ name: 'Przerwa swiateczna', startDate: '2026-12-23', endDate: '2027-01-01' }],
};

describe('API — usuwanie semestru', () => {
  const term = { id: 't-27z', startYear: 2027, type: 'WINTER' };

  it('tylko admin', async () => {
    const res = await request(app).delete('/api/terms/2027-Z').set('Authorization', `Bearer ${dean}`);
    expect(res.status).toBe(403);
  });

  it('pusty semestr usuwa', async () => {
    prismaMock.academicTerm.findUnique.mockResolvedValueOnce(term);
    const res = await request(app).delete('/api/terms/2027-Z').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Usunieto semestr 2027/28 zimowy');
    expect(prismaMock.academicTerm.delete).toHaveBeenCalledWith({ where: { id: 't-27z' } });
  });

  it('semestr z naborem rocznikow nie znika — komunikat mowi dlaczego', async () => {
    prismaMock.academicTerm.findUnique.mockResolvedValueOnce(term);
    prismaMock.cohort.count.mockResolvedValueOnce(3);
    const res = await request(app).delete('/api/terms/2027-Z').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('roczniki (3)');
  });

  it('semestr z kalendarzami — najpierw kalendarze', async () => {
    prismaMock.academicTerm.findUnique.mockResolvedValueOnce(term);
    prismaMock.termCalendar.count.mockResolvedValueOnce(2);
    const res = await request(app).delete('/api/terms/2027-Z').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('kalendarze wydzialow (2)');
  });
});

describe('API — semestry', () => {
  it('lista semestrow wymaga zalogowania', async () => {
    const res = await request(app).get('/api/terms');
    expect(res.status).toBe(401);
  });

  it('zakladanie semestru tylko dla admina', async () => {
    const res = await request(app)
      .post('/api/terms')
      .set('Authorization', `Bearer ${dean}`)
      .send({ startYear: 2027, type: 'WINTER' });
    expect(res.status).toBe(403);
  });

  it('zly klucz semestru -> 400', async () => {
    const res = await request(app).get('/api/terms/2026-X/calendars').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(400);
  });

  it('swieta ustawowe liczone bez bazy', async () => {
    const res = await request(app)
      .get('/api/terms/holidays?from=2026-12-20&to=2027-01-10')
      .set('Authorization', `Bearer ${student}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((h: { date: string }) => h.date)).toContain('2026-12-24');
  });
});

describe('API — kalendarze semestru', () => {
  it('podglad kalendarza dla planisty: tygodnie i swieta', async () => {
    const res = await request(app)
      .post('/api/term-calendars/preview')
      .set('Authorization', `Bearer ${dean}`)
      .send(validCalendar);
    expect(res.status).toBe(200);
    expect(res.body.data.problems).toEqual([]);
    expect(res.body.data.weeks[0].index).toBe(1);
    // tygodnie w calosci w przerwie swiatecznej nie maja numeru
    expect(res.body.data.weeks.some((w: { index: number | null }) => w.index === null)).toBe(true);
  });

  it('student nie moze ogladac podgladu (zapis/planowanie)', async () => {
    const res = await request(app)
      .post('/api/term-calendars/preview')
      .set('Authorization', `Bearer ${student}`)
      .send(validCalendar);
    expect(res.status).toBe(403);
  });

  it('niepoprawna data -> 400 z walidacji', async () => {
    const res = await request(app)
      .post('/api/term-calendars/preview')
      .set('Authorization', `Bearer ${dean}`)
      .send({ ...validCalendar, startDate: '2026-13-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^Data poczatku: /);
  });

  it('kalendarz zjazdowy bez zjazdow zglaszany jako problem', async () => {
    const res = await request(app)
      .post('/api/term-calendars/preview')
      .set('Authorization', `Bearer ${dean}`)
      .send({ ...validCalendar, studyMode: 'PART_TIME', kind: 'ZJAZD' });
    expect(res.status).toBe(200);
    expect(res.body.data.problems).toContain('Kalendarz zjazdowy nie ma zadnego zjazdu');
  });

  it('dziekanat nie edytuje kalendarza innego wydzialu -> 403', async () => {
    prismaMock.termCalendar.findUnique.mockResolvedValueOnce({
      id: 'c1',
      facultyId: 'inny',
      status: 'PLANNING',
      studyMode: 'FULL_TIME',
    });
    const res = await request(app)
      .put('/api/term-calendars/c1')
      .set('Authorization', `Bearer ${dean}`)
      .send(validCalendar);
    expect(res.status).toBe(403);
  });

  it('kalendarz w archiwum jest tylko do odczytu -> 409', async () => {
    prismaMock.termCalendar.findUnique.mockResolvedValueOnce({
      id: 'c2',
      facultyId: 'wm',
      status: 'ARCHIVED',
      studyMode: 'FULL_TIME',
    });
    const res = await request(app)
      .put('/api/term-calendars/c2')
      .set('Authorization', `Bearer ${dean}`)
      .send(validCalendar);
    expect(res.status).toBe(409);
  });
});

describe('API — edycja dat kalendarza (terminy nieaktualne)', () => {
  // Zapisany kalendarz = validCalendar (te same daty i przerwa), status "w przygotowaniu".
  const stored = {
    id: 'c4',
    termId: 't1',
    facultyId: 'wm',
    studyMode: 'FULL_TIME',
    status: 'PLANNING',
    name: 'Podstawowy',
    kind: 'WEEKLY',
    startDate: new Date('2026-10-01T00:00:00Z'),
    endDate: new Date('2027-01-31T00:00:00Z'),
    breaks: [{ name: 'Przerwa swiateczna', startDate: new Date('2026-12-23T00:00:00Z'), endDate: new Date('2027-01-01T00:00:00Z') }],
    days: [],
    zjazdy: [],
    term: { id: 't1', startYear: 2026, type: 'WINTER' },
  };
  const save = async (body: unknown) => {
    prismaMock.termCalendar.findUnique.mockResolvedValueOnce(stored);
    prismaMock.termCalendar.update.mockClear();
    prismaMock.$transaction.mockResolvedValueOnce([{}, {}, {}, {}, stored]);
    const res = await request(app).put('/api/term-calendars/c4').set('Authorization', `Bearer ${dean}`).send(body);
    expect(res.status).toBe(200);
    return prismaMock.termCalendar.update.mock.calls[0]![0] as { data: Record<string, unknown> };
  };

  it('nowa nazwa przerwy — daty bez zmian, bez znacznika i bez przeliczania terminow', async () => {
    autoPlanMock.refreshCalendarTerms.mockClear();
    const args = await save({ ...validCalendar, breaks: [{ ...validCalendar.breaks[0], name: 'Boze Narodzenie' }] });
    expect(args.data).not.toHaveProperty('datesChangedAt');
    expect(autoPlanMock.refreshCalendarTerms).not.toHaveBeenCalled();
  });

  it('nowe daty kalendarza w przygotowaniu — terminy jego rocznikow przeliczone od razu', async () => {
    autoPlanMock.refreshCalendarTerms.mockResolvedValueOnce({ cohortIds: ['c1'], report: null });
    prismaMock.termCalendar.findUnique.mockResolvedValueOnce(stored);
    prismaMock.$transaction.mockResolvedValueOnce([{}, {}, {}, {}, stored]);
    const res = await request(app)
      .put('/api/term-calendars/c4')
      .set('Authorization', `Bearer ${dean}`)
      .send({ ...validCalendar, endDate: '2027-01-24' });
    expect(res.status).toBe(200);
    expect(autoPlanMock.refreshCalendarTerms).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), expect.objectContaining({ id: 'c4' }));
    expect(res.body.message).toBe('Kalendarz zapisany — terminy przeliczone');
  });

  it('nowa przerwa — znacznik zmiany dat', async () => {
    const args = await save({ ...validCalendar, breaks: [...validCalendar.breaks, { name: 'Rektorskie', startDate: '2026-11-02', endDate: '2026-11-02' }] });
    expect(args.data.datesChangedAt).toBeInstanceOf(Date);
  });
  it('umieszczenia z tygodniami, ktorych juz nie ma -> zapis przechodzi z ostrzezeniem', async () => {
    prismaMock.termCalendar.findUnique.mockResolvedValueOnce(stored);
    prismaMock.$transaction.mockResolvedValueOnce([{}, {}, {}, {}, stored]);
    missingPeriodsMock.mockResolvedValueOnce({ placements: 2, numbers: [17, 18] });
    const res = await request(app).put('/api/term-calendars/c4').set('Authorization', `Bearer ${dean}`).send(validCalendar);
    expect(res.status).toBe(200);
    expect(res.body.warning).toBe(
      '2 umieszczenia maja wybrane tygodnie nr 17, 18, ktorych w kalendarzu juz nie ma — w te dni zajecia sie nie odbeda. Popraw je w Ukladaniu planu (Niezgodnosci w planie).',
    );
  });

  it('bez takich umieszczen — bez ostrzezenia', async () => {
    prismaMock.termCalendar.findUnique.mockResolvedValueOnce(stored);
    prismaMock.$transaction.mockResolvedValueOnce([{}, {}, {}, {}, stored]);
    const res = await request(app).put('/api/term-calendars/c4').set('Authorization', `Bearer ${dean}`).send(validCalendar);
    expect(res.body.warning).toBeNull();
  });
});

describe('API — usuwanie kalendarza', () => {
  const calendar = { id: 'c3', termId: 't1', facultyId: 'wm', status: 'PUBLISHED', studyMode: 'FULL_TIME' };

  it('kalendarz z planem rocznikow -> 409, nic nie usuwa', async () => {
    prismaMock.termCalendar.findUnique.mockResolvedValueOnce(calendar);
    usageMock.mockResolvedValueOnce({ cohorts: 14, cohortsWithPlan: 12, placements: 412, occurrences: 5000 });
    prismaMock.termCalendar.delete.mockClear();
    const res = await request(app).delete('/api/term-calendars/c3').set('Authorization', `Bearer ${dean}`);
    expect(res.status).toBe(409);
    expect(res.body.message ?? res.body.error).toContain('412 umieszczen');
    expect(prismaMock.termCalendar.delete).not.toHaveBeenCalled();
  });

  it('kalendarz bez planu -> usuniety', async () => {
    prismaMock.termCalendar.findUnique.mockResolvedValueOnce(calendar);
    usageMock.mockResolvedValueOnce({ cohorts: 3, cohortsWithPlan: 0, placements: 0, occurrences: 0 });
    prismaMock.termCalendar.delete.mockClear();
    const res = await request(app).delete('/api/term-calendars/c3').set('Authorization', `Bearer ${dean}`);
    expect(res.status).toBe(200);
    expect(prismaMock.termCalendar.delete).toHaveBeenCalledWith({ where: { id: 'c3' } });
  });

  it('powod blokady: umieszczenia i/albo terminy', () => {
    expect(calendarDeleteBlock({ cohorts: 2, cohortsWithPlan: 0, placements: 0, occurrences: 0 })).toBeNull();
    expect(calendarDeleteBlock({ cohorts: 2, cohortsWithPlan: 1, placements: 0, occurrences: 7 })).toContain('1 rocznik ma 7 terminow');
    expect(calendarDeleteBlock({ cohorts: 2, cohortsWithPlan: 2, placements: 3, occurrences: 7 })).toContain('2 roczniki maja 3 umieszczenia i 7 terminow');
  });
});

describe('API — publikacja kalendarza', () => {
  const stored = {
    id: 'c5',
    termId: 't1',
    facultyId: 'wm',
    studyMode: 'FULL_TIME',
    status: 'PLANNING',
    name: 'Podstawowy',
    kind: 'WEEKLY',
    startDate: new Date('2026-10-01T00:00:00Z'),
    endDate: new Date('2027-01-31T00:00:00Z'),
    breaks: [],
    days: [],
    zjazdy: [],
    term: { id: 't1', startYear: 2026, type: 'WINTER' },
  };

  it('publikacja przelicza terminy przed zmiana statusu i mowi o pominietych terminach', async () => {
    prismaMock.termCalendar.findUnique.mockResolvedValueOnce(stored);
    prismaMock.termCalendar.update.mockReturnValueOnce(Promise.resolve({ ...stored, status: 'PUBLISHED' }) as never);
    const conflict = { date: '2026-10-05', section: 'Fizyka', reason: 'Sala zajeta', with: 'Chemia' };
    autoPlanMock.changeCalendarStatus.mockImplementationOnce(async (_t: unknown, _c: unknown, _s: unknown, update: () => Promise<unknown>) => ({
      result: await update(),
      refresh: {
        cohortIds: ['c1'],
        report: { added: 12, removed: 0, changed: 0, unchanged: 0, total: 12, conflicts: [conflict], beyondHours: 0, shortfalls: [], orphanExceptions: [], calendarsMissing: [], draftVersions: [] },
      },
    }));
    const res = await request(app).put('/api/term-calendars/c5/status').set('Authorization', `Bearer ${dean}`).send({ status: 'PUBLISHED' });
    expect(res.status).toBe(200);
    expect(autoPlanMock.changeCalendarStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      expect.objectContaining({ id: 'c5', status: 'PLANNING' }),
      'PUBLISHED',
      expect.any(Function),
    );
    expect(res.body.message).toBe('Kalendarz opublikowany — terminy przeliczone (12)');
    expect(res.body.warning).toMatch(/^1 termin pominiety przez kolizje/);
  });
});
