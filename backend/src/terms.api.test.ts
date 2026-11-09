import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Testy HTTP tras semestrow i kalendarzy — Prisma mockowana, wiec sprawdzamy uprawnienia,
// walidacje wejscia i sciezki, ktore licza wynik bez bazy (swieta, podglad kalendarza).
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn().mockResolvedValue({ facultyId: 'wm' }) },
  academicTerm: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  termCalendar: {
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
vi.mock('./services/plan', async (importOriginal) => ({ ...(await importOriginal<object>()), calendarUsage: usageMock }));

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
    expect(res.body.error).toMatch(/startDate/);
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

  it('nowa nazwa przerwy — daty bez zmian, bez znacznika', async () => {
    const args = await save({ ...validCalendar, breaks: [{ ...validCalendar.breaks[0], name: 'Boze Narodzenie' }] });
    expect(args.data).not.toHaveProperty('datesChangedAt');
  });

  it('nowa przerwa — znacznik zmiany dat', async () => {
    const args = await save({ ...validCalendar, breaks: [...validCalendar.breaks, { name: 'Rektorskie', startDate: '2026-11-02', endDate: '2026-11-02' }] });
    expect(args.data.datesChangedAt).toBeInstanceOf(Date);
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
