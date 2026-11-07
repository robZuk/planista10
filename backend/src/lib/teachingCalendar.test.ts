import { describe, expect, it } from 'vitest';
import { expandDates, TeachingCalendar, validateCalendar, type CalendarInput } from './teachingCalendar';

/** Zima 2024/25 jak w danych: start we wtorek 1.10, bez przerw. */
const winter2024: CalendarInput = {
  kind: 'WEEKLY',
  studyMode: 'FULL_TIME',
  startDate: '2024-10-01',
  endDate: '2025-01-31',
  breaks: [],
  days: [],
  zjazdy: [],
};

describe('TeachingCalendar.dayInfo', () => {
  const cal = new TeachingCalendar(winter2024);

  it('swieto ustawowe nie jest dniem zajec', () => {
    expect(cal.dayInfo('2024-11-11')).toMatchObject({ teaching: false, reason: 'HOLIDAY' });
  });

  it('weekend nie jest dniem zajec stacjonarnych', () => {
    expect(cal.dayInfo('2024-10-05')).toMatchObject({ teaching: false, reason: 'NOT_MODE_DAY' });
  });

  it('poza zakresem semestru', () => {
    expect(cal.dayInfo('2024-09-30')).toMatchObject({ teaching: false, reason: 'OUT_OF_RANGE' });
  });

  it('zamiana dni: sobota wg planu poniedzialku jest dniem zajec stacjonarnych', () => {
    const swapped = new TeachingCalendar({
      ...winter2024,
      days: [{ date: '2024-10-12', kind: 'FOLLOWS_WEEKDAY', followsWeekday: 'MONDAY' }],
    });
    expect(swapped.dayInfo('2024-10-12')).toMatchObject({ teaching: true, effectiveWeekday: 1 });
  });
});

describe('numeracja tygodni', () => {
  it('tydzien startu (od wtorku) to tydzien 1 dla wszystkich dni — wspolna parzystosc', () => {
    const cal = new TeachingCalendar(winter2024);
    expect(cal.weekIndexOf('2024-10-01')).toBe(1); // wtorek
    expect(cal.weekIndexOf('2024-10-04')).toBe(1); // piatek
    expect(cal.weekIndexOf('2024-10-07')).toBe(2); // poniedzialek kolejnego tygodnia
  });

  it('tydzien w calosci w przerwie jest pomijany', () => {
    const cal = new TeachingCalendar({
      ...winter2024,
      breaks: [{ name: 'Przerwa swiateczna', startDate: '2024-12-21', endDate: '2025-01-06' }],
    });
    const before = cal.weekIndexOf('2024-12-20')!; // pt przed przerwa
    expect(cal.weekIndexOf('2024-12-23')).toBeNull();
    expect(cal.weekIndexOf('2024-12-30')).toBeNull();
    // tydzien 6-12.01: poniedzialek w przerwie, ale wt-pt nie -> liczony
    expect(cal.weekIndexOf('2025-01-07')).toBe(before + 1);
  });

  it('podglad tygodni pokazuje numery, przerwy i swieta', () => {
    const cal = new TeachingCalendar(winter2024);
    const weeks = cal.teachingWeeks();
    expect(weeks[0]).toMatchObject({ index: 1, monday: '2024-09-30', teachingDays: 4 });
    const november = weeks.find((w) => w.monday === '2024-11-11')!;
    expect(november.notes.some((n) => n.includes('2024-11-11'))).toBe(true);
  });
});

