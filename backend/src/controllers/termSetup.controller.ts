import type { Request } from 'express';
import type { AcademicTerm } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import { getCallerScope, assertCohortsInScope } from '../lib/facultyScope';
import { addDays, fromIsoDate, isIsoDate, toIsoDate, type IsoDate } from '../lib/isoDate';
import { personalDaysOff, TeachingCalendar } from '../lib/teachingCalendar';
import { toCalendarInput } from '../services/termCalendars';
import { parseTermKey } from '../lib/terms';
import { groupsOverlap, indexGroups } from '../lib/groupTree';
import { activeCohorts } from '../services/sections';
import { cohortLabel, toTreeGroup } from '../services/cohorts';
import { calendarsFor } from '../services/plan';
import { publishedCohortKeys } from '../services/visibility';
import { carryPlan } from '../services/carryPlan';
import { staleReasonsByCohort } from '../services/staleness';

async function findTerm(key: string) {
  const ref = parseTermKey(key);
  if (!ref) throw new AppError(400, 'Nieprawidlowy klucz semestru');
  const term = await prisma.academicTerm.findUnique({ where: { startYear_type: ref } });
  if (!term) throw new AppError(404, 'Semestr nie istnieje');
  return term;
}

async function facultyOf(req: Request): Promise<string | null> {
  const scope = await getCallerScope(req);
  const requested =
    (typeof req.query.facultyId === 'string' ? req.query.facultyId : null) ??
    (typeof req.body?.facultyId === 'string' ? req.body.facultyId : null);
  if (scope.isAdmin) return requested && requested !== 'all' ? requested : null;
  if (!scope.facultyId) throw new AppError(403, 'Konto bez przypisanego wydzialu');
  return scope.facultyId;
}

/** Przeniesienie planu z zeszlego roku (podglad albo zapis) dla wybranych rocznikow. */
export const carryPlanHandler = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const facultyId = await facultyOf(req);
  const { cohortIds, dryRun = true } = req.body as { cohortIds?: string[]; dryRun?: boolean };
  if (!Array.isArray(cohortIds) || cohortIds.length === 0) throw new AppError(400, 'Wybierz roczniki');
  await assertCohortsInScope(req, cohortIds);
  const report = await carryPlan(term, { facultyId, cohortIds, dryRun });
  res.json({
    data: report,
    message: dryRun
      ? 'Podglad przeniesienia planu'
      : `Przeniesiono ${report.created.length} umieszczen; kolizje ${report.conflicts.length}, bez odpowiednika ${report.unmatched.length}`,
  });
});

/**
 * Lista kontrolna przygotowania semestru dla wydzialu: kalendarze, roczniki, zajecia,
 * obsada, plan i publikacja — z licznikami, zeby planista widzial, co jeszcze zostalo.
 */
