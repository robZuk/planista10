import type { OccupancyEntry, OccupancyResource } from '@/types';
import { CLASS_LABELS } from './scheduleDisplay';
import { formatMinutes, toMinutes } from './timeGrid';

/**
 * Strony „Zajetosc sal” i „Zajetosc prowadzacych” — wspolna czysta logika bez DOM: indeks pozycji
 * zasobu, dni i os czasu widoku, zajete minuty, wolny przedzial godzin, opisy tygodni i pozycji. Dane
 * (cala uczelnia, konkretne daty) liczy backend (services/occupancyView) — te same, na ktorych licza
 * sie kolizje sali i prowadzacego. Filtry wierszy: lib/roomOccupancy i lib/instructorOccupancy.
 */

/** Id zasobu pozycji w danym widoku; null — pozycja bez tego zasobu (online w widoku sal, NN). */
export function resourceIdOf(e: Pick<OccupancyEntry, 'roomId' | 'instructorId'>, resource: OccupancyResource): string | null {
  return resource === 'room' ? e.roomId : e.instructorId;
}

/** Pozycje po zasobie i dniu (kolejnosc z API: godzina rosnaco). */
export function indexEntries(entries: OccupancyEntry[], resource: OccupancyResource): Map<string, Map<string, OccupancyEntry[]>> {
  const byResource = new Map<string, Map<string, OccupancyEntry[]>>();
  for (const e of entries) {
    const id = resourceIdOf(e, resource);
    if (!id) continue;
    const byDay = byResource.get(id) ?? new Map<string, OccupancyEntry[]>();
    byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
    byResource.set(id, byDay);
  }
  return byResource;
}

type Span = Pick<OccupancyEntry, 'date' | 'startMinute' | 'endMinute'>;

