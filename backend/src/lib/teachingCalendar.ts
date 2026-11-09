import type { CalendarDayKind, CalendarKind, DayOfWeek, StudyMode } from '@prisma/client';
import { holidaysInRange } from './holidays';
import { addDays, daysBetween, eachDay, inRange, mondayOf, weekdayOf, type IsoDate } from './isoDate';

/**
 * Kalendarz zajec semestru — czyste funkcje (bez bazy), wspolne dla podgladu
 * kalendarza, walidacji i generowania terminow.
 *
 * Dzien jest dniem zajec, gdy lezy w zakresie semestru, nie jest swietem ustawowym,
 * nie wypada w przerwie ani nie jest ogloszony wolnym, a do tego miesci sie w rytmie
 * kalendarza: tryb tygodniowy -> dni trybu studiow (stacjonarne pon-pt,
 * niestacjonarne pt-nd); tryb zjazdowy -> dni zjazdow.
 *
 * Numer tygodnia liczymy od poniedzialku tygodnia startu, pomijajac tygodnie w calosci
 * zajete przerwa. Wszystkie dni tygodnia dziela ten sam numer, wiec parzystosc
 * (tydzien A/B) jest wspolna dla poniedzialku i wtorku — inaczej niz w starym
 * generatorze, ktory liczyl ja osobno dla kazdego dnia tygodnia.
 */

export interface CalendarBreakInput {
  name?: string | null;
  startDate: IsoDate;
  endDate: IsoDate;
}

export interface CalendarDayInput {
  date: IsoDate;
  kind: CalendarDayKind;
  name?: string | null;
  /** FOLLOWS_WEEKDAY: tego dnia obowiazuje plan wskazanego dnia tygodnia. */
  followsWeekday?: DayOfWeek | null;
  /** CLOSED_FROM: od tego bloku (order) zajecia sa odwolane (godziny rektorskie). */
  closedFromBlockOrder?: number | null;
}

export interface ZjazdInput {
  number: number;
  startDate: IsoDate;
  endDate: IsoDate;
}

export interface CalendarInput {
  kind: CalendarKind;
  studyMode: StudyMode;
  startDate: IsoDate;
  endDate: IsoDate;
  breaks: CalendarBreakInput[];
  days: CalendarDayInput[];
  zjazdy: ZjazdInput[];
}

const WEEKDAY_NUM: Record<DayOfWeek, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

export const WEEKDAY_ENUM: DayOfWeek[] = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

/** Dni tygodnia, w ktorych tryb studiow w ogole ma zajecia. */
export function modeWeekdays(studyMode: StudyMode): number[] {
  return studyMode === 'FULL_TIME' ? [1, 2, 3, 4, 5] : [5, 6, 0];
}

/** Przyczyna, dla ktorej dzien nie jest dniem zajec (null = jest dniem zajec). */
export type DayBlockReason = 'OUT_OF_RANGE' | 'HOLIDAY' | 'BREAK' | 'DAY_OFF' | 'NOT_MODE_DAY' | 'NO_ZJAZD';

export interface DayInfo {
  date: IsoDate;
  /** Dzien tygodnia, wg ktorego planu odbywaja sie zajecia (po zamianie dni). */
  effectiveWeekday: number;
  teaching: boolean;
  reason: DayBlockReason | null;
  /** Nazwa swieta / przerwy / dnia wolnego — do podgladu. */
  label: string | null;
  /** Zamkniecie od bloku (godziny rektorskie), jesli ustawione. */
  closedFromBlockOrder: number | null;
}

/** Dzien zajec z gotowymi numerami tygodnia i zjazdu — material dla expandDates. */
interface TeachingDay {
  date: IsoDate;
  closedFromBlockOrder: number | null;
  week: number | null;
  zjazd: number | null;
}

/**
 * Indeks kalendarza z prekomputowanymi wyszukiwaniami. Budujemy go raz na kalendarz
 * i odpytujemy dla wielu dat (generowanie terminow siega kilkuset dni x setek zajec).
 */
