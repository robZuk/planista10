/**
 * Obsada jednych zajec: prowadzacy (albo NN — wakat) i godziny. Czyste funkcje wspolne dla
 * okna zajec, okna grup przedmiotu i Obciazen — te same zasady i te same komunikaty.
 */
export interface StaffRow {
  /** null = NN (wakat — miejsce na prowadzacego). */
  instructorId: string | null;
  hours: number;
}

/** Problem listy obsady (null = w porzadku): dodatnie godziny, suma do godzin zajec, osoba raz. */
export function staffProblem(rows: StaffRow[], sectionHours: number): string | null {
  if (rows.some((r) => !Number.isInteger(r.hours) || r.hours <= 0)) return 'Godziny prowadzacego musza byc dodatnie';
  const total = rows.reduce((sum, r) => sum + r.hours, 0);
  if (total > sectionHours) return `Suma godzin obsady (${total}) przekracza godziny zajec (${sectionHours})`;
  const ids = rows.map((r) => r.instructorId).filter((id): id is string => !!id);
  if (new Set(ids).size !== ids.length) return 'Prowadzacy powtarza sie w obsadzie';
  return null;
}

/**
 * Obsada po ustawieniu godzin jednej osoby (Obciazenia): jej wiersz zmienia sie w miejscu albo
 * dochodzi na koncu (0 h = usuniecie), obsada innych zostaje. Gdy suma przekroczy godziny zajec,
 * ustepuja najpierw wiersze NN — to miejsca na prowadzacego, nie czyjas praca. Nadmiar ponad NN
 * zostaje (i odrzuci go staffProblem).
 */
export function withPersonHours(rows: StaffRow[], instructorId: string, hours: number, sectionHours: number): StaffRow[] {
  const had = rows.some((r) => r.instructorId === instructorId);
  const next = rows.flatMap((r) => (r.instructorId !== instructorId ? [r] : hours > 0 ? [{ instructorId, hours }] : []));
  if (!had && hours > 0) next.push({ instructorId, hours });
  let excess = next.reduce((sum, r) => sum + r.hours, 0) - sectionHours;
  if (excess <= 0) return next;
  return next.flatMap((r) => {
    if (r.instructorId !== null || excess <= 0) return [r];
    const cut = Math.min(r.hours, excess);
    excess -= cut;
    return r.hours > cut ? [{ instructorId: null, hours: r.hours - cut }] : [];
  });
}

/** Wolne godziny zajec dla nowej osoby: godziny minus obsada prowadzacych (NN sie nie liczy — ustapi). */
export function freeHours(rows: StaffRow[], sectionHours: number): number {
  return Math.max(0, sectionHours - rows.reduce((sum, r) => sum + (r.instructorId ? r.hours : 0), 0));
}
