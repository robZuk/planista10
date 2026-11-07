import type { AcademicTerm, DayOfWeek, Prisma, TermCalendar } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { fromIsoDate, toIsoDate, type IsoDate } from '../lib/isoDate';
import { expandDates, modeWeekdays, TeachingCalendar, WEEKDAY_ENUM } from '../lib/teachingCalendar';
import { groupsOverlap, indexGroups } from '../lib/groupTree';
import { checkTimeWindow, rangesOverlap, roomTypeMap } from '../lib/scheduleTime';
import {
  findConflict,
  materialize,
  type BusySlot,
  type MatException,
  type MatPlacement,
  type MatSection,
} from '../lib/materializer';
import { calendarInclude, toCalendarInput } from './termCalendars';
import { activeCohorts, type CohortContext } from './sections';
import { cohortLabel, toTreeGroup } from './cohorts';

/**
 * Plan semestru (nowy model). Umieszczenia uklada planista; terminy powstaja tylko
 * przyciskiem "Generuj terminy". Kolizje sprawdzamy na konkretnych datach w calej
 * uczelni: sala, prowadzacy i grupy (regula nakladania z lib/groupTree).
 */

const CLASS_LETTER: Record<string, string> = { LECTURE: 'W', EXERCISE: 'C', LAB: 'L', PROJECT: 'P', SEMINAR: 'S' };

// ─── Kalendarz rocznika ──────────────────────────────────────

export type CalendarRow = TermCalendar & Prisma.TermCalendarGetPayload<{ include: typeof calendarInclude }>;

/** Kalendarz, wg ktorego rocznik ma zajecia: wybrany w Rocznikach albo domyslny wydzialu. */
export async function calendarFor(term: AcademicTerm, ctx: CohortContext): Promise<CalendarRow | null> {
  const chosen = ctx.cohort.terms.find((t) => t.termId === term.id)?.calendarId;
  const candidates = await prisma.termCalendar.findMany({
    where: {
      termId: term.id,
      facultyId: ctx.cohort.program.fieldOfStudy.facultyId,
      studyMode: ctx.cohort.program.studyMode,
    },
    include: calendarInclude,
  });
  return (
    candidates.find((c) => c.id === chosen) ??
    candidates.find((c) => c.name === 'Podstawowy') ??
    candidates[0] ??
    null
  );
}

/** Wszystkie grupy z rocznikami — wspolny indeks do reguly nakladania. */
async function groupOverlapFn() {
  const groups = await prisma.studentGroup.findMany();
  const index = indexGroups(groups.map(toTreeGroup));
  return (a: string, b: string) => groupsOverlap(a, b, index);
}

function toMatPlacement(p: {
  id: string;
  sectionId: string;
  dayOfWeek: DayOfWeek;
  startOrder: number;
  endOrder: number;
  roomId: string;
  instructorId: string | null;
  cycle: 'WEEK' | 'ZJAZD';
  pattern: 'ALL' | 'EVEN' | 'ODD' | 'LIST';
  numbers: number[];
  fromIndex: number | null;
  toIndex: number | null;
  jointKey: string | null;
}): MatPlacement {
  return { ...p };
}

const sectionLabelInclude = { programEntry: { select: { subject: { select: { name: true } } } } } as const;

function sectionLabel(subject: string, classType: string, groupName: string) {
  return `${subject} (${CLASS_LETTER[classType] ?? classType}) ${groupName}`;
}

// ─── Zakres planu: roczniki, kalendarze, zajecia, umieszczenia ──

interface Scope {
  contexts: CohortContext[];
  calendars: Map<string, CalendarRow>; // cohortId -> kalendarz
  teaching: Map<string, TeachingCalendar>; // cohortId -> kalendarz zajec
}

async function loadScope(term: AcademicTerm, facultyId: string | null, cohortIds?: string[]): Promise<Scope> {
  const contexts = await activeCohorts(term, facultyId, cohortIds);
  const calendars = new Map<string, CalendarRow>();
  const teaching = new Map<string, TeachingCalendar>();
  for (const ctx of contexts) {
    const calendar = await calendarFor(term, ctx);
    if (!calendar) continue;
    calendars.set(ctx.cohort.id, calendar);
    teaching.set(ctx.cohort.id, new TeachingCalendar(toCalendarInput(calendar)));
  }
  return { contexts, calendars, teaching };
}