export class TeachingCalendar {
  private readonly holidays: Map<IsoDate, string>;
  private readonly overrides: Map<IsoDate, CalendarDayInput>;
  private readonly startMonday: IsoDate;
  private readonly weekIndexCache = new Map<IsoDate, number | null>();
  private teachingDaysCache: Map<number, TeachingDay[]> | null = null;

  constructor(readonly input: CalendarInput) {
    this.holidays = new Map(holidaysInRange(input.startDate, input.endDate).map((h) => [h.date, h.name]));
    this.overrides = new Map(input.days.map((day) => [day.date, day]));
    this.startMonday = mondayOf(input.startDate);
  }

  private breakOf(date: IsoDate): CalendarBreakInput | undefined {
    return this.input.breaks.find((b) => inRange(date, b.startDate, b.endDate));
  }

  zjazdOf(date: IsoDate): ZjazdInput | undefined {
    return this.input.zjazdy.find((z) => inRange(date, z.startDate, z.endDate));
  }

  dayInfo(date: IsoDate): DayInfo {
    const override = this.overrides.get(date);
    const effectiveWeekday =
      override?.kind === 'FOLLOWS_WEEKDAY' && override.followsWeekday
        ? WEEKDAY_NUM[override.followsWeekday]
        : weekdayOf(date);
    const closedFromBlockOrder =
      override?.kind === 'CLOSED_FROM' ? (override.closedFromBlockOrder ?? null) : null;
    const blocked = (reason: DayBlockReason, label: string | null): DayInfo => ({
      date,
      effectiveWeekday,
      teaching: false,
      reason,
      label,
      closedFromBlockOrder,
    });

    if (!inRange(date, this.input.startDate, this.input.endDate)) return blocked('OUT_OF_RANGE', null);
    const holiday = this.holidays.get(date);
    if (holiday) return blocked('HOLIDAY', holiday);
    const pause = this.breakOf(date);
    if (pause) return blocked('BREAK', pause.name ?? 'Przerwa');
    if (override?.kind === 'DAY_OFF') return blocked('DAY_OFF', override.name ?? 'Dzien wolny');
    if (this.input.kind === 'ZJAZD') {
      if (!this.zjazdOf(date)) return blocked('NO_ZJAZD', null);
    } else if (!modeWeekdays(this.input.studyMode).includes(effectiveWeekday)) {
      return blocked('NOT_MODE_DAY', null);
    }
    return {
      date,
      effectiveWeekday,
      teaching: true,
      reason: null,
      label: override?.name ?? null,
      closedFromBlockOrder,
    };
  }

  /**
   * Numer tygodnia zajec (1, 2, ...) albo null, gdy tydzien w calosci przypada na
   * przerwe (albo data jest przed startem). Tydzien jest pomijany, jesli zaden z dni
   * trybu studiow w zakresie semestru nie lezy poza przerwa — swieta pojedynczych dni
   * nie przesuwaja numeracji.
   */
  weekIndexOf(date: IsoDate): number | null {
    const monday = mondayOf(date);
    if (this.weekIndexCache.has(monday)) return this.weekIndexCache.get(monday)!;
    if (monday < this.startMonday || date > this.input.endDate) {
      this.weekIndexCache.set(monday, null);
      return null;
    }
    let index = 0;
    let result: number | null = null;
    for (let week = this.startMonday; week <= monday; week = addDays(week, 7)) {
      const counted = this.isCountedWeek(week);
      if (counted) index++;
      if (week === monday) result = counted ? index : null;
    }
    this.weekIndexCache.set(monday, result);
    return result;
  }

  private isCountedWeek(monday: IsoDate): boolean {
    const weekdays = modeWeekdays(this.input.studyMode);
    for (let offset = 0; offset < 7; offset++) {
      const day = addDays(monday, offset);
      if (!weekdays.includes(weekdayOf(day))) continue;
      if (!inRange(day, this.input.startDate, this.input.endDate)) continue;
      if (!this.breakOf(day)) return true;
    }
    return false;
  }

