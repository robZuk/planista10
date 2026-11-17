import { CLASS_FULL_LABELS } from '@/lib/scheduleDisplay';
import type { ClassSectionRow, ClassType } from '@/types';

/**
 * Przedmiot i forma w roczniku — wszystkie grupy tych samych zajec, tak jak w zleceniach
 * i arkuszach katedr ("cwiczenia, 3 gr. × 15 h"). Obsade wciaz zapisuje sie per grupa.
 */
export interface SectionGroup {
  key: string;
  cohort: ClassSectionRow['cohort'];
  subject: ClassSectionRow['subject'];
  specialization: string | null;
  specializationName: string | null;
  classType: ClassType;
  programEntryId: string;
  /** Katedra prowadzaca te forme przedmiotu (zlecenie wydzialu). */
  department: ClassSectionRow['department'];
  sections: ClassSectionRow[];
  /** Suma godzin grup. */
  hours: number;
  /** Obsadzone godziny (w kazdej grupie najwyzej jej godziny). */
  assignedHours: number;
  hasVacancy: boolean;
  orphaned: boolean;
  archived: boolean;
}

/** Klucz pozycji: rocznik, przedmiot (z jego specjalnoscia — osobna pozycja programu) i forma. */
export const groupKey = (row: ClassSectionRow): string =>
  `${row.cohort.id}|${row.subject.id}|${row.specialization ?? ''}|${row.classType}`;

/** Grupuje zajecia w pozycje przedmiot × forma, w kolejnosci listy zajec (rocznik, program, forma). */
export function groupSections(rows: ClassSectionRow[]): SectionGroup[] {
  const groups = new Map<string, SectionGroup>();
  for (const row of rows) {
    const key = groupKey(row);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        cohort: row.cohort,
        subject: row.subject,
        specialization: row.specialization,
        specializationName: row.specializationName,
        classType: row.classType,
        programEntryId: row.programEntryId,
        department: row.department,
        sections: [],
        hours: 0,
        assignedHours: 0,
        hasVacancy: false,
        orphaned: false,
        archived: row.cohort.archived,
      };
      groups.set(key, group);
    }
    group.sections.push(row);
    group.hours += row.hours;
    group.assignedHours += Math.min(row.assignedHours, row.hours);
    group.hasVacancy ||= row.hasVacancy;
    group.orphaned ||= row.status === 'ORPHANED';
  }
  return [...groups.values()];
}

/** Godziny osoby w zajeciach (0 = nie prowadzi). */
export function personHours(section: Pick<ClassSectionRow, 'instructors'>, instructorId: string): number {
  return section.instructors.find((i) => i.instructorId === instructorId)?.hours ?? 0;
}

/**
 * Godziny, ktore moze dostac osoba: godziny zajec minus obsada innych prowadzacych. NN sie nie
 * liczy — przy zapisie ustepuje (jak na serwerze, lib/staffing.withPersonHours).
 */
export function freeHoursFor(section: Pick<ClassSectionRow, 'hours' | 'instructors'>, instructorId: string): number {
  const others = section.instructors
    .filter((i) => i.instructorId && i.instructorId !== instructorId)
    .reduce((sum, i) => sum + i.hours, 0);
  return Math.max(0, section.hours - others);
}

/** Opis pozycji do wyboru i w komunikatach: "MiBM-N1 s1 · Elektrotechnika i elektronika I (ESOiOO) · cwiczenia". */
export function groupLabel(group: Pick<SectionGroup, 'cohort' | 'subject' | 'specialization' | 'classType'>): string {
  const subject = group.specialization ? `${group.subject.name} (${group.specialization})` : group.subject.name;
  return `${group.cohort.code} s${group.cohort.semester} · ${subject} · ${CLASS_FULL_LABELS[group.classType].toLowerCase()}`;
}

/** Wymiar pozycji jak w zleceniach: "3 gr. × 15 h" albo "15 h" dla jednej grupy (rozne godziny grup — sama suma). */
export function groupSize(group: Pick<SectionGroup, 'sections' | 'hours'>): string {
  const n = group.sections.length;
  if (n === 1) return `${group.hours} h`;
  const first = group.sections[0]!.hours;
  return group.sections.every((s) => s.hours === first) ? `${n} gr. × ${first} h` : `${n} gr., razem ${group.hours} h`;
}
