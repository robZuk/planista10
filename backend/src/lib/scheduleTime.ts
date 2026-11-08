import type { ClassType, RoomType } from '@prisma/client';

/**
 * Typy sal dla form zajec i nakladanie zakresow blokow w obrebie jednej siatki. Dni i okno
 * godzin zajec sa w siatce wydzialu (lib/timeGrid.ts → dayWindowProblem), a kolizje miedzy
 * siatkami licza sie w minutach (minutesOverlap).
 */

// ─── Nakladanie sie przedzialow blokow (domkniete) ───────────
export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

// ─── Typy sal dopuszczalne dla formy zajec ───────────────────
// SPORTS tylko przy cwiczeniach — WF idzie w programie wlasnie jako ta forma.
export const roomTypeMap: Record<ClassType, RoomType[]> = {
  LECTURE: ['LECTURE', 'EXERCISE'],
  EXERCISE: ['EXERCISE', 'LECTURE', 'SPORTS'],
  LAB: ['LAB', 'COMPUTER_LAB'],
  PROJECT: ['EXERCISE', 'COMPUTER_LAB', 'SEMINAR'],
  SEMINAR: ['SEMINAR', 'EXERCISE'],
};
