import type { IsoDate } from './isoDate';
import { minutesOverlap } from './timeGrid';
import type { BusySlot } from './materializer';

/**
 * Plan a obsada — czyste funkcje. Umieszczenie niesie prowadzacego wybranego z obsady swoich
 * zajec (grupy), a zmiana obsady planu nie zmienia. Plan rozjezdza sie z obsada na dwa sposoby:
 *  - FOREIGN — prowadzacego umieszczenia nie ma juz w obsadzie tych zajec,
 *  - MISSING — umieszczenie bez prowadzacego (NN), choc obsada jest pelna (same osoby, bez wakatu
 *    i brakujacych godzin). Przy wakacie NN w planie bywa celowe — czesc godzin nie ma osoby.
 */
export type StaffMismatchKind = 'FOREIGN' | 'MISSING';

export interface StaffRow {
  /** null = NN (wakat). */
  instructorId: string | null;
  hours: number;
}

export function staffMismatch(placementInstructorId: string | null, staff: StaffRow[], sectionHours: number): StaffMismatchKind | null {
  if (placementInstructorId) return staff.some((s) => s.instructorId === placementInstructorId) ? null : 'FOREIGN';
  const named = staff.filter((s) => s.instructorId);
  const assigned = staff.reduce((sum, s) => sum + s.hours, 0);
  const vacancy = staff.some((s) => !s.instructorId) || assigned < sectionHours;
  return named.length > 0 && !vacancy ? 'MISSING' : null;
}

/**
 * Na kogo przepiac: osoba z obsady, ktorej nie ma jeszcze w innych umieszczeniach tych zajec
 * (zwykle ta, ktora zastapila usunieta), z najwieksza liczba godzin; gdy wszyscy sa juz w planie —
 * ta z najwieksza liczba godzin; obsada bez osob — NN (null).
 */
export function proposeInstructor(staff: StaffRow[], usedElsewhere: ReadonlySet<string>): string | null {
  const named = staff
    .filter((s): s is StaffRow & { instructorId: string } => !!s.instructorId)
    .sort((a, b) => b.hours - a.hours);
  return (named.find((s) => !usedElsewhere.has(s.instructorId)) ?? named[0])?.instructorId ?? null;
}

export interface TimedDate {
  date: IsoDate;
  startMinute: number;
  endMinute: number;
}

export type InstructorBusy = Pick<BusySlot, 'date' | 'startMinute' | 'endMinute' | 'instructorId' | 'jointKey' | 'label'>;

/** Kolizje prowadzacego na datach umieszczenia — najwyzej jedna na date; zajecia laczone (ten sam jointKey) nie koliduja. */
export function instructorConflicts(
  dates: TimedDate[],
  instructorId: string,
  jointKey: string | null,
  busy: InstructorBusy[],
): { date: IsoDate; with: string }[] {
  const out: { date: IsoDate; with: string }[] = [];
  for (const d of dates) {
    const hit = busy.find(
      (b) =>
        b.instructorId === instructorId &&
        b.date === d.date &&
        !(jointKey && b.jointKey === jointKey) &&
        minutesOverlap(d.startMinute, d.endMinute, b.startMinute, b.endMinute),
    );
    if (hit) out.push({ date: d.date, with: hit.label });
  }
  return out;
}