/**
 * Zajete sloty z umieszczen calego semestru (wszystkie wydzialy) + terminy MANUAL
 * i przeniesione terminy — do sprawdzania nowego umieszczenia jeszcze przed generowaniem.
 */
async function placementBusy(term: AcademicTerm, excludePlacementId?: string): Promise<BusySlot[]> {
  const scope = await loadScope(term, null);
  const ctxById = new Map(scope.contexts.map((c) => [c.cohort.id, c]));
  const placements = await prisma.placement.findMany({
    where: { termId: term.id, ...(excludePlacementId ? { id: { not: excludePlacementId } } : {}) },
    include: { section: { include: sectionLabelInclude } },
  });
  const busy: BusySlot[] = [];
  for (const p of placements) {
    const ctx = ctxById.get(p.section.cohortId);
    const cal = scope.teaching.get(p.section.cohortId);
    if (!ctx || !cal) continue;
    const label = sectionLabel(p.section.programEntry.subject.name, p.section.classType, ctx.nameOf(p.section.groupId));
    for (const d of expandDates(cal, { ...toMatPlacement(p) })) {
      busy.push({
        date: d.date,
        startOrder: p.startOrder,
        endOrder: p.endOrder,
        roomId: p.roomId,
        instructorId: p.instructorId,
        groupId: p.section.groupId,
        jointKey: p.jointKey,
        label,
      });
    }
  }
  const manual = await prisma.occurrence.findMany({
    where: { termId: term.id, status: { not: 'CANCELLED' }, kind: 'MANUAL' },
    include: { section: { include: sectionLabelInclude } },
  });
  for (const o of manual) {
    busy.push({
      date: toIsoDate(o.date),
      startOrder: o.startOrder,
      endOrder: o.endOrder,
      roomId: o.roomId,
      instructorId: o.instructorId,
      groupId: o.groupId,
      jointKey: o.jointKey,
      label: `${o.section.programEntry.subject.name} (termin reczny)`,
    });
  }
  return busy;
}

// ─── Walidacja umieszczenia ──────────────────────────────────

export interface PlacementInput {
  sectionId: string;
  dayOfWeek: DayOfWeek;
  startOrder: number;
  endOrder: number;
  roomId: string;
  instructorId: string | null;
  cycle: 'WEEK' | 'ZJAZD';
  pattern: 'ALL' | 'EVEN' | 'ODD' | 'LIST';
  numbers: number[];
  fromIndex: number | null;
  toIndex: number | null;
  jointKey: string | null;
}

export interface PlacementCheck {
  errors: string[];
  conflicts: { date: IsoDate; reason: string; with: string }[];
  dates: number;
}

