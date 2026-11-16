import type { StaffAssignmentInput } from '@/api/sections';

/**
 * Wiersze obsady w oknach (jednych zajec i wszystkich grup przedmiotu): prowadzacy albo NN
 * i godziny jako tekst z pola. Zasady i komunikaty jak na serwerze (backend lib/staffing).
 */

/** Wartosc "NN (wakat)" w wyborze prowadzacego — Radix/cmdk nie przyjmuja pustego stringa. */
export const NN = '__nn__';

export interface StaffDraftRow {
  /** '' = nic nie wybrano, NN = wakat, inaczej id prowadzacego. */
  instructorId: string;
  hours: string;
}

/** Wiersze startowe okna: obecna obsada albo jeden pusty wiersz na wszystkie godziny. */
export function draftRows(section: { hours: number; instructors: { instructorId: string | null; hours: number }[] }): StaffDraftRow[] {
  return section.instructors.length > 0
    ? section.instructors.map((i) => ({ instructorId: i.instructorId ?? NN, hours: String(i.hours) }))
    : [{ instructorId: '', hours: String(section.hours) }];
}

export const draftTotal = (rows: StaffDraftRow[]): number => rows.reduce((sum, r) => sum + (Number(r.hours) || 0), 0);

/**
 * Problem wierszy (null = mozna zapisac). Wiersz bez prowadzacego bylby przy zapisie pominiety
 * po cichu — wymagamy prowadzacego albo NN, dodatnich godzin i bez powtorzen osoby.
 */
export function staffRowsProblem(rows: StaffDraftRow[], sectionHours: number): string | null {
  if (rows.some((r) => !r.instructorId)) return 'Wybierz prowadzacego (albo NN) w kazdym wierszu albo usun pusty wiersz';
  if (rows.some((r) => r.hours.trim() === '' || !Number.isInteger(Number(r.hours)) || Number(r.hours) <= 0)) {
    return 'Godziny w kazdym wierszu musza byc liczba calkowita wieksza od zera';
  }
  const chosen = rows.map((r) => r.instructorId).filter((id) => id !== NN);
  if (new Set(chosen).size !== chosen.length) return 'Ten sam prowadzacy jest w obsadzie dwa razy — polacz jego godziny w jednym wierszu';
  const total = draftTotal(rows);
  if (total > sectionHours) return `Suma godzin (${total}) przekracza godziny zajec (${sectionHours})`;
  return null;
}

export function toAssignments(rows: StaffDraftRow[]): StaffAssignmentInput[] {
  return rows.map((r) => ({ instructorId: r.instructorId === NN ? null : r.instructorId, hours: Number(r.hours) }));
}

/** Czy obsada sie zmienila (kolejnosc wierszy bez znaczenia) — zapisujemy tylko zmienione zajecia. */
export function sameAssignments(a: StaffAssignmentInput[], b: StaffAssignmentInput[]): boolean {
  const key = (list: StaffAssignmentInput[]) =>
    list
      .map((x) => `${x.instructorId ?? ''}:${x.hours}`)
      .sort()
      .join('|');
  return key(a) === key(b);
}
