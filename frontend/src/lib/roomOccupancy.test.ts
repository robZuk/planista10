import { describe, expect, it } from 'vitest';
import type { Building, RoomOccupancyEntry } from '@/types';
import {
  buildingFilterOptions,
  hourTick,
  overlapping,
  busyMinutes,
  defaultBuildingFilter,
  entrySummary,
  hoursLabel,
  isFree,
  roomRows,
  timeAxis,
  utilizationPercent,
  visibleDays,
  weekLabel,
  weekRange,
} from './roomOccupancy';

const building = (id: string, name: string, facultyId: string | null, rooms: [string, string, number][]): Building => ({
  id,
  name,
  address: null,
  facultyId,
  createdAt: '2026-01-01',
  rooms: rooms.map(([roomId, number, capacity]) => ({ id: roomId, number, capacity, type: capacity > 60 ? 'LECTURE' : 'LAB', buildingId: id })),
});

const buildings = [
  building('bc', 'Budynek C', 'wm', [['c1010', '1010', 30], ['c101', '101', 120], ['c2', '2', 24]]),
  building('aula', 'Aula Główna', null, [['a1', 'Aula', 400]]),
  building('we', 'Budynek D (WE)', 'we', [['d1', '101', 40]]),
];
const all = { building: 'all', type: 'all' as const, minCapacity: null, query: '' };

const entry = (over: Partial<RoomOccupancyEntry>): RoomOccupancyEntry => ({
  id: '0',
  roomId: 'c101',
  date: '2026-11-18',
  startMinute: 480,
  endMinute: 570,
  kind: 'CLASS',
  title: 'Mechanika',
  classType: 'LECTURE',
  groups: [{ label: 'MBM-S1 s1 · MBM-1-W', cohortId: 'c1', facultyId: 'wm' }],
  facultyIds: ['wm'],
  instructor: 'dr Jan Nowak',
  note: null,
  joint: false,
  conflict: false,
  ...over,
});

describe('roomRows', () => {
  it('budynki po nazwie, sale numerami rosnaco (2, 101, 1010)', () => {
    expect(roomRows(buildings, all).map((r) => r.room.id)).toEqual(['a1', 'c2', 'c101', 'c1010', 'd1']);
  });

  it('filtr wydzialu, budynkow ogolnouczelnianych i jednego budynku', () => {
    expect(roomRows(buildings, { ...all, building: 'faculty:wm' }).map((r) => r.room.id)).toEqual(['c2', 'c101', 'c1010']);
    expect(roomRows(buildings, { ...all, building: 'shared' }).map((r) => r.room.id)).toEqual(['a1']);
    expect(roomRows(buildings, { ...all, building: 'building:we' }).map((r) => r.room.id)).toEqual(['d1']);
  });

  it('typ, pojemnosc i wyszukiwanie (numer albo budynek, bez polskich znakow)', () => {
    expect(roomRows(buildings, { ...all, type: 'LECTURE' }).map((r) => r.room.id)).toEqual(['a1', 'c101']);
    expect(roomRows(buildings, { ...all, minCapacity: 40 }).map((r) => r.room.id)).toEqual(['a1', 'c101', 'd1']);
    expect(roomRows(buildings, { ...all, query: 'glowna' }).map((r) => r.room.id)).toEqual(['a1']);
    expect(roomRows(buildings, { ...all, query: '101 we' }).map((r) => r.room.id)).toEqual(['d1']);
  });
});

describe('zajete godziny', () => {
  it('nakladajace sie zajecia (kolizja) liczone raz, dni osobno', () => {
    const minutes = busyMinutes([
      entry({ startMinute: 480, endMinute: 570 }),
      entry({ startMinute: 540, endMinute: 600 }),
      entry({ startMinute: 600, endMinute: 660 }),
      entry({ date: '2026-11-19', startMinute: 480, endMinute: 525 }),
    ]);
    expect(minutes).toBe(180 + 45);
    expect(hoursLabel(minutes)).toBe('3,8 h');
    expect(utilizationPercent(30 * 60)).toBe(50);
  });
});

describe('os czasu i dni', () => {
  it('pelne godziny wokol zajec, co najmniej 8–18', () => {
    expect(timeAxis([])).toEqual({ start: 480, end: 1080 });
    expect(timeAxis([entry({ startMinute: 435, endMinute: 1170 })])).toEqual({ start: 420, end: 1200 });
  });

  it('weekend tylko, gdy cos sie w nim odbywa', () => {
    const days = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
    expect(visibleDays(days, [entry({})])).toHaveLength(5);
    expect(visibleDays(days, [entry({ date: '2026-11-22' })])).toEqual([...days.slice(0, 5), '2026-11-22']);
  });
});

