import type { ClassType, RoomType } from '@prisma/client';
import { isActiveIn } from './groupTree';
import { roomTypeMap } from './scheduleTime';
import { plural } from './plural';

/**
 * Niezgodnosci planu rocznika, ktore powstaja PO umieszczeniu zajec: "Umiesc" sprawdza je
 * przy zapisie (services/plan.checkPlacement), ale pozniejsza zmiana obsady, sali, grupy albo
 * godzin zajec (synchronizacja) juz nie. Nie blokujemy tych zmian — plan je pokazuje.
 * Czysta funkcja: dane przygotowuje planView.
 */

export type PlanIssueKind =
  | 'INSTRUCTOR_NOT_STAFFED' // prowadzacy umieszczenia zdjety z obsady zajec
  | 'ROOM_TYPE' // typ sali nie pasuje do formy zajec
  | 'ROOM_CAPACITY' // sala mniejsza niz grupa
  | 'GROUP_INACTIVE' // grupy nie ma w semestrze rocznika, a jej zajecia sa w planie
  | 'STAFF_HOURS' // obsada ma wiecej godzin niz zajecia
  | 'OUTSIDE_GRID' // dzien albo godziny umieszczenia poza dniami/oknem siatki wydzialu
  | 'MISSING_PERIODS'; // wybrane zjazdy/tygodnie, ktorych nie ma w kalendarzu (np. po "Przenies plan")

export interface PlanIssue {
  kind: PlanIssueKind;
  /** null = problem zajec (grupa, obsada), nie jednego umieszczenia. */
  placementId: string | null;
  message: string;
}

export interface IssueSection {
  classType: ClassType;
  hours: number;
  group: { size: number; fromSemester: number; toSemester: number | null };
  instructors: { instructorId: string | null; hours: number }[];
  placements: {
    id: string;
    instructorId: string | null;
    instructorName?: string;
    /** null = zajecia online (bez sali). */
    room: { number: string; type: RoomType; capacity: number } | null;
    /** Problem z dniem/oknem siatki (lib/timeGrid.dayWindowProblem) albo null. */
    gridProblem?: string | null;
    /** Rytm "wybrane zjazdy/tygodnie": numery, ktorych nie ma w kalendarzu rocznika. */
    missingPeriods?: { cycle: 'WEEK' | 'ZJAZD'; numbers: number[]; available: number };
  }[];
}

export function sectionIssues(section: IssueSection, semester: number): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const staff = new Set(section.instructors.map((i) => i.instructorId).filter(Boolean));

  if (section.placements.length > 0 && !isActiveIn(section.group, semester)) {
    const range = `${section.group.fromSemester}-${section.group.toSemester ?? 'koniec studiow'}`;
    issues.push({
      kind: 'GROUP_INACTIVE',
      placementId: null,
      message: `Grupa nie istnieje w semestrze ${semester} (obowiazuje w semestrach ${range}) — popraw zakres grupy albo usun zajecia z planu`,
    });
  }

  const staffed = section.instructors.reduce((sum, i) => sum + i.hours, 0);
  if (staffed > section.hours) {
    issues.push({
      kind: 'STAFF_HOURS',
      placementId: null,
      message: `Obsada ma ${staffed} h, a zajecia ${section.hours} h — popraw podzial godzin w „Zajeciach i obsadzie”`,
    });
  }

  for (const p of section.placements) {
    if (p.gridProblem) {
      issues.push({
        kind: 'OUTSIDE_GRID',
        placementId: p.id,
        message: `Zajecia poza siatka godzin wydzialu: ${p.gridProblem} — przenies je w dozwolony dzien i godziny`,
      });
    }
    if (p.missingPeriods && p.missingPeriods.numbers.length > 0) {
      const { cycle, numbers, available } = p.missingPeriods;
      const what = cycle === 'ZJAZD' ? (numbers.length === 1 ? 'Zjazdu' : 'Zjazdow') : numbers.length === 1 ? 'Tygodnia' : 'Tygodni';
      const has = cycle === 'ZJAZD' ? plural(available, 'zjazd', 'zjazdy', 'zjazdow') : plural(available, 'tydzien', 'tygodnie', 'tygodni') + ' zajec';
      issues.push({
        kind: 'MISSING_PERIODS',
        placementId: p.id,
        message: `${what} nr ${numbers.join(', ')} nie ma w kalendarzu rocznika (ma ${has}) — w te dni zajecia sie nie odbeda; wybierz inne numery`,
      });
    }
    if (p.instructorId && !staff.has(p.instructorId)) {
      issues.push({
        kind: 'INSTRUCTOR_NOT_STAFFED',
        placementId: p.id,
        message: `${p.instructorName ?? 'Prowadzacy'} nie jest juz w obsadzie zajec — wybierz prowadzacego z obsady`,
      });
    }
    if (p.room && !roomTypeMap[section.classType].includes(p.room.type)) {
      issues.push({
        kind: 'ROOM_TYPE',
        placementId: p.id,
        message: `Sala ${p.room.number} nie pasuje typem do formy zajec — wybierz inna sale`,
      });
    }
    if (p.room && p.room.capacity < section.group.size) {
      issues.push({
        kind: 'ROOM_CAPACITY',
        placementId: p.id,
        message: `Sala ${p.room.number} ma ${p.room.capacity} miejsc, grupa ${section.group.size} osob`,
      });
    }
  }
  return issues;
}
