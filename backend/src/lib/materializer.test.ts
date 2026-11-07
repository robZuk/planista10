import { describe, expect, it } from 'vitest';
import { materialize, type MatPlacement, type MatSection } from './materializer';
import { TeachingCalendar } from './teachingCalendar';

const cal = new TeachingCalendar({
  kind: 'WEEKLY',
  studyMode: 'FULL_TIME',
  startDate: '2024-10-01',
  endDate: '2025-01-31',
  breaks: [],
  days: [],
  zjazdy: [],
});

const section = (id: string, hours: number, groupId = 'g1', consumedHours = 0): MatSection => ({
  id,
  hours,
  groupId,
  calendar: cal,
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
      busy: [{ date: '2024-10-02', startOrder: 3, endOrder: 4, roomId: 'r1', instructorId: null, groupId: 'x', jointKey: null, label: 'inne' }],
      groupsOverlap: noOverlap,
    });
    expect(r.conflicts).toEqual([{ date: '2024-10-02', section: 's', reason: 'ROOM', with: 'inne' }]);
    expect(r.occurrences.map((o) => o.date)).toEqual(['2024-10-09']);
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
