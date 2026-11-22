import type { AcademicTerm } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { addDays, toIsoDate, todayIso, type IsoDate } from '../lib/isoDate';
import { holidaysInRange, type Holiday } from '../lib/holidays';
import { shortDate } from '../lib/conflictMessage';
import {
  buildOccupancyEntries,
  pickWeek,
  resourceIdOf,
  termWeeks,
  type OccupancyEntry,
  type OccupancyResource,
  type OccupancySlot,
  type TermWeek,
} from '../lib/occupancyView';
import { occupancyWithScope } from './plan';

/**
 * Zajetosc sal i prowadzacych w tygodniu (strony „Zajetosc sal” i „Zajetosc prowadzacych”) — cala
 * uczelnia, bo sale i prowadzacy sa wspolni dla wydzialow: plan wszystkich wydzialow wg wzorca rozpisany
 * na daty kalendarzy rocznikow (jak „Generuj terminy”, takze gdy terminow jeszcze nie wygenerowano),
 * terminy reczne i zajetosci zewnetrzne. To ta sama zajetosc, na ktorej licza sie kolizje sali
 * i prowadzacego przy ukladaniu planu (services/plan → termOccupancy).
 */

export interface OccupancyView {
  /** Tygodnie semestru do przegladania (od pierwszego do ostatniego dnia kalendarzy). */
  weeks: TermWeek[];
  /** Poniedzialek pokazanego tygodnia; null — semestr nie ma jeszcze kalendarzy. */
  week: IsoDate | null;
  /** Dni pokazanego tygodnia (pn–nd). */
  days: IsoDate[];
  /** Swieta ustawowe w tym tygodniu. */
  holidays: Holiday[];
  entries: OccupancyEntry[];
}

const personName = (p: { title: string | null; firstName: string; lastName: string }) =>
  `${p.title ?? ''} ${p.firstName} ${p.lastName}`.trim();

/** Zajetosc sal: zajecia z sala (bez zajec online), wiersze i kolizje po sali. */
export function roomOccupancy(term: AcademicTerm, requestedWeek: IsoDate | null): Promise<OccupancyView> {
  return occupancyView(term, requestedWeek, 'room');
}

/** Zajetosc prowadzacych: zajecia z prowadzacym (takze online, bez NN), wiersze i kolizje po prowadzacym. */
export function instructorOccupancy(term: AcademicTerm, requestedWeek: IsoDate | null): Promise<OccupancyView> {
  return occupancyView(term, requestedWeek, 'instructor');
}

async function occupancyView(term: AcademicTerm, requestedWeek: IsoDate | null, resource: OccupancyResource): Promise<OccupancyView> {
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
  const inWeek = busy.filter((b) => resourceIdOf(b, resource) && b.date >= week && b.date <= sunday);

  const sectionIds = [...new Set(inWeek.flatMap((b) => (b.origin?.kind === 'SECTION' ? [b.origin.sectionId] : [])))];
  const externalIds = [...new Set(inWeek.flatMap((b) => (b.origin?.kind === 'EXTERNAL' ? [b.origin.externalBusyId] : [])))];
  const instructorIds = [...new Set(inWeek.flatMap((b) => (b.instructorId ? [b.instructorId] : [])))];
  const roomIds = [...new Set(inWeek.flatMap((b) => (b.roomId ? [b.roomId] : [])))];
  const [sections, externals, people, rooms] = await Promise.all([
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
    roomIds.length > 0
      ? prisma.room.findMany({ where: { id: { in: roomIds } }, select: { id: true, number: true, building: { select: { name: true } } } })
      : Promise.resolve([]),
  ]);
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const externalById = new Map(externals.map((e) => [e.id, e]));
  const nameById = new Map(people.map((p) => [p.id, personName(p)]));
  // Sala jak w „Moim planie”: numer i budynek.
  const roomById = new Map(rooms.map((r) => [r.id, `${r.number} (${r.building.name})`]));
  const ctxById = new Map(scope.contexts.map((c) => [c.cohort.id, c]));

  const slots: OccupancySlot[] = [];
  for (const b of inWeek) {
    const common = {
      date: b.date,
      startMinute: b.startMinute,
      endMinute: b.endMinute,
      jointKey: b.jointKey,
      roomId: b.roomId,
      room: b.roomId ? (roomById.get(b.roomId) ?? null) : null,
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

  return { weeks, week, days, holidays: holidaysInRange(week, sunday), entries: buildOccupancyEntries(slots, resource) };
}