export const setupStatus = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const facultyId = await facultyOf(req);
  const facultyWhere = facultyId ? { facultyId } : {};

  const programs = await prisma.program.findMany({
    where: facultyId ? { fieldOfStudy: { facultyId } } : {},
    select: { studyMode: true, fieldOfStudy: { select: { facultyId: true } } },
  });
  const calendars = await prisma.termCalendar.findMany({
    where: { termId: term.id, ...facultyWhere },
    select: { id: true, facultyId: true, studyMode: true, name: true, kind: true, status: true },
  });
  const neededModes = new Set(programs.map((p) => `${p.fieldOfStudy.facultyId}|${p.studyMode}`));
  const missingCalendars = [...neededModes].filter((k) => !calendars.some((c) => `${c.facultyId}|${c.studyMode}` === k)).length;

  const contexts = await activeCohorts(term, facultyId);
  const cohortIds = contexts.map((c) => c.cohort.id);
  // Liczniki wszystkich rocznikow zbiorczo (kilka zapytan zamiast kilku na rocznik).
  const active = { termId: term.id, cohortId: { in: cohortIds }, status: 'ACTIVE' as const };
  const versionIds = [...new Set(contexts.map((c) => c.cohort.programVersion.id))];
  const [cohortCalendars, sectionRows, placedRows, vacancyRows, termSections, occurrenceRows, staleByCohort, entryRows, heldRows] = await Promise.all([
    calendarsFor(term, contexts),
    prisma.classSection.groupBy({ by: ['cohortId'], where: active, _count: { _all: true } }),
    prisma.classSection.groupBy({ by: ['cohortId'], where: { ...active, placements: { some: {} } }, _count: { _all: true } }),
    prisma.classSection.groupBy({
      by: ['cohortId'],
      where: { ...active, OR: [{ instructors: { none: {} } }, { instructors: { some: { instructorId: null } } }] },
      _count: { _all: true },
    }),
    prisma.classSection.findMany({
      where: { termId: term.id, cohortId: { in: cohortIds } },
      select: { id: true, cohortId: true, hours: true, status: true, _count: { select: { placements: true } } },
    }),
    prisma.occurrence.groupBy({ by: ['sectionId'], where: { termId: term.id, section: { cohortId: { in: cohortIds } } }, _count: { _all: true } }),
    // Terminy nieaktualne: ta sama funkcja co w "Ukladaniu planu" (services/staleness).
    staleReasonsByCohort(term, contexts),
    // Przedmioty programu wg semestru — rocznik bez zajec, ktorego program nie ma nic w tym
    // semestrze (np. praktyka), nie jest zaleglosci: synchronizacja i tak niczego nie doda.
    prisma.programEntry.groupBy({ by: ['versionId', 'semester'], where: { versionId: { in: versionIds } }, _count: { _all: true } }),
    // Godziny w terminach (bez odwolanych; 1 blok = 1 godzina programu) — zajecia, ktore po
    // generowaniu nie wyczerpia godzin (np. swieta w nowym roku wypadaja w inne dni).
    prisma.occurrence.findMany({
      where: { termId: term.id, status: { not: 'CANCELLED' }, section: { cohortId: { in: cohortIds } } },
      select: { sectionId: true, startOrder: true, endOrder: true },
    }),
  ]);
  const heldHours = new Map<string, number>();
  for (const o of heldRows) heldHours.set(o.sectionId, (heldHours.get(o.sectionId) ?? 0) + o.endOrder - o.startOrder + 1);
  const entriesIn = new Map(entryRows.map((r) => [`${r.versionId}|${r.semester}`, r._count._all]));
  const countOf = (rows: { cohortId: string; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.cohortId, r._count._all]));
  const sectionCount = countOf(sectionRows);
  const placedCount = countOf(placedRows);
  const vacancyCount = countOf(vacancyRows);
  const cohortOfSection = new Map(termSections.map((s) => [s.id, s.cohortId]));
  const occurrenceCount = new Map<string, number>();
  for (const r of occurrenceRows) {
    const cohortId = cohortOfSection.get(r.sectionId);
    if (cohortId) occurrenceCount.set(cohortId, (occurrenceCount.get(cohortId) ?? 0) + r._count._all);
  }
  // Ulozone zajecia, ktorych terminy maja mniej godzin niz program (liczone, gdy rocznik ma juz terminy).
  const shortCount = new Map<string, number>();
  for (const s of termSections) {
    if (s.status !== 'ACTIVE' || s._count.placements === 0) continue;
    if ((heldHours.get(s.id) ?? 0) < s.hours) shortCount.set(s.cohortId, (shortCount.get(s.cohortId) ?? 0) + 1);
  }

  const cohorts = [];
  for (const ctx of contexts) {
    const calendar = cohortCalendars.get(ctx.cohort.id) ?? null;
    const sections = sectionCount.get(ctx.cohort.id) ?? 0;
    const withPlacement = placedCount.get(ctx.cohort.id) ?? 0;
    const vacancies = vacancyCount.get(ctx.cohort.id) ?? 0;
    const occurrences = occurrenceCount.get(ctx.cohort.id) ?? 0;
    const reasons = staleByCohort.get(ctx.cohort.id) ?? [];
    cohorts.push({
      id: ctx.cohort.id,
      label: cohortLabel(ctx.cohort),
      code: ctx.cohort.program.code,
      // Do filtrow rocznikow (tryb, kierunek, stopien) — jak w Rocznikach i Planie.
      program: {
        code: ctx.cohort.program.code,
        name: ctx.cohort.program.name,
        studyMode: ctx.cohort.program.studyMode,
        degreeLevel: ctx.cohort.program.degreeLevel,
        fieldOfStudy: {
          id: ctx.cohort.program.fieldOfStudy.id,
          name: ctx.cohort.program.fieldOfStudy.name,
          shortName: ctx.cohort.program.fieldOfStudy.shortName,
        },
      },
      semester: ctx.semester,
      programVersion: { id: ctx.cohort.programVersion.id, label: ctx.cohort.programVersion.label, status: ctx.cohort.programVersion.status },
      calendar: calendar ? { name: calendar.name, status: calendar.status } : null,
      groups: ctx.tree.length,
      programEntries: entriesIn.get(`${ctx.cohort.programVersion.id}|${ctx.semester}`) ?? 0,
      sections,
      vacancies,
      placedSections: withPlacement,
      occurrences,
      shortSections: occurrences > 0 ? (shortCount.get(ctx.cohort.id) ?? 0) : 0,
      stale: reasons.length > 0,
      staleReasons: reasons,
    });
  }

  res.json({
    data: {
      calendars,
      missingCalendars,
      cohorts,
      totals: {
        cohorts: cohorts.length,
        cohortsWithoutCalendar: cohorts.filter((c) => !c.calendar).length,
        cohortsWithDraftVersion: cohorts.filter((c) => c.programVersion.status === 'DRAFT').length,
        cohortsWithoutSections: cohorts.filter((c) => c.sections === 0 && c.programEntries > 0).length,
        cohortsWithEmptySemester: cohorts.filter((c) => c.programEntries === 0).length,
        sections: cohorts.reduce((s, c) => s + c.sections, 0),
        vacancies: cohorts.reduce((s, c) => s + c.vacancies, 0),
        placedSections: cohorts.reduce((s, c) => s + c.placedSections, 0),
        staleCohorts: cohorts.filter((c) => c.stale).length,
        shortSections: cohorts.reduce((s, c) => s + c.shortSections, 0),
        published: calendars.filter((c) => c.status === 'PUBLISHED').length,
      },
    },
  });
});