export async function checkPlacement(term: AcademicTerm, input: PlacementInput, excludeId?: string): Promise<PlacementCheck> {
  const errors: string[] = [];
  const section = await prisma.classSection.findUnique({
    where: { id: input.sectionId },
    include: { instructors: true, group: true },
  });
  if (!section || section.termId !== term.id) throw new AppError(400, 'Zajecia nie naleza do tego semestru');
  const [ctx] = await activeCohorts(term, null, [section.cohortId]);
  if (!ctx) throw new AppError(400, 'Rocznik nie ma zajec w tym semestrze');
  const calendar = await calendarFor(term, ctx);
  if (!calendar) throw new AppError(409, 'Rocznik nie ma kalendarza w tym semestrze — ustaw go w Kalendarzu semestru');
  if (calendar.status === 'ARCHIVED') throw new AppError(409, 'Kalendarz jest w archiwum — plan tylko do odczytu');

  const blocks = await prisma.timeBlock.findMany({ orderBy: { order: 'asc' } });
  const start = blocks.find((b) => b.order === input.startOrder);
  if (!start || !blocks.some((b) => b.order === input.endOrder) || input.endOrder < input.startOrder) {
    errors.push('Nieprawidlowy zakres godzin');
  }
  const day = WEEKDAY_ENUM.indexOf(input.dayOfWeek);
  if (!modeWeekdays(calendar.studyMode).includes(day)) {
    errors.push(calendar.studyMode === 'FULL_TIME' ? 'Stacjonarne: zajecia pon-pt' : 'Niestacjonarne: zajecia pt-nd');
  } else if (start) {
    const window = checkTimeWindow(day, start.startTime, calendar.studyMode);
    if (window) errors.push(window);
  }
  if (input.cycle === 'ZJAZD' && calendar.kind !== 'ZJAZD') errors.push('Rocznik ma kalendarz tygodniowy — wybierz rytm tygodniowy');
  if (input.pattern === 'LIST' && input.numbers.length === 0) errors.push('Wybierz numery tygodni/zjazdow');

  const room = await prisma.room.findUnique({ where: { id: input.roomId } });
  if (!room) errors.push('Sala nie istnieje');
  else {
    if (!roomTypeMap[section.classType].includes(room.type)) errors.push('Typ sali nie pasuje do formy zajec');
    if (room.capacity < section.group.size) errors.push(`Sala ma ${room.capacity} miejsc, grupa ${section.group.size} osob`);
  }
  const staff = section.instructors.map((i) => i.instructorId);
  if (input.instructorId && !staff.includes(input.instructorId)) {
    errors.push('Prowadzacy spoza obsady tych zajec — uzupelnij najpierw obsade');
  }

  const cal = new TeachingCalendar(toCalendarInput(calendar));
  const dates = expandDates(cal, { ...input });
  if (dates.length === 0) errors.push('W tym rytmie nie wypada zaden dzien zajec');

  const conflicts: PlacementCheck['conflicts'] = [];
  if (errors.length === 0) {
    const busy = await placementBusy(term, excludeId);
    const overlap = await groupOverlapFn();
    const byDate = new Map<string, BusySlot[]>();
    for (const b of busy) byDate.set(b.date, [...(byDate.get(b.date) ?? []), b]);
    for (const d of dates) {
      const conflict = findConflict(
        { date: d.date, startOrder: input.startOrder, endOrder: input.endOrder, roomId: input.roomId, instructorId: input.instructorId, groupId: section.groupId, jointKey: input.jointKey },
        byDate.get(d.date) ?? [],
        overlap,
      );
      if (conflict) conflicts.push({ date: d.date, ...conflict });
    }
  }
  return { errors, conflicts, dates: dates.length };
}

/**
 * Podpowiedz przy przeciaganiu: dla kazdego dnia i bloku startowego — czy zajecia
 * o danej dlugosci zmieszcza sie bez kolizji grupy, prowadzacego (i sali, jesli podana).
 */
export async function availability(
  term: AcademicTerm,
  sectionId: string,
  length: number,
  opts: { roomId?: string; instructorId?: string | null; cycle: 'WEEK' | 'ZJAZD'; pattern: 'ALL' | 'LIST'; numbers: number[] },
) {
  const section = await prisma.classSection.findUnique({ where: { id: sectionId }, include: { instructors: true } });
  if (!section) throw new AppError(404, 'Zajecia nie znalezione');
  const [ctx] = await activeCohorts(term, null, [section.cohortId]);
  const calendar = ctx ? await calendarFor(term, ctx) : null;
  if (!calendar) throw new AppError(409, 'Rocznik nie ma kalendarza w tym semestrze');
  const cal = new TeachingCalendar(toCalendarInput(calendar));
  const blocks = await prisma.timeBlock.findMany({ orderBy: { order: 'asc' } });
  const busy = await placementBusy(term);
  const overlap = await groupOverlapFn();
  const instructorId =
    opts.instructorId !== undefined ? opts.instructorId : (section.instructors.find((i) => i.instructorId)?.instructorId ?? null);

  const days = modeWeekdays(calendar.studyMode).map((d) => WEEKDAY_ENUM[d]!);
  const cells: Record<string, Record<number, string | null>> = {};
  for (const dayOfWeek of days) {
    cells[dayOfWeek] = {};
    const dates = expandDates(cal, { dayOfWeek, cycle: opts.cycle, pattern: opts.pattern, numbers: opts.numbers }).map((d) => d.date);
    const relevant = busy.filter((b) => dates.includes(b.date));
    for (const block of blocks) {
      const endOrder = block.order + length - 1;
      if (!blocks.some((b) => b.order === endOrder)) {
        cells[dayOfWeek]![block.order] = 'Poza siatka godzin';
        continue;
      }
      let reason: string | null = null;
      for (const b of relevant) {
        if (!rangesOverlap(block.order, endOrder, b.startOrder, b.endOrder)) continue;
        if (opts.roomId && b.roomId === opts.roomId) reason = `Sala zajeta: ${b.label}`;
        else if (instructorId && b.instructorId === instructorId) reason = `Prowadzacy zajety: ${b.label}`;
        else if (overlap(section.groupId, b.groupId)) reason = `Grupa zajeta: ${b.label}`;
        if (reason) break;
      }
      cells[dayOfWeek]![block.order] = reason;
    }
  }
  return { days, cells };
}

