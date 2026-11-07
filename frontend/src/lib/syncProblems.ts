import type { SyncProblem } from '@/types';

/** Problemy synchronizacji jednego rodzaju dla jednego rocznika (i specjalnosci). */
export interface SyncProblemGroup {
  key: string;
  cohort: string;
  semester: number;
  kind: SyncProblem['kind'];
  specialization: SyncProblem['specialization'];
  message: string;
  /** Przedmioty, ktorych dotyczy problem (bez pustych i bez powtorzen). */
  subjects: string[];
}

/**
 * Grupuje problemy po roczniku, rodzaju i specjalnosci — zamiast szesciu linii
 * "rocznik nie ma grupy tej specjalnosci" jedna pozycja z lista przedmiotow.
 * Kolejnosc grup = kolejnosc pierwszego wystapienia.
 */
export function groupSyncProblems(problems: SyncProblem[]): SyncProblemGroup[] {
  const groups = new Map<string, SyncProblemGroup>();
  for (const p of problems) {
    // Problemy bez specjalnosci roznia sie trescia — nie sklejamy roznych komunikatow.
    const key = [p.cohortId, p.kind, p.specialization?.id ?? '', p.specialization ? '' : p.message].join('|');
    let group = groups.get(key);
    if (!group) {
      group = { key, cohort: p.cohort, semester: p.semester, kind: p.kind, specialization: p.specialization, message: p.message, subjects: [] };
      groups.set(key, group);
    }
    if (p.subject && !group.subjects.includes(p.subject)) group.subjects.push(p.subject);
  }
  return [...groups.values()];
}
