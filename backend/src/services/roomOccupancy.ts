import type { AcademicTerm } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { addDays, toIsoDate, todayIso, type IsoDate } from '../lib/isoDate';
import { holidaysInRange, type Holiday } from '../lib/holidays';
import { shortDate } from '../lib/conflictMessage';
import { buildRoomEntries, pickWeek, termWeeks, type RoomEntry, type RoomSlot, type TermWeek } from '../lib/roomOccupancy';
import { occupancyWithScope } from './plan';

/**
 * Zajetosc sal w tygodniu (strona „Zajetosc sal”) — cala uczelnia, bo sale sa wspolne: plan
 * wszystkich wydzialow wg wzorca rozpisany na daty kalendarzy rocznikow (jak „Generuj terminy”,
 * takze gdy terminow jeszcze nie wygenerowano), terminy reczne i zajetosci zewnetrzne. To ta sama
 * zajetosc, na ktorej licza sie kolizje sali przy ukladaniu planu (services/plan → termOccupancy).
 */

export interface RoomOccupancyView {
  /** Tygodnie semestru do przegladania (od pierwszego do ostatniego dnia kalendarzy). */
  weeks: TermWeek[];
  /** Poniedzialek pokazanego tygodnia; null — semestr nie ma jeszcze kalendarzy. */
  week: IsoDate | null;
  /** Dni pokazanego tygodnia (pn–nd). */
  days: IsoDate[];
  /** Swieta ustawowe w tym tygodniu. */
  holidays: Holiday[];
  entries: RoomEntry[];
}

const personName = (p: { title: string | null; firstName: string; lastName: string }) =>
  `${p.title ?? ''} ${p.firstName} ${p.lastName}`.trim();

export async function roomOccupancy(term: AcademicTerm, requestedWeek: IsoDate | null): Promise<RoomOccupancyView> {
  const [calendars, externalDates] = await Promise.all([
    prisma.termCalendar.findMany({ where: { termId: term.id }, select: { startDate: true, endDate: true } }),
    prisma.externalBusy.findMany({ where: { termId: term.id }, select: { dates: true } }),
  ]);
  const calendarRanges = calendars.map((c) => ({ start: toIsoDate(c.startDate), end: toIsoDate(c.endDate) }));
  const external = externalDates.flatMap((e) => e.dates.map(toIsoDate)).sort();
  const ranges = [...calendarRanges, ...(external.length > 0 ? [{ start: external[0]!, end: external[external.length - 1]! }] : [])];
  const anchor = calendarRanges.length > 0 ? calendarRanges.reduce((min, r) => (r.start < min ? r.start : min), calendarRanges[0]!.start) : undefined;
  const weeks = termWeeks(ranges, anchor);

  const week = pickWeek(weeks, requestedWeek, todayIso());
  if (!week) return { weeks, week: null, days: [], holidays: [], entries: [] };
  const sunday = addDays(week, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));

  const { busy, scope } = await occupancyWithScope(term);
  const inWeek = busy.filter((b) => b.roomId && b.date >= week && b.date <= sunday);

  const sectionIds = [...new Set(inWeek.flatMap((b) => (b.origin?.kind === 'SECTION' ? [b.origin.sectionId] : [])))];
  const externalIds = [...new Set(inWeek.flatMap((b) => (b.origin?.kind === 'EXTERNAL' ? [b.origin.externalBusyId] : [])))];
  const instructorIds = [...new Set(inWeek.flatMap((b) => (b.instructorId ? [b.instructorId] : [])))];
  const [sections, externals, people] = await Promise.all([
    sectionIds.length > 0
      ? prisma.classSection.findMany({
          where: { id: { in: sectionIds } },
          select: {
            id: true,
            cohortId: true,
            groupId: true,
            classType: true,
            facultyId: true,
            programEntry: { select: { subject: { select: { name: true } } } },
          },
        })
      : Promise.resolve([]),
    externalIds.length > 0
      ? prisma.externalBusy.findMany({ where: { id: { in: externalIds } }, select: { id: true, source: true, receivedOn: true, note: true } })
      : Promise.resolve([]),
    instructorIds.length > 0
      ? prisma.instructor.findMany({ where: { id: { in: instructorIds } }, select: { id: true, title: true, firstName: true, lastName: true } })
      : Promise.resolve([]),
  ]);
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const externalById = new Map(externals.map((e) => [e.id, e]));
  const nameById = new Map(people.map((p) => [p.id, personName(p)]));
  const ctxById = new Map(scope.contexts.map((c) => [c.cohort.id, c]));

  const slots: RoomSlot[] = [];
  for (const b of inWeek) {
    const common = {
      roomId: b.roomId!,
      date: b.date,
      startMinute: b.startMinute,
      endMinute: b.endMinute,
      jointKey: b.jointKey,
      instructorId: b.instructorId,
      instructor: b.instructorId ? (nameById.get(b.instructorId) ?? null) : null,
    };
    const origin = b.origin;
    if (origin?.kind === 'SECTION') {
      const s = sectionById.get(origin.sectionId);
      if (!s) continue;
      const ctx = ctxById.get(s.cohortId);
      slots.push({
        ...common,
        kind: origin.manual ? 'MANUAL' : 'CLASS',
        title: s.programEntry.subject.name,
        classType: s.classType,
        group: {
          label: ctx ? `${ctx.cohort.program.code} s${ctx.semester} · ${ctx.nameOf(s.groupId)}` : s.programEntry.subject.name,
          cohortId: s.cohortId,
          facultyId: s.facultyId,
        },
        facultyId: s.facultyId,
        note: null,
      });
    } else if (origin?.kind === 'EXTERNAL') {
      const e = externalById.get(origin.externalBusyId);
      if (!e) continue;
      const note = e.note?.trim();
      slots.push({
        ...common,
        kind: 'EXTERNAL',
        title: e.source,
        classType: null,
        group: null,
        facultyId: null,
        note: `zgloszenie: ${e.source}, stan na ${shortDate(toIsoDate(e.receivedOn))}${note ? ` — ${note}` : ''}`,
      });
    }
  }

  return { weeks, week, days, holidays: holidaysInRange(week, sunday), entries: buildRoomEntries(slots) };
}
