import { isIsoDate, toIsoDate, type IsoDate } from './isoDate';
import { minutesOverlap } from './timeGrid';
import { EXTERNAL_PREFIX, shortDate } from './conflictMessage';
import type { BusySlot } from './materializer';

/**
 * Zajetosci zewnetrzne — czas prowadzacego i/lub sali zajety poza planem w systemie
 * (zajecia innych wydzialow zgloszone mailem). Czyste funkcje, bez bazy.
 *
 * Zajetosc nie jest zajeciami: nie ma grupy ani godzin programu, wiec koliduje tylko salowo
 * i prowadzacym. Ma czas w minutach (inne wydzialy maja inne siatki) i konkretne daty
 * (inne wydzialy maja wlasne kalendarze i zjazdy) — jak terminy, z ktorymi sie porownuje.
 */

export interface ExternalBusyEntry {
  id: string;
  source: string;
  receivedOn: IsoDate | Date;
  instructorId: string | null;
  roomId: string | null;
  startMinute: number;
  endMinute: number;
  dates: (IsoDate | Date)[];
  note: string | null;
}

/** Najwiecej dat w jednym wpisie — semestr ma ok. 15 tygodni, zjazdy po kilka dni. */
export const MAX_EXTERNAL_DATES = 200;

/** Opis do komunikatow kolizji: "zajecia poza wydzialem (WE – dziekanat, stan na 10.02): wyklad". */
export function externalLabel(entry: Pick<ExternalBusyEntry, 'source' | 'receivedOn' | 'note'>): string {
  const note = entry.note?.trim();
  return `${EXTERNAL_PREFIX} (${entry.source}, stan na ${shortDate(toIsoDate(entry.receivedOn))})${note ? `: ${note}` : ''}`;
}

/** Wpis -> zajete sloty na kazda date (bez grupy: koliduje tylko sala i prowadzacy). */
export function externalBusySlots(entry: ExternalBusyEntry): BusySlot[] {
  const label = externalLabel(entry);
  return entry.dates.map((d) => ({
    date: toIsoDate(d),
    startMinute: entry.startMinute,
    endMinute: entry.endMinute,
    roomId: entry.roomId,
    instructorId: entry.instructorId,
    groupId: null,
    jointKey: null,
    label,
  }));
}

/** Daty bez powtorzen, posortowane — tak zapisujemy wpis. */
export function normalizeDates(dates: IsoDate[]): IsoDate[] {
  return [...new Set(dates)].sort();
}

/** Bledy wpisu (puste = poprawny): zasob, godziny, daty. */
export function externalBusyProblems(input: {
  instructorId: string | null;
  roomId: string | null;
  startMinute: number;
  endMinute: number;
  dates: IsoDate[];
}): string[] {
  const problems: string[] = [];
  if (!input.instructorId && !input.roomId) problems.push('Wskaz prowadzacego albo sale (albo oba)');
  if (input.startMinute < 0 || input.endMinute > 24 * 60 || input.startMinute >= input.endMinute) {
    problems.push('Godzina zakonczenia musi byc pozniejsza niz rozpoczecia');
  }
  if (input.dates.length === 0) problems.push('Podaj co najmniej jedna date');
  if (input.dates.some((d) => !isIsoDate(d))) problems.push('Nieprawidlowa data');
  if (normalizeDates(input.dates).length > MAX_EXTERNAL_DATES) problems.push(`Najwyzej ${MAX_EXTERNAL_DATES} dat w jednym wpisie`);
  return problems;
}

export interface ExternalClash {
  date: IsoDate;
  reason: 'ROOM' | 'INSTRUCTOR';
  with: string;
}

/**
 * Zajecia planu, z ktorymi zajetosc zewnetrzna sie zderza (ta sama sala albo prowadzacy,
 * nakladajace sie minuty tej samej daty). Jedna kolizja na date i zajecia — zajetosc z wzorca
 * i z wygenerowanych terminow bywa ta sama.
 */
export function externalClashes(entry: ExternalBusyEntry, busy: BusySlot[]): ExternalClash[] {
  const dates = new Set(entry.dates.map(toIsoDate));
  const seen = new Set<string>();
  const out: ExternalClash[] = [];
  for (const b of busy) {
    if (!dates.has(b.date) || !minutesOverlap(entry.startMinute, entry.endMinute, b.startMinute, b.endMinute)) continue;
    const reason = entry.roomId && b.roomId === entry.roomId ? 'ROOM' : entry.instructorId && b.instructorId === entry.instructorId ? 'INSTRUCTOR' : null;
    if (!reason) continue;
    const key = `${b.date}|${b.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date: b.date, reason, with: b.label });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.with.localeCompare(b.with));
}
