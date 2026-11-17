import type { ComboboxOption } from '@/components/Combobox';
import type { Department, Instructor } from '@/types';

type DepartmentRef = Pick<Department, 'shortName'> & { faculty: { shortName: string } | null };

/**
 * Oznaczenie katedry jak w zleceniach wydzialu: skrot katedry i wydzialu ("KEO-WE");
 * jednostka miedzywydzialowa — sam skrot ("SJO"). Jak backend/src/lib/department.
 */
export function departmentLabel(department: DepartmentRef): string {
  return department.faculty ? `${department.shortName}-${department.faculty.shortName}` : department.shortName;
}

/** Kolejnosc list: katedry wydzialami (po skrocie wydzialu), jednostki miedzywydzialowe na koncu. */
export function compareDepartments(a: DepartmentRef, b: DepartmentRef): number {
  if (!a.faculty !== !b.faculty) return a.faculty ? -1 : 1;
  return (
    (a.faculty?.shortName ?? '').localeCompare(b.faculty?.shortName ?? '', 'pl') ||
    a.shortName.localeCompare(b.shortName, 'pl')
  );
}

export function instructorName(instructor: Pick<Instructor, 'title' | 'firstName' | 'lastName'>): string {
  return `${instructor.title ?? ''} ${instructor.firstName} ${instructor.lastName}`.trim();
}

/**
 * Opcje wyboru skladu katedry. Przy nazwisku stoi obecna inna katedra (albo wydzial osoby bez
 * katedry) — widac, kto przejdzie z innej katedry. Imiennikow (dwoch "dr Tomasz Nowak")
 * rozroznia e-mail.
 */
export function memberOptions(instructors: Instructor[], departmentId: string): ComboboxOption[] {
  const sameName = new Map<string, number>();
  for (const i of instructors) sameName.set(instructorName(i), (sameName.get(instructorName(i)) ?? 0) + 1);
  return instructors.map((i) => {
    const name = instructorName(i);
    const unit =
      i.department && i.departmentId !== departmentId ? departmentLabel(i.department) : !i.department ? i.faculty?.shortName : null;
    const label = [name, unit, (sameName.get(name) ?? 0) > 1 ? i.email : null].filter(Boolean).join(' · ');
    return { value: i.id, label, keywords: i.email };
  });
}

/**
 * Prowadzacy do wyboru w obsadzie: przy nazwisku katedra (albo wydzial osoby bez katedry), jak
 * w arkuszach katedr; imiennikow rozroznia e-mail. Szukanie tez po e-mailu i nazwie katedry.
 */
export function instructorOptions(instructors: Instructor[]): ComboboxOption[] {
  const sameName = new Map<string, number>();
  for (const i of instructors) sameName.set(instructorName(i), (sameName.get(instructorName(i)) ?? 0) + 1);
  return instructors.map((i) => {
    const name = instructorName(i);
    const unit = i.department ? departmentLabel(i.department) : i.faculty?.shortName;
    const label = [name, unit, (sameName.get(name) ?? 0) > 1 ? i.email : null].filter(Boolean).join(' · ');
    return { value: i.id, label, keywords: [i.email, i.department?.name].filter(Boolean).join(' ') };
  });
}

export interface MembershipChanges {
  /** Przypieci, ktorzy dotad nalezeli do innej katedry. */
  moving: Instructor[];
  /** Dotychczasowi czlonkowie, ktorzy zostana bez katedry. */
  leaving: Instructor[];
  /** Przypieci, ktorym katedra wydzialowa zmieni wydzial. */
  facultyChanging: Instructor[];
}

/** Co zmieni zapis skladu katedry — okno pokazuje to przed zapisem. */
export function membershipChanges(
  instructors: Instructor[],
  department: Pick<Department, 'id' | 'facultyId'>,
  selectedIds: string[],
): MembershipChanges {
  const chosen = new Set(selectedIds);
  const joining = instructors.filter((i) => chosen.has(i.id));
  return {
    moving: joining.filter((i) => i.departmentId !== null && i.departmentId !== department.id),
    leaving: instructors.filter((i) => !chosen.has(i.id) && i.departmentId === department.id),
    facultyChanging: department.facultyId ? joining.filter((i) => i.facultyId !== department.facultyId) : [],
  };
}

export interface DepartmentOptionGroup {
  label: string;
  departments: Department[];
}

/**
 * Katedry w wyborze na stronach wydzialu (Obsada): najpierw katedry tego wydzialu, jednostki
 * miedzywydzialowe (SJO) i katedry, ktore juz maja tu zajecia; reszta uczelni osobno na koncu —
 * potrzebna rzadko (osoba z katedry innego wydzialu, ktorej dopisuje sie zajecia), wiec nie
 * miesza sie z wlasnymi. Bez wybranego wydzialu (cala uczelnia) — jedna lista.
 */
export function departmentSelectGroups(
  departments: Department[],
  opts: { facultyId: string | null; usedIds: Set<string> },
): DepartmentOptionGroup[] {
  const sorted = [...departments].sort(compareDepartments);
  if (!opts.facultyId) return [{ label: 'Katedry', departments: sorted }];
  const near = (d: Department) => d.facultyId === opts.facultyId || d.facultyId === null || opts.usedIds.has(d.id);
  return [
    { label: 'Ten wydzial i katedry z zajeciami na nim', departments: sorted.filter(near) },
    { label: 'Inne wydzialy', departments: sorted.filter((d) => !near(d)) },
  ].filter((g) => g.departments.length > 0);
}