  /** Numer zjazdu obejmujacego date albo null. */
  zjazdIndexOf(date: IsoDate): number | null {
    return this.zjazdOf(date)?.number ?? null;
  }

  /**
   * Dni zajec semestru pogrupowane wg efektywnego dnia tygodnia (po zamianach dni), w kolejnosci
   * dat, z numerem tygodnia i zjazdu. Liczone raz na kalendarz: setki umieszczen dzieli kilka
   * kalendarzy i piec-siedem dni tygodnia, wiec expandDates tylko filtruje gotowa liste
   * zamiast sprawdzac kazdy dzien semestru dla kazdego umieszczenia.
   */
  teachingDaysByWeekday(): Map<number, TeachingDay[]> {
    if (this.teachingDaysCache) return this.teachingDaysCache;
    const byWeekday = new Map<number, TeachingDay[]>();
    for (const date of eachDay(this.input.startDate, this.input.endDate)) {
      const info = this.dayInfo(date);
      if (!info.teaching) continue;
      const list = byWeekday.get(info.effectiveWeekday) ?? [];
      list.push({ date, closedFromBlockOrder: info.closedFromBlockOrder, week: this.weekIndexOf(date), zjazd: this.zjazdIndexOf(date) });
      byWeekday.set(info.effectiveWeekday, list);
    }
    this.teachingDaysCache = byWeekday;
    return byWeekday;
  }

  /** Tygodnie zajec z numerami — do podgladu kalendarza i przelicznikow godzin. */
  teachingWeeks(): TeachingWeek[] {
    const weeks: TeachingWeek[] = [];
    for (let monday = this.startMonday; monday <= this.input.endDate; monday = addDays(monday, 7)) {
      const index = this.weekIndexOf(monday < this.input.startDate ? this.input.startDate : monday);
      const days = Array.from({ length: 7 }, (_, i) => this.dayInfo(addDays(monday, i)));
      weeks.push({
        index,
        monday,
        sunday: addDays(monday, 6),
        teachingDays: days.filter((day) => day.teaching).length,
        notes: days
          .filter((day) => day.label && (day.reason === 'HOLIDAY' || day.reason === 'DAY_OFF'))
          .map((day) => `${day.date}: ${day.label}`),
        breakName: index === null ? (this.breakOf(addDays(monday, 2))?.name ?? null) : null,
      });
    }
    return weeks;
  }
}

export interface TeachingWeek {
  /** null = tydzien pominiety (przerwa). */
  index: number | null;
  monday: IsoDate;
  sunday: IsoDate;
  teachingDays: number;
  notes: string[];
  breakName: string | null;
}

/** Rytm umieszczenia zajec w kalendarzu (wzorzec tygodnia albo zjazdu). */
export interface SlotPattern {
  dayOfWeek: DayOfWeek;
  cycle: 'WEEK' | 'ZJAZD';
  pattern: 'ALL' | 'EVEN' | 'ODD' | 'LIST';
  /** Numery tygodni/zjazdow dla pattern = LIST. */
  numbers?: number[];
  fromIndex?: number | null;
  toIndex?: number | null;
  /** Zakres blokow — do odciecia dni z godzinami rektorskimi. */
  startOrder?: number;
  endOrder?: number;
}

export interface ExpandedDate {
  date: IsoDate;
  /** Numer tygodnia (cycle WEEK) albo zjazdu (cycle ZJAZD). */
  index: number;
}

/**
 * Wszystkie daty, w ktore wypada umieszczenie zajec. Bez limitu godzin — ten nakladamy
 * przy generowaniu terminow, bo dotyczy sumy wszystkich umieszczen jednych zajec.
 */
