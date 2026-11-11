import type { SetupCohort } from '@/types';

/**
 * Braki rocznika w "Przygotowaniu semestru" — ktore kroki listy kontrolnej sa u niego
 * niegotowe. Czysta funkcja: z niej korzysta wyroznienie komorek, sortowanie (roczniki
 * z brakami na gorze) i przelacznik "Tylko roczniki z brakami".
 */
export type SetupIssue =
  | 'NO_CALENDAR' // brak kalendarza (krok 1)
  | 'NO_GROUPS' // rocznik bez grup (krok 2)
  | 'DRAFT_VERSION' // wersja programu w projekcie (krok 3)
  | 'NO_SECTIONS' // brak zajec — trzeba zsynchronizowac (krok 4)
  | 'VACANCIES' // zajecia bez pelnej obsady (krok 5)
  | 'UNPLACED' // nie wszystkie zajecia sa w planie (krok 6)
  | 'NO_OCCURRENCES' // plan jest, terminow brak (krok 7)
  | 'STALE'; // terminy nieaktualne (krok 7)

type IssueInput = Pick<
  SetupCohort,
  'calendar' | 'groups' | 'programVersion' | 'programEntries' | 'sections' | 'vacancies' | 'placedSections' | 'occurrences' | 'stale'
>;

export function setupIssues(c: IssueInput): Set<SetupIssue> {
  const issues = new Set<SetupIssue>();
  if (!c.calendar) issues.add('NO_CALENDAR');
  if (c.groups === 0) issues.add('NO_GROUPS');
  if (c.programVersion.status === 'DRAFT') issues.add('DRAFT_VERSION');
  // Program bez przedmiotow w tym semestrze (np. praktyka): brak zajec jest poprawny.
  if (c.sections === 0 && c.programEntries > 0) issues.add('NO_SECTIONS');
  if (c.vacancies > 0) issues.add('VACANCIES');
  if (c.sections > 0 && c.placedSections < c.sections) issues.add('UNPLACED');
  // Terminy 0 to brak tylko wtedy, gdy jest juz z czego je wygenerowac.
  if (c.placedSections > 0 && c.occurrences === 0) issues.add('NO_OCCURRENCES');
  if (c.stale) issues.add('STALE');
  return issues;
}

const collator = new Intl.Collator('pl', { numeric: true });

/** Roczniki z brakami na gorze (wiecej brakow wyzej), dalej wg kodu programu i semestru. */
export function sortSetupCohorts<T extends IssueInput & Pick<SetupCohort, 'code' | 'semester'>>(cohorts: T[]): T[] {
  const count = new Map(cohorts.map((c) => [c, setupIssues(c).size]));
  return [...cohorts].sort(
    (a, b) =>
      Number(count.get(b)! > 0) - Number(count.get(a)! > 0) ||
      count.get(b)! - count.get(a)! ||
      collator.compare(a.code, b.code) ||
      a.semester - b.semester,
  );
}
