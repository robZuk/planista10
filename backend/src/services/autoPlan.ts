import type { AcademicTerm, CalendarStatus, TermCalendar } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { withPlanLock } from './planLock';
import { syncSections, type SyncReport } from './sections';
import { cohortIdsOfCalendar, refreshPlanningTerms, type RefreshResult } from './plan';

/**
 * Samoczynne zmiany po zapisach poza "Ukladaniem planu" (nabory, grupy, wersje programu, kalendarze):
 *  - zajecia semestru: zmiany dodajace synchronizacji (nowe zajecia, przywrocone osierocone, godziny
 *    zajec bez planu) stosuja sie od razu; usuniecia, osierocenia i godziny zajec w planie czekaja
 *    na podglad na stronie "Obsada",
 *  - terminy rocznikow z kalendarzem "w przygotowaniu" przeliczaja sie po kazdej zmianie, a przy
 *    publikacji kalendarza — jeszcze raz, zanim zobacza je studenci i prowadzacy.
 * Zapisy ida pod blokada planu semestru (services/planLock), jak synchronizacja i generowanie
 * uruchamiane recznie. Wolajacy NIE moze juz trzymac blokady tego semestru.
 */

export interface AutoSyncSummary {
  /** Zmiany zastosowane same. */
  created: number;
  reactivated: number;
  hoursChanged: number;
  /** Zmiany, ktore czekaja na decyzje planisty na stronie "Obsada". */
  pending: number;
}

const emptySummary = (): AutoSyncSummary => ({ created: 0, reactivated: 0, hoursChanged: 0, pending: 0 });
const noRefresh = (): RefreshResult => ({ cohortIds: [], report: null });

function addReport(summary: AutoSyncSummary, report: SyncReport) {
  summary.created += report.created.length;
  summary.reactivated += report.reactivated.length;
  summary.hoursChanged += report.hoursChanged.length;
  summary.pending += report.pending;
}

/** Synchronizacja dodajaca w jednym semestrze + przeliczenie terminow rocznikow z przywroconymi zajeciami. */
async function syncTerm(term: AcademicTerm, opts: { facultyId: string | null; cohortIds?: string[] }, summary: AutoSyncSummary) {
  await withPlanLock(term.id, async () => {
    const report = await syncSections(term, { ...opts, dryRun: false, mode: 'additive' });
    addReport(summary, report);
    // Przywrocone zajecia moga miec umieszczenia — ich terminy wracaja do planu. Nowe zajecia i godziny
    // zajec bez planu terminow nie zmieniaja.
    const touched = report.reactivated.map((r) => r.cohortId);
    if (touched.length > 0) await refreshPlanningTerms(term, touched);
  });
}

/**
 * Semestry, w ktorych wydzialy maja kalendarz poza archiwum — tylko tam zajecia powstaja same
 * (archiwum to zapis tego, co sie odbylo; semestr bez kalendarza nie bedzie mial planu).
 */
async function liveTerms(facultyIds: string[]): Promise<AcademicTerm[]> {
  if (facultyIds.length === 0) return [];
  return prisma.academicTerm.findMany({
    where: { calendars: { some: { facultyId: { in: facultyIds }, status: { not: 'ARCHIVED' } } } },
  });
}

/** Po zmianie naboru, grup, trybu wykladow albo wersji programu rocznikow — zajecia we wszystkich zywych semestrach. */
export async function autoSyncCohorts(cohortIds: string[]): Promise<AutoSyncSummary> {
  const summary = emptySummary();
  const ids = [...new Set(cohortIds)];
  if (ids.length === 0) return summary;
  const cohorts = await prisma.cohort.findMany({
    where: { id: { in: ids } },
    select: { program: { select: { fieldOfStudy: { select: { facultyId: true } } } } },
  });
  const facultyIds = [...new Set(cohorts.map((c) => c.program.fieldOfStudy.facultyId))];
  for (const term of await liveTerms(facultyIds)) await syncTerm(term, { facultyId: null, cohortIds: ids }, summary);
  return summary;
}

