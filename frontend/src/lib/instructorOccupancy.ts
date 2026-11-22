import type { Department, Instructor, Role } from '@/types';
import { compareDepartments, departmentLabel, instructorName } from './departments';
import { matchesAllWords } from './searchMatch';

/**
 * Strona „Zajetosc prowadzacych” — wiersze i filtry prowadzacych (czysta logika bez DOM). Wspolna
 * logika widoku zajetosci (os czasu, zajete godziny, opisy pozycji): lib/occupancyView.
 */

/** Radix Select nie przyjmuje pustego stringa jako wartosci — stad wartownicy (jak na liscie prowadzacych). */
export const NO_FACULTY = '__none__';
export const NO_DEPARTMENT = '__none__';

export interface InstructorFilters {
  /** 'all', NO_FACULTY (ogolnouczelniani — bez wydzialu) albo id wydzialu prowadzacego. */
  faculty: string;
  /** 'all', NO_DEPARTMENT (bez katedry) albo id katedry. */
  department: string;
  /** Nazwisko, imie, tytul albo katedra (kazde slowo, bez polskich znakow). */
  query: string;
}

export const inFaculty = (i: Pick<Instructor, 'facultyId'>, faculty: string) =>
  faculty === 'all' || (faculty === NO_FACULTY ? !i.facultyId : i.facultyId === faculty);

const inDepartment = (i: Pick<Instructor, 'departmentId'>, department: string) =>
  department === 'all' || (department === NO_DEPARTMENT ? !i.departmentId : i.departmentId === department);

/** Jednostka prowadzacego jak w obsadzie: katedra ("KEO-WE"), bez katedry — skrot wydzialu. */
export function instructorUnit(i: Pick<Instructor, 'department' | 'faculty'>): string | null {
  return i.department ? departmentLabel(i.department) : (i.faculty?.shortName ?? null);
}

const plCompare = (a: string, b: string) => a.localeCompare(b, 'pl', { sensitivity: 'base' });

/** Prowadzacy spelniajacy filtry, po nazwisku i imieniu. */
export function instructorRows(instructors: Instructor[], filters: InstructorFilters): Instructor[] {
  return instructors
    .filter((i) => inFaculty(i, filters.faculty) && inDepartment(i, filters.department))
    .filter((i) => !filters.query.trim() || matchesAllWords(`${instructorName(i)} ${instructorUnit(i) ?? ''} ${i.department?.name ?? ''}`, filters.query))
    .sort((a, b) => plCompare(a.lastName, b.lastName) || plCompare(a.firstName, b.firstName) || plCompare(a.title ?? '', b.title ?? ''));
}

/** Katedry do filtra: te, ktore maja prowadzacych w wybranym wydziale. */
export function departmentsInFaculty(instructors: Instructor[], faculty: string): Department[] {
  const byId = new Map<string, Department>();
  for (const i of instructors) if (i.department && inFaculty(i, faculty)) byId.set(i.department.id, i.department);
  return [...byId.values()].sort(compareDepartments);
}

/** Domyslny filtr wydzialu: wydzial planisty (dziekanat) albo wydzial z filtra admina — gdy ma prowadzacych. */
export function defaultFacultyFilter(
  role: Role | undefined,
  userFacultyId: string | null | undefined,
  globalFacultyId: string,
  instructors: Pick<Instructor, 'facultyId'>[],
): string {
  const facultyId = role === 'DEAN_OFFICE' ? userFacultyId : globalFacultyId !== 'all' ? globalFacultyId : null;
  return facultyId && instructors.some((i) => i.facultyId === facultyId) ? facultyId : 'all';
}
