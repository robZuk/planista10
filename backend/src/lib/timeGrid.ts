/**
 * Siatki godzin — czyste funkcje (bez bazy). Siatka to bloki o dowolnym starcie i dlugosci
 * (np. 08:00-08:45); 1 blok = 1 godzina programu niezaleznie od minut. Przerwy to odstepy
 * miedzy kolejnymi blokami. Umieszczenia wskazuja bloki numerem (`order`) w siatce swojego
 * kalendarza, a KOLIZJE miedzy roznymi siatkami licza sie w minutach od polnocy.
 */

export interface GridBlock {
  order: number;
  startTime: string; // "HH:MM"
  endTime: string;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(time: string): boolean {
  return TIME_RE.test(time);
}

/** "08:45" -> 525 */
export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** 525 -> "08:45" */
export function formatMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function blockLabel(startTime: string, endTime: string): string {
  return `${startTime}-${endTime}`;
}

/** Polotwarte przedzialy minut: 09:00-10:00 i 10:00-10:45 NIE nachodza na siebie. */
export function minutesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Walidacja blokow siatki (kolejnosc dowolna): format HH:MM, start przed koncem, bez nakladania
 * sie. Zwraca liste problemow (pusta = poprawna).
 */
export function validateBlocks(blocks: { startTime: string; endTime: string }[]): string[] {
  const problems: string[] = [];
  if (blocks.length === 0) problems.push('Siatka musi miec co najmniej jeden blok');
  for (const b of blocks) {
    if (!isValidTime(b.startTime) || !isValidTime(b.endTime)) {
      problems.push(`Nieprawidlowa godzina bloku ${b.startTime}-${b.endTime} (format GG:MM)`);
    } else if (toMinutes(b.startTime) >= toMinutes(b.endTime)) {
      problems.push(`Blok ${b.startTime}-${b.endTime} konczy sie przed startem`);
    }
  }
  if (problems.length > 0) return problems;
  const sorted = [...blocks].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (toMinutes(cur.startTime) < toMinutes(prev.endTime)) {
      problems.push(`Bloki ${prev.startTime}-${prev.endTime} i ${cur.startTime}-${cur.endTime} nachodza na siebie`);
    }
  }
  return problems;
}

/** Bloki posortowane po starcie i ponumerowane 1..n (order wynika z godziny). */
export function numberBlocks<T extends { startTime: string; endTime: string }>(blocks: T[]): (T & { order: number })[] {
  return [...blocks]
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))
    .map((b, i) => ({ ...b, order: i + 1 }));
}

/** Zakres blokow siatki w minutach. */
export interface MinuteRange {
  startMinute: number;
  endMinute: number;
}

/**
 * Indeks siatki: zamiana zakresu blokow `startOrder..endOrder` (wlacznie) na minuty.
 * null, gdy ktoregos bloku nie ma w siatce albo zakres jest odwrocony.
 */
export interface GridTime {
  blocks: GridBlock[];
  has(order: number): boolean;
  range(startOrder: number, endOrder: number): MinuteRange | null;
}

export function gridTime(blocks: GridBlock[]): GridTime {
  const byOrder = new Map(blocks.map((b) => [b.order, b]));
  const sorted = [...blocks].sort((a, b) => a.order - b.order);
  return {
    blocks: sorted,
    has: (order) => byOrder.has(order),
    range: (startOrder, endOrder) => {
      const start = byOrder.get(startOrder);
      const end = byOrder.get(endOrder);
      if (!start || !end || endOrder < startOrder) return null;
      return { startMinute: toMinutes(start.startTime), endMinute: toMinutes(end.endTime) };
    },
  };
}

/** Przerwy w siatce: odstepy miedzy kolejnymi blokami (po bloku `afterOrder`). */
export function gridBreaks(blocks: GridBlock[]): { afterOrder: number; startMinute: number; endMinute: number; minutes: number }[] {
  const sorted = [...blocks].sort((a, b) => a.order - b.order);
  const breaks = [];
  for (let i = 1; i < sorted.length; i++) {
    const end = toMinutes(sorted[i - 1]!.endTime);
    const start = toMinutes(sorted[i]!.startTime);
    if (start > end) breaks.push({ afterOrder: sorted[i - 1]!.order, startMinute: end, endMinute: start, minutes: start - end });
  }
  return breaks;
}

// ─── Dni zajec siatki (okno godzin) ──────────────────────────

export type WeekdayName = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

/** Dzien zajec siatki z opcjonalnym oknem godzin ("HH:MM"; null = bez ograniczenia). */
export interface GridDay {
  day: WeekdayName;
  from: string | null;
  to: string | null;
}