describe('expandDates', () => {
  it('co tydzien we wtorek, bez swiat', () => {
    const dates = expandDates(new TeachingCalendar(winter2024), {
      dayOfWeek: 'MONDAY',
      cycle: 'WEEK',
      pattern: 'ALL',
    }).map((d) => d.date);
    expect(dates[0]).toBe('2024-10-07');
    expect(dates).not.toContain('2024-11-11'); // swieto
  });

  it('tygodnie parzyste: poniedzialek i wtorek tego samego tygodnia maja te sama parzystosc', () => {
    const cal = new TeachingCalendar(winter2024);
    const mondays = expandDates(cal, { dayOfWeek: 'MONDAY', cycle: 'WEEK', pattern: 'EVEN' });
    const tuesdays = expandDates(cal, { dayOfWeek: 'TUESDAY', cycle: 'WEEK', pattern: 'EVEN' });
    expect(mondays[0]!.date).toBe('2024-10-07'); // tydzien 2
    expect(tuesdays[0]!.date).toBe('2024-10-08'); // tydzien 2, nie 1.10
  });

  it('zakres tygodni od-do', () => {
    const dates = expandDates(new TeachingCalendar(winter2024), {
      dayOfWeek: 'WEDNESDAY',
      cycle: 'WEEK',
      pattern: 'ALL',
      fromIndex: 1,
      toIndex: 3,
    });
    expect(dates.map((d) => d.index)).toEqual([1, 2, 3]);
  });

  it('godziny rektorskie odcinaja zajecia od wskazanego bloku', () => {
    const cal = new TeachingCalendar({
      ...winter2024,
      days: [{ date: '2024-10-09', kind: 'CLOSED_FROM', closedFromBlockOrder: 6 }],
    });
    const morning = expandDates(cal, { dayOfWeek: 'WEDNESDAY', cycle: 'WEEK', pattern: 'ALL', startOrder: 2, endOrder: 3 });
    const afternoon = expandDates(cal, { dayOfWeek: 'WEDNESDAY', cycle: 'WEEK', pattern: 'ALL', startOrder: 6, endOrder: 7 });
    expect(morning.map((d) => d.date)).toContain('2024-10-09');
    expect(afternoon.map((d) => d.date)).not.toContain('2024-10-09');
  });

  it('zjazdy: kazdy zjazd i wybrane zjazdy (LIST)', () => {
    const cal = new TeachingCalendar({
      kind: 'ZJAZD',
      studyMode: 'PART_TIME',
      startDate: '2026-10-01',
      endDate: '2027-01-31',
      breaks: [],
      days: [],
      zjazdy: [
        { number: 1, startDate: '2026-10-09', endDate: '2026-10-11' },
        { number: 2, startDate: '2026-10-23', endDate: '2026-10-25' },
        { number: 3, startDate: '2026-11-06', endDate: '2026-11-08' },
      ],
    });
    const everySaturday = expandDates(cal, { dayOfWeek: 'SATURDAY', cycle: 'ZJAZD', pattern: 'ALL' });
    expect(everySaturday.map((d) => d.date)).toEqual(['2026-10-10', '2026-10-24', '2026-11-07']);
    const second = expandDates(cal, { dayOfWeek: 'SUNDAY', cycle: 'ZJAZD', pattern: 'LIST', numbers: [2] });
    expect(second).toEqual([{ date: '2026-10-25', index: 2 }]);
    // sobota poza zjazdem nie jest dniem zajec
    expect(cal.dayInfo('2026-10-17')).toMatchObject({ teaching: false, reason: 'NO_ZJAZD' });
  });
});

describe('validateCalendar', () => {
  it('wykrywa nachodzace zjazdy i brak zjazdow', () => {
    expect(validateCalendar({ ...winter2024, kind: 'ZJAZD', studyMode: 'PART_TIME' })).toContain(
      'Kalendarz zjazdowy nie ma zadnego zjazdu',
    );
    const problems = validateCalendar({
      ...winter2024,
      kind: 'ZJAZD',
      studyMode: 'PART_TIME',
      zjazdy: [
        { number: 1, startDate: '2024-10-04', endDate: '2024-10-06' },
        { number: 2, startDate: '2024-10-06', endDate: '2024-10-08' },
      ],
    });
    expect(problems.some((p) => p.includes('nachodza'))).toBe(true);
  });

  it('poprawny kalendarz nie ma problemow', () => {
    expect(validateCalendar(winter2024)).toEqual([]);
  });
});
