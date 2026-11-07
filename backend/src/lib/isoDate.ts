/**
 * Daty kalendarzowe jako tekst "YYYY-MM-DD" — bez stref czasowych.
 *
 * Kalendarz semestru operuje na DNIACH, nie na chwilach w czasie. Arytmetyka na
 * obiektach Date w strefie lokalnej potrafi przesunac dzien przy zmianie czasu,
 * wiec liczymy w UTC (polnoc UTC = ten sam dzien niezaleznie od strefy serwera),
 * a na zewnatrz wystawiamy wylacznie tekst.
 */

export type IsoDate = string;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isoDate(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Date (polnoc UTC, jak zwraca Prisma dla @db.Date) albo ISO string -> "YYYY-MM-DD". */
export function toIsoDate(value: Date | string): IsoDate {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" -> Date o polnocy UTC (do zapisu w kolumnie @db.Date). */
export function fromIsoDate(value: IsoDate): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** Rozbicie recznie (Date.UTC normalizuje np. 29.02 roku nieprzestepnego na 1.03). */
function toUtc(value: IsoDate): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}

export function addDays(value: IsoDate, days: number): IsoDate {
  const date = toUtc(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Dzien tygodnia: 0 = niedziela ... 6 = sobota (jak Date.getUTCDay). */
export function weekdayOf(value: IsoDate): number {
  return toUtc(value).getUTCDay();
}

/** Poniedzialek tygodnia, w ktorym lezy data. */
export function mondayOf(value: IsoDate): IsoDate {
  const weekday = weekdayOf(value);
  return addDays(value, weekday === 0 ? -6 : 1 - weekday);
}

/** Liczba dni od `from` do `to` (ujemna, gdy `to` jest wczesniej). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** Kolejne dni z przedzialu domknietego [from, to]. */
export function* eachDay(from: IsoDate, to: IsoDate): Generator<IsoDate> {
  for (let day = from; day <= to; day = addDays(day, 1)) {
    yield day;
  }
}

/** Czy `value` lezy w przedziale domknietym [from, to] (porownanie tekstowe jest poprawne dla ISO). */
export function inRange(value: IsoDate, from: IsoDate, to: IsoDate): boolean {
  return value >= from && value <= to;
}

export function yearOf(value: IsoDate): number {
  return Number(value.slice(0, 4));
}

/** Dzisiejsza data (wg UTC) — wydzielone, zeby testy mogly ja podmienic. */
export function todayIso(): IsoDate {
  return new Date().toISOString().slice(0, 10);
}
