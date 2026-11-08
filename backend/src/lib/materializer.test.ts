import { describe, expect, it } from 'vitest';
import { materialize, type MatPlacement, type MatSection } from './materializer';
import { TeachingCalendar } from './teachingCalendar';
import { gridTime, type GridBlock } from './timeGrid';

// Siatka 60 min od 07:00 (blok 2 = 08:00-09:00, blok 3 = 09:00-10:00).
const g60: GridBlock[] = Array.from({ length: 13 }, (_, i) => ({
  order: i + 1,
  startTime: `${String(7 + i).padStart(2, '0')}:00`,
  endTime: `${String(8 + i).padStart(2, '0')}:00`,
}));
// Siatka 45 min z przerwa: 08:00-08:45, 08:45-09:30, 09:45-10:30.
const g45: GridBlock[] = [
  { order: 1, startTime: '08:00', endTime: '08:45' },
  { order: 2, startTime: '08:45', endTime: '09:30' },
  { order: 3, startTime: '09:45', endTime: '10:30' },
];

const cal = new TeachingCalendar({
  kind: 'WEEKLY',
  studyMode: 'FULL_TIME',
  startDate: '2024-10-01',
  endDate: '2025-01-31',
  breaks: [],
  days: [],
  zjazdy: [],
});

const section = (id: string, hours: number, groupId = 'g1', consumedHours = 0, blocks = g60): MatSection => ({
  id,
  hours,
  groupId,
  calendar: cal,
  grid: gridTime(blocks),
  consumedHours,
  label: id,
});

const placement = (id: string, sectionId: string, extra: Partial<MatPlacement> = {}): MatPlacement => ({
  id,
  sectionId,
  dayOfWeek: 'WEDNESDAY',
  startOrder: 2,
  endOrder: 3,
  roomId: 'r1',
  instructorId: 'i1',
  cycle: 'WEEK',
  pattern: 'ALL',
  numbers: [],
  fromIndex: null,
  toIndex: null,
  jointKey: null,
  ...extra,
});

const noOverlap = (a: string, b: string) => a === b;

