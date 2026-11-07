/**
 * Czy terminy rocznika sa nieaktualne wzgledem tego, z czego powstaly. Czysta funkcja —
 * znaczniki czasu (ms) liczy warstwa uslug.
 *
 *  - PLACEMENTS: umieszczenie zmienione po ostatnim generowaniu (zmiana wzorca),
 *  - SECTIONS:   zajecia w planie zmienione po generowaniu (np. godziny z synchronizacji
 *                programu) — terminy policzono dla starej liczby godzin.
 */
export type StaleReason = 'PLACEMENTS' | 'SECTIONS';

export function staleReasons(input: {
  /** Ostatnia zmiana umieszczen rocznika (0 = brak umieszczen). */
  lastPlacementChange: number;
  /** Ostatnia zmiana zajec, ktore sa w planie (maja umieszczenia lub terminy reczne). */
  lastSectionChange: number;
  /** Ostatnie generowanie terminow z kalendarza rocznika (0 = nigdy). */
  generatedAt: number;
}): StaleReason[] {
  const reasons: StaleReason[] = [];
  if (input.lastPlacementChange > input.generatedAt) reasons.push('PLACEMENTS');
  // Bez generowania nie ma terminow do unieaktualnienia — wystarczy powod PLACEMENTS.
  if (input.generatedAt > 0 && input.lastSectionChange > input.generatedAt) reasons.push('SECTIONS');
  return reasons;
}
