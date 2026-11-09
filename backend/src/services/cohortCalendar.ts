import type { AcademicTerm, Prisma, TermCalendar } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { calendarInclude } from './termCalendars';
import type { CohortContext } from './sections';

/**
 * Kalendarz rocznika w semestrze: wybrany w Rocznikach albo domyslny wydzialu. Osobny modul,
 * bo korzystaja z niego i plan (services/plan), i zajecia (services/sections) — plan importuje
 * zajecia, wiec trzymanie tego w planie dawaloby zaleznosc cykliczna.
 */

export type CalendarRow = TermCalendar & Prisma.TermCalendarGetPayload<{ include: typeof calendarInclude }>;

/** Wybor kalendarza rocznika z kalendarzy semestru: wybrany w Rocznikach albo domyslny wydzialu. */
function pickCalendar(term: AcademicTerm, ctx: CohortContext, calendars: CalendarRow[]): CalendarRow | null {
  const chosen = ctx.cohort.terms.find((t) => t.termId === term.id)?.calendarId;
  const candidates = calendars.filter(
    (c) => c.facultyId === ctx.cohort.program.fieldOfStudy.facultyId && c.studyMode === ctx.cohort.program.studyMode,
  );
  return (
    candidates.find((c) => c.id === chosen) ??
    candidates.find((c) => c.name === 'Podstawowy') ??
    candidates[0] ??
    null
  );
}

/** Kalendarz, wg ktorego rocznik ma zajecia: wybrany w Rocznikach albo domyslny wydzialu. */
export async function calendarFor(term: AcademicTerm, ctx: CohortContext): Promise<CalendarRow | null> {
  const candidates = await prisma.termCalendar.findMany({
    where: {
      termId: term.id,
      facultyId: ctx.cohort.program.fieldOfStudy.facultyId,
      studyMode: ctx.cohort.program.studyMode,
    },
    include: calendarInclude,
  });
  return pickCalendar(term, ctx, candidates);
}

/**
 * Kalendarze wielu rocznikow jednym zapytaniem (zamiast calendarFor w petli — N+1).
 * Klucz: id rocznika; brak wpisu = rocznik bez kalendarza.
 */
export async function calendarsFor(term: AcademicTerm, contexts: CohortContext[]): Promise<Map<string, CalendarRow>> {
  const out = new Map<string, CalendarRow>();
  if (contexts.length === 0) return out;
  const calendars = await prisma.termCalendar.findMany({ where: { termId: term.id }, include: calendarInclude });
  for (const ctx of contexts) {
    const calendar = pickCalendar(term, ctx, calendars);
    if (calendar) out.set(ctx.cohort.id, calendar);
  }
  return out;
}

/**
 * Roczniki, ktorych kalendarz w semestrze jest w archiwum. Ich zajecia, obsada i plan sa
 * tylko do odczytu — to zapis tego, co sie odbylo.
 */
export async function archivedCohortIds(term: AcademicTerm, contexts: CohortContext[]): Promise<Set<string>> {
  const calendars = await calendarsFor(term, contexts);
  return new Set([...calendars].filter(([, c]) => c.status === 'ARCHIVED').map(([cohortId]) => cohortId));
}
