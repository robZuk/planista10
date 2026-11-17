import type { DayOfWeek } from '@/types';
import { dayOfDate } from './timeGrid';

/**
 * Daty zajetosci zewnetrznej (zajecia innych wydzialow ze zgloszen). Czyste funkcje na tekscie
 * "RRRR-MM-DD" — arytmetyka w UTC, bez strefy przegladarki (jak lib/scheduleDates).
 */

const MS_PER_DAY = 86_400_000;

function toUtc(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && fromUtc(toUtc(value)) === value;

/**
 * Daty dnia tygodnia od `from` do `to` (wlacznie), co `everyWeeks` tygodni — od pierwszego
 * takiego dnia po `from`. Co 2 tygodnie: parzystosc wyznacza pierwsza data (wybierz `from`
 * w tygodniu, od ktorego zajecia sie zaczynaja). Zle daty albo `to` przed `from` — pusto.
 */
export function weeklyDates(day: DayOfWeek, from: string, to: string, everyWeeks = 1): string[] {
  if (!isDate(from) || !isDate(to) || to < from || everyWeeks < 1) return [];
  let ms = toUtc(from);
  for (let i = 0; i < 7 && dayOfDate(fromUtc(ms)) !== day; i++) ms += MS_PER_DAY;
  const out: string[] = [];
  for (const end = toUtc(to); ms <= end; ms += 7 * everyWeeks * MS_PER_DAY) out.push(fromUtc(ms));
  return out;
}

/** Dodanie dat do listy: bez powtorzen, rosnaco. */
export function mergeDates(current: string[], added: string[]): string[] {
  return [...new Set([...current, ...added.filter(isDate)])].sort();
}

/** "2027-03-01" -> "1.03" (rok wynika z semestru). */
export function shortDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(day)}.${month}`;
}

const SHORT_DAY: Record<string, string> = {
  MONDAY: 'pn',
  TUESDAY: 'wt',
  WEDNESDAY: 'sr',
  THURSDAY: 'czw',
  FRIDAY: 'pt',
  SATURDAY: 'sob',
  SUNDAY: 'nd',
};
const DAY_ORDER = Object.keys(SHORT_DAY);

/** Krotko do tabeli: "pn · 15 dat · 1.03–7.06" albo "sob, nd · 4 daty · 7.03–18.04". */
export function datesSummary(dates: string[]): string {
  if (dates.length === 0) return 'brak dat';
  const sorted = [...dates].sort();
  const days = [...new Set(sorted.map((d) => dayOfDate(d)).filter((d): d is NonNullable<typeof d> => !!d))]
    .sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b))
    .map((d) => SHORT_DAY[d]);
  const count = sorted.length === 1 ? '1 data' : `${sorted.length} ${datesWord(sorted.length)}`;
  const range = sorted.length === 1 ? shortDate(sorted[0]!) : `${shortDate(sorted[0]!)}–${shortDate(sorted[sorted.length - 1]!)}`;
  return [days.join(', '), count, range].join(' · ');
}

function datesWord(n: number): string {
  const lastTwo = n % 100;
  const last = n % 10;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'daty' : 'dat';
}

/** Dzisiejsza data lokalna "RRRR-MM-DD" (domyslne "stan na" nowego zgloszenia). */
export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
