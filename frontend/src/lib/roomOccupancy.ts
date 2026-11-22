import type { Building, Faculty, Role, Room, RoomOccupancyEntry, RoomType, TermWeek } from '@/types';
import { CLASS_LABELS } from './scheduleDisplay';
import { formatMinutes } from './timeGrid';
import { matchesAllWords } from './searchMatch';

/**
 * Strona „Zajetosc sal” — czysta logika bez DOM: filtr sal, dni i os czasu widoku, zajete minuty,
 * wolna sala w przedziale godzin, opisy tygodni i pozycji. Dane (cala uczelnia, konkretne daty)
 * liczy backend (services/roomOccupancy) — te same, na ktorych licza sie kolizje sali.
 */

export interface RoomRow {
  room: Room;
  building: Building;
}

/**
 * Filtr budynkow: 'all' — wszystkie, 'faculty:<id>' — budynki wydzialu, 'shared' — budynki bez
 * wydzialu (ogolnouczelniane: aula, SJO, hale sportowe), 'building:<id>' — jeden budynek.
 */
export type BuildingFilter = string;

export interface RoomFilters {
  building: BuildingFilter;
  type: RoomType | 'all';
  /** Co najmniej tyle miejsc; null — bez progu. */
  minCapacity: number | null;
  /** Numer sali albo nazwa budynku (kazde slowo, bez polskich znakow). */
  query: string;
}

export function matchesBuilding(building: Pick<Building, 'id' | 'facultyId'>, filter: BuildingFilter): boolean {
  if (filter === 'shared') return !building.facultyId;
  if (filter.startsWith('faculty:')) return building.facultyId === filter.slice('faculty:'.length);
  if (filter.startsWith('building:')) return building.id === filter.slice('building:'.length);
  return true;
}

const plCompare = (a: string, b: string) => a.localeCompare(b, 'pl', { numeric: true, sensitivity: 'base' });

/** Sale spelniajace filtry: budynek po budynku (nazwa), w budynku numery rosnaco (101 przed 1010). */
export function roomRows(buildings: Building[], filters: RoomFilters): RoomRow[] {
  return buildings
    .filter((b) => matchesBuilding(b, filters.building))
    .flatMap((building) => (building.rooms ?? []).map((room) => ({ room, building })))
    .filter(({ room }) => filters.type === 'all' || room.type === filters.type)
    .filter(({ room }) => filters.minCapacity === null || room.capacity >= filters.minCapacity)
    .filter(({ room, building }) => !filters.query.trim() || matchesAllWords(`${room.number} ${building.name}`, filters.query))
    .sort((a, b) => plCompare(a.building.name, b.building.name) || plCompare(a.room.number, b.room.number));
}

/** Pozycje sal po sali i dniu (kolejnosc z API: godzina rosnaco). */
export function indexEntries(entries: RoomOccupancyEntry[]): Map<string, Map<string, RoomOccupancyEntry[]>> {
  const byRoom = new Map<string, Map<string, RoomOccupancyEntry[]>>();
  for (const e of entries) {
    const byDay = byRoom.get(e.roomId) ?? new Map<string, RoomOccupancyEntry[]>();
    byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
    byRoom.set(e.roomId, byDay);
  }
  return byRoom;
}

type Span = Pick<RoomOccupancyEntry, 'date' | 'startMinute' | 'endMinute'>;

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

/** Tydzien odniesienia dla procentu wykorzystania: pn–pt 8:00–20:00 (60 h). */
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
export function timeAxis(entries: Pick<RoomOccupancyEntry, 'startMinute' | 'endMinute'>[]): { start: number; end: number } {
  let start = 8 * 60;
  let end = 18 * 60;
  for (const e of entries) {
    start = Math.min(start, Math.floor(e.startMinute / 60) * 60);
    end = Math.max(end, Math.ceil(e.endMinute / 60) * 60);
  }
  return { start, end };
}

/** Dni widoku: pn–pt zawsze, sobota i niedziela — gdy cos sie w nich odbywa (zjazdy). */
export function visibleDays(days: string[], entries: Pick<RoomOccupancyEntry, 'date'>[]): string[] {
  const used = new Set(entries.map((e) => e.date));
  return days.filter((d, i) => i < 5 || used.has(d));
}

/** Sala wolna w przedziale [from, to) — zadne zajecia z dnia nie nachodza na niego. */
export function isFree(dayEntries: Pick<RoomOccupancyEntry, 'startMinute' | 'endMinute'>[], from: number, to: number): boolean {
  return dayEntries.every((e) => e.endMinute <= from || e.startMinute >= to);
}

const isoAddDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

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
export function weekLabel(week: TermWeek): string {
  return `tydz. ${week.number} · ${weekRange(week.monday)}`;
}

export interface BuildingOption {
  value: BuildingFilter;
  label: string;
}

/**
 * Opcje filtra: wszystkie, budynki kazdego wydzialu (ktory ma budynki), ogolnouczelniane i potem
 * pojedyncze budynki z liczba sal.
 */
export function buildingFilterOptions(buildings: Building[], faculties: Faculty[]): { groups: BuildingOption[]; buildings: BuildingOption[] } {
  const withRooms = buildings.filter((b) => (b.rooms?.length ?? 0) > 0);
  const groups: BuildingOption[] = [{ value: 'all', label: 'Wszystkie budynki' }];
  for (const f of [...faculties].sort((a, b) => plCompare(a.shortName, b.shortName))) {
    if (withRooms.some((b) => b.facultyId === f.id)) groups.push({ value: `faculty:${f.id}`, label: `Budynki ${f.shortName}` });
  }
  if (withRooms.some((b) => !b.facultyId)) groups.push({ value: 'shared', label: 'Ogolnouczelniane (bez wydzialu)' });
  // Nazwa budynku bez dopisku wydzialu: bywa juz w nazwie („Budynek A (WM)” obok „Budynek A” z WM),
  // a dopisek dawal dwie takie same pozycje. Budynki wydzialu sa wyzej jako jedna opcja.
  const single = [...withRooms]
    .sort((a, b) => plCompare(a.name, b.name))
    .map((b) => {
      const rooms = b.rooms?.length ?? 0;
      return { value: `building:${b.id}`, label: `${b.name} · ${rooms} ${roomsWord(rooms)}` };
    });
  return { groups, buildings: single };
}

function roomsWord(n: number): string {
  if (n === 1) return 'sala';
  const lastTwo = n % 100;
  const last = n % 10;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'sale' : 'sal';
}

/** Domyslny filtr budynkow: wydzial planisty (dziekanat) albo wydzial wybrany w filtrze admina. */
export function defaultBuildingFilter(
  role: Role | undefined,
  userFacultyId: string | null | undefined,
  globalFacultyId: string,
  buildings: Pick<Building, 'facultyId'>[],
): BuildingFilter {
  const facultyId = role === 'DEAN_OFFICE' ? userFacultyId : globalFacultyId !== 'all' ? globalFacultyId : null;
  return facultyId && buildings.some((b) => b.facultyId === facultyId) ? `faculty:${facultyId}` : 'all';
}

/** Pozycje tej samej sali i dnia nachodzace na `entry` — z czym koliduje. */
export function overlapping(entry: RoomOccupancyEntry, dayEntries: RoomOccupancyEntry[]): RoomOccupancyEntry[] {
  return dayEntries.filter((e) => e.id !== entry.id && e.startMinute < entry.endMinute && entry.startMinute < e.endMinute);
}

/** Etykieta godziny na osi: "8", "14", "7:30". */
export function hourTick(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return m === 0 ? String(h) : `${h}:${String(m).padStart(2, '0')}`;
}

/** Forma i przedmiot na kafelku: "W · Mechanika"; zajetosc zewnetrzna — kto zglosil. */
export function entryTitle(e: Pick<RoomOccupancyEntry, 'kind' | 'title' | 'classType'>): string {
  if (e.kind === 'EXTERNAL') return `Zajetosc zewnetrzna · ${e.title}`;
  return e.classType ? `${CLASS_LABELS[e.classType]} · ${e.title}` : e.title;
}

/**
 * Jedna linia do dymku: "08:00–09:30 W · Mechanika · MBM-S1 s1 · MBM-1-W · dr Jan Nowak".
 * `withConflict: false` — bez dopisku o kolizji (lista kolizji w oknie szczegolow).
 */
export function entrySummary(e: RoomOccupancyEntry, { withConflict = true }: { withConflict?: boolean } = {}): string {
  const parts = [`${formatMinutes(e.startMinute)}–${formatMinutes(e.endMinute)} ${entryTitle(e)}`];
  if (e.groups.length > 0) parts.push(e.groups.map((g) => g.label).join(', '));
  if (e.kind !== 'EXTERNAL' || e.instructor) parts.push(e.instructor ?? 'NN');
  if (e.kind === 'MANUAL') parts.push('termin reczny');
  if (withConflict && e.conflict) parts.push('KOLIZJA');
  return parts.join(' · ');
}
