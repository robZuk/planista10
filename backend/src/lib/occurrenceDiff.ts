/**
 * Diff terminow z wzorca przy "Generuj terminy": obecne terminy w zakresie vs. wyliczone przez
 * materializer. Termin o tym samym kluczu (umieszczenie + data z wzorca) zostaje tym samym
 * wierszem — zachowuje id (np. data utworzenia zostaje). Zmienia sie
 * tylko tresc (data po przeniesieniu, godziny, sala...). Czysta funkcja, bez bazy.
 */

/** Tresc wiersza terminu z wzorca (to, co generowanie zapisuje). */
export interface DerivedRow {
  termId: string;
  facultyId: string;
  sectionId: string;
  placementId: string;
  originalDate: Date;
  date: Date;
  startOrder: number;
  endOrder: number;
  startMinute: number;
  endMinute: number;
  roomId: string | null;
  instructorId: string | null;
  groupId: string;
  kind: 'DERIVED';
  jointKey: string | null;
  note: string | null;
}

/** Obecny termin z bazy (DERIVED w zakresie generowania). */
export type ExistingRow = Omit<DerivedRow, 'placementId' | 'originalDate' | 'kind'> & {
  id: string;
  placementId: string | null;
  originalDate: Date | null;
};

export interface OccurrenceDiff {
  toCreate: DerivedRow[];
  toUpdate: { id: string; data: DerivedRow }[];
  /** Terminy, ktorych juz nie ma we wzorcu (i odlaczone od usunietych umieszczen). */
  toDelete: string[];
  /** Raport dla planisty: zmiana tego, co widac w planie (data, godziny, sala, prowadzacy). */
  added: number;
  changed: number;
  unchanged: number;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const keyOf = (placementId: string, originalDate: Date) => `${placementId}|${iso(originalDate)}`;

type Visible = Pick<DerivedRow, 'date' | 'startOrder' | 'endOrder' | 'startMinute' | 'endMinute' | 'roomId' | 'instructorId'>;
const visibleSig = (o: Visible) => `${iso(o.date)}|${o.startOrder}|${o.endOrder}|${o.startMinute}|${o.endMinute}|${o.roomId}|${o.instructorId}`;
/** Pelna tresc — czy wiersz trzeba zapisac (takze zmiany niewidoczne w raporcie: klucz zajec laczonych, uwaga...). */
const fullSig = (o: Visible & Pick<DerivedRow, 'facultyId' | 'groupId' | 'jointKey' | 'note'>) =>
  `${visibleSig(o)}|${o.facultyId}|${o.groupId}|${o.jointKey}|${o.note}`;

export function diffOccurrences(existing: ExistingRow[], planned: DerivedRow[]): OccurrenceDiff {
  const diff: OccurrenceDiff = { toCreate: [], toUpdate: [], toDelete: [], added: 0, changed: 0, unchanged: 0 };
  const byKey = new Map<string, ExistingRow>();
  for (const o of existing) {
    // Terminy usunietych umieszczen (placementId = null) nie maja juz swojego miejsca we wzorcu.
    // Gdyby w bazie byl dubel klucza (sprzed unikalnego indeksu), nadmiarowy wiersz usuwamy.
    if (o.placementId && o.originalDate && !byKey.has(keyOf(o.placementId, o.originalDate))) {
      byKey.set(keyOf(o.placementId, o.originalDate), o);
    } else diff.toDelete.push(o.id);
  }
  for (const row of planned) {
    const key = keyOf(row.placementId, row.originalDate);
    const old = byKey.get(key);
    if (!old) {
      diff.toCreate.push(row);
      diff.added++;
      continue;
    }
    byKey.delete(key);
    if (visibleSig(old) !== visibleSig(row)) diff.changed++;
    else diff.unchanged++;
    if (fullSig(old) !== fullSig(row)) diff.toUpdate.push({ id: old.id, data: row });
  }
  for (const o of byKey.values()) diff.toDelete.push(o.id);
  return diff;
}
