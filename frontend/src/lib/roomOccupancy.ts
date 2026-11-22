import type { Building, Faculty, Role, Room, RoomType } from '@/types';
import { matchesAllWords } from './searchMatch';

/**
 * Strona „Zajetosc sal” — wiersze i filtry sal (czysta logika bez DOM). Wspolna logika widoku zajetosci
 * (os czasu, zajete godziny, opisy pozycji): lib/occupancyView.
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
