import { assignLanes, type LanePlacement } from './gridLanes';

/** "2026-11-09" + n dni — w UTC, wiec zmiana czasu nie przesuwa dnia. */
function addDays(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Tydzien "Mojego planu" jako kalendarz. Plan osobisty laczy wydzialy o roznych siatkach godzin
 * (07:15, 07:30, 08:00...), wiec — inaczej niz siatka planu wydzialu — os jest w minutach, nie
 * w blokach. Czyste funkcje: kolumny dni, zakres godzin i tory zajec rownoleglych.
 */

export interface WeekRow {
  id: string;
  date: string;
  startMinute: number;
  endMinute: number;
}

/** Poniedzialek-piatek zawsze; sobota i niedziela tylko, gdy maja zajecia (studia niestacjonarne). */
export function weekColumns(monday: string, rows: Pick<WeekRow, 'date'>[]): string[] {
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const used = new Set(rows.map((r) => r.date));
  return days.filter((d, i) => i < 5 || used.has(d));
}

/** Zakres osi w minutach od polnocy: pelne godziny wokol zajec; pusty tydzien — 8:00-16:00. */
export function hourRange(rows: Pick<WeekRow, 'startMinute' | 'endMinute'>[]): { from: number; to: number } {
  if (rows.length === 0) return { from: 8 * 60, to: 16 * 60 };
  const from = Math.floor(Math.min(...rows.map((r) => r.startMinute)) / 60) * 60;
  const to = Math.ceil(Math.max(...rows.map((r) => r.endMinute)) / 60) * 60;
  return { from, to };
}

/**
 * Tory zajec nakladajacych sie w czasie (np. wyklad i cwiczenia innej grupy studenta albo
 * odwolany termin i odrobienie). Przedzialy minut sa polotwarte — zajecia 9:00-10:00
 * i 10:00-11:00 nie stoja obok siebie.
 */
export function weekLanes(rows: WeekRow[]): Map<string, LanePlacement> {
  const result = new Map<string, LanePlacement>();
  const byDate = new Map<string, WeekRow[]>();
  for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  for (const dayRows of byDate.values()) {
    const lanes = assignLanes(dayRows.map((r) => ({ id: r.id, startOrder: r.startMinute, endOrder: r.endMinute - 1 })));
    for (const [id, lane] of lanes) result.set(id, lane);
  }
  return result;
}
