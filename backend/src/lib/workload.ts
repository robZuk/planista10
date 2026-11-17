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
  /** Klucze zajec laczonych (Placement.jointKey) z umieszczen tej osoby w tych zajeciach. */
  jointKeys?: string[];
  /** Krotki opis zajec do "laczone z ..." (rocznik i grupa albo "inny wydzial"). */
  label?: string;
}

export interface WorkloadGroup {
  sectionId: string;
  name: string;
  /** Godziny tej osoby w grupie. */
  hours: number;
  /** Godziny zajec grupy (z programu). */
  sectionHours: number;
  /** Godziny liczone do obciazenia — 0, gdy to te same zajecia co laczone z nimi (liczone raz). */
  countedHours: number;
  /** Zajecia laczone z ta grupa (wspolny jointKey w planie) — opisy pozostalych. */
  jointWith: string[];
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
  /** Godziny liczone (zajecia laczone raz). */
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

/**
 * Zajecia laczone miedzy kierunkami (wspolny Placement.jointKey) to jedne zajecia osoby, choc
 * w obsadzie sa dwa razy (osobno w kazdym roczniku). Pozycje jednej osoby polaczone wspolnym
 * kluczem tworza klaster, ktory liczy sie raz: pelne godziny ma pozycja z najwieksza liczba
 * godzin (najlepiej z widoku, zeby godziny nie uciekly do innego wydzialu), pozostale 0.
 * Bez planu (zanim ktos umiesci zajecia jako laczone) system nie wie o laczeniu.
 */
export function jointCounting(entries: WorkloadEntry[]): { counted: number[]; jointWith: string[][] } {
  const counted = entries.map((e) => e.hours);
  const jointWith: string[][] = entries.map(() => []);
  // Union-find po pozycjach jednej osoby polaczonych wspolnym kluczem.
  const parent = entries.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const owner = new Map<string, number>();
  entries.forEach((e, i) => {
    for (const key of e.jointKeys ?? []) {
      const k = `${e.instructorId}|${key}`;
      const j = owner.get(k);
      if (j === undefined) owner.set(k, i);
      else parent[find(i)] = find(j);
    }
  });
  const clusters = new Map<number, number[]>();
  entries.forEach((_, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), i]));
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const pool = members.some((i) => entries[i]!.view) ? members.filter((i) => entries[i]!.view) : members;
    const kept = pool.reduce((best, i) => (entries[i]!.hours > entries[best]!.hours ? i : best), pool[0]!);
    for (const i of members) {
      if (i !== kept) counted[i] = 0;
      jointWith[i] = members.filter((j) => j !== i).map((j) => entries[j]!.label ?? '?');
    }
  }
  return { counted, jointWith };
}

/** Obciazenia osob z zajeciami w widoku, od najwiekszych; pozycje w kolejnosci rocznikow i programu. */
export function aggregateWorkload(entries: WorkloadEntry[]): WorkloadPerson[] {
  const { counted, jointWith } = jointCounting(entries);
  const people = new Map<string, WorkloadPerson>();
  const itemsOf = new Map<string, Map<string, WorkloadItem>>();
  entries.forEach((e, index) => {
    const hours = counted[index]!;
    let person = people.get(e.instructorId);
    if (!person) {
      person = { instructorId: e.instructorId, here: 0, fullTime: 0, partTime: 0, total: 0, items: [] };
      people.set(e.instructorId, person);
      itemsOf.set(e.instructorId, new Map());
    }
    person.total += hours;
    if (!e.view) return;
    person.here += hours;
    if (e.view.studyMode === 'PART_TIME') person.partTime += hours;
    else person.fullTime += hours;
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
    item.groups.push({
      sectionId: e.sectionId,
      name: e.view.group,
      hours: e.hours,
      sectionHours: e.sectionHours,
      countedHours: hours,
      jointWith: jointWith[index]!,
    });
    item.hours += hours;
  });
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