// ─── Widok planu rocznika ────────────────────────────────────

export async function planView(term: AcademicTerm, cohortId: string) {
  const scope = await loadScope(term, null, [cohortId]);
  const ctx = scope.contexts[0];
  if (!ctx) throw new AppError(404, 'Rocznik nie ma zajec w tym semestrze');
  const calendar = scope.calendars.get(cohortId) ?? null;
  const cal = scope.teaching.get(cohortId) ?? null;

  const sections = await prisma.classSection.findMany({
    where: { termId: term.id, cohortId },
    include: {
      programEntry: { select: { orderInSemester: true, subject: { select: { id: true, name: true } }, specialization: { select: { shortName: true } } } },
      instructors: { include: { instructor: { select: { id: true, title: true, firstName: true, lastName: true } } } },
      placements: { include: { room: { select: { id: true, number: true, building: { select: { name: true } } } }, instructor: { select: { id: true, title: true, firstName: true, lastName: true } }, _count: { select: { exceptions: true } } } },
    },
  });
  const manual = await prisma.occurrence.groupBy({
    by: ['sectionId'],
    where: { termId: term.id, kind: 'MANUAL', status: { not: 'CANCELLED' }, section: { cohortId } },
    _sum: { endOrder: true, startOrder: true },
    _count: { _all: true },
  });
  const manualHours = new Map(manual.map((m) => [m.sectionId, (m._sum.endOrder ?? 0) - (m._sum.startOrder ?? 0) + m._count._all]));

  // Bilans godzin: ile godzin dadza obecne umieszczenia (bez kolizji, z limitem).
  const planned = new Map<string, number>();
  if (cal) {
    const mat = materialize({
      sections: sections.map((s) => ({ id: s.id, hours: s.hours, groupId: s.groupId, calendar: cal, consumedHours: manualHours.get(s.id) ?? 0, label: s.id })),
      placements: sections.flatMap((s) => s.placements.map(toMatPlacement)),
      exceptions: [],
      busy: [],
      groupsOverlap: () => false,
      skipConflicts: true,
    });
    for (const o of mat.occurrences) planned.set(o.sectionId, (planned.get(o.sectionId) ?? 0) + o.endOrder - o.startOrder + 1);
  }

  const name = (i: { title: string | null; firstName: string; lastName: string } | null) =>
    i ? `${i.title ?? ''} ${i.firstName} ${i.lastName}`.trim() : 'NN';
  const lastPlacementChange = sections
    .flatMap((s) => s.placements.map((p) => p.updatedAt.getTime()))
    .reduce((a, b) => Math.max(a, b), 0);
  const generatedAt = calendar?.lastGeneratedAt?.getTime() ?? 0;
  const derivedCount = await prisma.occurrence.count({ where: { termId: term.id, kind: 'DERIVED', section: { cohortId } } });

  return {
    cohort: {
      id: ctx.cohort.id,
      label: cohortLabel(ctx.cohort),
      code: ctx.cohort.program.code,
      semester: ctx.semester,
      studyMode: ctx.cohort.program.studyMode,
    },
    calendar: calendar
      ? {
          id: calendar.id,
          name: calendar.name,
          kind: calendar.kind,
          status: calendar.status,
          lastGeneratedAt: calendar.lastGeneratedAt,
          teachingWeeks: cal!.teachingWeeks().filter((w) => w.index !== null).length,
          zjazdy: calendar.zjazdy.map((z) => ({ number: z.number, startDate: toIsoDate(z.startDate), endDate: toIsoDate(z.endDate) })),
        }
      : null,
    // Kalendarz nieaktualny: umieszczenia zmienione po ostatnim generowaniu.
    stale: lastPlacementChange > generatedAt && (generatedAt > 0 || derivedCount > 0 || lastPlacementChange > 0),
    generatedOccurrences: derivedCount,
    sections: sections
      .map((s) => ({
        id: s.id,
        subject: s.programEntry.subject,
        order: s.programEntry.orderInSemester,
        specialization: s.programEntry.specialization?.shortName ?? null,
        classType: s.classType,
        group: { id: s.groupId, name: ctx.nameOf(s.groupId) },
        hours: s.hours,
        plannedHours: (planned.get(s.id) ?? 0) + (manualHours.get(s.id) ?? 0),
        status: s.status,
        instructors: s.instructors.map((i) => ({ instructorId: i.instructorId, name: name(i.instructor), hours: i.hours })),
        placements: s.placements.map((p) => ({
          id: p.id,
          dayOfWeek: p.dayOfWeek,
          startOrder: p.startOrder,
          endOrder: p.endOrder,
          room: { id: p.room.id, label: `${p.room.number} (${p.room.building.name})` },
          instructor: p.instructorId ? { id: p.instructorId, name: name(p.instructor) } : null,
          cycle: p.cycle,
          pattern: p.pattern,
          numbers: p.numbers,
          fromIndex: p.fromIndex,
          toIndex: p.toIndex,
          jointKey: p.jointKey,
          exceptionCount: p._count.exceptions,
        })),
      }))
      .sort((a, b) => a.order - b.order || a.subject.name.localeCompare(b.subject.name) || a.classType.localeCompare(b.classType) || a.group.name.localeCompare(b.group.name)),
  };
}

