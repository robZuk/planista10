/**
 * Lista "Dzisiejsze zajecia" na panelu. Sortujemy po godzinie, nie po numerze bloku — panel
 * laczy wydzialy o roznych siatkach (blok 1 to 07:00 na jednym, 07:15 na drugim).
 * Dla planistow (cala uczelnia albo wydzial: setki zajec) — tylko trwajace i najblizsze.
 */
export interface TimedEntry {
  startBlock: { startTime: string };
  endBlock: { endTime: string };
}

export function sortByTime<T extends TimedEntry>(entries: T[]): T[] {
  return [...entries].sort(
    (a, b) => a.startBlock.startTime.localeCompare(b.startBlock.startTime) || a.endBlock.endTime.localeCompare(b.endBlock.endTime),
  );
}

/**
 * Trwajace i najblizsze zajecia (koniec po `now`, "HH:MM"), najwyzej `limit`. Gdy dzisiejsze
 * zajecia juz sie skonczyly — ostatnie `limit`, zeby karta nie byla pusta wieczorem.
 */
export function todayShortlist<T extends TimedEntry>(entries: T[], now: string, limit: number): { shown: T[]; total: number } {
  const sorted = sortByTime(entries);
  const upcoming = sorted.filter((e) => e.endBlock.endTime > now);
  const shown = upcoming.length > 0 ? upcoming.slice(0, limit) : sorted.slice(-limit);
  return { shown, total: sorted.length };
}
