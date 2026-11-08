/**
 * Czy terminy rocznika sa nieaktualne wzgledem tego, z czego powstaly. Czysta funkcja —
 * znaczniki czasu (ms) liczy warstwa uslug.
 *
 *  - PLACEMENTS: umieszczenie zmienione po ostatnim generowaniu (zmiana wzorca),
 *  - SECTIONS:   zajecia w planie zmienione po generowaniu (np. godziny z synchronizacji
 *                programu) — terminy policzono dla starej liczby godzin,
 *  - DELETED:    umieszczenie usuniete po generowaniu — jego terminy wciaz sa w planie
 *                (znikna przy "Generuj terminy").
 */
export type StaleReason = 'PLACEMENTS' | 'SECTIONS' | 'DELETED';

export function staleReasons(input: {
  /** Ostatnia zmiana umieszczen rocznika (0 = brak umieszczen). */
  lastPlacementChange: number;
  /** Ostatnia zmiana zajec, ktore sa w planie (maja umieszczenia lub terminy reczne). */
  lastSectionChange: number;
  /** Ostatnie generowanie terminow z kalendarza rocznika (0 = nigdy). */
  generatedAt: number;
  /**
   * Ostatnie odlaczenie terminow od usunietego umieszczenia (0 = brak). Terminy bez umieszczenia
   * sprzed ostatniego generowania to celowo zachowana przeszlosc (generowanie "od daty").
   */
  lastDeletion?: number;
}): StaleReason[] {
  const reasons: StaleReason[] = [];
  if (input.lastPlacementChange > input.generatedAt) reasons.push('PLACEMENTS');
  // Bez generowania nie ma terminow do unieaktualnienia — wystarczy powod PLACEMENTS.
  if (input.generatedAt > 0 && input.lastSectionChange > input.generatedAt) reasons.push('SECTIONS');
  if ((input.lastDeletion ?? 0) > input.generatedAt) reasons.push('DELETED');
  return reasons;
}
