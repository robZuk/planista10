/**
 * Zajecia laczone (wspolny klucz) to jedne zajecia dla kilku grup: ta sama sala, ten sam prowadzacy,
 * ten sam czas. W planie sa osobnymi terminami (kazda grupa swoj), ale prowadzacy prowadzi je raz —
 * panel i "Moj plan" licza je raz i pokazuja jako jedna pozycje z lista grup (jak Obciazenia).
 * Czysta funkcja — bez bazy.
 */

export interface JointSlot {
  date: string;
  startMinute: number;
  endMinute: number;
  jointKey: string | null;
  roomId: string | null;
  instructorId: string | null;
}

/** Klucz fizycznych zajec; null = zajecia nielaczone (zostaja osobno). */
export function jointSlotKey(s: JointSlot): string | null {
  if (!s.jointKey) return null;
  return [s.date, s.startMinute, s.endMinute, s.jointKey, s.roomId ?? '-', s.instructorId ?? '-'].join('|');
}

/**
 * Scala wiersze tych samych zajec laczonych w jeden (kolejnosc pierwszego wystapienia zostaje).
 * `merge` dostaje pierwszy wiersz i pozostale z tej samej grupy zajec.
 */
export function mergeJoint<T>(rows: T[], slotOf: (row: T) => JointSlot, merge: (first: T, rest: T[]) => T): T[] {
  const groups = new Map<string, T[]>();
  const order: (T | string)[] = [];
  for (const row of rows) {
    const key = jointSlotKey(slotOf(row));
    if (!key) {
      order.push(row);
      continue;
    }
    const list = groups.get(key);
    if (list) list.push(row);
    else {
      groups.set(key, [row]);
      order.push(key);
    }
  }
  return order.map((item) => {
    if (typeof item !== 'string') return item;
    const [first, ...rest] = groups.get(item)!;
    return rest.length > 0 ? merge(first!, rest) : first!;
  });
}

/** "A, B" bez powtorzen, posortowane — ta sama kolejnosc grup w kazdym terminie. */
export function joinUnique(values: string[]): string {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl')).join(', ');
}
