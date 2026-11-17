import { describe, expect, it } from 'vitest';
import { calendarDatesKey, calendarPeriods, expandDates, inPeriod, personalDaysOff, semesterWeekOf, TeachingCalendar, validateCalendar, type CalendarInput, type ExpandedDate, type SlotPattern } from './teachingCalendar';
import { eachDay } from './isoDate';

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

  it('podglad tygodni opisuje tez wyjatki dni zajec (inny plan dnia, godziny rektorskie)', () => {
    const cal = new TeachingCalendar({
      ...winter2024,
      days: [
        { date: '2024-11-15', kind: 'FOLLOWS_WEEKDAY', followsWeekday: 'MONDAY' },
        { date: '2024-11-14', kind: 'CLOSED_FROM', closedFromBlockOrder: 5, name: 'Godziny rektorskie' },
      ],
    });
    const notes = cal.teachingWeeks().find((w) => w.monday === '2024-11-11')!.notes;
    expect(notes).toContain('2024-11-15: zajecia wg planu — poniedzialek');
    expect(notes).toContain('2024-11-14: Godziny rektorskie od bloku 5');
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

describe('expandDates — szybka wersja daje to samo co sprawdzanie kazdego dnia', () => {
  // Wzorzec: dotychczasowy algorytm (kazdy dzien semestru przez dayInfo).
  function reference(calendar: TeachingCalendar, slot: SlotPattern): ExpandedDate[] {
    const weekdayNum: Record<string, number> = { SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6 };
    const result: ExpandedDate[] = [];
    for (const date of eachDay(calendar.input.startDate, calendar.input.endDate)) {
      const info = calendar.dayInfo(date);
      if (!info.teaching || info.effectiveWeekday !== weekdayNum[slot.dayOfWeek]) continue;
      if (info.closedFromBlockOrder !== null && slot.endOrder !== undefined && slot.endOrder >= info.closedFromBlockOrder) continue;
      const index = slot.cycle === 'WEEK' ? calendar.weekIndexOf(date) : calendar.zjazdIndexOf(date);
      if (index === null) continue;
      if (slot.pattern === 'EVEN' && index % 2 !== 0) continue;
      if (slot.pattern === 'ODD' && index % 2 !== 1) continue;
      if (slot.pattern === 'LIST' && !(slot.numbers ?? []).includes(index)) continue;
      if (slot.fromIndex != null && index < slot.fromIndex) continue;
      if (slot.toIndex != null && index > slot.toIndex) continue;
      result.push({ date, index });
    }
    return result;
  }

  const weekly = new TeachingCalendar({
    kind: 'WEEKLY',
    studyMode: 'FULL_TIME',
    startDate: '2026-10-01',
    endDate: '2027-02-05',
    breaks: [{ name: 'Swieta', startDate: '2026-12-22', endDate: '2027-01-02' }],
    days: [
      { date: '2026-10-14', kind: 'DAY_OFF', name: 'Rektorski' },
      { date: '2026-11-13', kind: 'FOLLOWS_WEEKDAY', followsWeekday: 'MONDAY' },
      { date: '2026-12-04', kind: 'CLOSED_FROM', closedFromBlockOrder: 7 },
    ],
    zjazdy: [],
  });
  const zjazdy = new TeachingCalendar({
    kind: 'ZJAZD',
    studyMode: 'PART_TIME',
    startDate: '2026-10-01',
    endDate: '2027-02-07',
    breaks: [],
    days: [{ date: '2026-10-17', kind: 'CLOSED_FROM', closedFromBlockOrder: 5 }],
    zjazdy: [
      { number: 1, startDate: '2026-10-01', endDate: '2026-10-04' }, // od czwartku
      { number: 2, startDate: '2026-10-16', endDate: '2026-10-18' },
      { number: 3, startDate: '2026-11-06', endDate: '2026-11-08' },
      { number: 4, startDate: '2026-11-20', endDate: '2026-11-22' },
    ],
  });

  const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
  const variants: Omit<SlotPattern, 'dayOfWeek' | 'cycle'>[] = [
    { pattern: 'ALL' },
    { pattern: 'EVEN' },
    { pattern: 'ODD', endOrder: 8 },
    { pattern: 'LIST', numbers: [1, 3, 4] },
    { pattern: 'ALL', fromIndex: 2, toIndex: 7, endOrder: 4 },
    { pattern: 'ALL', endOrder: 9 }, // odciete przez godziny rektorskie od bloku 7/5
  ];

  it('kalendarz tygodniowy i zjazdowy: wszystkie dni, rytmy i zakresy', () => {
    let compared = 0;
    for (const [calendar, cycle] of [
      [weekly, 'WEEK'],
      [zjazdy, 'ZJAZD'],
      [zjazdy, 'WEEK'],
    ] as const) {
      for (const dayOfWeek of DAYS) {
        for (const v of variants) {
          const slot: SlotPattern = { dayOfWeek, cycle, ...v };
          expect(expandDates(calendar, slot)).toEqual(reference(calendar, slot));
          compared++;
        }
      }
    }
    expect(compared).toBe(3 * 7 * variants.length);
    // kontrola sensu: zamiana dni dodaje piatek 13.11 do poniedzialkow, zjazd 1 ma czwartek
    expect(expandDates(weekly, { dayOfWeek: 'MONDAY', cycle: 'WEEK', pattern: 'ALL' }).map((d) => d.date)).toContain('2026-11-13');
    expect(expandDates(zjazdy, { dayOfWeek: 'THURSDAY', cycle: 'ZJAZD', pattern: 'ALL' }).map((d) => d.date)).toEqual(['2026-10-01']);
  });
});

describe('calendarPeriods — okresy widoku tygodnia terminow', () => {
  it('kalendarz tygodniowy: tygodnie pn-nd z numerami, swietami i przerwa', () => {
    const cal = new TeachingCalendar({
      ...winter2024,
      breaks: [{ name: 'Przerwa swiateczna', startDate: '2024-12-23', endDate: '2025-01-01' }],
      days: [{ date: '2024-11-16', kind: 'FOLLOWS_WEEKDAY', followsWeekday: 'MONDAY' }],
    });
    const periods = calendarPeriods(cal);
    expect(periods[0]).toMatchObject({ index: 1, label: 'Tydzien 1', from: '2024-09-30', to: '2024-10-06' });
    expect(periods[0]!.days).toHaveLength(7);
    // 30.09 przed startem semestru — nie jest dniem zajec, bez etykiety.
    expect(periods[0]!.days[0]).toMatchObject({ date: '2024-09-30', dayOfWeek: 'MONDAY', teaching: false, label: null });
    const nov = periods.find((p) => p.from === '2024-11-11')!;
    expect(nov.days[0]).toMatchObject({ dayOfWeek: 'MONDAY', teaching: false, label: 'Narodowe Święto Niepodległości' });
    // Sobota wg planu poniedzialku.
    expect(nov.days[5]).toMatchObject({ dayOfWeek: 'SATURDAY', teaching: true, followsWeekday: 'MONDAY' });
    const xmas = periods.find((p) => p.from === '2024-12-23')!;
    expect(xmas).toMatchObject({ index: null, label: 'Przerwa: Przerwa swiateczna' });
    expect(xmas.days[0]).toMatchObject({ teaching: false, label: 'Przerwa swiateczna' });
  });

  it('kalendarz zjazdowy: okres = zjazd z jego dniami', () => {
    const cal = new TeachingCalendar({
      ...winter2024,
      kind: 'ZJAZD',
      studyMode: 'PART_TIME',
      zjazdy: [
        { number: 2, startDate: '2024-10-18', endDate: '2024-10-20' },
        { number: 1, startDate: '2024-10-04', endDate: '2024-10-06' },
      ],
    });
    const periods = calendarPeriods(cal);
    // Zjazd opisany numerem tygodnia semestru (tydz. 1 = tydzien startu 1.10), jak w arkuszu planu.
    expect(periods.map((p) => [p.index, p.label, p.from, p.to])).toEqual([
      [1, 'tydz. 1', '2024-10-04', '2024-10-06'],
      [2, 'tydz. 3', '2024-10-18', '2024-10-20'],
    ]);
    expect(periods[0]!.days.map((d) => [d.dayOfWeek, d.teaching])).toEqual([
      ['FRIDAY', true],
      ['SATURDAY', true],
      ['SUNDAY', true],
    ]);
  });
});

describe('semesterWeekOf — „tydz.” zjazdu jak w arkuszu planu niestacjonarnych', () => {
  // Zima 2026/27: start w czwartek 1.10 (tydzien 1 = 28.09-4.10); przerwy licza sie do numeracji.
  it.each([
    ['2026-10-02', 1], // pt pierwszego zjazdu
    ['2026-10-04', 1], // nd tego samego tygodnia
    ['2026-10-09', 2],
    ['2026-10-30', 5], // przerwa (Wszystkich Swietych) — luka w zjazdach
    ['2026-11-06', 6],
    ['2027-01-08', 15], // po dwoch tygodniach przerwy swiatecznej
    ['2027-01-30', 18],
    ['2027-02-05', 19],
  ])('%s -> tydz. %i', (date, week) => {
    expect(semesterWeekOf(date, '2026-10-01')).toBe(week);
  });
});

describe('calendarDatesKey', () => {
  const base = {
    kind: 'ZJAZD' as const,
    startDate: '2026-10-01',
    endDate: '2027-01-31',
    breaks: [
      { name: 'Przerwa swiateczna', startDate: '2026-12-23', endDate: '2027-01-01' },
      { name: 'Dni rektorskie', startDate: '2026-11-02', endDate: '2026-11-03' },
    ],
    days: [{ date: '2026-11-12', kind: 'DAY_OFF' as const, name: 'Dzien rektorski', followsWeekday: null, closedFromBlockOrder: null }],
    zjazdy: [
      { number: 1, startDate: '2026-10-03', endDate: '2026-10-04' },
      { number: 2, startDate: '2026-10-17', endDate: '2026-10-18' },
    ],
  };

  it('nazwy i kolejnosc na liscie nie zmieniaja klucza', () => {
    const renamed = {
      ...base,
      breaks: [...base.breaks].reverse().map((b) => ({ ...b, name: 'inna nazwa' })),
      days: base.days.map((d) => ({ ...d, name: null })),
      zjazdy: [...base.zjazdy].reverse(),
    };
    expect(calendarDatesKey(renamed)).toBe(calendarDatesKey(base));
  });

  it('nowa przerwa, przesuniety zjazd, inny koniec semestru i rodzaj — inny klucz', () => {
    const key = calendarDatesKey(base);
    expect(calendarDatesKey({ ...base, breaks: [...base.breaks, { name: 'X', startDate: '2026-11-20', endDate: '2026-11-20' }] })).not.toBe(key);
    expect(calendarDatesKey({ ...base, zjazdy: [base.zjazdy[0]!, { number: 2, startDate: '2026-10-24', endDate: '2026-10-25' }] })).not.toBe(key);
    expect(calendarDatesKey({ ...base, endDate: '2027-02-07' })).not.toBe(key);
    expect(calendarDatesKey({ ...base, kind: 'WEEKLY' })).not.toBe(key);
  });

  it('pola nieuzywane przez rodzaj dnia sa pomijane', () => {
    const withNoise = { ...base, days: base.days.map((d) => ({ ...d, followsWeekday: 'MONDAY' as const, closedFromBlockOrder: 3 })) };
    expect(calendarDatesKey(withNoise)).toBe(calendarDatesKey(base));
  });
});

describe('personalDaysOff', () => {
  const weekly = (over: Partial<CalendarInput> = {}): TeachingCalendar =>
    new TeachingCalendar({ kind: 'WEEKLY', studyMode: 'FULL_TIME', startDate: '2026-10-01', endDate: '2027-01-31', breaks: [], days: [], zjazdy: [], ...over });
  const zjazdy = new TeachingCalendar({
    kind: 'ZJAZD',
    studyMode: 'PART_TIME',
    startDate: '2026-10-01',
    endDate: '2027-01-31',
    breaks: [],
    days: [],
    zjazdy: [{ number: 1, startDate: '2026-11-13', endDate: '2026-11-15' }],
  });
  const week = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];

  it('swieto ustawowe — takze gdy drugi kalendarz (zjazdy) po prostu nie ma tego dnia zajec', () => {
    expect(personalDaysOff(week, [weekly(), zjazdy])).toEqual({ '2026-11-11': 'Narodowe Święto Niepodległości' });
  });

  it('przerwa jednego wydzialu nie jest dniem wolnym, gdy w drugim sa zajecia', () => {
    const wm = weekly({ breaks: [{ name: 'Dni rektorskie WM', startDate: '2026-11-09', endDate: '2026-11-10' }] });
    expect(personalDaysOff(week, [wm, weekly()])['2026-11-09']).toBeUndefined();
    expect(personalDaysOff(week, [wm])['2026-11-09']).toBe('Dni rektorskie WM');
  });

  it('dzien wolny uczelni z wlasna nazwa; bez kalendarzy — same swieta', () => {
    const cal = weekly({ days: [{ date: '2026-11-10', kind: 'DAY_OFF', name: 'Dzien sportu' }] });
    expect(personalDaysOff(week, [cal])['2026-11-10']).toBe('Dzien sportu');
    expect(personalDaysOff(week, [])).toEqual({ '2026-11-11': 'Narodowe Święto Niepodległości' });
  });
});

describe('inPeriod — czy tydzien/zjazd nalezy do rytmu umieszczenia', () => {
  const rule = (extra: Partial<Pick<SlotPattern, 'pattern' | 'numbers' | 'fromIndex' | 'toIndex'>> = {}) => ({ pattern: 'ALL' as const, ...extra });
  const of = (r: Parameters<typeof inPeriod>[0]) => [1, 2, 3, 4, 5, 6].filter((n) => inPeriod(r, n));

  it('kazdy, parzyste, nieparzyste, wybrane', () => {
    expect(of(rule())).toEqual([1, 2, 3, 4, 5, 6]);
    expect(of(rule({ pattern: 'EVEN' }))).toEqual([2, 4, 6]);
    expect(of(rule({ pattern: 'ODD' }))).toEqual([1, 3, 5]);
    expect(of(rule({ pattern: 'LIST', numbers: [2, 5] }))).toEqual([2, 5]);
  });

  it('zakres od-do laczy sie z wzorem', () => {
    expect(of(rule({ fromIndex: 2, toIndex: 4 }))).toEqual([2, 3, 4]);
    expect(of(rule({ pattern: 'LIST', numbers: [1, 3, 5], toIndex: 3 }))).toEqual([1, 3]);
  });
});