/**
 * "Moj plan": terminy z OPUBLIKOWANYCH (lub archiwalnych) kalendarzy. Prowadzacy widzi
 * swoje zajecia; student — zajecia grup, ktore nakladaja sie na jego grupy (wyklad
 * calego rocznika, jego grupa cwiczeniowa, laboratoryjna...).
 */
export const myPlan = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { role: true, instructorId: true, studentGroups: { select: { id: true, cohortId: true } } },
  });
  if (!user) throw new AppError(401, 'Brak uzytkownika');
  const from = typeof req.query.from === 'string' && isIsoDate(req.query.from) ? fromIsoDate(req.query.from) : undefined;
  const to = typeof req.query.to === 'string' && isIsoDate(req.query.to) ? fromIsoDate(req.query.to) : undefined;

  let groupFilter: string[] | null = null;
  // Roczniki, wg ktorych kalendarzy osoba ma zajecia — do dni wolnych w kalendarzu tygodnia.
  let personCohortIds: string[] = [];
  if (user.role === 'STUDENT') {
    const memberGroups = user.studentGroups.filter((g) => g.cohortId);
    const cohortIds = [...new Set(memberGroups.map((g) => g.cohortId!))];
    personCohortIds = cohortIds;
    const groups = await prisma.studentGroup.findMany({ where: { cohortId: { in: cohortIds } } });
    const index = indexGroups(groups.map(toTreeGroup));
    groupFilter = groups.filter((g) => memberGroups.some((m) => groupsOverlap(m.id, g.id, index))).map((g) => g.id);
  } else if (user.role === 'INSTRUCTOR') {
    if (!user.instructorId) {
      res.json({ data: [], daysOff: {}, range: null });
      return;
    }
    const taught = await prisma.classSection.findMany({
      where: { termId: term.id, occurrences: { some: { instructorId: user.instructorId } } },
      select: { cohortId: true },
      distinct: ['cohortId'],
    });
    personCohortIds = taught.map((t) => t.cohortId);
  } else {
    throw new AppError(400, 'Plan osobisty jest dla studentow i prowadzacych — planisci uzywaja Ukladania planu');
  }

  const rows = await prisma.occurrence.findMany({
    where: {
      termId: term.id,
      ...(groupFilter ? { groupId: { in: groupFilter } } : { instructorId: user.instructorId! }),
      ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    include: {
      section: { select: { cohortId: true, classType: true, programEntry: { select: { subject: { select: { name: true } } } }, cohort: { select: { program: { select: { studyMode: true, code: true } } } } } },
      room: { select: { number: true, building: { select: { name: true } } } },
      instructor: { select: { title: true, firstName: true, lastName: true } },
      group: { select: { id: true } },
    },
    orderBy: [{ date: 'asc' }, { startMinute: 'asc' }],
  });
  // Widac tylko terminy rocznikow, ktorych WLASNY kalendarz jest opublikowany albo w archiwum —
  // rocznik przypiety do wariantu "w planowaniu" nie pokazuje jeszcze planu (choc wydzial ma
  // inne opublikowane kalendarze). Nazwy grup liczone na semestr rocznika (jak w Ukladaniu planu).
  // Pusta lista rocznikow w activeCohorts znaczy "wszystkie" — tydzien bez zajec nie pyta o nic.
  const cohortIds = [...new Set(rows.map((o) => o.section.cohortId))];
  const contexts = cohortIds.length > 0 ? await activeCohorts(term, null, cohortIds) : [];
  const visibleCohorts = await publishedCohortKeys(cohortIds.map((cohortId) => ({ termId: term.id, cohortId })));
  const shown = rows.filter((o) => visibleCohorts.has(`${term.id}|${o.section.cohortId}`));
  const nameOf = new Map(contexts.map((c) => [c.cohort.id, c.nameOf]));
  const data = shown
    .map((o) => ({
      id: o.id,
      date: toIsoDate(o.date),
      startOrder: o.startOrder,
      endOrder: o.endOrder,
      startMinute: o.startMinute,
      endMinute: o.endMinute,
      subject: o.section.programEntry.subject.name,
      classType: o.section.classType,
      program: o.section.cohort.program.code,
      group: nameOf.get(o.section.cohortId)?.(o.groupId) ?? '',
      room: o.room ? `${o.room.number} (${o.room.building.name})` : 'ON-LINE',
      instructor: o.instructor ? `${o.instructor.title ?? ''} ${o.instructor.firstName} ${o.instructor.lastName}`.trim() : 'NN',
      status: o.status,
      note: o.note,
    }));
  const calendars = await personCalendars(term, personCohortIds);
  // Zakres semestru wg opublikowanych kalendarzy osoby — front przestawia tydzien albo mowi,
  // ze planu jeszcze nie ma (zamiast pustego tygodnia z samym swietem spoza semestru).
  const range =
    calendars.length > 0
      ? {
          start: calendars.map((c) => c.input.startDate).sort()[0]!,
          end: calendars.map((c) => c.input.endDate).sort().at(-1)!,
        }
      : null;
  res.json({ data, daysOff: from && to ? personDaysOff(calendars, toIsoDate(from), toIsoDate(to)) : {}, range });
});

