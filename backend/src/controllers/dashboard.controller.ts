import { prisma } from '../lib/prisma';
import { asyncHandler } from '../middleware/asyncHandler';
import { addDays, fromIsoDate, mondayOf, todayIso } from '../lib/isoDate';
import { holidaysInRange } from '../lib/holidays';
import { occurrenceScope, publishedScopes } from '../services/visibility';

const occurrenceInclude = {
  room: { select: { number: true, building: { select: { name: true } } } },
  instructor: { select: { firstName: true, lastName: true, title: true } },
  group: { select: { id: true, code: true, partitionKey: true } },
  section: {
    select: {
      classType: true,
      cohort: { select: { program: { select: { code: true, studyMode: true } } } },
      programEntry: { select: { subject: { select: { name: true } } } },
    },
  },
};

/**
 * Statystyki dashboardu (nowy model). Liczby uczelni dla planistow, a "dzis" i "ten
 * tydzien" — przyciete do roli: student i prowadzacy widza tylko swoje, opublikowane
 * terminy; dziekanat — swoj wydzial.
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
  const blocks = await prisma.timeBlock.findMany();
  const blockByOrder = new Map(blocks.map((b) => [b.order, b]));

  const [
    usersByRole,
    instructorCount,
    groupCount,
    studentCount,
    roomCount,
    buildingCount,
    placementCount,
    occurrencesByStatus,
    recentUsers,
    facultyCount,
    subjectCount,
    calendarCount,
    weekRows,
  ] = await Promise.all([
    prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
    prisma.instructor.count(),
    prisma.studentGroup.count(),
    prisma.user.count({ where: { role: 'STUDENT' } }),
    prisma.room.count(),
    prisma.building.count(),
    prisma.placement.count(),
    prisma.occurrence.groupBy({ by: ['status'], _count: { _all: true } }),
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
          orderBy: [{ date: 'asc' }, { startOrder: 'asc' }],
        })
      : Promise.resolve([]),
  ]);

  const visible = scope?.publishedOnly ? await publishedScopes() : null;
  const week = weekRows
    .filter((o) => !visible || visible.has(`${o.termId}|${o.facultyId}|${o.section.cohort.program.studyMode}`))
    .map((o) => ({
      id: o.id,
      classType: o.section.classType,
      status: o.status,
      date: o.date.toISOString(),
      room: o.room,
      instructor: o.instructor,
      studentGroup: {
        id: o.group.id,
        name: `${o.section.cohort.program.code} ${o.group.partitionKey === 'ROOT' ? 'caly rocznik' : `${o.group.partitionKey}-${o.group.code ?? ''}`}`,
      },
      curriculumEntry: { subject: o.section.programEntry.subject },
      startBlock: { order: o.startOrder, startTime: blockByOrder.get(o.startOrder)?.startTime ?? '' },
      endBlock: { order: o.endOrder, endTime: blockByOrder.get(o.endOrder)?.endTime ?? '' },
    }));

  const byRole = Object.fromEntries(usersByRole.map((r) => [r.role, r._count._all])) as Record<string, number>;
  const byStatus = Object.fromEntries(occurrencesByStatus.map((r) => [r.status, r._count._all])) as Record<string, number>;
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
        scheduled: byStatus.SCHEDULED ?? 0,
        cancelled: byStatus.CANCELLED ?? 0,
        makeup: byStatus.MAKEUP ?? 0,
        total: Object.values(byStatus).reduce((s, v) => s + v, 0),
        todayCount: todayEntries.length,
      },
      faculties: { total: facultyCount },
      subjects: { total: subjectCount },
      calendars: { total: calendarCount },
      todayEntries,
      weekEntries: week,
      upcomingHolidays: holidaysInRange(today, addDays(today, 7)).map((h) => ({ id: h.date, ...h })),
      recentUsers,
    },
  });
});