/** Zajete minuty — nakladajace sie zajecia (kolizje) liczone raz. */
export function busyMinutes(entries: Span[]): number {
  const byDate = new Map<string, Span[]>();
  for (const e of entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  let total = 0;
  for (const list of byDate.values()) {
    const sorted = [...list].sort((a, b) => a.startMinute - b.startMinute);
    let start = -1;
    let end = -1;
    for (const e of sorted) {
      if (e.startMinute > end) {
        total += end - start;
        start = e.startMinute;
        end = e.endMinute;
      } else end = Math.max(end, e.endMinute);
    }
    total += end - start;
  }
  return total;
}

/** Zajete minuty kazdego zasobu w tygodniu (z indeksu). */
export function busyByResource(index: Map<string, Map<string, OccupancyEntry[]>>): Map<string, number> {
  const map = new Map<string, number>();
  for (const [id, byDay] of index) map.set(id, busyMinutes([...byDay.values()].flat()));
  return map;
}

/** Tydzien odniesienia dla procentu wykorzystania sali: pn–pt 8:00–20:00 (60 h). */
export const STANDARD_WEEK_MINUTES = 5 * 12 * 60;

/** "26 h" / "7,5 h" — godziny zegarowe. */
export function hoursLabel(minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${String(hours).replace('.', ',')} h`;
}

/** Procent wykorzystania wzgledem 60 h (pn–pt 8–20) — weekend moze dac wiecej niz 100%. */
export function utilizationPercent(minutes: number): number {
  return Math.round((minutes / STANDARD_WEEK_MINUTES) * 100);
}

/** Os czasu widoku: pelne godziny wokol zajec, co najmniej 8:00–18:00. */
export function timeAxis(entries: Pick<OccupancyEntry, 'startMinute' | 'endMinute'>[]): { start: number; end: number } {
  let start = 8 * 60;
  let end = 18 * 60;
  for (const e of entries) {
    start = Math.min(start, Math.floor(e.startMinute / 60) * 60);
    end = Math.max(end, Math.ceil(e.endMinute / 60) * 60);
  }
  return { start, end };
}

/** Dni widoku: pn–pt zawsze, sobota i niedziela — gdy cos sie w nich odbywa (zjazdy). */
export function visibleDays(days: string[], entries: Pick<OccupancyEntry, 'date'>[]): string[] {
  const used = new Set(entries.map((e) => e.date));
  return days.filter((d, i) => i < 5 || used.has(d));
}

/** Zasob wolny w przedziale [from, to) — zadne zajecia z dnia nie nachodza na niego. */
export function isFree(dayEntries: Pick<OccupancyEntry, 'startMinute' | 'endMinute'>[], from: number, to: number): boolean {
  return dayEntries.every((e) => e.endMinute <= from || e.startMinute >= to);
}

const TIME_RE = /^\d{2}:\d{2}$/;

/** Szukany wolny przedzial z pol "od"/"do" ("HH:MM"); null — niepelny albo "do" nie po "od". */
export function freeRange(from: string, to: string): { from: number; to: number } | null {
  if (!TIME_RE.test(from) || !TIME_RE.test(to)) return null;
  const range = { from: toMinutes(from), to: toMinutes(to) };
  return range.from < range.to ? range : null;
}

export const isoAddDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** Przejscie do innego tygodnia (parametry adresu) — w widoku dnia ten sam dzien tygodnia. */
export function weekChange(monday: string, week: string | null, day: string | null): { week: string; day: string | null } {
  const offset = day && week ? daysBetween(week, day) : null;
  return { week: monday, day: offset === null ? null : isoAddDays(monday, offset) };
}

/** "16.11.2026" */
export function fullDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${Number(day)}.${month}.${year}`;
}

/** "16–22.11.2026", "30.11–6.12.2026", "28.12.2026–3.01.2027" */
export function weekRange(monday: string): string {
  const sunday = isoAddDays(monday, 6);
  const [y1, m1, d1] = monday.split('-');
  const [y2, m2] = sunday.split('-');
  if (y1 !== y2) return `${fullDate(monday)}–${fullDate(sunday)}`;
  if (m1 !== m2) return `${Number(d1)}.${m1}–${fullDate(sunday)}`;
  return `${Number(d1)}–${fullDate(sunday)}`;
}

/** "tydz. 8 · 16–22.11.2026" */
export function weekLabel(week: { monday: string; number: number }): string {
  return `tydz. ${week.number} · ${weekRange(week.monday)}`;
}

/** Pozycje tego samego zasobu i dnia nachodzace na `entry` — z czym koliduje. */
export function overlapping(entry: OccupancyEntry, dayEntries: OccupancyEntry[]): OccupancyEntry[] {
  return dayEntries.filter((e) => e.id !== entry.id && e.startMinute < entry.endMinute && entry.startMinute < e.endMinute);
}

/** Etykieta godziny na osi: "8", "14", "7:30". */
export function hourTick(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return m === 0 ? String(h) : `${h}:${String(m).padStart(2, '0')}`;
}

/** Forma i przedmiot na kafelku: "W · Mechanika"; zajetosc zewnetrzna — kto zglosil. */
export function entryTitle(e: Pick<OccupancyEntry, 'kind' | 'title' | 'classType'>): string {
  if (e.kind === 'EXTERNAL') return `Zajetosc zewnetrzna · ${e.title}`;
  return e.classType ? `${CLASS_LABELS[e.classType]} · ${e.title}` : e.title;
}

/** Sala pozycji w widoku prowadzacych: "101 (Budynek C)", zajecia bez sali — "online"; zajetosc zewnetrzna bez sali — null. */
export function roomLabel(e: Pick<OccupancyEntry, 'kind' | 'room'>): string | null {
  return e.room ?? (e.kind === 'EXTERNAL' ? null : 'online');
}

/**
 * Druga linia kafelka osi dnia — to, czego nie mowi wiersz: w widoku sal grupy, w widoku prowadzacych
 * sala i grupy; przy zajetosci zewnetrznej opis zgloszenia.
 */
export function entryDetail(e: OccupancyEntry, resource: OccupancyResource): string {
  const groups = e.groups.map((g) => g.label).join(', ');
  if (resource === 'room') return e.kind === 'EXTERNAL' ? (e.note ?? '') : groups;
  return [roomLabel(e), e.kind === 'EXTERNAL' ? e.note : groups].filter(Boolean).join(' · ');
}

/**
 * Jedna linia do dymku: "08:00–09:30 W · Mechanika · MBM-S1 s1 · MBM-1-W · dr Jan Nowak" (widok sal —
 * prowadzacy; widok prowadzacych — sala). `withConflict: false` — bez dopisku o kolizji (lista kolizji
 * w oknie szczegolow).
 */
export function entrySummary(e: OccupancyEntry, resource: OccupancyResource, { withConflict = true }: { withConflict?: boolean } = {}): string {
  const parts = [`${formatMinutes(e.startMinute)}–${formatMinutes(e.endMinute)} ${entryTitle(e)}`];
  if (e.groups.length > 0) parts.push(e.groups.map((g) => g.label).join(', '));
  if (resource === 'room') {
    if (e.kind !== 'EXTERNAL' || e.instructor) parts.push(e.instructor ?? 'NN');
  } else {
    const room = roomLabel(e);
    if (room) parts.push(room);
  }
  if (e.kind === 'MANUAL') parts.push('termin reczny');
  if (withConflict && e.conflict) parts.push('KOLIZJA');
  return parts.join(' · ');
}
