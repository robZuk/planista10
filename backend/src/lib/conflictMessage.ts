import type { IsoDate } from './isoDate';

/**
 * Czytelne komunikaty o kolizjach planu. Czyste funkcje — bez bazy.
 *
 * Kolizje jednego umieszczenia zwykle powtarzaja sie co tydzien/zjazd z tymi samymi
 * zajeciami, wiec grupujemy je wg (powod, z czym) i wypisujemy daty krotko (4.10, 18.10),
 * zamiast powtarzac caly opis zajec przy kazdej dacie.
 */

export interface ConflictLike {
  date: IsoDate;
  reason: string;
  with: string;
}

const REASON_TEXT: Record<string, string> = {
  ROOM: 'Sala zajeta',
  INSTRUCTOR: 'Prowadzacy ma wtedy zajecia',
  GROUP: 'Grupa ma wtedy zajecia',
  GRID: 'Poza siatka godzin',
};

/** Nazwa powodu kolizji dla czlowieka (nieznany kod — bez zmian). */
export function conflictReasonText(reason: string): string {
  return REASON_TEXT[reason] ?? reason;
}

/** "2026-10-04" -> "4.10" — rok wynika z semestru. */
export function shortDate(date: IsoDate): string {
  const [, month, day] = date.split('-');
  return `${Number(day)}.${month}`;
}

/** Krotka lista dat: pierwsze `max`, reszta jako "i jeszcze N" (poprawne dla kazdego N). */
export function datesList(dates: IsoDate[], max = 6): string {
  const sorted = [...new Set(dates)].sort();
  const shown = sorted.slice(0, max).map(shortDate).join(', ');
  return sorted.length > max ? `${shown} i jeszcze ${sorted.length - max}` : shown;
}

/** Odmiana "termin": 1 terminie, 2-4 terminach... (miejscownik jest jeden dla liczby mnogiej). */
function inTerms(n: number): string {
  return n === 1 ? 'w 1 terminie' : `w ${n} terminach`;
}

interface ConflictGroup {
  reason: string;
  with: string;
  dates: IsoDate[];
}

function groupConflicts(conflicts: ConflictLike[]): ConflictGroup[] {
  const groups = new Map<string, ConflictGroup>();
  for (const c of conflicts) {
    const key = `${c.reason}|${c.with}`;
    const g = groups.get(key) ?? { reason: c.reason, with: c.with, dates: [] };
    g.dates.push(c.date);
    groups.set(key, g);
  }
  // Najczestsze najpierw; przy remisie wg najwczesniejszej daty.
  return [...groups.values()].sort(
    (a, b) => b.dates.length - a.dates.length || [...a.dates].sort()[0]!.localeCompare([...b.dates].sort()[0]!),
  );
}

/**
 * Komunikat wielowierszowy (frontend wyswietla go z zachowaniem nowych linii):
 *
 *   Kolizja w 8 terminach:
 *   • Grupa ma wtedy zajecia — MIBM-N1 s3: Podst. konstr. maszyn (C) TRUOiP-SN-3-C-A
 *     daty: 4.10, 18.10, 15.11, 22.11, 6.12, 13.12 i jeszcze 2
 */
export function conflictMessage(conflicts: ConflictLike[], maxGroups = 3): string {
  if (conflicts.length === 0) return '';
  const groups = groupConflicts(conflicts);
  const lines = [`Kolizja ${inTerms(new Set(conflicts.map((c) => c.date)).size)}:`];
  for (const g of groups.slice(0, maxGroups)) {
    lines.push(`• ${conflictReasonText(g.reason)} — ${g.with}`);
    lines.push(`  daty: ${datesList(g.dates)}`);
  }
  const rest = groups.slice(maxGroups);
  if (rest.length > 0) {
    const restDates = rest.reduce((n, g) => n + g.dates.length, 0);
    lines.push(`Pozostale kolizje: ${restDates}`);
  }
  return lines.join('\n');
}

/** Jedna kolizja (termin reczny, przeniesienie terminu): "Kolizja: sala zajeta — X". */
export function singleConflictMessage(conflict: { reason: string; with: string }): string {
  return `Kolizja: ${conflictReasonText(conflict.reason).toLowerCase()} — ${conflict.with}`;
}

/** Krotko w jednej linii (wiersz raportu "Przenies plan"): "kolizja w 8 terminach — grupa ma wtedy zajecia: X (4.10, 18.10…)". */
export function conflictShort(conflicts: ConflictLike[]): string {
  if (conflicts.length === 0) return '';
  const [top] = groupConflicts(conflicts);
  const others = conflicts.length - top!.dates.length;
  return (
    `kolizja ${inTerms(new Set(conflicts.map((c) => c.date)).size)} — ${conflictReasonText(top!.reason).toLowerCase()}: ` +
    `${top!.with} (${datesList(top!.dates, 3)})${others > 0 ? `; pozostale kolizje: ${others}` : ''}`
  );
}
