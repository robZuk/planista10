import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcademicTerm } from '@prisma/client';
import type { BusySlot } from '../lib/materializer';

// Zajetosc sal i prowadzacych w tygodniu — Prisma i wspolna zajetosc semestru (occupancyWithScope) mockowane:
// wybor tygodnia, tylko sloty z zasobem widoku w tym tygodniu, opis zajec, terminow recznych i zajetosci zewnetrznych.
const prismaMock = vi.hoisted(() => ({
  termCalendar: { findMany: vi.fn() },
  externalBusy: { findMany: vi.fn() },
  classSection: { findMany: vi.fn() },
  instructor: { findMany: vi.fn() },
  room: { findMany: vi.fn() },
}));
vi.mock('../lib/prisma', () => ({ prisma: prismaMock }));
const occupancyMock = vi.hoisted(() => vi.fn());
vi.mock('./plan', () => ({ occupancyWithScope: occupancyMock }));

import { instructorOccupancy, roomOccupancy } from './occupancyView';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const term = { id: 't-2026Z', startYear: 2026, type: 'WINTER' } as AcademicTerm;

const busy = (over: Partial<BusySlot>): BusySlot => ({
  date: '2026-11-18',
  startMinute: 480,
  endMinute: 570,
  roomId: 'r1',
  instructorId: 'i1',
  groupId: 'g1',
  jointKey: null,
  label: 'x',
  origin: { kind: 'SECTION', sectionId: 's1', manual: false },
  ...over,
});

const scope = {
  contexts: [{ cohort: { id: 'c1', program: { code: 'MBM-S1' } }, semester: 1, nameOf: (id: string) => (id === 'g1' ? 'MBM-1-C-A' : '?') }],
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.termCalendar.findMany.mockResolvedValue([{ startDate: d('2026-10-01'), endDate: d('2027-01-31') }]);
  prismaMock.externalBusy.findMany.mockImplementation((args: { where: { id?: unknown } }) =>
    Promise.resolve(
      args.where.id
        ? [{ id: 'e1', source: 'WE – dziekanat', receivedOn: d('2026-11-10'), note: 'wyklad' }]
        : [{ dates: [d('2026-11-18')] }],
    ),
  );
  prismaMock.classSection.findMany.mockResolvedValue([
    { id: 's1', cohortId: 'c1', groupId: 'g1', classType: 'EXERCISE', facultyId: 'wm', programEntry: { subject: { name: 'Mechanika' } } },
  ]);
  prismaMock.instructor.findMany.mockResolvedValue([{ id: 'i1', title: 'dr inz.', firstName: 'Jan', lastName: 'Nowak' }]);
  prismaMock.room.findMany.mockResolvedValue([{ id: 'r1', number: '101', building: { name: 'Budynek C' } }]);
});

describe('roomOccupancy', () => {
  it('tydzien wskazanej daty: tylko sloty z sala w tym tygodniu, z opisem zajec', async () => {
    occupancyMock.mockResolvedValue({
      scope,
      busy: [
        busy({}),
        busy({ roomId: null }), // zajecia online — nie zajmuja sali
        busy({ date: '2026-11-25' }), // nastepny tydzien
      ],
    });
    const view = await roomOccupancy(term, '2026-11-20');
    expect(view.week).toBe('2026-11-16');
    expect(view.days).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
    expect(view.weeks[0]).toEqual({ monday: '2026-09-28', number: 1 });
    expect(view.entries).toEqual([
      expect.objectContaining({
        roomId: 'r1',
        date: '2026-11-18',
        kind: 'CLASS',
        title: 'Mechanika',
        classType: 'EXERCISE',
        groups: [{ label: 'MBM-S1 s1 · MBM-1-C-A', cohortId: 'c1', facultyId: 'wm' }],
        facultyIds: ['wm'],
        instructor: 'dr inz. Jan Nowak',
        room: '101 (Budynek C)',
        conflict: false,
      }),
    ]);
  });

  it('termin reczny i zajetosc zewnetrzna — wlasny rodzaj, zgloszenie w opisie, kolizja z zajeciami', async () => {
    occupancyMock.mockResolvedValue({
      scope,
      busy: [
        busy({ origin: { kind: 'SECTION', sectionId: 's1', manual: true } }),
        busy({ startMinute: 540, endMinute: 600, instructorId: null, groupId: null, origin: { kind: 'EXTERNAL', externalBusyId: 'e1' } }),
      ],
    });
    const view = await roomOccupancy(term, '2026-11-18');
    expect(view.entries.map((e) => [e.kind, e.title, e.note, e.conflict])).toEqual([
      ['MANUAL', 'Mechanika', null, true],
      ['EXTERNAL', 'WE – dziekanat', 'zgloszenie: WE – dziekanat, stan na 10.11 — wyklad', true],
    ]);
  });

  it('semestr bez kalendarzy i zajetosci zewnetrznych — pusty widok bez liczenia zajetosci', async () => {
    prismaMock.termCalendar.findMany.mockResolvedValue([]);
    prismaMock.externalBusy.findMany.mockResolvedValue([]);
    const view = await roomOccupancy(term, null);
    expect(view).toEqual({ weeks: [], week: null, days: [], holidays: [], entries: [] });
    expect(occupancyMock).not.toHaveBeenCalled();
  });

  it('swieta ustawowe tygodnia', async () => {
    occupancyMock.mockResolvedValue({ scope, busy: [] });
    const view = await roomOccupancy(term, '2026-11-11');
    expect(view.holidays).toEqual([{ date: '2026-11-11', name: expect.stringContaining('Niepodleg') }]);
  });
});

describe('instructorOccupancy', () => {
  it('sloty z prowadzacym w tygodniu: zajecia online zostaja, NN i nastepny tydzien odpadaja; sala w opisie', async () => {
    occupancyMock.mockResolvedValue({
      scope,
      busy: [
        busy({}),
        busy({ roomId: null, startMinute: 600, endMinute: 690 }), // online — prowadzacy zajety, sala nie
        busy({ instructorId: null, startMinute: 720, endMinute: 810 }), // NN
        busy({ date: '2026-11-25' }),
      ],
    });
    const view = await instructorOccupancy(term, '2026-11-18');
    expect(view.week).toBe('2026-11-16');
    expect(view.entries.map((e) => [e.instructorId, e.instructor, e.startMinute, e.room, e.conflict])).toEqual([
      ['i1', 'dr inz. Jan Nowak', 480, '101 (Budynek C)', false],
      ['i1', 'dr inz. Jan Nowak', 600, null, false],
    ]);
  });

  it('zajetosc zewnetrzna prowadzacego (bez sali) — kolizja z jego zajeciami', async () => {
    occupancyMock.mockResolvedValue({
      scope,
      busy: [busy({}), busy({ roomId: null, groupId: null, startMinute: 540, endMinute: 600, origin: { kind: 'EXTERNAL', externalBusyId: 'e1' } })],
    });
    const view = await instructorOccupancy(term, '2026-11-18');
    expect(view.entries.map((e) => [e.kind, e.title, e.room, e.conflict])).toEqual([
      ['CLASS', 'Mechanika', '101 (Budynek C)', true],
      ['EXTERNAL', 'WE – dziekanat', null, true],
    ]);
  });
});