export function expandDates(calendar: TeachingCalendar, slot: SlotPattern): ExpandedDate[] {
  const result: ExpandedDate[] = [];
  for (const day of calendar.teachingDaysByWeekday().get(WEEKDAY_NUM[slot.dayOfWeek]) ?? []) {
    const date = day.date;
    if (day.closedFromBlockOrder !== null && slot.endOrder !== undefined && slot.endOrder >= day.closedFromBlockOrder) {
      continue;
    }
    const index = slot.cycle === 'WEEK' ? day.week : day.zjazd;
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

/** Dzien okresu (tygodnia albo zjazdu) do widoku tygodnia terminow. */
export interface PeriodDay {
  date: IsoDate;
  dayOfWeek: DayOfWeek;
  /** Czy w tym dniu wg kalendarza sa zajecia. */
  teaching: boolean;
  /** Swieto, przerwa, dzien wolny albo nazwa zmiany dnia (null = zwykly dzien). */
  label: string | null;
  /** Zajecia wg planu innego dnia tygodnia (np. sroda wg planu piatku). */
  followsWeekday: DayOfWeek | null;
  /** Godziny rektorskie: zajecia od tego bloku odwolane. */
  closedFromBlockOrder: number | null;
}

/** Okres nawigacji widoku tygodnia: tydzien kalendarzowy (pn-nd) albo zjazd. */
export interface CalendarPeriod {
  /** Numer tygodnia zajec / zjazdu; null = tydzien w calosci w przerwie. */
  index: number | null;
  label: string;
  from: IsoDate;
  to: IsoDate;
  days: PeriodDay[];
}

/**
 * Okresy semestru do przegladania terminow tydzien po tygodniu: dla kalendarza tygodniowego
 * kazdy tydzien (pn-nd, takze w przerwie — zeby bylo widac, ze jest pusty), dla zjazdowego
 * kazdy zjazd. Dni niosa swieta, przerwy, dni wolne i zamiany dni.
 */
export function calendarPeriods(calendar: TeachingCalendar): CalendarPeriod[] {
  const dayOf = (date: IsoDate): PeriodDay => {
    const info = calendar.dayInfo(date);
    const weekday = weekdayOf(date);
    const named = info.reason === 'HOLIDAY' || info.reason === 'BREAK' || info.reason === 'DAY_OFF';
    return {
      date,
      dayOfWeek: WEEKDAY_ENUM[weekday]!,
      teaching: info.teaching,
      label: info.teaching || named ? info.label : null,
      followsWeekday: info.teaching && info.effectiveWeekday !== weekday ? WEEKDAY_ENUM[info.effectiveWeekday]! : null,
      closedFromBlockOrder: info.closedFromBlockOrder,
    };
  };
  const input = calendar.input;
  if (input.kind === 'ZJAZD') {
    return [...input.zjazdy]
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .map((z) => ({
        index: z.number,
        label: `Zjazd ${z.number}`,
        from: z.startDate,
        to: z.endDate,
        days: [...eachDay(z.startDate, z.endDate)].map(dayOf),
      }));
  }
  return calendar.teachingWeeks().map((week) => ({
    index: week.index,
    label: week.index !== null ? `Tydzien ${week.index}` : `Przerwa${week.breakName ? `: ${week.breakName}` : ''}`,
    from: week.monday,
    to: week.sunday,
    days: [...eachDay(week.monday, week.sunday)].map(dayOf),
  }));
}

/** Problemy spojnosci kalendarza — zwracane przed zapisem, zeby nie zapisac bzdur. */
export function validateCalendar(input: CalendarInput): string[] {
  const problems: string[] = [];
  if (input.startDate > input.endDate) problems.push('Poczatek semestru jest pozniej niz koniec');
  if (daysBetween(input.startDate, input.endDate) > 200) problems.push('Semestr dluzszy niz 200 dni');
  for (const pause of input.breaks) {
    if (pause.startDate > pause.endDate) problems.push(`Przerwa "${pause.name ?? ''}": poczatek po koncu`);
  }
  const dates = new Set<string>();
  for (const day of input.days) {
    if (dates.has(day.date)) problems.push(`Dzien ${day.date} ma dwa wpisy`);
    dates.add(day.date);
    if (day.kind === 'FOLLOWS_WEEKDAY' && !day.followsWeekday) {
      problems.push(`Dzien ${day.date}: wskaz, wg ktorego dnia tygodnia sa zajecia`);
    }
    if (day.kind === 'CLOSED_FROM' && !day.closedFromBlockOrder) {
      problems.push(`Dzien ${day.date}: wskaz blok, od ktorego zajecia sa odwolane`);
    }
  }
  const sorted = [...input.zjazdy].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const numbers = new Set<number>();
  sorted.forEach((zjazd, i) => {
    if (numbers.has(zjazd.number)) problems.push(`Zjazd nr ${zjazd.number} wystepuje dwa razy`);
    numbers.add(zjazd.number);
    if (zjazd.startDate > zjazd.endDate) problems.push(`Zjazd nr ${zjazd.number}: poczatek po koncu`);
    if (!inRange(zjazd.startDate, input.startDate, input.endDate) || !inRange(zjazd.endDate, input.startDate, input.endDate)) {
      problems.push(`Zjazd nr ${zjazd.number} wykracza poza semestr`);
    }
    const previous = sorted[i - 1];
    if (previous && zjazd.startDate <= previous.endDate) {
      problems.push(`Zjazdy nr ${previous.number} i ${zjazd.number} nachodza na siebie`);
    }
  });
  if (input.kind === 'ZJAZD' && input.zjazdy.length === 0) {
    problems.push('Kalendarz zjazdowy nie ma zadnego zjazdu');
  }
  return problems;
}

/**
 * Klucz dat kalendarza — wszystko, od czego zaleza terminy: rodzaj, daty semestru, przerwy,
 * dni wyjatkowe i zjazdy. Bez nazw (przerw, dni) i kolejnosci na liscie. Rozne klucze =
 * terminy wygenerowane wg starej wersji kalendarza sa nieaktualne.
 */
export function calendarDatesKey(input: Omit<CalendarInput, 'studyMode'>): string {
  const sorted = <T>(rows: T[]) => rows.map((r) => JSON.stringify(r)).sort();
  return JSON.stringify({
    kind: input.kind,
    startDate: input.startDate,
    endDate: input.endDate,
    breaks: sorted(input.breaks.map((b) => [b.startDate, b.endDate])),
    days: sorted(
      input.days.map((d) => [
        d.date,
        d.kind,
        d.kind === 'FOLLOWS_WEEKDAY' ? (d.followsWeekday ?? null) : null,
        d.kind === 'CLOSED_FROM' ? (d.closedFromBlockOrder ?? null) : null,
      ]),
    ),
    zjazdy: sorted(input.zjazdy.map((z) => [z.number, z.startDate, z.endDate])),
  });
}

/** Powody, ktore planista nazywa "dniem wolnym" (a nie po prostu dniem bez zajec trybu). */
const DAY_OFF_REASONS: DayBlockReason[] = ['HOLIDAY', 'BREAK', 'DAY_OFF'];

/**
 * Dni wolne w planie osobistym (student, prowadzacy) — opis do kolumny kalendarza tygodnia.
 * Osoba moze miec zajecia wg kilku kalendarzy (prowadzacy na kilku wydzialach), wiec dzien jest
 * wolny tylko wtedy, gdy w ZADNYM z nich nie ma zajec, a co najmniej jeden podaje powod (swieto,
 * przerwa, dzien wolny uczelni). Bez kalendarzy — same swieta ustawowe.
 */
export function personalDaysOff(dates: IsoDate[], calendars: TeachingCalendar[]): Record<IsoDate, string> {
  const result: Record<IsoDate, string> = {};
  for (const date of dates) {
    if (calendars.length === 0) {
      const holiday = holidaysInRange(date, date)[0];
      if (holiday) result[date] = holiday.name;
      continue;
    }
    const infos = calendars.map((c) => c.dayInfo(date));
    if (infos.some((i) => i.teaching)) continue;
    const labels = [...new Set(infos.filter((i) => i.reason && DAY_OFF_REASONS.includes(i.reason)).map((i) => i.label ?? 'Dzien wolny'))];
    if (labels.length > 0) result[date] = labels.join(' / ');
  }
  return result;
}
