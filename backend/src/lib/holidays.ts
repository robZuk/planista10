import { addDays, isoDate, yearOf, type IsoDate } from './isoDate';

/**
 * Swieta ustawowe w Polsce (dni wolne od pracy, ustawa z 18.01.1951) — LICZONE,
 * a nie wpisywane co roku recznie. Stale daty plus swieta ruchome zalezne od
 * Wielkanocy. Od 2025 r. dniem wolnym jest takze Wigilia (24.12).
 *
 * Dni wolne specyficzne dla uczelni (rektorskie, dziekanskie, przerwy) to dane
 * kalendarza semestru (CalendarDay / CalendarBreak), nie ta lista.
 */

export interface Holiday {
  date: IsoDate;
  name: string;
}

/** Niedziela Wielkanocna — algorytm Meeusa/Jonesa/Butchera (kalendarz gregorianski). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

/** Wszystkie swieta ustawowe danego roku kalendarzowego, posortowane po dacie. */
export function polishHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const list: Holiday[] = [
    { date: isoDate(year, 1, 1), name: 'Nowy Rok' },
    { date: isoDate(year, 1, 6), name: 'Święto Trzech Króli' },
    { date: easter, name: 'Niedziela Wielkanocna' },
    { date: addDays(easter, 1), name: 'Poniedziałek Wielkanocny' },
    { date: isoDate(year, 5, 1), name: 'Święto Pracy' },
    { date: isoDate(year, 5, 3), name: 'Święto Konstytucji 3 Maja' },
    { date: addDays(easter, 49), name: 'Zesłanie Ducha Świętego' },
    { date: addDays(easter, 60), name: 'Boże Ciało' },
    { date: isoDate(year, 8, 15), name: 'Wniebowzięcie NMP' },
    { date: isoDate(year, 11, 1), name: 'Wszystkich Świętych' },
    { date: isoDate(year, 11, 11), name: 'Narodowe Święto Niepodległości' },
    { date: isoDate(year, 12, 25), name: 'Boże Narodzenie' },
    { date: isoDate(year, 12, 26), name: 'Drugi dzień Bożego Narodzenia' },
  ];
  if (year >= 2025) list.push({ date: isoDate(year, 12, 24), name: 'Wigilia Bożego Narodzenia' });
  return list.sort((x, y) => x.date.localeCompare(y.date));
}

/** Swieta ustawowe w przedziale domknietym [from, to] (moze obejmowac kilka lat). */
export function holidaysInRange(from: IsoDate, to: IsoDate): Holiday[] {
  const result: Holiday[] = [];
  for (let year = yearOf(from); year <= yearOf(to); year++) {
    for (const holiday of polishHolidays(year)) {
      if (holiday.date >= from && holiday.date <= to) result.push(holiday);
    }
  }
  return result;
}
