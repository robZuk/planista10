import { prisma } from '../lib/prisma';
import { asyncHandler } from '../middleware/asyncHandler';
import { addDays, fromIsoDate, mondayOf, toIsoDate, todayIso } from '../lib/isoDate';
import { holidaysInRange } from '../lib/holidays';
import { formatMinutes } from '../lib/timeGrid';
import { upcomingDaysOff, type CalendarDayOff } from '../lib/daysOff';
import { occurrenceScope, publishedCohortKeys } from '../services/visibility';
import { activeCohorts } from '../services/sections';

const occurrenceInclude = {
  room: { select: { number: true, building: { select: { name: true } } } },
  instructor: { select: { firstName: true, lastName: true, title: true } },
  group: { select: { id: true, code: true, partitionKey: true } },
  section: {
    select: {
      classType: true,
      cohortId: true,
      cohort: { select: { program: { select: { code: true, studyMode: true } } } },
      programEntry: { select: { subject: { select: { name: true } } } },
    },
  },
};

/**
 * Statystyki dashboardu (nowy model). Wszystko przyciete do roli: administrator widzi uczelnie,
 * dziekanat — swoj wydzial (kafelki tez, inaczej mieszaly sie z wykresem i "dzis" wydzialu),
 * student i prowadzacy — swoje, opublikowane terminy.
 */
