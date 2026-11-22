import type { AcademicTerm, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { mondayOf, toIsoDate, type IsoDate } from '../lib/isoDate';
import { ROOT } from '../lib/groupTree';
import { materialize } from '../lib/materializer';
import { termLabel } from '../lib/terms';
import { semesterWeekOf } from '../lib/teachingCalendar';
import { toMinutes, type WeekdayName } from '../lib/timeGrid';
import {
  dateColumns,
  datesBetween,
  fullDate,
  shortDate,
  weekPatternLabel,
  weekdayColumns,
  weekdayName,
  type PrintDocument,
  type PrintEntry,
  type PrintPage,
} from '../lib/planPrint';
import {
  DAY_SHEET,
  DAY_SHORT,
  frameNotes,
  layoutDay,
  roman,
  rowLabel,
  sheetColumns,
  sheetDate,
  trimRows,
  updatedStamp,
  type SheetDay,
  type SheetDocument,
  type SheetItem,
  type SheetRow,
} from '../lib/planSheet';
import { loadScope, type Scope } from './plan';
import { studyYearOf } from './cohorts';
import type { CohortContext } from './sections';

/**
 * Druk planu (PDF).
 *
 * - Rocznik — arkusz dla studentow w ukladzie arkuszy WM (lib/planSheet, lib/planSheetPdf):
 *   stacjonarne — plan tygodnia z wzorca (umieszczenia), niestacjonarne — dni zjazdow z datami:
 *   to, co dalo by „Generuj terminy” z obecnego wzorca (materializer) plus terminy reczne.
 * - Prowadzacy i sala — plan na osi czasu (lib/planPrint, lib/planPdf): plan tygodnia stacjonarnych
 *   i strony po tygodniach z datami (zajecia z roznych kalendarzy).
 * Plan pokazuje stan wzorca, takze gdy terminow jeszcze nie wygenerowano.
 */

export type PrintSubject =
  | { kind: 'cohort'; cohortId: string; groupId?: string | null }
  | { kind: 'instructor'; instructorId: string }
  | { kind: 'room'; roomId: string };

const sectionInclude = {
  programEntry: { select: { subject: { select: { name: true } } } },
  placements: { include: { exceptions: true } },
} satisfies Prisma.ClassSectionInclude;

type PrintSection = Prisma.ClassSectionGetPayload<{ include: typeof sectionInclude }>;

/** Zajecie na stronie przed nadaniem opisu (opis zalezy od tego, czyj to plan). */
interface Slot {
  id: string;
  section: PrintSection;
  ctx: CohortContext;
  startMinute: number;
  endMinute: number;
  roomId: string | null;
  instructorId: string | null;
}
interface WeekSlot extends Slot {
  day: WeekdayName;
  pattern: string;
}
interface DateSlot extends Slot {
  date: IsoDate;
}

interface Collected {
  scope: Scope;
  weekly: WeekSlot[];
  dated: DateSlot[];
}

/** Umieszczenia (plan tygodnia) i terminy z dat (zjazdy) wybranych zajec. */
async function collect(term: AcademicTerm, sectionWhere: Prisma.ClassSectionWhereInput): Promise<Collected> {
  const sections = await prisma.classSection.findMany({ where: { termId: term.id, ...sectionWhere }, include: sectionInclude });
  const scope = await loadScope(term, null, [...new Set(sections.map((s) => s.cohortId))]);
  const ctxById = new Map(scope.contexts.map((c) => [c.cohort.id, c]));
  const weekly: WeekSlot[] = [];
  const zjazdSections: PrintSection[] = [];

  for (const s of sections) {
    const ctx = ctxById.get(s.cohortId);
    const calendar = scope.calendars.get(s.cohortId);
    const grids = scope.grids.get(s.cohortId);
    if (!ctx || !calendar || !grids) continue;
    if (calendar.kind === 'ZJAZD') {
      zjazdSections.push(s);
      continue;
    }
    for (const p of s.placements) {
      const time = grids.forDay(p.dayOfWeek).time.range(p.startOrder, p.endOrder);
      if (!time) continue;
      weekly.push({ id: p.id, section: s, ctx, day: p.dayOfWeek, ...time, roomId: p.roomId, instructorId: p.instructorId, pattern: weekPatternLabel(p) });
    }
  }

  const dated: DateSlot[] = [];
  if (zjazdSections.length > 0) {
    const sectionIds = zjazdSections.map((s) => s.id);
    const manual = await prisma.occurrence.findMany({ where: { sectionId: { in: sectionIds }, kind: 'MANUAL' } });
    const manualHours = new Map<string, number>();
    for (const m of manual) manualHours.set(m.sectionId, (manualHours.get(m.sectionId) ?? 0) + m.endOrder - m.startOrder + 1);
    const mat = materialize({
      sections: zjazdSections.map((s) => ({
        id: s.id,
        hours: s.hours,
        groupId: s.groupId,
        calendar: scope.teaching.get(s.cohortId)!,
        gridOf: (day) => scope.grids.get(s.cohortId)!.forDay(day).time,
        consumedHours: manualHours.get(s.id) ?? 0,
        label: s.id,
      })),
      placements: zjazdSections.flatMap((s) => s.placements),
      exceptions: zjazdSections.flatMap((s) =>
        s.placements.flatMap((p) =>
          p.exceptions.map((e) => ({
            placementId: e.placementId,
            originalDate: toIsoDate(e.originalDate),
            newDate: e.newDate ? toIsoDate(e.newDate) : null,
            newStartOrder: e.newStartOrder,
            newEndOrder: e.newEndOrder,
            newRoomId: e.newRoomId,
            newOnline: e.newOnline,
            newInstructorId: e.newInstructorId ?? undefined,
          })),
        ),
      ),
      busy: [],
      groupsOverlap: () => false,
      skipConflicts: true,
    });
    const byId = new Map(zjazdSections.map((s) => [s.id, s]));
    for (const o of mat.occurrences) {
      const s = byId.get(o.sectionId)!;
      dated.push({ id: `${o.placementId}|${o.originalDate}`, section: s, ctx: ctxById.get(s.cohortId)!, date: o.date, startMinute: o.startMinute, endMinute: o.endMinute, roomId: o.roomId, instructorId: o.instructorId });
    }
    for (const m of manual) {
      const s = byId.get(m.sectionId)!;
      dated.push({ id: m.id, section: s, ctx: ctxById.get(s.cohortId)!, date: toIsoDate(m.date), startMinute: m.startMinute, endMinute: m.endMinute, roomId: m.roomId, instructorId: m.instructorId });
    }
  }
  return { scope, weekly, dated };
}

/** Nazwy sal i prowadzacych wystepujacych na wydruku (takze z przeniesien terminow). */
async function namesOf(slots: Slot[]) {
  const roomIds = [...new Set(slots.flatMap((s) => (s.roomId ? [s.roomId] : [])))];
  const instructorIds = [...new Set(slots.flatMap((s) => (s.instructorId ? [s.instructorId] : [])))];
  const [rooms, instructors] = await Promise.all([
    prisma.room.findMany({ where: { id: { in: roomIds } }, include: { building: { select: { name: true } } } }),
    prisma.instructor.findMany({ where: { id: { in: instructorIds } } }),
  ]);
  // Pelna i krotka postac (waski kafelek): "s. 235 (Centrum Symulatorowe (WN))" / "s. 235",
  // "dr hab. inż. Tomasz Kozłowski" / "T. Kozłowski" (tytuly bywaja dluzsze niz nazwisko).
  const roomName = new Map(rooms.map((r) => [r.id, [`s. ${r.number} (${r.building.name})`, `s. ${r.number}`] as Line]));
  const personName = new Map(
    instructors.map((i) => [
      i.id,
      [`${i.title ?? ''} ${i.firstName} ${i.lastName}`.trim(), `${i.firstName.charAt(0)}. ${i.lastName}`] as Line,
    ]),
  );
  return {
    room: (id: string | null): Line => (id ? (roomName.get(id) ?? 'sala?') : 'on-line'),
    instructor: (id: string | null): Line => (id ? (personName.get(id) ?? '?') : 'NN'),
  };
}

/** Linia opisu kafelka: tekst albo para [pelna, krotka] — krotka, gdy pelna sie nie miesci. */
type Line = string | [string, string];
const fullOf = (l: Line) => (typeof l === 'string' ? l : l[0]);
const shortOf = (l: Line) => (typeof l === 'string' ? l : l[1]);
/** Polaczenie linii w jedna ("grupa · prowadzacy") z zachowaniem wersji krotkiej. */
const joinLines = (...parts: Line[]): Line => [parts.map(fullOf).join(' · '), parts.map(shortOf).join(' · ')];

const groupOf = (s: Slot) => s.ctx.nameOf(s.section.groupId);
const cohortGroupOf = (s: Slot) => `${s.ctx.cohort.program.code} s${s.ctx.semester} · ${groupOf(s)}`;

function toEntry(s: Slot, column: string, lines: Line[]): PrintEntry {
  const kept = lines.filter((l) => fullOf(l) !== '');
  return {
    id: s.id,
    column,
    startMinute: s.startMinute,
    endMinute: s.endMinute,
    classType: s.section.classType,
    title: s.section.programEntry.subject.name,
    lines: kept.map(fullOf),
    compactLines: kept.map(shortOf),
  };
}

/** Strony z dat zgrupowanych po tygodniach (prowadzacy, sala). */
function weekPages(heading: string, dated: DateSlot[], describe: (s: DateSlot) => Line[], subheadingOf: (range: string) => string): PrintPage[] {
  const byWeek = new Map<IsoDate, DateSlot[]>();
  for (const s of dated) byWeek.set(mondayOf(s.date), [...(byWeek.get(mondayOf(s.date)) ?? []), s]);
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, slots]) => {
      const dates = [...new Set(slots.map((s) => s.date))].sort();
      const range = dates.length > 1 ? `${shortDate(dates[0]!)}–${fullDate(dates[dates.length - 1]!)}` : fullDate(dates[0]!);
      return {
        heading,
        subheading: subheadingOf(range),
        columns: dateColumns(dates),
        entries: slots.map((s) => toEntry(s, s.date, describe(s))),
      };
    });
}

