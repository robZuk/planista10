import type { SemesterType } from '@prisma/client';
import { addDays, isoDate, mondayOf, weekdayOf, yearOf, type IsoDate } from './isoDate';

/**
 * Semestr kalendarzowy (AcademicTerm) — jedyny kontekst czasowy planowania.
 *
 * Semestr opisuje para (rok startu roku akademickiego, typ): zima 2026 = "2026/2027
 * zimowy", lato 2026 = "2026/2027 letni" (fizycznie luty-czerwiec 2027). Porzadkujemy
 * je liczba porzadkowa `ordinal`, dzieki ktorej arytmetyka "ktory semestr programu
 * realizuje rocznik" sprowadza sie do odejmowania (patrz cohortSemesterInTerm).
 */

export interface TermRef {
  startYear: number;
  type: SemesterType;
}

export function termOrdinal(term: TermRef): number {
  return term.startYear * 2 + (term.type === 'SUMMER' ? 1 : 0);
}

export function termFromOrdinal(ordinal: number): TermRef {
  return { startYear: Math.floor(ordinal / 2), type: ordinal % 2 === 1 ? 'SUMMER' : 'WINTER' };
}

/** Przesuniecie o `semesters` semestrow (ujemne = wstecz). */
export function shiftTerm(term: TermRef, semesters: number): TermRef {
  return termFromOrdinal(termOrdinal(term) + semesters);
}

/** Klucz do adresu URL: "2026-Z" (zimowy) / "2026-L" (letni). */
export function termKey(term: TermRef): string {
  return `${term.startYear}-${term.type === 'SUMMER' ? 'L' : 'Z'}`;
}

export function parseTermKey(key: string): TermRef | null {
  const match = /^(\d{4})-([ZL])$/.exec(key);
  if (!match) return null;
  return { startYear: Number(match[1]), type: match[2] === 'L' ? 'SUMMER' : 'WINTER' };
}

/** "2026/2027" — format roku akademickiego uzywany w starszych tabelach. */
export function academicYearOf(term: TermRef): string {
  return `${term.startYear}/${term.startYear + 1}`;
}

/** "2026/27 zimowy" — etykieta do UI. */
export function termLabel(term: TermRef): string {
  const next = String((term.startYear + 1) % 100).padStart(2, '0');
  return `${term.startYear}/${next} ${term.type === 'SUMMER' ? 'letni' : 'zimowy'}`;
}

/**
 * Semestr, w ktorym lezy data. Zima trwa od 1 pazdziernika do 14 lutego (z sesja),
 * lato od 15 lutego do 30 wrzesnia (z wakacjami) — wakacje naleza do konczacego sie
 * roku akademickiego, wiec "biezacy" semestr nigdy nie jest pusty.
 */
export function termOfDate(date: IsoDate): TermRef {
  const year = yearOf(date);
  const monthDay = date.slice(5);
  if (monthDay >= '10-01') return { startYear: year, type: 'WINTER' };
  if (monthDay < '02-15') return { startYear: year - 1, type: 'WINTER' };
  return { startYear: year - 1, type: 'SUMMER' };
}

/**
 * Domyslne daty semestru, gdy nie ma z czego zaproponowac (brak kalendarza tego typu
 * w zadnym wczesniejszym roku): zima 1.10-31.01, lato od trzeciego poniedzialku
 * lutego do 15.06.
 */
export function defaultTermDates(term: TermRef): { startDate: IsoDate; endDate: IsoDate } {
  if (term.type === 'WINTER') {
    return { startDate: isoDate(term.startYear, 10, 1), endDate: isoDate(term.startYear + 1, 1, 31) };
  }
  const year = term.startYear + 1;
  const firstMonday = mondayOf(isoDate(year, 2, 7)); // poniedzialek w tygodniu 1-7 lutego
  const startDate = addDays(firstMonday, 14);
  return { startDate, endDate: isoDate(year, 6, 15) };
}

/**
 * Przeniesienie daty o `years` lat z zachowaniem dnia tygodnia: ta sama data w nowym
 * roku, przesunieta do najblizszego dnia o tym samym dniu tygodnia (maks. +-3 dni).
 * Dzieki temu propozycja kalendarza z zeszlego roku nie zaczyna semestru w niedziele.
 */
export function shiftDateByYears(date: IsoDate, years: number): IsoDate {
  const target = isoDate(yearOf(date) + years, Number(date.slice(5, 7)), Number(date.slice(8, 10)));
  // 29 lutego w roku nieprzestepnym -> Date przeskoczy na 1 marca; normalizujemy przez addDays.
  const normalized = addDays(target, 0);
  let diff = weekdayOf(date) - weekdayOf(normalized);
  if (diff > 3) diff -= 7;
  if (diff < -3) diff += 7;
  return addDays(normalized, diff);
}

/**
 * Numer semestru programu, ktory rocznik realizuje w danym semestrze kalendarzowym.
 * Rocznik startuje semestrem `startTerm` (nr 1). Dziala tak samo dla naboru
 * pazdziernikowego i lutowego — bez reguly "nieparzysty = zima".
 */
export function cohortSemesterInTerm(startTerm: TermRef, term: TermRef): number {
  return termOrdinal(term) - termOrdinal(startTerm) + 1;
}