const DAY_LABEL: Record<WeekdayName, string> = {
  MONDAY: 'poniedzialek',
  TUESDAY: 'wtorek',
  WEDNESDAY: 'sroda',
  THURSDAY: 'czwartek',
  FRIDAY: 'piatek',
  SATURDAY: 'sobota',
  SUNDAY: 'niedziela',
};

/** Polska nazwa dnia tygodnia (bez diakrytykow) do komunikatow. */
export function weekdayLabel(day: WeekdayName): string {
  return DAY_LABEL[day];
}

export const WEEK_ORDER: WeekdayName[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

/** Domyslne dni = dotychczasowa regula: stacjonarne pn-pt; niestacjonarne pt od 15:00, sob, nd. */
export function defaultGridDays(studyMode: 'FULL_TIME' | 'PART_TIME'): GridDay[] {
  return studyMode === 'FULL_TIME'
    ? (['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as const).map((day) => ({ day, from: null, to: null }))
    : [
        { day: 'FRIDAY', from: '15:00', to: null },
        { day: 'SATURDAY', from: null, to: null },
        { day: 'SUNDAY', from: null, to: null },
      ];
}

/** Dni z bazy (JSON) -> lista w kolejnosci tygodnia; bledne wpisy pomijane. */
export function parseGridDays(value: unknown): GridDay[] {
  if (!Array.isArray(value)) return [];
  const days = value.filter(
    (d): d is GridDay =>
      !!d &&
      typeof d === 'object' &&
      WEEK_ORDER.includes((d as GridDay).day) &&
      ((d as GridDay).from === null || isValidTime(String((d as GridDay).from))) &&
      ((d as GridDay).to === null || isValidTime(String((d as GridDay).to))),
  );
  return WEEK_ORDER.flatMap((day) => days.filter((d) => d.day === day).slice(0, 1));
}

/** Problem z dniem/godzina zajec wg siatki albo null (np. "czwartek: zajecia od 16:00"). */
export function dayWindowProblem(days: GridDay[], day: WeekdayName, startMinute: number, endMinute: number): string | null {
  const entry = days.find((d) => d.day === day);
  if (!entry) {
    return `Siatka nie przewiduje zajec w dniu: ${DAY_LABEL[day]} (dni: ${days.map((d) => DAY_LABEL[d.day]).join(', ') || 'brak'})`;
  }
  if (entry.from && startMinute < toMinutes(entry.from)) return `${DAY_LABEL[day]}: zajecia od ${entry.from}`;
  if (entry.to && endMinute > toMinutes(entry.to)) return `${DAY_LABEL[day]}: zajecia do ${entry.to}`;
  return null;
}

/**
 * Zakres blokow z innej siatki przeniesiony po godzinach: blok startu o tej samej godzinie
 * rozpoczecia i blok konca o tej samej godzinie zakonczenia; null, gdy godziny nie pasuja.
 * Uzywane przy zajeciach laczonych miedzy wydzialami o roznych siatkach.
 */
export function mapRangeByTime(from: GridTime, to: GridTime, startOrder: number, endOrder: number): { startOrder: number; endOrder: number } | null {
  const range = from.range(startOrder, endOrder);
  if (!range) return null;
  const start = to.blocks.find((b) => to.range(b.order, b.order)!.startMinute === range.startMinute);
  const end = to.blocks.find((b) => to.range(b.order, b.order)!.endMinute === range.endMinute);
  return start && end && end.order >= start.order ? { startOrder: start.order, endOrder: end.order } : null;
}

/** Umieszczenie we wzorcu (dzien + bloki) — do sprawdzenia wzgledem dni i okien siatki. */
export interface PatternSlot {
  dayOfWeek: WeekdayName;
  startOrder: number;
  endOrder: number;
  cohortId: string;
}

/**
 * Umieszczenia, ktore po zmianie dni/okien siatki wypadlyby poza nia — pogrupowane wg
 * problemu (np. "Siatka nie przewiduje zajec w dniu: piatek ..."), z liczba umieszczen
 * i rocznikow. Pusta lista = zmiana nie rusza istniejacego planu.
 */
export function slotsOutsideDays(
  slots: PatternSlot[],
  days: GridDay[],
  time: GridTime,
): { problem: string; placements: number; cohorts: number }[] {
  const groups = new Map<string, { placements: number; cohorts: Set<string> }>();
  for (const slot of slots) {
    const range = time.range(slot.startOrder, slot.endOrder);
    if (!range) continue;
    const problem = dayWindowProblem(days, slot.dayOfWeek, range.startMinute, range.endMinute);
    if (!problem) continue;
    const g = groups.get(problem) ?? { placements: 0, cohorts: new Set<string>() };
    g.placements += 1;
    g.cohorts.add(slot.cohortId);
    groups.set(problem, g);
  }
  return [...groups].map(([problem, g]) => ({ problem, placements: g.placements, cohorts: g.cohorts.size }));
}
