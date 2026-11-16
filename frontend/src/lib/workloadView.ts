import { departmentLabel, instructorName } from '@/lib/departments';
import { matchesAllWords } from '@/lib/searchMatch';
import type { Instructor, StudyMode, WorkloadItem, WorkloadPerson } from '@/types';

/** Wymiar pozycji jak w arkuszu katedry: "3 gr. × 15 h = 45 h", "2 gr. = 25 h" (rozne godziny), "15 h". */
export function itemSize(item: Pick<WorkloadItem, 'groups' | 'hours'>): string {
  const n = item.groups.length;
  if (n <= 1) return `${item.hours} h`;
  const first = item.groups[0]!.hours;
  return item.groups.every((g) => g.hours === first) ? `${n} gr. × ${first} h = ${item.hours} h` : `${n} gr. = ${item.hours} h`;
}

/** Tryb w filtrze obciazen: oba albo jeden (jak arkusze katedr "stac-zima" / "niestac-zima"). */
export type ModeFilter = 'all' | StudyMode;
/** Filtr katedry: wszystkie, bez katedry albo id katedry. */
export const ALL_DEPARTMENTS = 'all';
export const NO_DEPARTMENT = 'none';

/** Obciazenie osoby tylko w wybranym trybie: pozycje tego trybu, godziny przeliczone. */
export function inMode(person: WorkloadPerson, mode: ModeFilter): WorkloadPerson {
  if (mode === 'all') return person;
  const hours = mode === 'FULL_TIME' ? person.fullTime : person.partTime;
  return {
    ...person,
    here: hours,
    fullTime: mode === 'FULL_TIME' ? hours : 0,
    partTime: mode === 'PART_TIME' ? hours : 0,
    items: person.items.filter((i) => i.studyMode === mode),
  };
}

export interface DepartmentBlock {
  /** null = prowadzacy bez katedry. */
  id: string | null;
  label: string;
  name: string | null;
  people: WorkloadPerson[];
  hours: number;
  fullTime: number;
  partTime: number;
}

/** Osoba z katedry bez zajec w widoku — zeby dalo sie jej dopisac zajecia z arkusza katedry. */
function emptyPerson(instructor: Instructor): WorkloadPerson {
  return {
    id: instructor.id,
    name: instructorName(instructor),
    department: instructor.department
      ? { id: instructor.department.id, name: instructor.department.name, label: departmentLabel(instructor.department) }
      : null,
    here: 0,
    fullTime: 0,
    partTime: 0,
    total: 0,
    items: [],
  };
}

/**
 * Obciazenia w ukladzie arkusza katedry: katedra → osoby (od najwiekszego obciazenia), sumy
 * katedry jak "suma kontrolna" w arkuszu. Po wybraniu katedry dochodza jej czlonkowie bez
 * godzin w widoku (z listy prowadzacych). Katedry alfabetycznie, "Bez katedry" na koncu.
 */
export function workloadBlocks(
  people: WorkloadPerson[],
  opts: { department: string; mode: ModeFilter; search: string; members?: Instructor[] },
): DepartmentBlock[] {
  const inScope = (departmentId: string | null) =>
    opts.department === ALL_DEPARTMENTS ||
    (opts.department === NO_DEPARTMENT ? departmentId === null : departmentId === opts.department);
  const shown = people
    .map((p) => inMode(p, opts.mode))
    .filter((p) => p.here > 0 && inScope(p.department?.id ?? null));
  if (opts.department !== ALL_DEPARTMENTS && opts.department !== NO_DEPARTMENT) {
    const present = new Set(shown.map((p) => p.id));
    for (const m of opts.members ?? []) {
      if (m.departmentId === opts.department && !present.has(m.id)) {
        // Osoba moze miec godziny tylko w drugim trybie — wtedy pokazujemy ja z zerem w tym.
        const known = people.find((p) => p.id === m.id);
        shown.push(known ? inMode(known, opts.mode) : emptyPerson(m));
      }
    }
  }
  const found = shown.filter((p) => matchesAllWords(`${p.name} ${p.department?.label ?? ''}`, opts.search));

  const blocks = new Map<string, DepartmentBlock>();
  for (const person of found) {
    const key = person.department?.id ?? '';
    let block = blocks.get(key);
    if (!block) {
      block = {
        id: person.department?.id ?? null,
        label: person.department?.label ?? 'Bez katedry',
        name: person.department?.name ?? null,
        people: [],
        hours: 0,
        fullTime: 0,
        partTime: 0,
      };
      blocks.set(key, block);
    }
    block.people.push(person);
    block.hours += person.here;
    block.fullTime += person.fullTime;
    block.partTime += person.partTime;
  }
  for (const block of blocks.values()) {
    block.people.sort((a, b) => b.here - a.here || a.name.localeCompare(b.name, 'pl'));
  }
  return [...blocks.values()].sort((a, b) => (!a.id !== !b.id ? (a.id ? -1 : 1) : a.label.localeCompare(b.label, 'pl')));
}