export const getStats = asyncHandler(async (req, res) => {
  const today = todayIso();
  const monday = mondayOf(today);
  const sunday = addDays(monday, 6);

  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, role: true, instructorId: true, facultyId: true },
  });
  const scope = user ? await occurrenceScope(user) : null;
  // Kafelki dziekanatu: tylko jego wydzial. Konto bez wydzialu nie widzi niczego.
  const dean = user?.role === 'DEAN_OFFICE';
  const fid = dean ? (user!.facultyId ?? '__none__') : null;
  const faculty = fid ? await prisma.faculty.findUnique({ where: { id: fid }, select: { name: true, shortName: true } }) : null;

  const [
    usersByRole,
    instructorCount,
    groupCount,
    studentCount,
    roomCount,
    buildingCount,
    placementCount,
    occurrenceCount,
    recentUsers,
    facultyCount,
    subjectCount,
    calendarCount,
    weekRows,
  ] = await Promise.all([
    prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
    prisma.instructor.count({ where: fid ? { facultyId: fid } : {} }),
    prisma.studentGroup.count({ where: fid ? { cohort: { program: { fieldOfStudy: { facultyId: fid } } } } : {} }),
    prisma.user.count({
      where: { role: 'STUDENT', ...(fid ? { studentGroups: { some: { cohort: { program: { fieldOfStudy: { facultyId: fid } } } } } } : {}) },
    }),
    prisma.room.count({ where: fid ? { building: { facultyId: fid } } : {} }),
    prisma.building.count({ where: fid ? { facultyId: fid } : {} }),
    prisma.placement.count({ where: fid ? { facultyId: fid } : {} }),
    prisma.occurrence.count({ where: fid ? { facultyId: fid } : {} }),
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    }),
    prisma.faculty.count(),
    prisma.subject.count(),
    prisma.termCalendar.count(),
    scope
      ? prisma.occurrence.findMany({
          where: { ...scope.where, date: { gte: fromIsoDate(monday), lte: fromIsoDate(sunday) } },
          include: occurrenceInclude,
          orderBy: [{ date: 'asc' }, { startMinute: 'asc' }],
        })
      : Promise.resolve([]),
  ]);

  // Student i prowadzacy: tylko roczniki z opublikowanym (albo archiwalnym) wlasnym kalendarzem.
  const visible = scope?.publishedOnly ? await publishedCohortKeys(weekRows.map((o) => ({ termId: o.termId, cohortId: o.section.cohortId }))) : null;
  const shownRows = weekRows.filter((o) => !visible || visible.has(`${o.termId}|${o.section.cohortId}`));
  const groupName = await groupNamesOf(shownRows);
  const week = shownRows
    .map((o) => ({
      id: o.id,
      classType: o.section.classType,
      date: o.date.toISOString(),
      room: o.room,
      instructor: o.instructor,
      studentGroup: {
        id: o.group.id,
        // Nazwa grupy liczona na semestr rocznika (jak w Ukladaniu planu i "Moim planie").
        name: `${o.section.cohort.program.code} ${groupName(o.termId, o.section.cohortId, o.group.id) ?? (o.group.partitionKey === 'ROOT' ? 'caly rocznik' : `${o.group.partitionKey}-${o.group.code ?? ''}`)}`,
      },
      curriculumEntry: { subject: o.section.programEntry.subject },
      // Godziny z terminu (rozne wydzialy moga miec rozne siatki godzin).
      startBlock: { order: o.startOrder, startTime: formatMinutes(o.startMinute) },
      endBlock: { order: o.endOrder, endTime: formatMinutes(o.endMinute) },
    }));

  // Najblizsze dni wolne (karta planisty): swieta i przerwy/dni wolne kalendarzy w zakresie roli.
  const horizon = addDays(today, 60);
  const planner = user?.role === 'ADMIN' || dean;
  const calendars = planner
    ? await prisma.termCalendar.findMany({
          where: { ...(fid ? { facultyId: fid } : {}), startDate: { lte: fromIsoDate(horizon) }, endDate: { gte: fromIsoDate(today) } },
          select: {
            name: true,
            studyMode: true,
            faculty: { select: { shortName: true } },
            breaks: { select: { name: true, startDate: true, endDate: true } },
            days: { where: { kind: 'DAY_OFF' }, select: { name: true, date: true } },
          },
        })
      : [];
  const calendarLabel = (c: (typeof calendars)[number]) =>
    `${fid ? '' : `${c.faculty.shortName} `}${c.studyMode === 'FULL_TIME' ? 'stacj.' : 'niestacj.'}${c.name === 'Podstawowy' ? '' : ` (${c.name})`}`;
  const calendarDaysOff: CalendarDayOff[] = calendars.flatMap((c) => [
    ...c.breaks.map((b) => ({ kind: 'BREAK' as const, name: b.name, start: toIsoDate(b.startDate), end: toIsoDate(b.endDate), calendar: calendarLabel(c) })),
    ...c.days.map((d) => {
      const date = toIsoDate(d.date);
      return { kind: 'DAY_OFF' as const, name: d.name || 'Dzien wolny', start: date, end: date, calendar: calendarLabel(c) };
    }),
  ]);
  // Karta jest tylko w widoku planisty; prowadzacy i student maja wlasny plan.
  const daysOff = planner ? upcomingDaysOff(today, horizon, holidaysInRange(today, horizon), calendarDaysOff, calendars.map(calendarLabel)) : [];

  const byRole = Object.fromEntries(usersByRole.map((r) => [r.role, r._count._all])) as Record<string, number>;
  const todayEntries = week.filter((o) => o.date.slice(0, 10) === today);

  res.json({
    data: {
      users: {
        total: Object.values(byRole).reduce((s, v) => s + v, 0),
        byRole: {
          ADMIN: byRole.ADMIN ?? 0,
          DEAN_OFFICE: byRole.DEAN_OFFICE ?? 0,
          INSTRUCTOR: byRole.INSTRUCTOR ?? 0,
          STUDENT: byRole.STUDENT ?? 0,
        },
      },
      instructors: { total: instructorCount },
      groups: { total: groupCount },
      students: { total: studentCount },
      rooms: { total: roomCount },
      buildings: { total: buildingCount },
      templates: { total: placementCount },
      entries: {
        total: occurrenceCount,
        todayCount: todayEntries.length,
      },
      faculties: { total: facultyCount },
      subjects: { total: subjectCount },
      calendars: { total: calendarCount },
      // Zakres liczb na kafelkach: cala uczelnia albo wydzial dziekanatu.
      scope: faculty ? { kind: 'FACULTY', name: faculty.name, shortName: faculty.shortName } : { kind: 'ALL' },
      todayEntries,
      weekEntries: week,
      upcomingHolidays: holidaysInRange(today, addDays(today, 7)).map((h) => ({ id: h.date, ...h })),
      upcomingDaysOff: daysOff,
      recentUsers,
    },
  });
});

/**
 * Nazwy grup terminow tygodnia — liczone na semestr rocznika (lib/groupTree.displayName przez
 * activeCohorts), osobno dla kazdego semestru, z ktorego pochodza terminy. Grupa spoza kontekstu
 * (rocznik poza zakresem programu) -> null, wtedy zostaje oznaczenie z klucza podzialu.
 */
async function groupNamesOf(rows: { termId: string; section: { cohortId: string } }[]) {
  const byTerm = new Map<string, Set<string>>();
  for (const r of rows) byTerm.set(r.termId, (byTerm.get(r.termId) ?? new Set<string>()).add(r.section.cohortId));
  const names = new Map<string, (groupId: string) => string>();
  if (byTerm.size > 0) {
    const terms = await prisma.academicTerm.findMany({ where: { id: { in: [...byTerm.keys()] } } });
    for (const term of terms) {
      for (const ctx of await activeCohorts(term, null, [...(byTerm.get(term.id) ?? [])])) names.set(`${term.id}|${ctx.cohort.id}`, ctx.nameOf);
    }
  }
  return (termId: string, cohortId: string, groupId: string): string | null => {
    const name = names.get(`${termId}|${cohortId}`)?.(groupId);
    return name && name !== '?' ? name : null;
  };
}
