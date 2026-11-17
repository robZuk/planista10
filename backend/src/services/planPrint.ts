import type { AcademicTerm, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { mondayOf, toIsoDate, type IsoDate } from '../lib/isoDate';
import { isActiveIn, pathFromRoot, ROOT, SPEC } from '../lib/groupTree';
import { materialize } from '../lib/materializer';
import { termLabel } from '../lib/terms';
import { semesterWeekOf } from '../lib/teachingCalendar';
import type { WeekdayName } from '../lib/timeGrid';
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
import { loadScope, type Scope } from './plan';
import { cohortLabel } from './cohorts';
import type { CohortContext } from './sections';

/**
 * Druk planu (PDF) rocznika (strony na grupy wykladowe albo wybrana grupa), prowadzacego albo sali.
 *
 * - Kalendarz tygodniowy (studia stacjonarne): jedna strona — plan tygodnia z wzorca
 *   (umieszczenia z rytmem: co tydzien, parzyste, od–do tygodnia).
 * - Kalendarz zjazdow (niestacjonarne): strona na zjazd z datami — to, co dalo by „Generuj
 *   terminy” z obecnego wzorca (materializer: limit godzin, przeniesienia) plus terminy reczne.
 *   Prowadzacy i sala maja zajecia z roznych kalendarzy, wiec ich strony ida po tygodniach.
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

export async function planPrint(term: AcademicTerm, subject: PrintSubject): Promise<PrintDocument> {
  const termName = termLabel(term);
  if (subject.kind === 'cohort') return cohortPrint(term, termName, subject.cohortId, subject.groupId ?? null);

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
  return { title: `${heading} — plan zajęć ${termName}`, termLabel: termName, pages };
}

/** Grupa jest przodkiem drugiej, potomkiem albo ta sama (sciezki od korzenia — jedna przedrostkiem drugiej). */
function sameLine(a: string, b: string, ctx: CohortContext): boolean {
  const pa = pathFromRoot(a, ctx.index).map((g) => g.id);
  const pb = pathFromRoot(b, ctx.index).map((g) => g.id);
  const n = Math.min(pa.length, pb.length);
  return pa.slice(0, n).every((id, i) => id === pb[i]);
}

/**
 * Grupy, dla ktorych drukujemy osobne strony: najglebsze grupy wykladowe (rocznik albo
 * specjalnosci) aktywne w semestrze — plan wywieszany dla studentow. Cwiczenia i laboratoria
 * grup podrzednych stoja obok siebie w torach. Wybrana grupa — tylko ona.
 */
function printUnits(ctx: CohortContext, groupId: string | null): string[] {
  if (groupId) return [groupId];
  const lecture = [...ctx.index.values()].filter((g) => isActiveIn(g, ctx.semester) && (g.partitionKey === ROOT || g.partitionKey === SPEC));
  const deepest = lecture.filter((g) => !lecture.some((o) => o.id !== g.id && sameLine(o.id, g.id, ctx) && pathFromRoot(o.id, ctx.index).length > pathFromRoot(g.id, ctx.index).length));
  return deepest.map((g) => g.id).sort((a, b) => ctx.nameOf(a).localeCompare(ctx.nameOf(b)));
}

async function cohortPrint(term: AcademicTerm, termName: string, cohortId: string, groupId: string | null): Promise<PrintDocument> {
  const collected = await collect(term, { cohortId });
  // Rocznik bez zajec nie trafil do zakresu zbieranych zajec — wczytujemy go wprost.
  const scope = collected.scope.contexts.length > 0 ? collected.scope : await loadScope(term, null, [cohortId]);
  const ctx = scope.contexts[0];
  if (!ctx) throw new AppError(404, 'Rocznik nie ma zajec w tym semestrze');
  const calendar = scope.calendars.get(cohortId);
  if (!calendar) throw new AppError(409, 'Rocznik nie ma kalendarza w tym semestrze');
  if (groupId && !ctx.index.has(groupId)) throw new AppError(400, 'Grupa nie nalezy do rocznika');

  const program = ctx.cohort.program;
  const mode = program.studyMode === 'PART_TIME' ? 'studia niestacjonarne' : 'studia stacjonarne';
  const about = `${program.fieldOfStudy.name}, ${mode} — ${cohortLabel(ctx.cohort)}`;
  const base = `${program.code} · semestr ${ctx.semester}`;
  const names = await namesOf([...collected.weekly, ...collected.dated]);
  const describe = (s: Slot): Line[] => [names.room(s.roomId), joinLines(groupOf(s), names.instructor(s.instructorId))];
  const units = printUnits(ctx, groupId);
  const pages: PrintPage[] = [];

  for (const unit of units) {
    // Plan grupy: jej zajecia, grup nadrzednych (wyklad rocznika) i jej podgrup (cwiczenia, laboratoria).
    const inUnit = (s: Slot) => sameLine(s.section.groupId, unit, ctx);
    const week = collected.weekly.filter(inUnit);
    const dates = collected.dated.filter(inUnit);
    const unitRoot = ctx.index.get(unit)?.partitionKey === ROOT;
    const heading = unitRoot && !groupId ? base : `${base} · ${ctx.nameOf(unit)}`;

    if (calendar.kind !== 'ZJAZD') {
      if (week.length === 0 && units.length > 1) continue;
      const days = scope.grids.get(cohortId)?.days.map((d) => d.day) ?? [];
      pages.push({
        heading,
        subheading: `${about}. Plan tygodnia ${fullDate(toIsoDate(calendar.startDate))}–${fullDate(toIsoDate(calendar.endDate))} — zajęcia co tydzień, chyba że opisano inaczej; dni wolne wg kalendarza roku akademickiego.`,
        columns: weekdayColumns([...days, ...week.map((s) => s.day)]),
        entries: week.map((s) => toEntry(s, s.day, [...describe(s), s.pattern])),
        emptyText: 'Brak ułożonych zajęć.',
      });
      continue;
    }

    // Zjazdy: strona na zjazd; kolumny — dni zjazdu, w ktore wydzial ma zajecia tego trybu.
    const modeDays = new Set<string>(scope.grids.get(cohortId)?.days.map((d) => d.day) ?? []);
    const teaching = scope.teaching.get(cohortId);
    const start = toIsoDate(calendar.startDate);
    const zjazdPages = [...calendar.zjazdy]
      .sort((a, b) => a.number - b.number)
      .map((z) => {
        const from = toIsoDate(z.startDate);
        const to = toIsoDate(z.endDate);
        const slots = dates.filter((s) => s.date >= from && s.date <= to);
        const days = datesBetween(from, to).filter((d) => modeDays.size === 0 || modeDays.has(weekdayName(d)) || slots.some((s) => s.date === d));
        return {
          heading,
          subheading: `${about}. Zjazd tydz. ${semesterWeekOf(from, start)}: ${shortDate(from)}–${fullDate(to)}`,
          // Swieto, przerwa albo dzien wolny w zjezdzie — opis w kolumnie (pusta kolumna wygladalaby na blad).
          columns: dateColumns(days).map((c) => {
            const info = teaching?.dayInfo(c.key);
            const off = info && !info.teaching && ['HOLIDAY', 'BREAK', 'DAY_OFF'].includes(info.reason ?? '');
            return off && !slots.some((s) => s.date === c.key) ? { ...c, closed: info.label ?? 'bez zajęć' } : c;
          }),
          entries: slots.map((s) => toEntry(s, s.date, describe(s))),
        };
      })
      .filter((p) => p.entries.length > 0);
    pages.push(...zjazdPages);
    // Terminy poza zjazdami (np. termin reczny w innym dniu) — po tygodniach na koncu grupy.
    const outside = dates.filter((s) => !calendar.zjazdy.some((z) => s.date >= toIsoDate(z.startDate) && s.date <= toIsoDate(z.endDate)));
    pages.push(...weekPages(heading, outside, describe, (range) => `${about}. Zajęcia poza zjazdami: ${range}`));
  }
  if (pages.length === 0) pages.push({ heading: base, subheading: about, columns: [], entries: [], emptyText: 'Brak ułożonych zajęć.' });
  const title = `${base}${groupId ? ` · ${ctx.nameOf(groupId)}` : ''} — plan zajęć ${termName}`;
  return { title, termLabel: termName, pages };
}
