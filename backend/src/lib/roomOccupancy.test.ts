import { describe, expect, it } from 'vitest';
import { buildRoomEntries, pickWeek, termWeeks, type RoomSlot } from './roomOccupancy';

const slot = (over: Partial<RoomSlot>): RoomSlot => ({
  roomId: 'r1',
  date: '2026-11-18',
  startMinute: 480,
  endMinute: 570,
  jointKey: null,
  instructorId: 'i1',
  kind: 'CLASS',
  title: 'Mechanika',
  classType: 'LECTURE',
  group: { label: 'MBM-S1 s1 · MBM-1-W', cohortId: 'c1', facultyId: 'wm' },
  facultyId: 'wm',
  instructor: 'dr Jan Nowak',
  note: null,
  ...over,
});

describe('buildRoomEntries', () => {
  it('zajecia laczone (ten sam klucz, czas, sala i prowadzacy) to jedna pozycja z lista grup', () => {
    const entries = buildRoomEntries([
      slot({ jointKey: 'MECH', group: { label: 'MBM-S1 s1 · MBM-1-W', cohortId: 'c1', facultyId: 'wm' } }),
      slot({ jointKey: 'MECH', group: { label: 'EDST-S1 s1 · EDST-1-W', cohortId: 'c2', facultyId: 'wm' } }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      joint: true,
      conflict: false,
      groups: [
        { label: 'EDST-S1 s1 · EDST-1-W', cohortId: 'c2', facultyId: 'wm' },
        { label: 'MBM-S1 s1 · MBM-1-W', cohortId: 'c1', facultyId: 'wm' },
      ],
      facultyIds: ['wm'],
    });
  });

  it('nakladajace sie zajecia bez wspolnego klucza to kolizja obu pozycji', () => {
    const entries = buildRoomEntries([
      slot({}),
      slot({ kind: 'EXTERNAL', title: 'WE – dziekanat', startMinute: 540, endMinute: 630, group: null, instructorId: null }),
      slot({ startMinute: 630, endMinute: 720, title: 'Fizyka' }),
    ]);
    expect(entries.map((e) => [e.title, e.conflict])).toEqual([
      ['Mechanika', true],
      ['WE – dziekanat', true],
      // 10:30 zaczyna sie, gdy zajetosc zewnetrzna sie konczy — przedzialy polotwarte.
      ['Fizyka', false],
    ]);
  });

  it('inna sala albo inny dzien nie koliduje', () => {
    const entries = buildRoomEntries([slot({}), slot({ roomId: 'r2' }), slot({ date: '2026-11-19' })]);
    expect(entries.every((e) => !e.conflict)).toBe(true);
  });

  it('kolejnosc: sala, dzien, godzina, przedmiot; id = miejsce na liscie', () => {
    const entries = buildRoomEntries([
      slot({ roomId: 'r2', startMinute: 600, endMinute: 690 }),
      slot({ startMinute: 600, endMinute: 690, title: 'B' }),
      slot({ startMinute: 600, endMinute: 690, title: 'A' }),
      slot({ startMinute: 480, endMinute: 570 }),
    ]);
    expect(entries.map((e) => [e.id, e.roomId, e.startMinute, e.title])).toEqual([
      ['0', 'r1', 480, 'Mechanika'],
      ['1', 'r1', 600, 'A'],
      ['2', 'r1', 600, 'B'],
      ['3', 'r2', 600, 'Mechanika'],
    ]);
  });

  it('kolizja z dluzszymi zajeciami wczesniej w dniu — takze nie z bezposrednim sasiadem', () => {
    const entries = buildRoomEntries([
      slot({ startMinute: 480, endMinute: 720, title: 'Dlugie' }),
      slot({ startMinute: 500, endMinute: 520, title: 'Krotkie', instructorId: 'i2' }),
      slot({ startMinute: 600, endMinute: 650, title: 'Pozniej', instructorId: 'i3' }),
    ]);
    expect(entries.map((e) => [e.title, e.conflict])).toEqual([
      ['Dlugie', true],
      ['Krotkie', true],
      ['Pozniej', true],
    ]);
  });
});

describe('termWeeks', () => {
  it('tygodnie od pierwszego do ostatniego dnia zakresow, numer od pierwszego dnia zajec', () => {
    const weeks = termWeeks(
      [
        { start: '2026-10-01', end: '2026-10-20' },
        { start: '2026-10-02', end: '2026-10-25' },
      ],
      '2026-10-01',
    );
    expect(weeks).toEqual([
      { monday: '2026-09-28', number: 1 },
      { monday: '2026-10-05', number: 2 },
      { monday: '2026-10-12', number: 3 },
      { monday: '2026-10-19', number: 4 },
    ]);
  });

  it('zajetosc zewnetrzna po koncu kalendarza wydluza liste, numeracja zostaje od poczatku zajec', () => {
    const weeks = termWeeks(
      [
        { start: '2026-10-01', end: '2026-10-04' },
        { start: '2026-10-14', end: '2026-10-14' },
      ],
      '2026-10-01',
    );
    expect(weeks.map((w) => w.number)).toEqual([1, 2, 3]);
  });

  it('bez zakresow — brak tygodni', () => {
    expect(termWeeks([])).toEqual([]);
  });
});

describe('pickWeek', () => {
  const weeks = termWeeks([{ start: '2026-10-01', end: '2026-10-20' }]);

  it('wskazana data -> poniedzialek jej tygodnia', () => {
    expect(pickWeek(weeks, '2026-10-08', '2026-11-22')).toBe('2026-10-05');
  });

  it('domyslnie biezacy tydzien, gdy jest w semestrze', () => {
    expect(pickWeek(weeks, null, '2026-10-14')).toBe('2026-10-12');
  });

  it('poza semestrem — pierwszy tydzien; bez tygodni — null', () => {
    expect(pickWeek(weeks, null, '2027-03-01')).toBe('2026-09-28');
    expect(pickWeek([], null, '2026-10-14')).toBeNull();
  });
});