describe('wolna sala', () => {
  it('przedzialy polotwarte: zajecia konczace sie o 9:30 nie blokuja 9:30–11:00', () => {
    const day = [entry({ startMinute: 480, endMinute: 570 }), entry({ startMinute: 720, endMinute: 810 })];
    expect(isFree(day, 570, 660)).toBe(true);
    expect(isFree(day, 560, 660)).toBe(false);
    expect(isFree(day, 660, 721)).toBe(false);
  });
});

describe('opisy', () => {
  it('zakres tygodnia w miesiacu, na przelomie miesiaca i roku', () => {
    expect(weekRange('2026-11-16')).toBe('16–22.11.2026');
    expect(weekRange('2026-11-30')).toBe('30.11–6.12.2026');
    expect(weekRange('2026-12-28')).toBe('28.12.2026–3.01.2027');
    expect(weekLabel({ monday: '2026-11-16', number: 8 })).toBe('tydz. 8 · 16–22.11.2026');
  });

  it('dymek pozycji: czas, forma, grupy, prowadzacy, termin reczny i kolizja', () => {
    expect(entrySummary(entry({}))).toBe('08:00–09:30 W · Mechanika · MBM-S1 s1 · MBM-1-W · dr Jan Nowak');
    expect(entrySummary(entry({ kind: 'MANUAL', instructor: null, conflict: true }))).toBe(
      '08:00–09:30 W · Mechanika · MBM-S1 s1 · MBM-1-W · NN · termin reczny · KOLIZJA',
    );
    expect(entrySummary(entry({ kind: 'EXTERNAL', title: 'WE – dziekanat', classType: null, groups: [], instructor: null }))).toBe(
      '08:00–09:30 Zajetosc zewnetrzna · WE – dziekanat',
    );
  });
});

describe('filtr budynkow', () => {
  const faculties = [
    { id: 'wm', name: 'Wydzial Mechaniczny', shortName: 'WM', createdAt: '' },
    { id: 'we', name: 'Wydzial Elektryczny', shortName: 'WE', createdAt: '' },
    { id: 'wn', name: 'Wydzial Nawigacyjny', shortName: 'WN', createdAt: '' },
  ];

  it('opcje: wszystkie, wydzialy z budynkami, ogolnouczelniane, budynki z liczba sal', () => {
    const options = buildingFilterOptions(buildings, faculties);
    expect(options.groups.map((o) => o.label)).toEqual(['Wszystkie budynki', 'Budynki WE', 'Budynki WM', 'Ogolnouczelniane (bez wydzialu)']);
    // Nazwy bez dopisku wydzialu — „Budynek D (WE)” ma go w nazwie, „Budynek C” (WM) nie dostaje drugiego.
    expect(options.buildings.map((o) => o.label)).toEqual(['Aula Główna · 1 sala', 'Budynek C · 3 sale', 'Budynek D (WE) · 1 sala']);
  });

  it('domyslnie wydzial dziekanatu albo wydzial z filtra admina, gdy ma budynki', () => {
    expect(defaultBuildingFilter('DEAN_OFFICE', 'wm', 'all', buildings)).toBe('faculty:wm');
    expect(defaultBuildingFilter('DEAN_OFFICE', 'wn', 'all', buildings)).toBe('all');
    expect(defaultBuildingFilter('ADMIN', null, 'we', buildings)).toBe('faculty:we');
    expect(defaultBuildingFilter('ADMIN', null, 'all', buildings)).toBe('all');
  });
});

describe('kolizje i os', () => {
  it('z czym koliduje pozycja — tylko nachodzace na nia, bez niej samej', () => {
    const a = entry({ id: 'a', startMinute: 480, endMinute: 600 });
    const b = entry({ id: 'b', startMinute: 570, endMinute: 660 });
    const c = entry({ id: 'c', startMinute: 600, endMinute: 690 });
    expect(overlapping(a, [a, b, c]).map((e) => e.id)).toEqual(['b']);
    expect(overlapping(b, [a, b, c]).map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('etykiety godzin bez zera wiodacego', () => {
    expect([hourTick(480), hourTick(840), hourTick(450)]).toEqual(['8', '14', '7:30']);
  });
});