/** Wydruk: arkusz dla studentow (rocznik) albo plan na osi czasu (prowadzacy, sala). */
export type PlanPrint = { kind: 'sheet'; document: SheetDocument } | { kind: 'timeline'; document: PrintDocument };

export async function planPrint(term: AcademicTerm, subject: PrintSubject): Promise<PlanPrint> {
  const termName = termLabel(term);
  if (subject.kind === 'cohort') return { kind: 'sheet', document: await sheetPrint(term, termName, subject.cohortId, subject.groupId ?? null) };

  const isRoom = subject.kind === 'room';
  const touch: Prisma.PlacementWhereInput = isRoom
    ? { OR: [{ roomId: subject.roomId }, { exceptions: { some: { newRoomId: subject.roomId } } }] }
    : { OR: [{ instructorId: subject.instructorId }, { exceptions: { some: { newInstructorId: subject.instructorId } } }] };
  const occurrenceTouch: Prisma.OccurrenceWhereInput = isRoom ? { roomId: subject.roomId } : { instructorId: subject.instructorId };

  let heading: string;
  if (isRoom) {
    const room = await prisma.room.findUnique({ where: { id: subject.roomId }, include: { building: { select: { name: true } } } });
    if (!room) throw new AppError(404, 'Sala nie znaleziona');
    heading = `Sala ${room.number} — ${room.building.name}`;
  } else {
    const person = await prisma.instructor.findUnique({ where: { id: subject.instructorId } });
    if (!person) throw new AppError(404, 'Prowadzacy nie znaleziony');
    heading = `${person.title ?? ''} ${person.firstName} ${person.lastName}`.trim();
  }

  const { weekly, dated } = await collect(term, {
    OR: [{ placements: { some: touch } }, { occurrences: { some: { kind: 'MANUAL', ...occurrenceTouch } } }],
  });
  const mine = (s: Slot) => (isRoom ? s.roomId === subject.roomId : s.instructorId === subject.instructorId);
  const week = weekly.filter(mine);
  const dates = dated.filter(mine);
  const names = await namesOf([...week, ...dates]);
  const describe = (s: Slot): Line[] => [isRoom ? names.instructor(s.instructorId) : names.room(s.roomId), cohortGroupOf(s)];

  const pages: PrintPage[] = [];
  if (week.length > 0) {
    pages.push({
      heading,
      subheading: 'Plan tygodnia — studia stacjonarne — zajęcia co tydzień, chyba że opisano inaczej',
      columns: weekdayColumns(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', ...week.map((s) => s.day)]),
      entries: week.map((s) => toEntry(s, s.day, [...describe(s), s.pattern])),
    });
  }
  pages.push(...weekPages(heading, dates, describe, (range) => `Studia niestacjonarne — zajęcia ${range}`));
  if (pages.length === 0) pages.push({ heading, subheading: '', columns: [], entries: [], emptyText: 'Brak zajęć w tym semestrze.' });
  return { kind: 'timeline', document: { title: `${heading} — plan zajęć ${termName}`, termLabel: termName, pages } };
}

/** Liczebnosc rocznika (grupa ROOT) — kolejnosc rocznikow na arkuszu: najwieksze z lewej. */
const cohortSize = (ctx: CohortContext) => ctx.cohort.groups.find((g) => g.partitionKey === ROOT)?.size ?? 0;

/**
 * Arkusz planu dla studentow (uklad arkuszy WM — lib/planSheet): roczniki wydzialu w tym samym
 * trybie i stopniu; stacjonarne — tylko ten sam semestr programu (arkusz "1 rok - I sem."),
 * niestacjonarne — wszystkie lata razem, wiersze na kazdy dzien zjazdow. Rocznik wybrany jest na
 * arkuszu zawsze, pozostale — gdy maja cos w planie. Filtr grupy: tylko ten rocznik i kolumny grupy.
 */
async function sheetPrint(term: AcademicTerm, termName: string, cohortId: string, groupId: string | null): Promise<SheetDocument> {
  const cohort = await prisma.cohort.findUnique({ where: { id: cohortId }, include: { program: { include: { fieldOfStudy: true } } } });
  if (!cohort) throw new AppError(404, 'Rocznik nie znaleziony');
  const program = cohort.program;
  const mode = program.studyMode;
  const fullTime = mode === 'FULL_TIME';
  const scope = await loadScope(term, program.fieldOfStudy.facultyId);
  const selected = scope.contexts.find((c) => c.cohort.id === cohortId);
  if (!selected) throw new AppError(404, 'Rocznik nie ma zajec w tym semestrze');
  if (!scope.calendars.has(cohortId)) throw new AppError(409, 'Rocznik nie ma kalendarza w tym semestrze');
  if (groupId && !selected.index.has(groupId)) throw new AppError(400, 'Grupa nie nalezy do rocznika');
  const grids = scope.grids.get(cohortId)!;

  const candidates = groupId
    ? [selected]
    : scope.contexts.filter(
        (c) =>
          scope.calendars.has(c.cohort.id) &&
          c.cohort.program.studyMode === mode &&
          c.cohort.program.degreeLevel === program.degreeLevel &&
          (!fullTime || c.semester === selected.semester),
      );
  const { weekly, dated } = await collect(term, { cohortId: { in: candidates.map((c) => c.cohort.id) } });
  const slots: Slot[] = [...weekly, ...dated];
  const planned = new Set(slots.map((s) => s.ctx.cohort.id));
  const cohorts = candidates
    .filter((c) => c.cohort.id === cohortId || planned.has(c.cohort.id))
    .sort(
      (a, b) =>
        (fullTime ? 0 : a.semester - b.semester) ||
        cohortSize(b) - cohortSize(a) ||
        a.cohort.program.fieldOfStudy.shortName.localeCompare(b.cohort.program.fieldOfStudy.shortName),
    );
  const onSheet = new Set(cohorts.map((c) => c.cohort.id));

  // Kilka programow jednego kierunku na arkuszu (MIBM-S1 i ESO-S1 to oba "MiBM") — program, ktorego
  // kod nie jest skrotem kierunku, podpisujemy przedrostkiem kodu ("ESO").
  const programsOf = new Map<string, Set<string>>();
  for (const c of cohorts) {
    const short = c.cohort.program.fieldOfStudy.shortName;
    programsOf.set(short, (programsOf.get(short) ?? new Set()).add(c.cohort.program.id));
  }
  const shortName = (c: CohortContext) => {
    const field = c.cohort.program.fieldOfStudy.shortName;
    const prefix = c.cohort.program.code.split('-')[0] ?? field;
    return (programsOf.get(field)?.size ?? 0) > 1 && prefix.toLowerCase() !== field.toLowerCase() ? prefix : field;
  };

  const columns = sheetColumns(
    cohorts.map((c) => {
      const field = c.cohort.program.fieldOfStudy;
      return {
        id: c.cohort.id,
        band: fullTime ? shortName(c) : `${studyYearOf(c.semester)} rok/${c.semester} sem.`,
        fieldShort: shortName(c),
        semester: c.semester,
        index: c.index,
        specShort: (id: string | null | undefined) => field.specializations.find((s) => s.id === id)?.shortName ?? null,
        onlyGroupId: groupId,
      };
    }),
    mode,
  );

  // Sala sam numer (on-line — bez sali), prowadzacy samo nazwisko (NN — puste).
  const mine = slots.filter((s) => onSheet.has(s.ctx.cohort.id));
  const roomIds = [...new Set(mine.flatMap((s) => (s.roomId ? [s.roomId] : [])))];
  const personIds = [...new Set(mine.flatMap((s) => (s.instructorId ? [s.instructorId] : [])))];
  const [rooms, people] = await Promise.all([
    prisma.room.findMany({ where: { id: { in: roomIds } }, select: { id: true, number: true } }),
    prisma.instructor.findMany({ where: { id: { in: personIds } }, select: { id: true, lastName: true } }),
  ]);
  const roomOf = new Map(rooms.map((r) => [r.id, r.number]));
  const personOf = new Map(people.map((p) => [p.id, p.lastName]));
  const toItem = (s: Slot, pattern: string): SheetItem => ({
    id: s.id,
    cohortId: s.ctx.cohort.id,
    groupId: s.section.groupId,
    startMinute: s.startMinute,
    endMinute: s.endMinute,
    subject: s.section.programEntry.subject.name,
    classType: s.section.classType,
    room: s.roomId ? (roomOf.get(s.roomId) ?? '?') : '',
    person: s.instructorId ? (personOf.get(s.instructorId) ?? '') : '',
    pattern,
  });

  // Wiersze dnia: bloki siatki obowiazujacej w tym dniu, w oknie godzin dnia zajec.
  const window = new Map(grids.days.map((d) => [d.day, d]));
  const rowsOf = (day: WeekdayName): SheetRow[] => {
    const w = window.get(day);
    const from = w?.from ? toMinutes(w.from) : 0;
    const to = w?.to ? toMinutes(w.to) : 24 * 60;
    return grids
      .forDay(day)
      .time.blocks.map((b) => ({ startMinute: toMinutes(b.startTime), endMinute: toMinutes(b.endTime) }))
      .filter((b) => b.startMinute >= from && b.endMinute <= to)
      .map((b) => ({ ...b, label: rowLabel(b.startMinute, mode) }));
  };

  const days: SheetDay[] = [];
  if (fullTime) {
    const items = weekly.filter((s) => onSheet.has(s.ctx.cohort.id)).map((s) => ({ day: s.day, item: toItem(s, s.pattern) }));
    const fallback = items.length > 0
      ? { from: Math.min(...items.map((i) => i.item.startMinute)), to: Math.max(...items.map((i) => i.item.endMinute)) }
      : undefined;
    const weekdays = weekdayColumns([...grids.days.map((d) => d.day), ...items.map((i) => i.day)]).map((c) => c.key as WeekdayName);
    for (const day of weekdays) {
      const dayItems = items.filter((i) => i.day === day).map((i) => i.item);
      const rows = trimRows(rowsOf(day), dayItems, fallback);
      days.push({ key: day, label: DAY_SHORT[day] ?? day, rows, greyIdle: false, layout: layoutDay(columns, rows, dayItems) });
    }
  } else {
    const items = dated.filter((s) => onSheet.has(s.ctx.cohort.id)).map((s) => ({ date: s.date, item: toItem(s, '') }));
    const modeDays = new Set<string>(grids.days.map((d) => d.day));
    const dates = new Set<IsoDate>(items.map((i) => i.date));
    for (const c of cohorts) {
      for (const z of scope.calendars.get(c.cohort.id)?.zjazdy ?? []) {
        for (const d of datesBetween(toIsoDate(z.startDate), toIsoDate(z.endDate))) if (modeDays.has(weekdayName(d))) dates.add(d);
      }
    }
    const start = toIsoDate(scope.calendars.get(cohortId)!.startDate);
    for (const date of [...dates].sort()) {
      const dayItems = items.filter((i) => i.date === date).map((i) => i.item);
      const infos = cohorts.map((c) => scope.teaching.get(c.cohort.id)?.dayInfo(date));
      const closed = dayItems.length === 0 && !infos.some((i) => i?.teaching) ? (infos.find((i) => i?.label)?.label ?? 'bez zajęć') : undefined;
      const rows = closed ? [] : rowsOf(weekdayName(date));
      days.push({
        key: date,
        label: DAY_SHEET[weekdayName(date)] ?? date,
        sublabel: sheetDate(date),
        week: `tydz: ${semesterWeekOf(date, start)}`,
        rows,
        closed,
        greyIdle: true,
        layout: layoutDay(columns, rows, dayItems),
      });
    }
  }

  const degree = program.degreeLevel === 'MASTER' ? 2 : 1;
  const base = fullTime
    ? `${studyYearOf(selected.semester)} rok - ${roman(selected.semester)} sem. - studia ${degree} stopnia - stacjonarne`
    : `Studia ${degree} stopnia - niestacjonarne`;
  const title = groupId ? `${base} - ${program.code} ${selected.nameOf(groupId)}` : base;
  const changed = mine.flatMap((s) => s.section.placements.map((p) => p.updatedAt.getTime()));
  return {
    title,
    updated: updatedStamp(changed.length > 0 ? new Date(Math.max(...changed)) : new Date()),
    termLabel: termName,
    mode,
    headLabels: fullTime ? ['specjalność', 'grupa'] : ['rok', 'grupa'],
    columns,
    days,
    notes: frameNotes(columns, days),
  };
}
