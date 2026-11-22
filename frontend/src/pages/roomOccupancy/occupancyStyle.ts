import type { ClassType, RoomOccupancyEntry } from '@/types';
import { CLASS_COLORS } from '@/lib/scheduleDisplay';

/** Paski w tabeli tygodnia — pelne kolory form (te same odcienie co kafelki planu). */
const BAR_COLORS: Record<ClassType, string> = {
  LECTURE: 'bg-blue-500',
  EXERCISE: 'bg-green-500',
  LAB: 'bg-orange-500',
  PROJECT: 'bg-purple-500',
  SEMINAR: 'bg-pink-500',
};

/** Kolizja na czerwono (widac ja z daleka), zajetosc zewnetrzna szara, zajecia — kolor formy. */
export function barClass(e: Pick<RoomOccupancyEntry, 'kind' | 'classType' | 'conflict'>): string {
  if (e.conflict) return 'bg-red-600';
  if (e.kind === 'EXTERNAL' || !e.classType) return 'bg-slate-500';
  return BAR_COLORS[e.classType];
}

/** Kafelek osi dnia: kolory formy jak w planie; termin reczny z przerywana ramka; zewnetrzna szara. */
export function tileClass(e: Pick<RoomOccupancyEntry, 'kind' | 'classType' | 'conflict'>): string {
  const base =
    e.kind === 'EXTERNAL' || !e.classType
      ? 'border-dashed bg-slate-100 border-slate-400 text-slate-800 dark:bg-slate-900 dark:border-slate-500 dark:text-slate-100'
      : `${CLASS_COLORS[e.classType]}${e.kind === 'MANUAL' ? ' border-dashed' : ''}`;
  return e.conflict ? `${base} ring-2 ring-red-600 ring-offset-1 ring-offset-background` : base;
}

/** Legenda pod filtrami. */
export const LEGEND: { label: string; className: string }[] = [
  { label: 'wyklad', className: BAR_COLORS.LECTURE },
  { label: 'cwiczenia', className: BAR_COLORS.EXERCISE },
  { label: 'laboratorium', className: BAR_COLORS.LAB },
  { label: 'projekt', className: BAR_COLORS.PROJECT },
  { label: 'seminarium', className: BAR_COLORS.SEMINAR },
  { label: 'zajetosc zewnetrzna', className: 'bg-slate-500' },
  { label: 'kolizja', className: 'bg-red-600' },
];

const DAY_SHORT = ['Nd', 'Pn', 'Wt', 'Sr', 'Cz', 'Pt', 'Sb'];
const DAY_LONG = ['niedziela', 'poniedzialek', 'wtorek', 'sroda', 'czwartek', 'piatek', 'sobota'];

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** "Pn 16.11" */
export function dayShort(date: string): string {
  const [, month, day] = date.split('-');
  return `${DAY_SHORT[weekday(date)]} ${Number(day)}.${month}`;
}

/** "poniedzialek" */
export function dayLong(date: string): string {
  return DAY_LONG[weekday(date)]!;
}

/** Pionowe linie co godzine na osi [start, end] (tlo paska albo wiersza). */
export function hourLines(start: number, end: number, color = 'var(--border)'): string {
  const step = (60 / (end - start)) * 100;
  return `repeating-linear-gradient(to right, transparent 0, transparent calc(${step}% - 1px), ${color} calc(${step}% - 1px), ${color} ${step}%)`;
}