// ─── Generowanie terminow ────────────────────────────────────

export interface GenerateReport {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  total: number;
  conflicts: { date: IsoDate; section: string; reason: string; with: string }[];
  beyondHours: number;
  shortfalls: { section: string; missing: number }[];
  orphanExceptions: { section: string; date: IsoDate; action: string }[];
  calendarsMissing: string[];
}

export async function generate(
  term: AcademicTerm,
  opts: { facultyId: string | null; cohortIds?: string[]; fromDate?: IsoDate | null; dryRun: boolean },
): Promise<GenerateReport> {
  const scope = await loadScope(term, opts.facultyId, opts.cohortIds);
  const report: GenerateReport = { added: 0, removed: 0, changed: 0, unchanged: 0, total: 0, conflicts: [], beyondHours: 0, shortfalls: [], orphanExceptions: [], calendarsMissing: [] };
  const ctxs = scope.contexts.filter((c) => {
    if (!scope.teaching.has(c.cohort.id)) report.calendarsMissing.push(cohortLabel(c.cohort));
    return scope.teaching.has(c.cohort.id);
  });
  for (const c of ctxs) {
    // Podglad wolno liczyc zawsze; zapisac terminow do archiwum nie wolno.
    if (!opts.dryRun && scope.calendars.get(c.cohort.id)!.status === 'ARCHIVED') {
      throw new AppError(409, `Kalendarz rocznika ${cohortLabel(c.cohort)} jest w archiwum — terminow nie generuje sie`);
    }
  }
  const cohortIds = ctxs.map((c) => c.cohort.id);
  const ctxById = new Map(ctxs.map((c) => [c.cohort.id, c]));

  const sections = await prisma.classSection.findMany({
    where: { termId: term.id, cohortId: { in: cohortIds } },
    include: { ...sectionLabelInclude, placements: { include: { exceptions: true } } },
  });
  const sectionIds = sections.map((s) => s.id);
  const from = opts.fromDate ? fromIsoDate(opts.fromDate) : null;

  // Godziny zuzyte poza generowaniem: terminy MANUAL i zachowane terminy sprzed "od kiedy".
  const kept = await prisma.occurrence.findMany({
    where: {
      sectionId: { in: sectionIds },
      status: { not: 'CANCELLED' },
      OR: [{ kind: 'MANUAL' }, ...(from ? [{ kind: 'DERIVED' as const, date: { lt: from } }] : [])],
    },
    select: { sectionId: true, startOrder: true, endOrder: true },
  });
  const consumed = new Map<string, number>();
  for (const k of kept) consumed.set(k.sectionId, (consumed.get(k.sectionId) ?? 0) + k.endOrder - k.startOrder + 1);

  const labelOf = new Map<string, string>();
  const matSections: MatSection[] = sections.map((s) => {
    const ctx = ctxById.get(s.cohortId)!;
    const label = `${ctx.cohort.program.code} s${ctx.semester}: ${sectionLabel(s.programEntry.subject.name, s.classType, ctx.nameOf(s.groupId))}`;
    labelOf.set(s.id, label);
    return { id: s.id, hours: s.hours, groupId: s.groupId, calendar: scope.teaching.get(s.cohortId)!, consumedHours: consumed.get(s.id) ?? 0, label };
  });
  const placements = sections.flatMap((s) => s.placements.map(toMatPlacement));
  const placementSection = new Map(sections.flatMap((s) => s.placements.map((p) => [p.id, s.id] as const)));
  const exceptions: MatException[] = sections.flatMap((s) =>
    s.placements.flatMap((p) =>
      p.exceptions.map((e) => ({
        placementId: e.placementId,
        originalDate: toIsoDate(e.originalDate),
        action: e.action,
        newDate: e.newDate ? toIsoDate(e.newDate) : null,
        newStartOrder: e.newStartOrder,
        newEndOrder: e.newEndOrder,
        newRoomId: e.newRoomId,
        newInstructorId: e.newInstructorId ?? undefined,
      })),
    ),
  );

  // Zajete poza zakresem: terminy innych zajec w semestrze + MANUAL + zachowana przeszlosc.
  const outside = await prisma.occurrence.findMany({
    where: {
      termId: term.id,
      status: { not: 'CANCELLED' },
      OR: [
        { sectionId: { notIn: sectionIds } },
        { kind: 'MANUAL' },
        ...(from ? [{ kind: 'DERIVED' as const, date: { lt: from } }] : []),
      ],
    },
    include: { section: { include: sectionLabelInclude } },
  });
  const busy: BusySlot[] = outside.map((o) => ({
    date: toIsoDate(o.date),
    startOrder: o.startOrder,
    endOrder: o.endOrder,
    roomId: o.roomId,
    instructorId: o.instructorId,
    groupId: o.groupId,
    jointKey: o.jointKey,
    label: labelOf.get(o.sectionId) ?? o.section.programEntry.subject.name,
  }));

  const mat = materialize({
    sections: matSections,
    placements,
    exceptions,
    busy,
    groupsOverlap: await groupOverlapFn(),
    fromDate: opts.fromDate ?? null,
  });

  // Diff z obecnymi terminami DERIVED w zakresie (klucz: umieszczenie + data z wzorca).
  const existing = await prisma.occurrence.findMany({
    where: { sectionId: { in: sectionIds }, kind: 'DERIVED', ...(from ? { date: { gte: from } } : {}) },
  });
  const sig = (o: { date: string; startOrder: number; endOrder: number; roomId: string; instructorId: string | null; status: string }) =>
    `${o.date}|${o.startOrder}|${o.endOrder}|${o.roomId}|${o.instructorId}|${o.status}`;
  const before = new Map(
    existing.map((o) => [
      `${o.placementId}|${o.originalDate ? toIsoDate(o.originalDate) : toIsoDate(o.date)}`,
      sig({ ...o, date: toIsoDate(o.date) }),
    ]),
  );
  for (const o of mat.occurrences) {
    const key = `${o.placementId}|${o.originalDate}`;
    const old = before.get(key);
    if (old === undefined) report.added++;
    else if (old !== sig(o)) report.changed++;
    else report.unchanged++;
    before.delete(key);
  }
  report.removed = before.size;
  report.total = mat.occurrences.length;
  report.conflicts = mat.conflicts;
  report.beyondHours = mat.beyondHours.length;
  report.shortfalls = mat.shortfalls;
  report.orphanExceptions = mat.orphanExceptions.map((e) => ({
    section: labelOf.get(placementSection.get(e.placementId) ?? '') ?? '?',
    date: e.originalDate,
    action: e.action,
  }));

  if (!opts.dryRun) {
    const sectionById = new Map(sections.map((s) => [s.id, s]));
    await prisma.$transaction([
      prisma.occurrence.deleteMany({
        where: { sectionId: { in: sectionIds }, kind: 'DERIVED', ...(from ? { date: { gte: from } } : {}) },
      }),
      prisma.occurrence.createMany({
        data: mat.occurrences.map((o) => ({
          termId: term.id,
          facultyId: sectionById.get(o.sectionId)!.facultyId,
          sectionId: o.sectionId,
          placementId: o.placementId,
          originalDate: fromIsoDate(o.originalDate),
          date: fromIsoDate(o.date),
          startOrder: o.startOrder,
          endOrder: o.endOrder,
          roomId: o.roomId,
          instructorId: o.instructorId,
          groupId: o.groupId,
          kind: 'DERIVED' as const,
          status: o.status,
          jointKey: o.jointKey,
        })),
      }),
      prisma.termCalendar.updateMany({
        where: { id: { in: [...new Set(ctxs.map((c) => scope.calendars.get(c.cohort.id)!.id))] } },
        data: { lastGeneratedAt: new Date() },
      }),
    ]);
  }
  return report;
}
