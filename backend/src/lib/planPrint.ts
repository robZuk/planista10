import type { WeekdayName } from './timeGrid';
import { addDays, weekdayOf, type IsoDate } from './isoDate';

/**
 * Druk planu (PDF) — model stron i czyste pomocnicze. Bez bazy i bez pdfkit: strony sklada
 * services/planPrint, rysuje lib/planPdf.
 *
 * Strona to siatka: kolumny (dni tygodnia — plan tygodnia; daty — zjazd albo tydzien) na
 * osi minut. Kafelki stoja w kolumnie wg rzeczywistego czasu, bo w jednym druku (prowadzacy,
 * sala) spotykaja sie siatki godzin roznych wydzialow i trybow.
 */

export interface PrintEntry {
  id: string;
  /** Klucz kolumny: dzien tygodnia (MONDAY…) albo data RRRR-MM-DD. */
  column: string;
  startMinute: number;
  endMinute: number;
  classType: string;
  /** Przedmiot. */
  title: string;
  /** Kolejne linie opisu; pierwsza idzie w jednej linii z godzinami ("8:00–9:30 · s. 114"). */
  lines: string[];
  /**
   * Krotsze wersje linii (ten sam porzadek): uzyte zamiast pelnej, gdy pelna nie miesci sie
   * w waskim kafelku — sala bez budynku, prowadzacy z inicjalem imienia.
   */
  compactLines?: string[];
}

export interface PrintColumn {
  key: string;
  label: string;
  sublabel?: string;
  /** Dzien bez zajec w kalendarzu (swieto, przerwa, dzien wolny) — opis w kolumnie. */
  closed?: string;
}

export interface PrintPage {
  heading: string;
  subheading: string;
  columns: PrintColumn[];
  entries: PrintEntry[];
  /** Tekst na pustej stronie. */
  emptyText?: string;
}

export interface PrintDocument {
  /** Tytul dokumentu (metadane PDF i nazwa pliku). */
  title: string;
  /** Semestr do stopki, np. "2026/27 zimowy". */
  termLabel: string;
  pages: PrintPage[];
}

export const CLASS_LETTER: Record<string, string> = { LECTURE: 'W', EXERCISE: 'C', LAB: 'L', PROJECT: 'P', SEMINAR: 'S' };
export const CLASS_NAME: Record<string, string> = {
  LECTURE: 'wykład',
  EXERCISE: 'ćwiczenia',
  LAB: 'laboratorium',
  PROJECT: 'projekt',
  SEMINAR: 'seminarium',
};

export const WEEKDAY_PL: Record<WeekdayName, string> = {
  MONDAY: 'Poniedziałek',
  TUESDAY: 'Wtorek',
  WEDNESDAY: 'Środa',
  THURSDAY: 'Czwartek',
  FRIDAY: 'Piątek',
  SATURDAY: 'Sobota',
  SUNDAY: 'Niedziela',
};