/** Kalendarze rocznikow osoby w semestrze — tylko opublikowane albo archiwalne, jak same terminy. */
async function personCalendars(term: AcademicTerm, cohortIds: string[]) {
  const contexts = cohortIds.length > 0 ? await activeCohorts(term, null, cohortIds) : [];
  const calendars = new Map<string, { input: ReturnType<typeof toCalendarInput>; teaching: TeachingCalendar }>();
  for (const [, cal] of await calendarsFor(term, contexts)) {
    if (!cal || cal.status === 'PLANNING' || calendars.has(cal.id)) continue;
    const input = toCalendarInput(cal);
    calendars.set(cal.id, { input, teaching: new TeachingCalendar(input) });
  }
  return [...calendars.values()];
}

/**
 * Dni wolne w zakresie planu osobistego (najwyzej 2 tygodnie) wg kalendarzy rocznikow osoby.
 * Regula: lib/teachingCalendar.personalDaysOff.
 */
function personDaysOff(calendars: { teaching: TeachingCalendar }[], from: IsoDate, to: IsoDate) {
  const dates: IsoDate[] = [];
  for (let d = from; d <= to && dates.length < 14; d = addDays(d, 1)) dates.push(d);
  return personalDaysOff(dates, calendars.map((c) => c.teaching));
}
