import type { ClassType, RoomType, StudyMode } from '@prisma/client';

/**
 * Logika czasowa planu zajec. Czas jest wyrazany BLOKAMI 1-godzinnymi (TimeBlock.order),
 * a nie stringami godzin — konflikt czasu to nakladanie sie przedzialow `order`.
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

function minutesFromTime(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Okno trybu studiow dla dnia tygodnia (0 = niedziela) i godziny startu; zwraca
 * komunikat bledu albo null. Stacjonarne: pon-pt. Niestacjonarne: pt od 15:00, sob, nd.
 */
export function checkTimeWindow(dayNum: number, startTime: string, studyMode: StudyMode): string | null {
  if (studyMode === 'FULL_TIME') {
    if (dayNum < 1 || dayNum > 5) return 'Studia stacjonarne: dozwolone tylko poniedzialek-piatek';
    return null;
  }
  if (dayNum >= 1 && dayNum <= 4) return 'Studia niestacjonarne: zajecia tylko pt/sob/nd';
  if (dayNum === 5 && minutesFromTime(startTime) < 15 * 60) return 'Studia niestacjonarne: piatek dopiero od 15:00';
  return null;
}