const WEEK_ORDER: WeekdayName[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const WEEKDAY_OF_INDEX: WeekdayName[] = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/** Dzien tygodnia daty. */
export const weekdayName = (date: IsoDate): WeekdayName => WEEKDAY_OF_INDEX[weekdayOf(date)]!;

/** "2027-03-06" -> "6.03" */
export function shortDate(date: IsoDate): string {
  const [, month, day] = date.split('-');
  return `${Number(day)}.${month}`;
}

/** "2027-03-06" -> "6.03.2027" */
export function fullDate(date: IsoDate): string {
  const [year] = date.split('-');
  return `${shortDate(date)}.${year}`;
}

/** Kolumny planu tygodnia: dni w kolejnosci tygodnia (bez powtorzen). */
export function weekdayColumns(days: Iterable<string>): PrintColumn[] {
  const set = new Set(days);
  return WEEK_ORDER.filter((d) => set.has(d)).map((d) => ({ key: d, label: WEEKDAY_PL[d] }));
}

/** Kolumny dat: dzien tygodnia i data (rosnaco, bez powtorzen). */
export function dateColumns(dates: Iterable<IsoDate>): PrintColumn[] {
  return [...new Set(dates)].sort().map((d) => ({ key: d, label: WEEKDAY_PL[weekdayName(d)], sublabel: shortDate(d) }));
}

/** Kolejne dni od–do wlacznie. */
export function datesBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Rytm umieszczenia tygodniowego dla ludzi: "tyg. parzyste 1–7", "tyg. 3,5"; co tydzien (domyslny) — pusty. */
export function weekPatternLabel(p: { pattern: string; numbers: number[]; fromIndex: number | null; toIndex: number | null }): string {
  const range = p.fromIndex || p.toIndex ? ` ${p.fromIndex ?? 1}–${p.toIndex ?? '…'}` : '';
  if (p.pattern === 'EVEN') return `tyg. parzyste${range}`;
  if (p.pattern === 'ODD') return `tyg. nieparzyste${range}`;
  if (p.pattern === 'LIST') return `tyg. ${p.numbers.join(',')}`;
  return range ? `tyg.${range}` : '';
}

/** Zakres osi czasu strony: pelne godziny wokol zajec (pusta strona — 8:00–16:00). */
export function timeWindow(entries: Pick<PrintEntry, 'startMinute' | 'endMinute'>[]): { start: number; end: number } {
  if (entries.length === 0) return { start: 8 * 60, end: 16 * 60 };
  const start = Math.floor(Math.min(...entries.map((e) => e.startMinute)) / 60) * 60;
  const end = Math.ceil(Math.max(...entries.map((e) => e.endMinute)) / 60) * 60;
  return { start, end: Math.max(end, start + 60) };
}

export interface PrintLane {
  lane: number;
  span: number;
  lanes: number;
}

/**
 * Tory zajec rownoleglych w kolumnie (jak frontend lib/gridLanes, ale w minutach: przedzialy
 * polotwarte — zajecia 8:00–9:30 i 9:30–11:00 nie dziela kolumny). Klaster nakladajacych sie
 * zajec dzieli kolumne na wspolna liczbe torow; kafelek rozszerza sie na wolne tory obok.
 */
export function printLanes(entries: Pick<PrintEntry, 'id' | 'startMinute' | 'endMinute'>[]): Map<string, PrintLane> {
  const overlaps = (a: (typeof entries)[number], b: (typeof entries)[number]) => a.startMinute < b.endMinute && b.startMinute < a.endMinute;
  const result = new Map<string, PrintLane>();
  const sorted = [...entries].sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute || a.id.localeCompare(b.id));
  let i = 0;
  while (i < sorted.length) {
    const cluster: typeof entries = [];
    let clusterEnd = -Infinity;
    while (i < sorted.length && (cluster.length === 0 || sorted[i]!.startMinute < clusterEnd)) {
      cluster.push(sorted[i]!);
      clusterEnd = Math.max(clusterEnd, sorted[i]!.endMinute);
      i++;
    }
    const laneEnds: number[] = [];
    const laneOf = new Map<string, number>();
    for (const item of cluster) {
      let lane = laneEnds.findIndex((end) => end <= item.startMinute);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.endMinute);
      } else laneEnds[lane] = item.endMinute;
      laneOf.set(item.id, lane);
    }
    const lanes = laneEnds.length;
    for (const item of cluster) {
      const lane = laneOf.get(item.id)!;
      let span = 1;
      while (lane + span < lanes && !cluster.some((o) => o !== item && laneOf.get(o.id) === lane + span && overlaps(o, item))) span++;
      result.set(item.id, { lane, span, lanes });
    }
  }
  return result;
}

/** Nazwa pliku: litery bez polskich znakow, cyfry i myslniki ("plan-MiBM-S1-2026-Z.pdf"). */
export function pdfFileName(parts: string[]): string {
  const ascii = parts
    .join('-')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `plan-${ascii || 'zajec'}.pdf`;
}
