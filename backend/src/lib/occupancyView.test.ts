import { describe, expect, it } from 'vitest';
import { buildOccupancyEntries, pickWeek, termWeeks, type OccupancySlot } from './occupancyView';

const slot = (over: Partial<OccupancySlot>): OccupancySlot => ({
  roomId: 'r1',
  room: '101 (Budynek C)',
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

const rooms = (slots: OccupancySlot[]) => buildOccupancyEntries(slots, 'room');
const people = (slots: OccupancySlot[]) => buildOccupancyEntries(slots, 'instructor');

describe('buildOccupancyEntries — sale', () => {
  it('zajecia laczone (ten sam klucz, czas, sala i prowadzacy) to jedna pozycja z lista grup', () => {
    const entries = rooms([
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
    const entries = rooms([
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
    const entries = rooms([slot({}), slot({ roomId: 'r2' }), slot({ date: '2026-11-19' })]);
    expect(entries.every((e) => !e.conflict)).toBe(true);
  });

  it('kolejnosc: sala, dzien, godzina, przedmiot; id = miejsce na liscie', () => {
    const entries = rooms([
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

  it('zajecia online (bez sali) nie trafiaja do widoku sal', () => {
    expect(rooms([slot({ roomId: null, room: null })])).toEqual([]);
  });

  it('zajecia o wspolnym kluczu, ktore sie nie scalaja (NN w jednej grupie), zostaja kolizja — niespojne zajecia laczone', () => {
    const entries = rooms([slot({ jointKey: 'MECH' }), slot({ jointKey: 'MECH', instructorId: null, instructor: null, group: { label: 'EDST-S1 s1 · EDST-1-W', cohortId: 'c2', facultyId: 'wm' } })]);
    expect(entries.map((e) => [e.joint, e.conflict])).toEqual([
      [false, true],
      [false, true],
    ]);
  });

  it('kolizja z dluzszymi zajeciami wczesniej w dniu — takze nie z bezposrednim sasiadem', () => {
    const entries = rooms([
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

describe('buildOccupancyEntries — prowadzacy', () => {
  it('wiersze po prowadzacym: zajecia online zostaja (bez sali), NN odpada', () => {
    const entries = people([
      slot({ instructorId: 'i2', instructor: 'mgr Ewa Lis', roomId: null, room: null, title: 'Online' }),
      slot({ instructorId: null, instructor: null, title: 'Wakat' }),
      slot({}),
    ]);
    expect(entries.map((e) => [e.id, e.instructorId, e.title, e.room])).toEqual([
      ['0', 'i1', 'Mechanika', '101 (Budynek C)'],
      ['1', 'i2', 'Online', null],
    ]);
  });

  it('kolizja prowadzacego: ta sama osoba w dwoch salach naraz; dwie osoby w jednej sali to nie jego kolizja', () => {
    const entries = people([
      slot({}),
      slot({ roomId: 'r2', room: '102 (Budynek C)', startMinute: 540, endMinute: 630, title: 'Fizyka' }),
      slot({ instructorId: 'i2', instructor: 'mgr Ewa Lis', title: 'Chemia' }),
    ]);
    expect(entries.map((e) => [e.instructorId, e.title, e.conflict])).toEqual([
      ['i1', 'Mechanika', true],
      ['i1', 'Fizyka', true],
      ['i2', 'Chemia', false],
    ]);
  });

  it('zajetosc zewnetrzna prowadzacego (bez sali) koliduje z jego zajeciami', () => {
    const entries = people([
      slot({}),
      slot({ kind: 'EXTERNAL', title: 'WE – dziekanat', roomId: null, room: null, group: null, facultyId: null, startMinute: 540, endMinute: 600 }),
    ]);
    expect(entries.map((e) => [e.kind, e.conflict])).toEqual([
      ['CLASS', true],
      ['EXTERNAL', true],
    ]);
  });

  it('zajecia laczone prowadzacego to jedna pozycja z lista grup', () => {
    const entries = people([
      slot({ jointKey: 'MECH' }),
      slot({ jointKey: 'MECH', group: { label: 'EDST-S1 s1 · EDST-1-W', cohortId: 'c2', facultyId: 'wm' } }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ joint: true, conflict: false, instructorId: 'i1' });
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
