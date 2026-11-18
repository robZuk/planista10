import { plural } from '@/lib/setupSteps';
import type { StaffChangeCheck, StaffMismatchRow } from '@/types';

/**
 * Plan a obsada (strona "Obsada"): umieszczenie niesie prowadzacego z obsady swojej grupy, a zmiana
 * obsady planu nie zmienia. Komunikat pojawia sie, gdy plan sie rozjechal; w oknie planista wybiera,
 * na kogo przepiac (podpowiedz z serwera), a podglad pokazuje kolizje kazdej zmiany.
 */

export interface PlanStaffNotice {
  title: string;
  description: string;
  action: string;
}

export function planStaffNotice(rows: StaffMismatchRow[]): PlanStaffNotice | null {
  if (rows.length === 0) return null;
  const foreign = rows.filter((r) => r.kind === 'FOREIGN').length;
  const missing = rows.length - foreign;
  const parts = [
    ...(foreign > 0 ? [`${plural(foreign, 'zajecia', 'zajecia', 'zajec')} z prowadzacym spoza obsady`] : []),
    ...(missing > 0 ? [`${plural(missing, 'zajecia', 'zajecia', 'zajec')} bez prowadzacego (NN), choc obsada jest pelna`] : []),
  ];
  return {
    title: 'Plan nie zgadza sie z obsada',
    description: `W planie: ${parts.join(', ')}. Zmiana obsady nie zmienia planu — przepnij prowadzacych, podglad pokaze kolizje.`,
    action: `Pokaz i przepnij (${rows.length})`,
  };
}

/** Wybor w oknie: id prowadzacego albo '' = NN. */
export type StaffChoices = Record<string, string>;

export const initialChoices = (rows: StaffMismatchRow[]): StaffChoices =>
  Object.fromEntries(rows.map((r) => [r.placementId, r.proposed ?? '']));

/** Czy wybor zmienia plan (ten sam prowadzacy albo NN przy NN — bez zmiany). */
export const changesPlan = (row: StaffMismatchRow, choice: string): boolean => (choice || null) !== (row.current?.id ?? null);

/** Zmiany do wyslania — zaznaczone wiersze, ktore cos zmieniaja, w kolejnosci listy. */
export function staffChanges(rows: StaffMismatchRow[], choices: StaffChoices, selected: ReadonlySet<string>) {
  return rows
    .filter((r) => selected.has(r.placementId) && changesPlan(r, choices[r.placementId] ?? ''))
    .map((r) => ({ placementId: r.placementId, instructorId: choices[r.placementId] || null }));
}

/** Opis wyniku podgladu jednej zmiany. */
export function checkText(check: StaffChangeCheck | undefined): { ok: boolean; text: string; details?: string } | null {
  if (!check) return null;
  if (check.error) return { ok: false, text: check.error };
  if (check.conflicts.length === 0) return { ok: true, text: 'bez kolizji' };
  const fmt = (d: string) => `${Number(d.slice(8, 10))}.${d.slice(5, 7)}`;
  const first = check.conflicts[0]!;
  return {
    ok: false,
    text: `kolizje: ${check.conflicts.length} (${fmt(first.date)} — ${first.with}${check.conflicts.length > 1 ? ' …' : ''})`,
    details: check.conflicts.map((c) => `${fmt(c.date)} — ${c.with}`).join('\n'),
  };
}