describe('materialize', () => {
  it('wyczerpuje godziny i skraca ostatni termin', () => {
    const r = materialize({
      sections: [section('s', 5)],
      placements: [placement('p', 's')],
      exceptions: [],
      busy: [],
      groupsOverlap: noOverlap,
    });
    expect(r.occurrences.map((o) => o.endOrder - o.startOrder + 1)).toEqual([2, 2, 1]);
    expect(r.beyondHours.length).toBeGreaterThan(0);
  });

  it('godziny wyczerpywane w kolejnosci dat przez wszystkie umieszczenia zajec', () => {
    const r = materialize({
      sections: [section('s', 4)],
      placements: [placement('pw', 's'), placement('pm', 's', { dayOfWeek: 'MONDAY' })],
      exceptions: [],
      busy: [],
      groupsOverlap: noOverlap,
    });
    // sr 2.10 (2h) i pon 7.10 (2h) — wtorek/sroda z pierwszego tygodnia zanim poniedzialek z drugiego
    expect(r.occurrences.map((o) => o.date)).toEqual(['2024-10-02', '2024-10-07']);
  });

  it('wyjatki: odwolanie i przeniesienie przezywaja przeliczenie; osierocony wyjatek w raporcie', () => {
    const r = materialize({
      sections: [section('s', 6)],
      placements: [placement('p', 's')],
      exceptions: [
        { placementId: 'p', originalDate: '2024-10-02', action: 'CANCEL' },
        { placementId: 'p', originalDate: '2024-10-09', action: 'MODIFY', newDate: '2024-10-10', newRoomId: 'r9' },
        { placementId: 'p', originalDate: '2024-10-03', action: 'CANCEL' }, // czwartek — nie ma takiej daty
      ],
      busy: [],
      groupsOverlap: noOverlap,
    });
    expect(r.occurrences[0]).toMatchObject({ date: '2024-10-02', status: 'CANCELLED' });
    expect(r.occurrences[1]).toMatchObject({ originalDate: '2024-10-09', date: '2024-10-10', roomId: 'r9' });
    expect(r.orphanExceptions).toHaveLength(1);
  });

  it('terminy reczne licza sie do godzin', () => {
    const r = materialize({
      sections: [section('s', 4, 'g1', 2)],
      placements: [placement('p', 's')],
      exceptions: [],
      busy: [],
      groupsOverlap: noOverlap,
    });
    expect(r.occurrences).toHaveLength(1);
  });

  it('kolizja z zajetym slotem: termin pominiety i zgloszony, godziny przechodza na kolejna date', () => {
    const r = materialize({
      sections: [section('s', 2)],
      placements: [placement('p', 's')],
      exceptions: [],
      // 09:00-11:00 (bloki 3-4 siatki 60 min) — nachodzi na 08:00-10:00 umieszczenia
      busy: [{ date: '2024-10-02', startMinute: 540, endMinute: 660, roomId: 'r1', instructorId: null, groupId: 'x', jointKey: null, label: 'inne' }],
      groupsOverlap: noOverlap,
    });
    expect(r.conflicts).toEqual([{ date: '2024-10-02', section: 's', reason: 'ROOM', with: 'inne' }]);
    expect(r.occurrences.map((o) => o.date)).toEqual(['2024-10-09']);
  });

  it('terminy niosa rzeczywisty czas z siatki swoich zajec', () => {
    const r = materialize({
      sections: [section('s', 2, 'g1', 0, g45)],
      placements: [placement('p', 's', { startOrder: 2, endOrder: 3 })],
      exceptions: [],
      busy: [],
      groupsOverlap: noOverlap,
    });
    // 08:45-10:30 — przez przerwe 09:30-09:45
    expect(r.occurrences[0]).toMatchObject({ startMinute: 525, endMinute: 630 });
  });

  it('kolizja sali miedzy roznymi siatkami liczy sie w minutach', () => {
    const r = materialize({
      // a: siatka 60 min, blok 3 = 09:00-10:00; b: siatka 45 min, blok 3 = 09:45-10:30 — ta sama sala
      sections: [section('a', 1, 'ga'), section('b', 1, 'gb', 0, g45)],
      placements: [placement('pa', 'a', { startOrder: 3, endOrder: 3 }), placement('pb', 'b', { startOrder: 3, endOrder: 3 })],
      exceptions: [],
      busy: [],
      groupsOverlap: noOverlap,
    });
    expect(r.conflicts[0]).toMatchObject({ section: 'b', reason: 'ROOM', with: 'a' });
  });

  it('styk blokow roznych siatek nie jest kolizja (07:00-08:00 vs 08:00-08:45)', () => {
    const r = materialize({
      sections: [section('a', 1, 'ga'), section('b', 1, 'gb', 0, g45)],
      placements: [placement('pa', 'a', { startOrder: 1, endOrder: 1 }), placement('pb', 'b', { startOrder: 1, endOrder: 1 })],
      exceptions: [],
      busy: [],
      groupsOverlap: noOverlap,
    });
    expect(r.conflicts).toEqual([]);
  });

  it('przeniesienie terminu na godziny spoza siatki -> zgloszone, nie zuzywa godzin', () => {
    const r = materialize({
      sections: [section('s', 2, 'g1', 0, g45)],
      placements: [placement('p', 's', { startOrder: 1, endOrder: 2 })],
      exceptions: [{ placementId: 'p', originalDate: '2024-10-02', action: 'MODIFY', newStartOrder: 3, newEndOrder: 4 }],
      busy: [],
      groupsOverlap: noOverlap,
    });
    expect(r.conflicts[0]).toMatchObject({ date: '2024-10-02', reason: 'GRID' });
    expect(r.occurrences.map((o) => o.date)).toEqual(['2024-10-09']);
  });

  it('zajecia online (bez sali) nie koliduja salowo, ale prowadzacy dalej tak', () => {
    const roomOnly = materialize({
      sections: [section('a', 2, 'ga'), section('b', 2, 'gb')],
      placements: [placement('pa', 'a', { instructorId: 'i1' }), placement('pb', 'b', { roomId: null, instructorId: 'i2' })],
      exceptions: [],
      busy: [],
      groupsOverlap: noOverlap,
    });
    expect(roomOnly.conflicts).toEqual([]);
    expect(roomOnly.occurrences.find((o) => o.sectionId === 'b')!.roomId).toBeNull();

    const sameInstructor = materialize({
      sections: [section('a', 2, 'ga'), section('b', 2, 'gb')],
      placements: [placement('pa', 'a'), placement('pb', 'b', { roomId: null })], // ten sam prowadzacy i1
      exceptions: [],
      busy: [],
      groupsOverlap: noOverlap,
    });
    expect(sameInstructor.conflicts[0]).toMatchObject({ section: 'b', reason: 'INSTRUCTOR' });
  });

  it('przeniesienie terminu na online (newOnline) przezywa przeliczenie', () => {
    const r = materialize({
      sections: [section('s', 4)],
      placements: [placement('p', 's')],
      exceptions: [{ placementId: 'p', originalDate: '2024-10-02', action: 'MODIFY', newOnline: true }],
      busy: [],
      groupsOverlap: noOverlap,
    });
    expect(r.occurrences.map((o) => [o.date, o.roomId])).toEqual([
      ['2024-10-02', null],
      ['2024-10-09', 'r1'],
    ]);
  });

  it('zajecia laczone (ten sam jointKey) nie koliduja ze soba', () => {
    const r = materialize({
      sections: [section('a', 2, 'ga'), section('b', 2, 'gb')],
      placements: [placement('pa', 'a', { jointKey: 'J' }), placement('pb', 'b', { jointKey: 'J' })],
      exceptions: [],
      busy: [],
      groupsOverlap: noOverlap,
    });
    expect(r.conflicts).toEqual([]);
    expect(r.occurrences).toHaveLength(2);
  });

  it('generowanie od daty pomija przeszlosc', () => {
    const r = materialize({
      sections: [section('s', 30)],
      placements: [placement('p', 's')],
      exceptions: [],
      busy: [],
      groupsOverlap: noOverlap,
      fromDate: '2025-01-01',
    });
    expect(r.occurrences.every((o) => o.date >= '2025-01-01')).toBe(true);
  });
});
