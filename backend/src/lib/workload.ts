import type { ClassType, StudyMode } from '@prisma/client';

/**
 * Obciazenia prowadzacych w semestrze — tak jak przysylaja je katedry: osoba → przedmiot i forma
 * w roczniku → grupy i godziny. Czysta funkcja: kontroler dostarcza pozycje obsady z opisem.
 */

/** Jedna pozycja obsady (prowadzacy w zajeciach). */
export interface WorkloadEntry {
  instructorId: string;
  hours: number;
  sectionId: string;
  sectionHours: number;
  cohortId: string;
  programEntryId: string;
  classType: ClassType;
  /** Opis zajec z widoku (wybrany wydzial); null — zajecia spoza widoku liczy tylko suma uczelni. */
  view: {
    cohort: { id: string; code: string; semester: number; label: string };
    subject: { id: string; name: string };
    /** Pozycja przedmiotu w semestrze programu (kolejnosc jak w programie). */
    order: number;
    group: string;
    studyMode: StudyMode;
  } | null;
}

export interface WorkloadGroup {
  sectionId: string;
  name: string;
  /** Godziny tej osoby w grupie. */
  hours: number;
  /** Godziny zajec grupy (z programu). */
  sectionHours: number;
}

/** Przedmiot i forma w roczniku — te same zajecia w kilku grupach (np. cwiczenia 3 gr. × 15 h). */
export interface WorkloadItem {
  key: string;
  cohort: { id: string; code: string; semester: number; label: string };
  subject: { id: string; name: string };
  order: number;
  classType: ClassType;
  studyMode: StudyMode;
  groups: WorkloadGroup[];
  hours: number;
}

export interface WorkloadPerson {
  instructorId: string;
  /** Godziny w widoku (wydziale): razem i osobno stacjonarne / niestacjonarne. */
  here: number;
  fullTime: number;
  partTime: number;
  /** Godziny w calej uczelni (z zajeciami innych wydzialow). */
  total: number;
  items: WorkloadItem[];
}

const CLASS_ORDER: ClassType[] = ['LECTURE', 'EXERCISE', 'LAB', 'PROJECT', 'SEMINAR'];
const byName = (a: string, b: string) => a.localeCompare(b, 'pl', { numeric: true });

/** Obciazenia osob z zajeciami w widoku, od najwiekszych; pozycje w kolejnosci rocznikow i programu. */
export function aggregateWorkload(entries: WorkloadEntry[]): WorkloadPerson[] {
  const people = new Map<string, WorkloadPerson>();
  const itemsOf = new Map<string, Map<string, WorkloadItem>>();
  for (const e of entries) {
    let person = people.get(e.instructorId);
    if (!person) {
      person = { instructorId: e.instructorId, here: 0, fullTime: 0, partTime: 0, total: 0, items: [] };
      people.set(e.instructorId, person);
      itemsOf.set(e.instructorId, new Map());
    }
    person.total += e.hours;
    if (!e.view) continue;
    person.here += e.hours;
    if (e.view.studyMode === 'PART_TIME') person.partTime += e.hours;
    else person.fullTime += e.hours;
    const key = `${e.cohortId}|${e.programEntryId}|${e.classType}`;
    const items = itemsOf.get(e.instructorId)!;
    let item = items.get(key);
    if (!item) {
      item = {
        key,
        cohort: e.view.cohort,
        subject: e.view.subject,
        order: e.view.order,
        classType: e.classType,
        studyMode: e.view.studyMode,
        groups: [],
        hours: 0,
      };
      items.set(key, item);
    }
    item.groups.push({ sectionId: e.sectionId, name: e.view.group, hours: e.hours, sectionHours: e.sectionHours });
    item.hours += e.hours;
  }
  for (const person of people.values()) {
    person.items = [...itemsOf.get(person.instructorId)!.values()].sort(
      (a, b) =>
        byName(a.cohort.code, b.cohort.code) ||
        a.cohort.semester - b.cohort.semester ||
        a.order - b.order ||
        byName(a.subject.name, b.subject.name) ||
        CLASS_ORDER.indexOf(a.classType) - CLASS_ORDER.indexOf(b.classType),
    );
    for (const item of person.items) item.groups.sort((a, b) => byName(a.name, b.name));
  }
  return [...people.values()]
    .filter((p) => p.here > 0)
    .sort((a, b) => b.here - a.here || a.instructorId.localeCompare(b.instructorId));
}
