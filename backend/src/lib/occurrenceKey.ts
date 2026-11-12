/**
 * Trwaly klucz terminu: zgloszenia prowadzacych i odrobienia wskazuja termin z wzorca kluczem
 * umieszczenie + data z wzorca (tym samym, ktorym wyjatki PlacementException przezywaja generowanie),
 * a terminy reczne i odlaczone — ich id. Pozostalosc z czasu, gdy "Generuj terminy" nadawalo
 * terminom nowe id; dzis generowanie zachowuje id (lib/occurrenceDiff), docelowo klucz zastapia
 * klucze obce do terminu.
 */
export interface KeyedOccurrence {
  id: string;
  kind: 'DERIVED' | 'MANUAL';
  placementId: string | null;
  /** Data z wzorca "YYYY-MM-DD" (przed wyjatkiem). */
  originalDate: string | null;
}

export function occurrenceKey(o: KeyedOccurrence): string {
  return o.kind === 'DERIVED' && o.placementId && o.originalDate ? `p:${o.placementId}|${o.originalDate}` : `o:${o.id}`;
}

export type ParsedKey = { placementId: string; originalDate: string } | { occurrenceId: string };

export function parseOccurrenceKey(key: string): ParsedKey | null {
  if (key.startsWith('o:') && key.length > 2) return { occurrenceId: key.slice(2) };
  const m = /^p:(.+)\|(\d{4}-\d{2}-\d{2})$/.exec(key);
  return m ? { placementId: m[1]!, originalDate: m[2]! } : null;
}
