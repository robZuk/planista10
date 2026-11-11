import { createHash } from 'node:crypto';
import type { AcademicTerm } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { calendarDatesKey } from '../lib/teachingCalendar';
import { toCalendarInput } from './termCalendars';
import { staleReasons, type StaleReason } from '../lib/planStaleness';
import { calendarsFor, type CalendarRow } from './cohortCalendar';
import type { CohortContext } from './sections';

/**
 * "Terminy nieaktualne" dla wielu rocznikow naraz — JEDNO zrodlo dla "Ukladania planu"
 * (planView) i "Przygotowania semestru" (setupStatus), zeby obie strony pokazywaly to samo.
 *
 * Porownujemy z ostatnim generowaniem TEGO rocznika (CohortGeneration), nie kalendarza:
 * kalendarz dzieli wiele rocznikow, a generowanie z planu przelicza tylko jeden.
 * Reguly powodow: lib/planStaleness.ts.
 */
/**
 * Odcisk kalendarza, wg ktorego powstaja terminy rocznika: wybrany kalendarz, numer semestru
 * rocznika i daty (semestr, przerwy, dni, zjazdy). Ten sam odcisk = te same daty zajec.
 */
export function calendarFingerprint(calendar: CalendarRow, semester: number): string {
  const key = `${calendar.id}|${semester}|${calendarDatesKey(toCalendarInput(calendar))}`;
  return createHash('sha1').update(key).digest('hex');
}

export async function staleReasonsByCohort(term: AcademicTerm, contexts: CohortContext[]): Promise<Map<string, StaleReason[]>> {
  const result = new Map<string, StaleReason[]>();
  if (contexts.length === 0) return result;
  const cohortIds = contexts.map((c) => c.cohort.id);
  const ofCohorts = { termId: term.id, section: { cohortId: { in: cohortIds } } };

  const [sections, placementChanges, manualSections, deletions, generations] = await Promise.all([
    prisma.classSection.findMany({
      where: { termId: term.id, cohortId: { in: cohortIds } },
      select: { id: true, cohortId: true, updatedAt: true },
    }),
    prisma.placement.groupBy({ by: ['sectionId'], where: ofCohorts, _max: { updatedAt: true } }),
    // Zajecia z terminami recznymi tez sa "w planie" (ich zmiana unieaktualnia terminy).
    prisma.occurrence.groupBy({
      by: ['sectionId'],
      where: { ...ofCohorts, kind: 'MANUAL', status: { not: 'CANCELLED' } },
      _count: { _all: true },
    }),
    // Terminy odlaczone od usunietych umieszczen: updatedAt = chwila usuniecia.
    prisma.occurrence.groupBy({
      by: ['sectionId'],
      where: { ...ofCohorts, kind: 'DERIVED', placementId: null },
      _max: { updatedAt: true },
    }),
    prisma.cohortGeneration.findMany({ where: { termId: term.id, cohortId: { in: cohortIds } } }),
  ]);
  // Kalendarz rocznika: zmiana jego dat albo ustawien rocznika w semestrze (wybor kalendarza,
  // numer semestru — CohortTerm) po generowaniu tez unieaktualnia terminy.
  const calendars = await calendarsFor(term, contexts);
  const calendarChange = new Map(
    contexts.map((c) => {
      const datesAt = calendars.get(c.cohort.id)?.datesChangedAt.getTime() ?? 0;
      const settingsAt = c.cohort.terms.find((t) => t.termId === term.id)?.changedAt?.getTime() ?? 0;
      return [c.cohort.id, Math.max(datesAt, settingsAt)];
    }),
  );

  const cohortOf = new Map(sections.map((s) => [s.id, s.cohortId]));
  const placementAt = new Map(placementChanges.map((p) => [p.sectionId, p._max.updatedAt?.getTime() ?? 0]));
  const manual = new Set(manualSections.map((m) => m.sectionId));
  const acc = new Map<string, { placements: number; sections: number; deletion: number }>();
  const entry = (cohortId: string) => {
    let e = acc.get(cohortId);
    if (!e) acc.set(cohortId, (e = { placements: 0, sections: 0, deletion: 0 }));
    return e;
  };

  for (const s of sections) {
    const e = entry(s.cohortId);
    const placedAt = placementAt.get(s.id);
    if (placedAt !== undefined) e.placements = Math.max(e.placements, placedAt);
    // Zmiana zajec liczy sie tylko dla zajec w planie — nowe zajecia bez umieszczen terminow nie zmieniaja.
    if (placedAt !== undefined || manual.has(s.id)) e.sections = Math.max(e.sections, s.updatedAt.getTime());
  }
  for (const d of deletions) {
    const cohortId = cohortOf.get(d.sectionId);
    if (cohortId) entry(cohortId).deletion = Math.max(entry(cohortId).deletion, d._max.updatedAt?.getTime() ?? 0);
  }
  const generatedAt = new Map(generations.map((g) => [g.cohortId, g.generatedAt.getTime()]));
  // Odcisk zapisany przy generowaniu -> porownanie tresci (zmiana tam i z powrotem to nie zmiana).
  const calendarChanged = new Map<string, boolean | undefined>(
    contexts.map((c) => {
      const stored = generations.find((g) => g.cohortId === c.cohort.id)?.calendarKey;
      const calendar = calendars.get(c.cohort.id);
      return [c.cohort.id, stored && calendar ? stored !== calendarFingerprint(calendar, c.semester) : undefined];
    }),
  );

  for (const cohortId of cohortIds) {
    const e = acc.get(cohortId) ?? { placements: 0, sections: 0, deletion: 0 };
    result.set(
      cohortId,
      staleReasons({
        lastPlacementChange: e.placements,
        lastSectionChange: e.sections,
        generatedAt: generatedAt.get(cohortId) ?? 0,
        lastDeletion: e.deletion,
        lastCalendarChange: calendarChange.get(cohortId) ?? 0,
        calendarChanged: calendarChanged.get(cohortId),
      }),
    );
  }
  return result;
}