/** Po zatwierdzeniu wersji programu — roczniki tej wersji. */
export async function autoSyncVersion(versionId: string): Promise<AutoSyncSummary> {
  const cohorts = await prisma.cohort.findMany({ where: { programVersionId: versionId }, select: { id: true } });
  return autoSyncCohorts(cohorts.map((c) => c.id));
}

/** Po zalozeniu kalendarza — roczniki tych wydzialow w tym semestrze (nowy semestr dostaje zajecia sam). */
export async function autoSyncTermFaculties(term: AcademicTerm, facultyIds: string[]): Promise<AutoSyncSummary> {
  const summary = emptySummary();
  for (const facultyId of [...new Set(facultyIds)]) await syncTerm(term, { facultyId }, summary);
  return summary;
}

/**
 * Po zmianie ustawien rocznika w semestrze (numer semestru, wariant kalendarza): inne zajecia
 * (inny semestr programu) i inne daty terminow.
 */
export async function autoSyncCohortTerm(term: AcademicTerm, cohortId: string): Promise<{ sync: AutoSyncSummary; refresh: RefreshResult }> {
  const sync = emptySummary();
  let refresh = noRefresh();
  await withPlanLock(term.id, async () => {
    addReport(sync, await syncSections(term, { facultyId: null, cohortIds: [cohortId], dryRun: false, mode: 'additive' }));
    refresh = await refreshPlanningTerms(term, [cohortId]);
  });
  return { sync, refresh };
}

type CalendarRef = Pick<TermCalendar, 'id' | 'facultyId' | 'studyMode' | 'status'>;

/** Terminy rocznikow kalendarza "w przygotowaniu" po zmianie jego dat, przerw, dni albo zjazdow. */
export async function refreshCalendarTerms(term: AcademicTerm, calendar: CalendarRef): Promise<RefreshResult> {
  if (calendar.status !== 'PLANNING') return noRefresh();
  return withPlanLock(term.id, async () => refreshPlanningTerms(term, await cohortIdsOfCalendar(term, calendar)));
}

/**
 * Zmiana statusu kalendarza z terminami w jednym kroku (pod blokada planu):
 *  - publikacja: terminy rocznikow przeliczone jeszcze raz, poki kalendarz jest w przygotowaniu —
 *    opublikowany plan nie bywa pusty ani nieaktualny,
 *  - cofniecie publikacji: terminy przeliczone od razu (dalej licza sie same). Powrot z archiwum
 *    (tylko admin) terminow nie rusza — to zapis tego, co sie odbylo.
 */
export async function changeCalendarStatus<T>(
  term: AcademicTerm,
  calendar: CalendarRef,
  status: CalendarStatus,
  update: () => Promise<T>,
): Promise<{ result: T; refresh: RefreshResult }> {
  return withPlanLock(term.id, async () => {
    let refresh = noRefresh();
    if (calendar.status === 'PLANNING' && status === 'PUBLISHED') {
      refresh = await refreshPlanningTerms(term, await cohortIdsOfCalendar(term, calendar));
    }
    const result = await update();
    if (calendar.status === 'PUBLISHED' && status === 'PLANNING') {
      refresh = await refreshPlanningTerms(term, await cohortIdsOfCalendar(term, calendar));
    }
    return { result, refresh };
  });
}

/** Dopisek do komunikatu o zajeciach zmienionych samoczynnie (kalendarz, nabor, grupy, wersja programu). */
export function syncNote(sync: AutoSyncSummary): string {
  const fixed = sync.reactivated + sync.hoursChanged;
  if (sync.created + fixed === 0) return '';
  return `; zajecia semestru: +${sync.created}${fixed > 0 ? `, poprawione ${fixed}` : ''}`;
}
