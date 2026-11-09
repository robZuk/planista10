import type { Request } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import { getCallerScope } from '../lib/facultyScope';
import { fromIsoDate, isIsoDate, toIsoDate } from '../lib/isoDate';
import { parseTermKey } from '../lib/terms';
import { groupsOverlap, indexGroups } from '../lib/groupTree';
import { activeCohorts } from '../services/sections';
import { cohortLabel, toTreeGroup } from '../services/cohorts';
import { calendarsFor } from '../services/plan';
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
  const [cohortCalendars, sectionRows, placedRows, vacancyRows, termSections, occurrenceRows, staleByCohort] = await Promise.all([
    calendarsFor(term, contexts),
    prisma.classSection.groupBy({ by: ['cohortId'], where: active, _count: { _all: true } }),
    prisma.classSection.groupBy({ by: ['cohortId'], where: { ...active, placements: { some: {} } }, _count: { _all: true } }),
    prisma.classSection.groupBy({
      by: ['cohortId'],
      where: { ...active, OR: [{ instructors: { none: {} } }, { instructors: { some: { instructorId: null } } }] },
      _count: { _all: true },
    }),
    prisma.classSection.findMany({ where: { termId: term.id, cohortId: { in: cohortIds } }, select: { id: true, cohortId: true } }),
    prisma.occurrence.groupBy({ by: ['sectionId'], where: { termId: term.id, section: { cohortId: { in: cohortIds } } }, _count: { _all: true } }),
    // Terminy nieaktualne: ta sama funkcja co w "Ukladaniu planu" (services/staleness).
    staleReasonsByCohort(term, contexts),
  ]);
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
      sections,
      vacancies,
      placedSections: withPlacement,
      occurrences,
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
        cohortsWithoutSections: cohorts.filter((c) => c.sections === 0).length,
        sections: cohorts.reduce((s, c) => s + c.sections, 0),
        vacancies: cohorts.reduce((s, c) => s + c.vacancies, 0),
        placedSections: cohorts.reduce((s, c) => s + c.placedSections, 0),
        staleCohorts: cohorts.filter((c) => c.stale).length,
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

  const published = await prisma.termCalendar.findMany({
    where: { termId: term.id, status: { in: ['PUBLISHED', 'ARCHIVED'] } },
    select: { facultyId: true, studyMode: true },
  });
  const visible = new Set(published.map((c) => `${c.facultyId}|${c.studyMode}`));

  let groupFilter: string[] | null = null;
  if (user.role === 'STUDENT') {
    const memberGroups = user.studentGroups.filter((g) => g.cohortId);
    const cohortIds = [...new Set(memberGroups.map((g) => g.cohortId!))];
    const groups = await prisma.studentGroup.findMany({ where: { cohortId: { in: cohortIds } } });
    const index = indexGroups(groups.map(toTreeGroup));
    groupFilter = groups.filter((g) => memberGroups.some((m) => groupsOverlap(m.id, g.id, index))).map((g) => g.id);
  } else if (user.role === 'INSTRUCTOR') {
    if (!user.instructorId) {
      res.json({ data: [] });
      return;
    }
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
      section: { select: { classType: true, programEntry: { select: { subject: { select: { name: true } } } }, cohort: { select: { program: { select: { studyMode: true, code: true } } } } } },
      room: { select: { number: true, building: { select: { name: true } } } },
      instructor: { select: { title: true, firstName: true, lastName: true } },
      group: { select: { id: true } },
    },
    orderBy: [{ date: 'asc' }, { startMinute: 'asc' }],
  });
  const data = rows
    .filter((o) => visible.has(`${o.facultyId}|${o.section.cohort.program.studyMode}`))
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
      room: o.room ? `${o.room.number} (${o.room.building.name})` : 'ON-LINE',
      instructor: o.instructor ? `${o.instructor.title ?? ''} ${o.instructor.firstName} ${o.instructor.lastName}`.trim() : 'NN',
      status: o.status,
      note: o.note,
    }));
  res.json({ data });
});
