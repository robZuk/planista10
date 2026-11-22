import { describe, expect, it } from 'vitest';
import type { OccupancyEntry } from '@/types';
import {
  busyByResource,
  busyMinutes,
  entryDetail,
  entrySummary,
  freeRange,
  hourTick,
  hoursLabel,
  indexEntries,
  isFree,
  overlapping,
  roomLabel,
  timeAxis,
  utilizationPercent,
  visibleDays,
  weekChange,
  weekLabel,
  weekRange,
} from './occupancyView';

const entry = (over: Partial<OccupancyEntry>): OccupancyEntry => ({
  id: '0',
  roomId: 'c101',
  room: '101 (Budynek C)',
  instructorId: 'i1',
  instructor: 'dr Jan Nowak',
  date: '2026-11-18',
  startMinute: 480,
  endMinute: 570,
  kind: 'CLASS',
  title: 'Mechanika',
  classType: 'LECTURE',
  groups: [{ label: 'MBM-S1 s1 · MBM-1-W', cohortId: 'c1', facultyId: 'wm' }],
  facultyIds: ['wm'],
  note: null,
  joint: false,
  conflict: false,
  ...over,
});

describe('indeks pozycji', () => {
  it('po sali albo po prowadzacym i dniu; pozycje bez zasobu (online, NN) pomijane', () => {
    const entries = [
      entry({ id: 'a' }),
      entry({ id: 'b', roomId: null, room: null, date: '2026-11-19' }),
      entry({ id: 'c', instructorId: null, instructor: null }),
    ];
    const byRoom = indexEntries(entries, 'room');
    expect([...byRoom.keys()]).toEqual(['c101']);
    expect(byRoom.get('c101')?.get('2026-11-18')?.map((e) => e.id)).toEqual(['a', 'c']);
    const byPerson = indexEntries(entries, 'instructor');
    expect([...byPerson.keys()]).toEqual(['i1']);
    expect([...byPerson.get('i1')!.keys()]).toEqual(['2026-11-18', '2026-11-19']);
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

  it('godziny kazdego zasobu z indeksu', () => {
    const index = indexEntries([entry({}), entry({ instructorId: 'i2', startMinute: 600, endMinute: 690 })], 'instructor');
    expect(busyByResource(index)).toEqual(new Map([['i1', 90], ['i2', 90]]));
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

  it('inny tydzien: w widoku dnia ten sam dzien tygodnia, w widoku tygodnia bez dnia', () => {
    expect(weekChange('2026-11-23', '2026-11-16', '2026-11-18')).toEqual({ week: '2026-11-23', day: '2026-11-25' });
    expect(weekChange('2026-11-23', '2026-11-16', null)).toEqual({ week: '2026-11-23', day: null });
  });
});

describe('wolny przedzial', () => {
  it('przedzialy polotwarte: zajecia konczace sie o 9:30 nie blokuja 9:30–11:00', () => {
    const day = [entry({ startMinute: 480, endMinute: 570 }), entry({ startMinute: 720, endMinute: 810 })];
    expect(isFree(day, 570, 660)).toBe(true);
    expect(isFree(day, 560, 660)).toBe(false);
    expect(isFree(day, 660, 721)).toBe(false);
  });

  it('godziny z pol: tylko pelne i "do" po "od"', () => {
    expect(freeRange('09:30', '11:00')).toEqual({ from: 570, to: 660 });
    expect(freeRange('11:00', '09:30')).toBeNull();
    expect(freeRange('09:30', '')).toBeNull();
  });
});

describe('opisy', () => {
  it('zakres tygodnia w miesiacu, na przelomie miesiaca i roku', () => {
    expect(weekRange('2026-11-16')).toBe('16–22.11.2026');
    expect(weekRange('2026-11-30')).toBe('30.11–6.12.2026');
    expect(weekRange('2026-12-28')).toBe('28.12.2026–3.01.2027');
    expect(weekLabel({ monday: '2026-11-16', number: 8 })).toBe('tydz. 8 · 16–22.11.2026');
  });

  it('dymek w widoku sal: czas, forma, grupy, prowadzacy, termin reczny i kolizja', () => {
    expect(entrySummary(entry({}), 'room')).toBe('08:00–09:30 W · Mechanika · MBM-S1 s1 · MBM-1-W · dr Jan Nowak');
    expect(entrySummary(entry({ kind: 'MANUAL', instructor: null, conflict: true }), 'room')).toBe(
      '08:00–09:30 W · Mechanika · MBM-S1 s1 · MBM-1-W · NN · termin reczny · KOLIZJA',
    );
    expect(entrySummary(entry({ kind: 'EXTERNAL', title: 'WE – dziekanat', classType: null, groups: [], instructor: null }), 'room')).toBe(
      '08:00–09:30 Zajetosc zewnetrzna · WE – dziekanat',
    );
  });

  it('dymek w widoku prowadzacych: sala zamiast prowadzacego, zajecia bez sali — online', () => {
    expect(entrySummary(entry({}), 'instructor')).toBe('08:00–09:30 W · Mechanika · MBM-S1 s1 · MBM-1-W · 101 (Budynek C)');
    expect(entrySummary(entry({ roomId: null, room: null, conflict: true }), 'instructor')).toBe(
      '08:00–09:30 W · Mechanika · MBM-S1 s1 · MBM-1-W · online · KOLIZJA',
    );
    // Zajetosc zewnetrzna samego prowadzacego — bez sali i bez „online”.
    expect(entrySummary(entry({ kind: 'EXTERNAL', title: 'WE – dziekanat', classType: null, groups: [], roomId: null, room: null }), 'instructor')).toBe(
      '08:00–09:30 Zajetosc zewnetrzna · WE – dziekanat',
    );
  });

  it('druga linia kafelka: sala — grupy; prowadzacy — sala i grupy; zajetosc zewnetrzna — opis zgloszenia', () => {
    expect(entryDetail(entry({}), 'room')).toBe('MBM-S1 s1 · MBM-1-W');
    expect(entryDetail(entry({}), 'instructor')).toBe('101 (Budynek C) · MBM-S1 s1 · MBM-1-W');
    const external = entry({ kind: 'EXTERNAL', classType: null, groups: [], room: null, roomId: null, note: 'zgloszenie: WE' });
    expect(entryDetail(external, 'room')).toBe('zgloszenie: WE');
    expect(entryDetail(external, 'instructor')).toBe('zgloszenie: WE');
    expect(roomLabel(entry({ room: null }))).toBe('online');
    expect(roomLabel(external)).toBeNull();
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
