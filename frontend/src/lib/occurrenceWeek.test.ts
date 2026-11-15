import { describe, expect, it } from 'vitest';
import type { CalendarPeriod, OccurrenceRow, PeriodDay } from '@/types';
import { dayNote, initialPeriodIndex, occurrenceMarker, occurrencesIn, periodColumns, periodLabel } from './occurrenceWeek';

const day = (date: string, dayOfWeek: PeriodDay['dayOfWeek'], extra: Partial<PeriodDay> = {}): PeriodDay => ({
  date,
  dayOfWeek,
  teaching: true,
  label: null,
  followsWeekday: null,
  closedFromBlockOrder: null,
  ...extra,
});

// Tydzien 2-8.11.2026 (pn-nd), sb i nd bez zajec stacjonarnych.
const week: CalendarPeriod = {
  index: 6,
  label: 'Tydzien 6',
  from: '2026-11-02',
  to: '2026-11-08',
  days: [
    day('2026-11-02', 'MONDAY'),
    day('2026-11-03', 'TUESDAY'),
    day('2026-11-04', 'WEDNESDAY'),
    day('2026-11-05', 'THURSDAY'),
    day('2026-11-06', 'FRIDAY'),
    day('2026-11-07', 'SATURDAY', { teaching: false }),
    day('2026-11-08', 'SUNDAY', { teaching: false }),
  ],
};
const next: CalendarPeriod = { ...week, index: 7, label: 'Tydzien 7', from: '2026-11-09', to: '2026-11-15', days: [] };

const occ = (date: string, extra: Partial<OccurrenceRow> = {}): OccurrenceRow => ({
  id: date,
  sectionId: 's1',
  placementId: 'p1',
  date,
  originalDate: date,
  startOrder: 2,
  endOrder: 3,
  startMinute: 480,
  endMinute: 600,
  subject: 'Fizyka',
  classType: 'LECTURE',
  group: 'EDST-1-W',
  groupId: 'g1',
  room: { id: 'r1', label: '101' },
  instructor: 'dr Nowak',
  instructorId: 'i1',
  kind: 'DERIVED',
  status: 'SCHEDULED',
  changed: false,
  note: null,
  ...extra,
});

const weekdays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as const;

describe('initialPeriodIndex', () => {
  it('tydzien z dzisiejsza data', () => expect(initialPeriodIndex([week, next], '2026-11-10', [])).toBe(1));
  it('poza semestrem: tydzien pierwszego terminu', () => expect(initialPeriodIndex([week, next], '2027-03-01', ['2026-11-12', '2026-11-03'])).toBe(0));
  it('bez terminow: pierwszy tydzien', () => expect(initialPeriodIndex([week, next], '2027-03-01', [])).toBe(0));
});

describe('periodColumns', () => {
  it('dni trybu studiow; weekend tylko gdy jest na nim termin (np. reczny)', () => {
    expect(periodColumns(week, [...weekdays], []).map((d) => d.dayOfWeek)).toEqual([...weekdays]);
    const cols = periodColumns(week, [...weekdays], [occ('2026-11-07', { kind: 'MANUAL' })]);
    expect(cols.map((d) => d.dayOfWeek)).toEqual([...weekdays, 'SATURDAY']);
  });

  it('dzien zajec spoza trybu (sobota wg planu poniedzialku) tez jest kolumna', () => {
    const swapped = { ...week, days: week.days.map((d) => (d.dayOfWeek === 'SATURDAY' ? { ...d, teaching: true, followsWeekday: 'MONDAY' as const } : d)) };
    expect(periodColumns(swapped, [...weekdays], []).map((d) => d.dayOfWeek)).toContain('SATURDAY');
  });
});

describe('occurrencesIn / dayNote / occurrenceMarker / periodLabel', () => {
  it('terminy w zakresie okresu', () => {
    expect(occurrencesIn(week, [occ('2026-11-01'), occ('2026-11-02'), occ('2026-11-08'), occ('2026-11-09')]).map((o) => o.date)).toEqual([
      '2026-11-02',
      '2026-11-08',
    ]);
  });

  it('opis dnia: swieto, zamiana dnia, zwykly dzien', () => {
    expect(dayNote(day('2026-11-11', 'WEDNESDAY', { teaching: false, label: 'Narodowe Swieto Niepodleglosci' }))).toBe('Narodowe Swieto Niepodleglosci');
    expect(dayNote(day('2026-11-14', 'SATURDAY', { followsWeekday: 'WEDNESDAY' }))).toBe('zajecia wg planu: sroda');
    expect(dayNote(day('2026-11-02', 'MONDAY'))).toBeNull();
  });

  it('oznaczenie terminu', () => {
    expect(occurrenceMarker(occ('2026-11-02', { status: 'CANCELLED' }))).toBe('odwolany');
    expect(occurrenceMarker(occ('2026-11-02', { kind: 'MANUAL', originalDate: null }))).toBe('reczny');
    expect(occurrenceMarker(occ('2026-11-03', { originalDate: '2026-11-11', changed: true }))).toBe('przeniesiony z 11.11');
    expect(occurrenceMarker(occ('2026-11-02', { changed: true }))).toBe('zmieniony');
    expect(occurrenceMarker(occ('2026-11-02'))).toBeUndefined();
  });

  it('etykieta okresu z datami', () => expect(periodLabel(week)).toBe('Tydzien 6 · 02.11–08.11'));
});
