import type { ClassType } from '@prisma/client';
import { isActiveIn, ROOT, SPEC, type TreeGroup } from './groupTree';

/**
 * Zapotrzebowanie: jakie zajecia (przedmiot x forma x grupa) rocznik musi miec
 * w danym semestrze programu. Czysta funkcja — bez bazy, wiec latwo ja testowac.
 *
 * Regula doboru grup dla formy zajec:
 *   W -> grupa wykladowa: caly rocznik albo specjalnosc (zob. lectureMode),
 *   C -> grupy cwiczeniowe (C),
 *   L -> laboratoryjne (L), a gdy ich brak -> cwiczeniowe,
 *   P -> projektowe (P), a gdy ich brak -> cwiczeniowe,
 *   S -> seminaryjne (S), a gdy ich brak -> cwiczeniowe;
 *   gdy nie ma i cwiczeniowych — grupa wykladowa.
 * Zastepczy podzial jest oznaczany (fallback), zeby planista widzial, ze np. projekt
 * idzie w grupach cwiczeniowych, bo rocznik nie ma osobnego podzialu projektowego.
 *
 * Przedmiot specjalnosciowy bierze grupy tylko z poddrzewa swojej specjalnosci (brak
 * grupy specjalnosci -> zajecia pominiete i zgloszone jako problem);
 * wspolny — z calego rocznika. Wyklad przedmiotu wspolnego: przy lectureMode SEPARATE
 * osobno dla kazdej specjalnosci (jesli rocznik jest juz podzielony), przy JOINT — razem.
 */

export interface DemandEntry {
  id: string;
  specializationId: string | null;
  hoursLecture: number;
  hoursExercise: number;
  hoursLab: number;
  hoursProject: number;
  hoursSeminar: number;
}

export interface DemandSection {
  programEntryId: string;
  classType: ClassType;
  groupId: string;
  hours: number;
  /** Grupy z podzialu zastepczego (np. projekt w grupach cwiczeniowych). */
  fallback: boolean;
}

export type DemandProblemKind = 'NO_ROOT_GROUP' | 'MISSING_SPECIALIZATION_GROUP';

export interface DemandProblem {
  programEntryId: string;
  kind: DemandProblemKind;
  /** Specjalnosc, ktorej grupy brakuje (MISSING_SPECIALIZATION_GROUP). */
  specializationId: string | null;
  message: string;
}

const HOURS: [ClassType, keyof DemandEntry][] = [
  ['LECTURE', 'hoursLecture'],
  ['EXERCISE', 'hoursExercise'],
  ['LAB', 'hoursLab'],
  ['PROJECT', 'hoursProject'],
  ['SEMINAR', 'hoursSeminar'],
];

/** Kolejnosc podzialow probowanych dla formy zajec. */
const PARTITIONS: Record<ClassType, string[]> = {
  LECTURE: [],
  EXERCISE: ['C'],
  LAB: ['L', 'C'],
  PROJECT: ['P', 'C'],
  SEMINAR: ['S', 'C'],
};

export function deriveSections(input: {
  entries: DemandEntry[];
  groups: TreeGroup[];
  semester: number;
  lectureMode: 'SEPARATE' | 'JOINT';
}): { sections: DemandSection[]; problems: DemandProblem[] } {
  const groups = input.groups.filter((g) => isActiveIn(g, input.semester));
  const byParent = new Map<string, TreeGroup[]>();
  for (const g of groups) {
    if (!g.parentId) continue;
    byParent.set(g.parentId, [...(byParent.get(g.parentId) ?? []), g]);
  }
  const root = groups.find((g) => g.partitionKey === ROOT);
  const specs = groups.filter((g) => g.partitionKey === SPEC);

  /** Wszyscy potomkowie (aktywni) wezla. */
  const descendants = (id: string): TreeGroup[] => {
    const out: TreeGroup[] = [];
    const stack = [...(byParent.get(id) ?? [])];
    while (stack.length) {
      const g = stack.pop()!;
      out.push(g);
      stack.push(...(byParent.get(g.id) ?? []));
    }
    return out;
  };

  const sections: DemandSection[] = [];
  const problems: DemandProblem[] = [];
  if (!root) {
    problems.push({ programEntryId: '', kind: 'NO_ROOT_GROUP', specializationId: null, message: 'Rocznik nie ma grupy "caly rocznik"' });
    return { sections, problems };
  }

  for (const entry of input.entries) {
    let scopes: TreeGroup[];
    if (entry.specializationId) {
      const spec = specs.find((s) => s.specializationId === entry.specializationId);
      if (!spec) {
        // Bez grupy specjalnosci nie wiadomo, kto ma te zajecia — przypisanie calemu
        // rocznikowi dalo by je studentom innej specjalnosci. Pomijamy i zglaszamy.
        problems.push({
          programEntryId: entry.id,
          kind: 'MISSING_SPECIALIZATION_GROUP',
          specializationId: entry.specializationId,
          message: 'Przedmiot specjalnosciowy, a rocznik nie ma grupy tej specjalnosci — zajecia pominiete (dodaj specjalnosc w Rocznikach)',
        });
        continue;
      }
      scopes = [spec];
    } else {
      scopes = [root];
    }

    for (const [classType, field] of HOURS) {
      const hours = entry[field] as number;
      if (hours <= 0) continue;

      for (const scope of scopes) {
        // Grupy wykladowe zakresu: przy wspolnym przedmiocie i osobnych wykladach — specjalnosci.
        const lectureGroups =
          scope.partitionKey === ROOT && input.lectureMode === 'SEPARATE' && specs.length > 0 ? specs : [scope];

        let chosen: TreeGroup[] = [];
        let fallback = false;
        if (classType !== 'LECTURE') {
          const inScope = descendants(scope.id);
          const order = PARTITIONS[classType];
          for (let i = 0; i < order.length; i++) {
            const found = inScope.filter((g) => g.partitionKey === order[i]);
            if (found.length > 0) {
              chosen = found;
              fallback = i > 0;
              break;
            }
          }
          if (chosen.length === 0) fallback = true;
        }
        if (chosen.length === 0) chosen = lectureGroups;
        for (const group of chosen) {
          sections.push({ programEntryId: entry.id, classType, groupId: group.id, hours, fallback });
        }
      }
    }
  }
  return { sections, problems };
}

/** Klucz zajec w semestrze (unikalnosc jak w bazie). */
export function sectionKey(s: { programEntryId: string; classType: ClassType; groupId: string }): string {
  return `${s.programEntryId}|${s.classType}|${s.groupId}`;
}

/**
 * Podzial godzin przy przenoszeniu obsady: gdy liczba godzin zajec sie zmienila,
 * skalujemy proporcjonalnie, a reszte z zaokraglen oddajemy pierwszemu prowadzacemu.
 */
export function scaleHours(source: number[], targetTotal: number): number[] {
  const total = source.reduce((a, b) => a + b, 0);
  if (total === targetTotal || total === 0) return total === 0 ? source.map(() => 0) : [...source];
  const scaled = source.map((h) => Math.floor((h * targetTotal) / total));
  scaled[0]! += targetTotal - scaled.reduce((a, b) => a + b, 0);
  return scaled;
}
