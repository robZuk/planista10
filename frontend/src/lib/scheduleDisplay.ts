import type { ClassType, EntryStatus, RoomType } from '@/types';

export const CLASS_TYPES: ClassType[] = ['LECTURE', 'EXERCISE', 'LAB', 'PROJECT', 'SEMINAR'];

/** Jednoliterowe skroty na blokach w siatce — miejsca jest tam malo. */
export const CLASS_LABELS: Record<ClassType, string> = {
  LECTURE: 'W',
  EXERCISE: 'C',
  LAB: 'L',
  PROJECT: 'P',
  SEMINAR: 'S',
};

export const CLASS_FULL_LABELS: Record<ClassType, string> = {
  LECTURE: 'Wyklad',
  EXERCISE: 'Cwiczenia',
  LAB: 'Laboratorium',
  PROJECT: 'Projekt',
  SEMINAR: 'Seminarium',
};

/**
 * Kolory tla i lewej krawedzi bloku, per typ zajec.
 *
 * To kolory TEMATYCZNE — maja rozrozniac typy zajec, a nie niesc znaczenie
 * semantyczne motywu (primary/destructive), wiec swiadomie omijaja tokeny shadcn
 * i podaja jawne warianty `dark:`.
 */
export const CLASS_COLORS: Record<ClassType, string> = {
  LECTURE:
    'bg-blue-100 border-blue-400 text-blue-900 dark:bg-blue-950 dark:border-blue-600 dark:text-blue-100',
  EXERCISE:
    'bg-green-100 border-green-400 text-green-900 dark:bg-green-950 dark:border-green-600 dark:text-green-100',
  LAB: 'bg-orange-100 border-orange-400 text-orange-900 dark:bg-orange-950 dark:border-orange-600 dark:text-orange-100',
  PROJECT:
    'bg-purple-100 border-purple-400 text-purple-900 dark:bg-purple-950 dark:border-purple-600 dark:text-purple-100',
  SEMINAR:
    'bg-pink-100 border-pink-400 text-pink-900 dark:bg-pink-950 dark:border-pink-600 dark:text-pink-100',
};

export const STATUS_LABELS: Record<EntryStatus, string> = {
  SCHEDULED: 'Zaplanowane',
  CANCELLED: 'Odwolane',
  MAKEUP: 'Odrobienie',
};

/**
 * Lustro backend/src/lib/scheduleTime.ts — jakie typy sal pasuja do typu zajec.
 * Uzywane do zawezenia listy sal w formularzu, zeby nie trafiac w blad WRONG_ROOM_TYPE.
 */
export const ROOM_TYPES_FOR_CLASS: Record<ClassType, RoomType[]> = {
  LECTURE: ['LECTURE', 'EXERCISE'],
  EXERCISE: ['EXERCISE', 'LECTURE', 'SPORTS'],
  LAB: ['LAB', 'COMPUTER_LAB'],
  PROJECT: ['EXERCISE', 'COMPUTER_LAB', 'SEMINAR'],
  SEMINAR: ['SEMINAR', 'EXERCISE'],
};

/**
 * Linie opisu bloku na siatce dopasowane do jego wysokosci: gdy sie nie mieszcza,
 * ogon laczymy w ostatniej dozwolonej linii (" · "), a reszte ucina `truncate`.
 * Pelny opis jest w podpowiedzi bloku.
 */
export function fitGridLines(lines: string[], maxLines: number): string[] {
  if (maxLines <= 0) return [];
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines - 1), lines.slice(maxLines - 1).join(' · ')];
}
