import type { AcademicTerm, DayOfWeek, Prisma, TermCalendar } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { fromIsoDate, toIsoDate, type IsoDate } from '../lib/isoDate';
import { calendarPeriods, expandDates, semesterWeekOf, TeachingCalendar } from '../lib/teachingCalendar';
import { groupsOverlap, indexGroups, pathFromRoot } from '../lib/groupTree';
import { roomTypeMap } from '../lib/scheduleTime';
import { dayWindowProblem, formatMinutes, mapRangeByTime, minutesOverlap, weekdayLabel, type GridTime, type MinuteRange, type WeekdayName } from '../lib/timeGrid';
import { gridFor, loadGrids, pickGrid, type FacultyGrids } from './timeGrids';

/** Bloki obowiazujace w danym dniu tygodnia (siatka dnia albo podstawowa) — dla materializera. */
const gridOfDay = (grids: FacultyGrids) => (day: WeekdayName) => grids.forDay(day).time;
import {
  findConflict,
  materialize,
  type BusySlot,
  type MatException,
  type MatPlacement,
  type MatSection,
} from '../lib/materializer';
import { diffOccurrences, type DerivedRow } from '../lib/occurrenceDiff';
import { toCalendarInput } from './termCalendars';
import { calendarFor, calendarsFor, type CalendarRow } from './cohortCalendar';
import { activeCohorts, type CohortContext } from './sections';
import { cohortLabel, toTreeGroup } from './cohorts';
import { calendarFingerprint, staleReasonsByCohort } from './staleness';
import { sectionIssues } from '../lib/planIssues';
import { externalBusySlots } from '../lib/externalBusy';

/**
 * Plan semestru (nowy model). Umieszczenia uklada planista; terminy liczy generowanie:
 * dopoki kalendarz rocznika jest "w przygotowaniu", po kazdej zmianie planu samo
 * (refreshPlanningTerms), a w opublikowanym — tylko przyciskiem "Generuj terminy".
 * Kolizje sprawdzamy na konkretnych datach w calej uczelni: sala, prowadzacy i grupy
 * (regula nakladania z lib/groupTree).
 */

const CLASS_LETTER: Record<string, string> = { LECTURE: 'W', EXERCISE: 'C', LAB: 'L', PROJECT: 'P', SEMINAR: 'S' };

// ─── Kalendarz rocznika ──────────────────────────────────────

// Kalendarz rocznika: services/cohortCalendar (uzywany tez przez zajecia).
export { calendarFor, calendarsFor, type CalendarRow } from './cohortCalendar';

/**
 * Plan uklada sie tylko z zatwierdzonej wersji programu. Wersja w projekcie (takze cofnieta
 * do projektu w trakcie planowania) blokuje zapisy planu rocznika do ponownego zatwierdzenia.
 */
export function assertVersionApproved(cohort: {
  programVersion: { label: string; status: string };
  program: { code: string };
  startTerm: { startYear: number; type: 'WINTER' | 'SUMMER' };
  name?: string | null;
}) {
  if (cohort.programVersion.status === 'DRAFT') {
    throw new AppError(
      409,
      `Wersja programu "${cohort.programVersion.label}" rocznika ${cohortLabel(cohort)} jest w projekcie — zatwierdz ja, zeby ukladac plan`,
    );
  }
}

/**
 * Zajecia, obsada i plan rocznika w semestrze sa tylko do odczytu, gdy jego kalendarz jest
 * w archiwum. Rocznik spoza semestru albo bez kalendarza — nie ma czego chronic.
 * `what` konczy komunikat: "... jest w archiwum — obsada tylko do odczytu".
 */
export async function assertCohortTermWritable(term: AcademicTerm, cohortId: string, what: string): Promise<void> {
  const [ctx] = await activeCohorts(term, null, [cohortId]);
  if (!ctx) return;
  const calendar = await calendarFor(term, ctx);
  if (calendar?.status === 'ARCHIVED') {
    throw new AppError(409, `Kalendarz rocznika ${cohortLabel(ctx.cohort)} jest w archiwum — ${what} tylko do odczytu`);
  }
}

/** Ile planu stoi na kalendarzu: roczniki, ktore z niego korzystaja, ich umieszczenia i terminy. */
export interface CalendarUsage {
  /** Roczniki semestru, ktorych kalendarzem jest ten (wybrany w Rocznikach albo domyslny). */
  cohorts: number;
  /** Roczniki z planem (umieszczenia albo terminy) na tym kalendarzu. */
  cohortsWithPlan: number;
  placements: number;
  occurrences: number;
}

/** Roczniki semestru, ktorych kalendarzem jest ten (wybrany w Rocznikach albo domyslny wydzialu). */
export async function cohortIdsOfCalendar(
  term: AcademicTerm,
  calendar: Pick<TermCalendar, 'id' | 'facultyId' | 'studyMode'>,
): Promise<string[]> {
  const contexts = (await activeCohorts(term, calendar.facultyId)).filter((c) => c.cohort.program.studyMode === calendar.studyMode);
  const chosen = await calendarsFor(term, contexts);
  return contexts.filter((c) => chosen.get(c.cohort.id)?.id === calendar.id).map((c) => c.cohort.id);
}

export async function calendarUsage(calendar: Pick<TermCalendar, 'id' | 'termId' | 'facultyId' | 'studyMode'>): Promise<CalendarUsage> {
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: calendar.termId } });
  const cohortIds = await cohortIdsOfCalendar(term, calendar);
  if (cohortIds.length === 0) return { cohorts: 0, cohortsWithPlan: 0, placements: 0, occurrences: 0 };
  const ofCohorts = { termId: term.id, section: { cohortId: { in: cohortIds } } };
  const [placements, occurrences, cohortsWithPlan] = await Promise.all([
    prisma.placement.count({ where: ofCohorts }),
    prisma.occurrence.count({ where: ofCohorts }),
    prisma.cohort.count({
      where: {
        id: { in: cohortIds },
        sections: { some: { termId: term.id, OR: [{ placements: { some: {} } }, { occurrences: { some: {} } }] } },
      },
    }),
  ]);
  return { cohorts: cohortIds.length, cohortsWithPlan, placements, occurrences };
}

/**
 * Umieszczenia "na wybranych zjazdach/tygodniach" rocznikow tego kalendarza, ktorych numerow
 * kalendarz juz nie ma (np. usuniety zjazd, krotszy semestr). Zapis kalendarza nie jest
 * blokowany — zwracamy liczbe i numery do ostrzezenia; plan pokazuje je jako niezgodnosc.
 */
export async function placementsWithMissingPeriods(
  calendar: Parameters<typeof toCalendarInput>[0] & Pick<TermCalendar, 'id' | 'termId' | 'facultyId' | 'studyMode'>,
): Promise<{ placements: number; numbers: number[] }> {
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: calendar.termId } });
  const contexts = (await activeCohorts(term, calendar.facultyId)).filter((c) => c.cohort.program.studyMode === calendar.studyMode);
  const chosen = await calendarsFor(term, contexts);
  const cohortIds = contexts.filter((c) => chosen.get(c.cohort.id)?.id === calendar.id).map((c) => c.cohort.id);
  if (cohortIds.length === 0) return { placements: 0, numbers: [] };
  const listed = await prisma.placement.findMany({
    where: { termId: term.id, pattern: 'LIST', section: { cohortId: { in: cohortIds } } },
    select: { cycle: true, numbers: true },
  });
  const input = toCalendarInput(calendar);
  const zjazdy = new Set(input.zjazdy.map((z) => z.number));
  const weeks = new Set(
    new TeachingCalendar(input)
      .teachingWeeks()
      .map((w) => w.index)
      .filter((i): i is number => i !== null),
  );
  const missing = new Set<number>();
  let placements = 0;
  for (const p of listed) {
    const known = p.cycle === 'ZJAZD' ? zjazdy : weeks;
    const lost = p.numbers.filter((n) => !known.has(n));
    if (lost.length > 0) {
      placements++;
      lost.forEach((n) => missing.add(n));
    }
  }
  return { placements, numbers: [...missing].sort((a, b) => a - b) };
}

/**
 * Zajecia laczone (wspolny jointKey) moga laczyc wydzialy o roznych siatkach godzin — dziela
 * rzeczywisty czas, nie numery blokow. Nowe umieszczenie dolacza w tym samym dniu i godzinach;
 * zmiana istniejacego przenosi pozostale umieszczenia po godzinach, wiec te godziny musza
 * istniec w ich siatkach.
 */
export async function jointProblems(term: AcademicTerm, input: PlacementInput, grid: GridTime, time: MinuteRange, excludeId?: string): Promise<string[]> {
  const joined = await prisma.placement.findMany({
    where: { termId: term.id, jointKey: input.jointKey, ...(excludeId ? { id: { not: excludeId } } : {}) },
    include: { section: { include: sectionLabelInclude } },
  });
  if (joined.length === 0) return [];
  const grids = await loadGrids();
  const ctxs = new Map((await activeCohorts(term, null, [...new Set(joined.map((j) => j.section.cohortId))])).map((c) => [c.cohort.id, c]));
  const problems: string[] = [];
  for (const j of joined) {
    const ctx = ctxs.get(j.section.cohortId);
    const other = ctx && pickGrid(grids, ctx.cohort.program.fieldOfStudy.facultyId, ctx.cohort.program.studyMode);
    const label = ctx ? `${ctx.cohort.program.code}: ${j.section.programEntry.subject.name}` : j.section.programEntry.subject.name;
    if (!other) {
      problems.push(`Zajecia laczone: ${label} — brak siatki godzin wydzialu`);
      continue;
    }
    if (excludeId) {
      if (!mapRangeByTime(grid, other.forDay(input.dayOfWeek).time, input.startOrder, input.endOrder)) {
        problems.push(`Zajecia laczone: godzin ${formatMinutes(time.startMinute)}-${formatMinutes(time.endMinute)} nie ma w siatce wydzialu dla ${label}`);
      }
      continue;
    }
    const jt = other.forDay(j.dayOfWeek).time.range(j.startOrder, j.endOrder);
    if (j.dayOfWeek !== input.dayOfWeek || !jt || jt.startMinute !== time.startMinute || jt.endMinute !== time.endMinute) {
      problems.push(
        `Zajecia laczone "${input.jointKey}" (${label}) sa w ${weekdayLabel(j.dayOfWeek)} ${jt ? `${formatMinutes(jt.startMinute)}-${formatMinutes(jt.endMinute)}` : '?'} — umiesc w tym samym czasie`,
      );
    }
  }
  return problems;
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
  /** null = zajecia online (bez sali). */
  roomId: string | null;
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

export interface Scope {
  contexts: CohortContext[];
  calendars: Map<string, CalendarRow>; // cohortId -> kalendarz
  teaching: Map<string, TeachingCalendar>; // cohortId -> kalendarz zajec
  grids: Map<string, FacultyGrids>; // cohortId -> siatki godzin wydzialu i trybu rocznika (bloki per dzien)
}

export async function loadScope(term: AcademicTerm, facultyId: string | null, cohortIds?: string[]): Promise<Scope> {
  const contexts = await activeCohorts(term, facultyId, cohortIds);
  const calendars = new Map<string, CalendarRow>();
  const teaching = new Map<string, TeachingCalendar>();
  const grids = new Map<string, FacultyGrids>();
  const [facultyGrids, cohortCalendars] = await Promise.all([loadGrids(), calendarsFor(term, contexts)]);
  for (const ctx of contexts) {
    const calendar = cohortCalendars.get(ctx.cohort.id);
    if (!calendar) continue;
    const grid = pickGrid(facultyGrids, ctx.cohort.program.fieldOfStudy.facultyId, ctx.cohort.program.studyMode);
    if (!grid) continue;
    calendars.set(ctx.cohort.id, calendar);
    teaching.set(ctx.cohort.id, new TeachingCalendar(toCalendarInput(calendar)));
    grids.set(ctx.cohort.id, grid);
  }
  return { contexts, calendars, teaching, grids };
}

export interface OccupancyOptions {
  /** Pomin umieszczenie (zapis jego nowej wersji). */
  excludePlacementId?: string;
  /** Pomin wiele umieszczen naraz (przepiecie prowadzacych z listy — services/planStaff). */
  excludePlacementIds?: string[];
  /** Pomin jeden termin wzorca: "placementId|originalDate" (przenoszony termin). */
  excludePatternKey?: string;
  /** Pomin termin reczny lub osierocony o tym id. */
  excludeOccurrenceId?: string;
  /** Pomin wzorce i osierocone terminy tych rocznikow (generowanie liczy je samo). */
  excludeCohortIds?: string[];
  /**
   * Dolacz tez wygenerowane terminy wzorcow (poziom terminow): gdy wzorzec zmieniono, a terminow
   * jeszcze nie przeliczono, stare terminy sa tym, co dzis widza studenci.
   */
  includeGenerated?: boolean;
  /**
   * Tylko zajetosc, ktora moze kolidowac z tym rocznikiem, sala i prowadzacym (podpowiedz
   * wolnych godzin, zapis umieszczenia, zmiana terminu). Grupy koliduja tylko w obrebie rocznika,
   * wiec zajecia innych rocznikow rozpisujemy tylko, gdy ich wzorzec albo wyjatek dotyczy tej
   * sali lub tego prowadzacego. Dla tych zasobow wynik jest taki sam jak bez filtra — a liczymy
   * kilkadziesiat zajec zamiast wszystkich w uczelni.
   */
  relevantTo?: { cohortId: string; roomId?: string | null; instructorId?: string | null };
  /**
   * Sprawdzanie wzorca tego rocznika (zapis umieszczenia, podpowiedz): pomin jego terminy
   * z usunietych umieszczen. "Generuj terminy" usuwa wszystkie wygenerowane terminy rocznika
   * i tworzy je od nowa z wzorca, wiec te terminy znikna, zanim nowy wzorzec da terminy —
   * nie moga z nim kolidowac (inaczej usuniete umieszczenie blokuje wlasne miejsce).
   * Terminy z usunietych umieszczen innych rocznikow dalej sa zajetoscia.
   */
  patternOfCohortId?: string;
  /** Bez zajetosci zewnetrznych (sprawdzanie samej zajetosci zewnetrznej z planem). */
  skipExternal?: boolean;
  /**
   * Tylko zajetosc tych sal i prowadzacych (bez grup) — kolizje zajetosci zewnetrznych z planem.
   * Jak `relevantTo` bez rocznika: rozpisujemy tylko zajecia, ktorych wzorzec albo wyjatek
   * dotyczy tych zasobow, wiec wynik dla nich jest taki sam jak bez filtra.
   */
  onlyResources?: { roomIds: string[]; instructorIds: string[] };
}

/**
 * Zajetosc semestru w calej uczelni — jeden zbior dla wzorca i terminow:
 *  - wzorce wszystkich wydzialow rozpisane na daty kalendarzy rocznikow, z naniesionymi
 *    przeniesieniami pojedynczych terminow i limitem godzin — dokladnie to, co dalo by
 *    "Generuj terminy" (materializer bez sprawdzania kolizji),
 *  - terminy reczne,
 *  - terminy wygenerowane z usunietych umieszczen (zyja do ponownego generowania),
 *  - opcjonalnie wszystkie wygenerowane terminy (includeGenerated — poziom terminow),
 *  - zajetosci zewnetrzne prowadzacych i sal (zajecia innych wydzialow zgloszone mailem).
 * Czas w minutach — siatki wydzialow sie roznia.
 */
export async function termOccupancy(term: AcademicTerm, opts: OccupancyOptions = {}): Promise<BusySlot[]> {
  const scope = await loadScope(term, null);
  const skip = new Set(opts.excludeCohortIds ?? []);
  const skipPlacements = new Set([...(opts.excludePlacementIds ?? []), ...(opts.excludePlacementId ? [opts.excludePlacementId] : [])]);
  const ctxById = new Map(scope.contexts.map((c) => [c.cohort.id, c]));
  const cohortIds = scope.contexts.map((c) => c.cohort.id).filter((id) => scope.teaching.has(id) && !skip.has(id));
  const rel = opts.relevantTo;
  // Umieszczenia dotykajace sali / prowadzacego — takze przez wyjatek (termin przeniesiony do tej sali).
  const touches: Prisma.PlacementWhereInput[] = [];
  if (rel?.roomId) touches.push({ roomId: rel.roomId }, { exceptions: { some: { newRoomId: rel.roomId } } });
  if (rel?.instructorId) touches.push({ instructorId: rel.instructorId }, { exceptions: { some: { newInstructorId: rel.instructorId } } });
  const only = opts.onlyResources;
  if (only) {
    const rooms = { in: only.roomIds };
    const instructors = { in: only.instructorIds };
    touches.push({ roomId: rooms }, { exceptions: { some: { newRoomId: rooms } } }, { instructorId: instructors }, { exceptions: { some: { newInstructorId: instructors } } });
  }
  const sectionRelevant: Prisma.ClassSectionWhereInput = rel
    ? { OR: [{ cohortId: rel.cohortId }, ...(touches.length ? [{ placements: { some: { OR: touches } } }] : [])] }
    : only
      ? { placements: { some: { OR: touches } } }
      : {};
  const occurrenceRelevant: Prisma.OccurrenceWhereInput = rel
    ? {
        OR: [
          { section: { cohortId: rel.cohortId } },
          ...(rel.roomId ? [{ roomId: rel.roomId }] : []),
          ...(rel.instructorId ? [{ instructorId: rel.instructorId }] : []),
        ],
      }
    : only
      ? { OR: [{ roomId: { in: only.roomIds } }, { instructorId: { in: only.instructorIds } }] }
      : {};

  // Zajetosci zewnetrzne koliduja tylko sala i prowadzacym — przy filtrze tylko te dwa zasoby.
  const externalRelevant: Prisma.ExternalBusyWhereInput = rel
    ? {
        OR: [
          ...(rel.roomId ? [{ roomId: rel.roomId }] : []),
          ...(rel.instructorId ? [{ instructorId: rel.instructorId }] : []),
        ],
      }
    : {};
  const wantExternal = !opts.skipExternal && (!rel || !!rel.roomId || !!rel.instructorId);

  const [sections, manual, orphans, external] = await Promise.all([
    prisma.classSection.findMany({
      where: { termId: term.id, cohortId: { in: cohortIds }, placements: { some: {} }, ...sectionRelevant },
      include: { ...sectionLabelInclude, placements: { include: { exceptions: true } } },
    }),
    prisma.occurrence.findMany({
      where: { termId: term.id, kind: 'MANUAL' },
      include: { section: { include: sectionLabelInclude } },
    }),
    prisma.occurrence.findMany({
      where: {
        termId: term.id,
        kind: 'DERIVED',
        section: { cohortId: { notIn: [...skip] } },
        ...(opts.includeGenerated ? {} : { placementId: null }),
        ...occurrenceRelevant,
      },
      include: { section: { include: sectionLabelInclude } },
    }),
    wantExternal ? prisma.externalBusy.findMany({ where: { termId: term.id, ...externalRelevant } }) : Promise.resolve([]),
  ]);

  const labelOf = (s:{ cohortId: string; groupId: string; classType: string; programEntry: { subject: { name: string } } }) => {
    const ctx = ctxById.get(s.cohortId);
    return ctx
      ? `${ctx.cohort.program.code} s${ctx.semester}: ${sectionLabel(s.programEntry.subject.name, s.classType, ctx.nameOf(s.groupId))}`
      : s.programEntry.subject.name;
  };
  const manualHours = new Map<string, number>();
  for (const m of manual) manualHours.set(m.sectionId, (manualHours.get(m.sectionId) ?? 0) + m.endOrder - m.startOrder + 1);

  const mat = materialize({
    sections: sections.map((s) => ({
      id: s.id,
      hours: s.hours,
      groupId: s.groupId,
      calendar: scope.teaching.get(s.cohortId)!,
      gridOf: gridOfDay(scope.grids.get(s.cohortId)!),
      consumedHours: manualHours.get(s.id) ?? 0,
      label: s.id,
    })),
    placements: sections.flatMap((s) => s.placements.filter((p) => !skipPlacements.has(p.id)).map(toMatPlacement)),
    exceptions: sections.flatMap((s) =>
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

  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const busy: BusySlot[] = mat.occurrences
    .filter((o) => `${o.placementId}|${o.originalDate}` !== opts.excludePatternKey)
    .map((o) => ({
      date: o.date,
      startMinute: o.startMinute,
      endMinute: o.endMinute,
      roomId: o.roomId,
      instructorId: o.instructorId,
      groupId: o.groupId,
      jointKey: o.jointKey,
      label: labelOf(sectionById.get(o.sectionId)!),
    }));
  for (const o of [...manual, ...orphans]) {
    if (o.id === opts.excludeOccurrenceId) continue;
    if (o.placementId && o.originalDate && `${o.placementId}|${toIsoDate(o.originalDate)}` === opts.excludePatternKey) continue;
    if (o.placementId && skipPlacements.has(o.placementId)) continue;
    if (opts.patternOfCohortId && o.kind === 'DERIVED' && !o.placementId && o.section.cohortId === opts.patternOfCohortId) continue;
    busy.push({
      date: toIsoDate(o.date),
      startMinute: o.startMinute,
      endMinute: o.endMinute,
      roomId: o.roomId,
      instructorId: o.instructorId,
      groupId: o.groupId,
      jointKey: o.jointKey,
      label: `${labelOf(o.section)}${o.kind === 'MANUAL' ? ' (termin reczny)' : ''}`,
    });
  }
  for (const e of external) busy.push(...externalBusySlots(e));
  return busy;
}

/**
 * Zajetosc do sprawdzania umieszczenia (bez jego poprzedniej wersji) — tylko to, co moze z nim
 * kolidowac, i bez terminow rocznika z usunietych umieszczen (znikna przy generowaniu).
 */
async function placementBusy(
  term: AcademicTerm,
  relevantTo: NonNullable<OccupancyOptions['relevantTo']>,
  excludePlacementId?: string,
): Promise<BusySlot[]> {
  return termOccupancy(term, { excludePlacementId, relevantTo, patternOfCohortId: relevantTo.cohortId });
}

// ─── Walidacja umieszczenia ──────────────────────────────────

export interface PlacementInput {
  sectionId: string;
  dayOfWeek: DayOfWeek;
  startOrder: number;
  endOrder: number;
  /** null = zajecia online (bez sali). */
  roomId: string | null;
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
  /** Zajetosc, ktora to umieszczenie wnosi na kazdej dacie rytmu (bez etykiety) — do symulacji podgladow. */
  slots: BusySlot[];
}

/**
 * @param extraBusy zajetosc spoza bazy — np. umieszczenia, ktore podglad "Przenies plan" utworzylby
 *   wczesniej w tej samej operacji (zapis tworzy je po kolei, wiec kolejne widza poprzednie).
 */
export async function checkPlacement(
  term: AcademicTerm,
  input: PlacementInput,
  excludeId?: string,
  extraBusy: BusySlot[] = [],
): Promise<PlacementCheck> {
  const errors: string[] = [];
  const section = await prisma.classSection.findUnique({
    where: { id: input.sectionId },
    include: { instructors: true, group: true },
  });
  if (!section || section.termId !== term.id) throw new AppError(400, 'Zajecia nie naleza do tego semestru');
  const [ctx] = await activeCohorts(term, null, [section.cohortId]);
  if (!ctx) throw new AppError(400, 'Rocznik nie ma zajec w tym semestrze');
  assertVersionApproved(ctx.cohort);
  const calendar = await calendarFor(term, ctx);
  if (!calendar) throw new AppError(409, 'Rocznik nie ma kalendarza w tym semestrze — ustaw go w Kalendarzu semestru');
  if (calendar.status === 'ARCHIVED') throw new AppError(409, 'Kalendarz jest w archiwum — plan tylko do odczytu');

  // Bloki dnia (siatka dnia albo podstawowa), dni i okno godzin z siatek wydzialu i trybu rocznika.
  const facultyGrids = await gridFor(ctx.cohort.program.fieldOfStudy.facultyId, ctx.cohort.program.studyMode);
  const grid = facultyGrids.forDay(input.dayOfWeek).time;
  const time = grid.range(input.startOrder, input.endOrder);
  if (!time) errors.push('Nieprawidlowy zakres godzin (poza siatka godzin wydzialu)');
  else {
    const window = dayWindowProblem(facultyGrids.days, input.dayOfWeek, time.startMinute, time.endMinute);
    if (window) errors.push(window);
  }
  if (input.cycle === 'ZJAZD' && calendar.kind !== 'ZJAZD') errors.push('Rocznik ma kalendarz tygodniowy — wybierz rytm tygodniowy');
  if (input.jointKey && time) errors.push(...(await jointProblems(term, input, grid, time, excludeId)));
  if (input.pattern === 'LIST' && input.numbers.length === 0) errors.push('Wybierz numery tygodni/zjazdow');

  // Zajecia online (bez sali): bez typu i pojemnosci sali; grupy i prowadzacy dalej sprawdzani.
  if (input.roomId) {
    const room = await prisma.room.findUnique({ where: { id: input.roomId } });
    if (!room) errors.push('Sala nie istnieje');
    else {
      if (!roomTypeMap[section.classType].includes(room.type)) errors.push('Typ sali nie pasuje do formy zajec');
      if (room.capacity < section.group.size) errors.push(`Sala ma ${room.capacity} miejsc, grupa ${section.group.size} osob`);
    }
  }
  const staff = section.instructors.map((i) => i.instructorId);
  if (input.instructorId && !staff.includes(input.instructorId)) {
    errors.push('Prowadzacy spoza obsady tych zajec — uzupelnij najpierw obsade');
  }

  const cal = new TeachingCalendar(toCalendarInput(calendar));
  const dates = expandDates(cal, { ...input });
  if (dates.length === 0) errors.push('W tym rytmie nie wypada zaden dzien zajec');

  const conflicts: PlacementCheck['conflicts'] = [];
  if (errors.length === 0 && time) {
    const busy = [
      ...(await placementBusy(term, { cohortId: section.cohortId, roomId: input.roomId, instructorId: input.instructorId }, excludeId)),
      ...extraBusy,
    ];
    const overlap = await groupOverlapFn();
    const byDate = new Map<string, BusySlot[]>();
    for (const b of busy) byDate.set(b.date, [...(byDate.get(b.date) ?? []), b]);
    for (const d of dates) {
      const conflict = findConflict(
        { date: d.date, ...time, roomId: input.roomId, instructorId: input.instructorId, groupId: section.groupId, jointKey: input.jointKey },
        byDate.get(d.date) ?? [],
        overlap,
      );
      if (conflict) conflicts.push({ date: d.date, ...conflict });
    }
  }
  const slots: BusySlot[] = time
    ? dates.map((d) => ({
        date: d.date,
        startMinute: time.startMinute,
        endMinute: time.endMinute,
        roomId: input.roomId,
        instructorId: input.instructorId,
        groupId: section.groupId,
        jointKey: input.jointKey,
        label: '',
      }))
    : [];
  return { errors, conflicts, dates: dates.length, slots };
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
  const facultyGrids = await gridFor(ctx!.cohort.program.fieldOfStudy.facultyId, ctx!.cohort.program.studyMode);
  const instructorId =
    opts.instructorId !== undefined ? opts.instructorId : (section.instructors.find((i) => i.instructorId)?.instructorId ?? null);
  const busy = await placementBusy(term, { cohortId: section.cohortId, roomId: opts.roomId ?? null, instructorId });
  const overlap = await groupOverlapFn();

  // Dni zajec z siatek wydzialu (np. niestacjonarne WN: czw-nd); bloki — siatki obowiazujacej w dniu.
  const days = facultyGrids.days.map((d) => d.day);
  const cells: Record<string, Record<number, string | null>> = {};
  for (const dayOfWeek of days) {
    cells[dayOfWeek] = {};
    const grid = facultyGrids.forDay(dayOfWeek).time;
    const blocks = grid.blocks;
    const dates = expandDates(cal, { dayOfWeek, cycle: opts.cycle, pattern: opts.pattern, numbers: opts.numbers }).map((d) => d.date);
    const relevant = busy.filter((b) => dates.includes(b.date));
    for (const block of blocks) {
      const endOrder = block.order + length - 1;
      const time = grid.range(block.order, endOrder);
      if (!time) {
        cells[dayOfWeek]![block.order] = 'Poza siatka godzin';
        continue;
      }
      let reason: string | null = dayWindowProblem(facultyGrids.days, dayOfWeek, time.startMinute, time.endMinute);
      for (const b of reason ? [] : relevant) {
        if (!minutesOverlap(time.startMinute, time.endMinute, b.startMinute, b.endMinute)) continue;
        if (opts.roomId && b.roomId === opts.roomId) reason = `Sala zajeta: ${b.label}`;
        else if (instructorId && b.instructorId === instructorId) reason = `Prowadzacy zajety: ${b.label}`;
        else if (b.groupId !== null && overlap(section.groupId, b.groupId)) reason = `Grupa zajeta: ${b.label}`;
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
  const facultyGrids = await gridFor(ctx.cohort.program.fieldOfStudy.facultyId, ctx.cohort.program.studyMode);

  const sections = await prisma.classSection.findMany({
    where: { termId: term.id, cohortId },
    include: {
      programEntry: { select: { orderInSemester: true, subject: { select: { id: true, name: true } }, specialization: { select: { shortName: true } } } },
      instructors: { include: { instructor: { select: { id: true, title: true, firstName: true, lastName: true } } } },
      placements: { include: { room: { select: { id: true, number: true, type: true, capacity: true, building: { select: { name: true } } } }, instructor: { select: { id: true, title: true, firstName: true, lastName: true } }, _count: { select: { exceptions: true } } } },
    },
  });
  const manual = await prisma.occurrence.groupBy({
    by: ['sectionId'],
    where: { termId: term.id, kind: 'MANUAL', section: { cohortId } },
    _sum: { endOrder: true, startOrder: true },
    _count: { _all: true },
    _max: { date: true },
  });
  const manualHours = new Map(manual.map((m) => [m.sectionId, (m._sum.endOrder ?? 0) - (m._sum.startOrder ?? 0) + m._count._all]));

  // Bilans godzin: ile godzin dadza obecne umieszczenia (bez kolizji, z limitem) i kiedy
  // zajecia sie skoncza (ostatnia data, na ktora starcza godzin — razem z terminami recznymi).
  const planned = new Map<string, number>();
  const endsOn = new Map<string, string>();
  const later = (id: string, date: string) => {
    const current = endsOn.get(id);
    if (!current || date > current) endsOn.set(id, date);
  };
  for (const m of manual) if (m._max.date) later(m.sectionId, toIsoDate(m._max.date));
  if (cal) {
    const mat = materialize({
      sections: sections.map((s) => ({ id: s.id, hours: s.hours, groupId: s.groupId, calendar: cal, gridOf: gridOfDay(facultyGrids), consumedHours: manualHours.get(s.id) ?? 0, label: s.id })),
      placements: sections.flatMap((s) => s.placements.map(toMatPlacement)),
      exceptions: [],
      busy: [],
      groupsOverlap: () => false,
      skipConflicts: true,
    });
    for (const o of mat.occurrences) {
      planned.set(o.sectionId, (planned.get(o.sectionId) ?? 0) + o.endOrder - o.startOrder + 1);
      later(o.sectionId, o.date);
    }
  }

  const name = (i: { title: string | null; firstName: string; lastName: string } | null) =>
    i ? `${i.title ?? ''} ${i.firstName} ${i.lastName}`.trim() : 'NN';
  // Wszystkie terminy rocznika (z wzorca i reczne) — licznik zakladki "Terminy".
  const occurrenceCount = await prisma.occurrence.count({ where: { termId: term.id, section: { cohortId } } });
  // Terminy nieaktualne: ta sama funkcja co w "Przygotowaniu semestru" (services/staleness).
  const reasons = (await staleReasonsByCohort(term, [ctx])).get(cohortId) ?? [];
  // Niezgodnosci powstale po umieszczeniu (obsada, sala, grupa, godziny) — lib/planIssues.
  const groupById = new Map(ctx.cohort.groups.map((g) => [g.id, g]));
  const gridProblemOf = (p: { dayOfWeek: WeekdayName; startOrder: number; endOrder: number }) => {
    const range = facultyGrids.forDay(p.dayOfWeek).time.range(p.startOrder, p.endOrder);
    return range ? dayWindowProblem(facultyGrids.days, p.dayOfWeek, range.startMinute, range.endMinute) : 'bloki spoza siatki';
  };
  // Numery zjazdow/tygodni z kalendarza rocznika — "wybrane zjazdy" spoza nich nic nie dadza.
  const zjazdNumbers = new Set(calendar?.zjazdy.map((z) => z.number) ?? []);
  const weekNumbers = new Set(
    cal
      ?.teachingWeeks()
      .map((w) => w.index)
      .filter((i): i is number => i !== null) ?? [],
  );
  const missingPeriodsOf = (p: { pattern: string; cycle: 'WEEK' | 'ZJAZD'; numbers: number[] }) => {
    if (!calendar || p.pattern !== 'LIST') return undefined;
    const known = p.cycle === 'ZJAZD' ? zjazdNumbers : weekNumbers;
    return { cycle: p.cycle, numbers: p.numbers.filter((n) => !known.has(n)), available: known.size };
  };
  const issuesOf = (s: (typeof sections)[number]) => {
    const group = groupById.get(s.groupId);
    if (!group) return [];
    return sectionIssues(
      {
        classType: s.classType,
        hours: s.hours,
        group,
        instructors: s.instructors,
        placements: s.placements.map((p) => ({
          id: p.id,
          instructorId: p.instructorId,
          instructorName: p.instructorId ? name(p.instructor) : undefined,
          room: p.room,
          gridProblem: gridProblemOf(p),
          missingPeriods: missingPeriodsOf(p),
        })),
      },
      ctx.semester,
    );
  };

  return {
    cohort: {
      id: ctx.cohort.id,
      label: cohortLabel(ctx.cohort),
      code: ctx.cohort.program.code,
      semester: ctx.semester,
      studyMode: ctx.cohort.program.studyMode,
      programVersion: {
        id: ctx.cohort.programVersion.id,
        label: ctx.cohort.programVersion.label,
        status: ctx.cohort.programVersion.status,
      },
    },
    calendar: calendar
      ? {
          id: calendar.id,
          name: calendar.name,
          kind: calendar.kind,
          status: calendar.status,
          lastGeneratedAt: calendar.lastGeneratedAt,
          endDate: toIsoDate(calendar.endDate),
          teachingWeeks: cal!.teachingWeeks().filter((w) => w.index !== null).length,
          // `week` — etykieta „tydz. N” (numer tygodnia semestru); umieszczenia wskazuja zjazd numerem.
          zjazdy: calendar.zjazdy.map((z) => ({
            number: z.number,
            week: semesterWeekOf(toIsoDate(z.startDate), toIsoDate(calendar.startDate)),
            startDate: toIsoDate(z.startDate),
            endDate: toIsoDate(z.endDate),
          })),
          // Tygodnie albo zjazdy z dniami wolnymi — nawigacja widoku tygodnia w "Terminach".
          periods: calendarPeriods(cal!),
        }
      : null,
    // Terminy nieaktualne: umieszczenia zmienione po ostatnim generowaniu.
    // Siatki godzin wydzialu i trybu rocznika: suma dni zajec (z oknem godzin) i siatki — podstawowa
    // oraz siatki dnia z wlasnymi blokami; dzien spoza siatek liczy sie wg podstawowej.
    timeGrid: {
      studyMode: facultyGrids.studyMode,
      days: facultyGrids.days,
      grids: facultyGrids.grids.map((g) => ({ id: g.id, base: g.base, days: g.days.map((d) => d.day), blocks: g.blocks })),
    },
    stale: reasons.length > 0,
    // Powody (do komunikatu): zmiana wzorca i/lub zmiana godzin zajec po generowaniu.
    staleReasons: reasons,
    occurrenceCount,
    sections: sections
      .map((s) => ({
        id: s.id,
        subject: s.programEntry.subject,
        order: s.programEntry.orderInSemester,
        specialization: s.programEntry.specialization?.shortName ?? null,
        classType: s.classType,
        group: {
          id: s.groupId,
          name: ctx.nameOf(s.groupId),
          // Liczebnosc — okno umieszczenia oznacza sale mniejsze niz grupa.
          size: groupById.get(s.groupId)?.size ?? 0,
          // Przodkowie od korzenia (bez samej grupy) — drzewo filtra i widok "co ma student tej grupy".
          ancestors: pathFromRoot(s.groupId, ctx.index)
            .slice(0, -1)
            .map((g) => ({ id: g.id, name: ctx.nameOf(g.id) })),
        },
        hours: s.hours,
        plannedHours: (planned.get(s.id) ?? 0) + (manualHours.get(s.id) ?? 0),
        endsOn: endsOn.get(s.id) ?? null,
        status: s.status,
        instructors: s.instructors.map((i) => ({ instructorId: i.instructorId, name: name(i.instructor), hours: i.hours })),
        placements: s.placements.map((p) => ({
          id: p.id,
          dayOfWeek: p.dayOfWeek,
          startOrder: p.startOrder,
          endOrder: p.endOrder,
          room: p.room ? { id: p.room.id, label: `${p.room.number} (${p.room.building.name})` } : null,
          instructor: p.instructorId ? { id: p.instructorId, name: name(p.instructor) } : null,
          cycle: p.cycle,
          pattern: p.pattern,
          numbers: p.numbers,
          fromIndex: p.fromIndex,
          toIndex: p.toIndex,
          jointKey: p.jointKey,
          exceptionCount: p._count.exceptions,
        })),
        issues: issuesOf(s),
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
  /** Przeniesienia terminow, ktorych daty juz nie ma we wzorcu (nie zostana zastosowane). */
  orphanExceptions: { section: string; date: IsoDate }[];
  calendarsMissing: string[];
  /** Roczniki pominiete, bo ich wersja programu jest w projekcie. */
  draftVersions: string[];
}

/** Sale i prowadzacy, ktorych moga dotyczyc terminy tych zajec: z umieszczen i z przeniesien terminow. */
function resourcesOf(
  sections: {
    placements: {
      roomId: string | null;
      instructorId: string | null;
      exceptions: { newRoomId: string | null; newInstructorId: string | null }[];
    }[];
  }[],
): { roomIds: string[]; instructorIds: string[] } {
  const rooms = new Set<string>();
  const instructors = new Set<string>();
  for (const s of sections) {
    for (const p of s.placements) {
      if (p.roomId) rooms.add(p.roomId);
      if (p.instructorId) instructors.add(p.instructorId);
      for (const e of p.exceptions) {
        if (e.newRoomId) rooms.add(e.newRoomId);
        if (e.newInstructorId) instructors.add(e.newInstructorId);
      }
    }
  }
  return { roomIds: [...rooms], instructorIds: [...instructors] };
}

/** Duze listy id dzielimy na porcje — limit parametrow zapytania w Postgresie. */
const ID_CHUNK = 5000;
function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function generate(
  term: AcademicTerm,
  opts: {
    facultyId: string | null;
    cohortIds?: string[];
    fromDate?: IsoDate | null;
    dryRun: boolean;
    /**
     * Zajetosc innych rocznikow tylko w salach i u prowadzacych z umieszczen generowanych
     * rocznikow (przeliczanie po kazdej zmianie planu). Grupy roznych rocznikow nie koliduja
     * (groupsOverlap), wiec kolizje wychodza te same — a rozpisujemy kilkadziesiat zajec
     * zamiast calej uczelni.
     */
    relevantOccupancy?: boolean;
  },
): Promise<GenerateReport> {
  const scope = await loadScope(term, opts.facultyId, opts.cohortIds);
  const report: GenerateReport = { added: 0, removed: 0, changed: 0, unchanged: 0, total: 0, conflicts: [], beyondHours: 0, shortfalls: [], orphanExceptions: [], calendarsMissing: [], draftVersions: [] };
  const ctxs = scope.contexts.filter((c) => {
    if (c.cohort.programVersion.status === 'DRAFT') {
      report.draftVersions.push(cohortLabel(c.cohort));
      return false;
    }
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
  // Odcisk kalendarza zapisany przy generowaniu (services/staleness) — do "terminow nieaktualnych".
  const fingerprintOf = (cohortId: string) => {
    const calendar = scope.calendars.get(cohortId);
    const ctx = ctxById.get(cohortId);
    return calendar && ctx ? calendarFingerprint(calendar, ctx.semester) : null;
  };

  const sections = await prisma.classSection.findMany({
    where: { termId: term.id, cohortId: { in: cohortIds } },
    include: { ...sectionLabelInclude, placements: { include: { exceptions: true } } },
  });
  const sectionIds = sections.map((s) => s.id);
  const from = opts.fromDate ? fromIsoDate(opts.fromDate) : null;
  // Zakres generowania liczymy po dacie z wzorca (jak materializer), nie po dacie terminu —
  // termin przeniesiony przez granice "od dnia" nalezy tam, gdzie jego data z wzorca.
  const inRange: Prisma.OccurrenceWhereInput = from
    ? { OR: [{ originalDate: { gte: from } }, { originalDate: null, date: { gte: from } }] }
    : {};
  const beforeRange: Prisma.OccurrenceWhereInput = from
    ? { OR: [{ originalDate: { lt: from } }, { originalDate: null, date: { lt: from } }] }
    : {};

  // Godziny zuzyte poza generowaniem: terminy MANUAL (zajecia dodatkowe) i zachowane terminy
  // sprzed "od kiedy".
  const kept = await prisma.occurrence.findMany({
    where: {
      sectionId: { in: sectionIds },
      OR: [{ kind: 'MANUAL' }, ...(from ? [{ kind: 'DERIVED' as const, ...beforeRange }] : [])],
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
    return {
      id: s.id,
      hours: s.hours,
      groupId: s.groupId,
      calendar: scope.teaching.get(s.cohortId)!,
      gridOf: gridOfDay(scope.grids.get(s.cohortId)!),
      consumedHours: consumed.get(s.id) ?? 0,
      label,
    };
  });
  const placements = sections.flatMap((s) => s.placements.map(toMatPlacement));
  const placementSection = new Map(sections.flatMap((s) => s.placements.map((p) => [p.id, s.id] as const)));
  const exceptions: MatException[] = sections.flatMap((s) =>
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
  );

  // Zajete poza zakresem: wzorce pozostalych rocznikow calej uczelni (takze jeszcze
  // niewygenerowane, z przeniesieniami) + terminy reczne + osierocone terminy,
  // a w zakresie — zachowana przeszlosc (generowanie od daty).
  const busy: BusySlot[] = await termOccupancy(term, {
    excludeCohortIds: cohortIds,
    ...(opts.relevantOccupancy ? { onlyResources: resourcesOf(sections) } : {}),
  });
  if (from) {
    const past = await prisma.occurrence.findMany({
      where: { sectionId: { in: sectionIds }, kind: 'DERIVED', ...beforeRange },
    });
    for (const o of past) {
      busy.push({
        date: toIsoDate(o.date),
        startMinute: o.startMinute,
        endMinute: o.endMinute,
        roomId: o.roomId,
        instructorId: o.instructorId,
        groupId: o.groupId,
        jointKey: o.jointKey,
        label: labelOf.get(o.sectionId) ?? 'termin',
      });
    }
  }

  const mat = materialize({
    sections: matSections,
    placements,
    exceptions,
    busy,
    groupsOverlap: await groupOverlapFn(),
    fromDate: opts.fromDate ?? null,
  });

  // Diff z obecnymi terminami DERIVED w zakresie (klucz: umieszczenie + data z wzorca). Termin
  // o tym samym kluczu zostaje tym samym wierszem (to samo id) — zmienia sie tylko jego tresc.
  const existing = await prisma.occurrence.findMany({
    where: { sectionId: { in: sectionIds }, kind: 'DERIVED', ...inRange },
  });
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  // Uwaga z wyjatku (powod przeniesienia) — termin wg wzorca uwagi nie ma.
  const noteOf = new Map(
    sections.flatMap((s) => s.placements.flatMap((p) => p.exceptions.map((e) => [`${p.id}|${toIsoDate(e.originalDate)}`, e.note] as const))),
  );
  const planned: DerivedRow[] = mat.occurrences.map((o) => ({
    termId: term.id,
    facultyId: sectionById.get(o.sectionId)!.facultyId,
    sectionId: o.sectionId,
    placementId: o.placementId,
    originalDate: fromIsoDate(o.originalDate),
    date: fromIsoDate(o.date),
    startOrder: o.startOrder,
    endOrder: o.endOrder,
    startMinute: o.startMinute,
    endMinute: o.endMinute,
    roomId: o.roomId,
    instructorId: o.instructorId,
    groupId: o.groupId,
    kind: 'DERIVED',
    jointKey: o.jointKey,
    note: noteOf.get(`${o.placementId}|${o.originalDate}`) ?? null,
  }));
  const diff = diffOccurrences(existing, planned);
  report.added = diff.added;
  report.changed = diff.changed;
  report.unchanged = diff.unchanged;
  report.removed = diff.toDelete.length;
  report.total = mat.occurrences.length;
  report.conflicts = mat.conflicts;
  report.beyondHours = mat.beyondHours.length;
  report.shortfalls = mat.shortfalls;
  report.orphanExceptions = mat.orphanExceptions.map((e) => ({
    section: labelOf.get(placementSection.get(e.placementId) ?? '') ?? '?',
    date: e.originalDate,
  }));

  if (!opts.dryRun) {
    const now = new Date();
    await prisma.$transaction([
      // Najpierw usuniecia (zwalniaja klucze), potem nowe i zmienione — terminy bez zmian
      // zostaja nietkniete (to samo id, ta sama data utworzenia).
      ...chunks(diff.toDelete, ID_CHUNK).map((ids) => prisma.occurrence.deleteMany({ where: { id: { in: ids } } })),
      ...chunks(diff.toCreate, ID_CHUNK).map((data) => prisma.occurrence.createMany({ data })),
      ...diff.toUpdate.map((u) => prisma.occurrence.update({ where: { id: u.id }, data: u.data })),
      prisma.termCalendar.updateMany({
        where: { id: { in: [...new Set(ctxs.map((c) => scope.calendars.get(c.cohort.id)!.id))] } },
        data: { lastGeneratedAt: now },
      }),
      // "Terminy nieaktualne" liczymy per rocznik: czas tylko dla rocznikow przeliczonych teraz,
      // nie dla wszystkich rocznikow kalendarza (generowanie z planu dotyczy jednego rocznika).
      ...cohortIds.map((cohortId) =>
        prisma.cohortGeneration.upsert({
          where: { cohortId_termId: { cohortId, termId: term.id } },
          create: { cohortId, termId: term.id, generatedAt: now, calendarKey: fingerprintOf(cohortId) },
          update: { generatedAt: now, calendarKey: fingerprintOf(cohortId) },
        }),
      ),
    ]);
  }
  return report;
}

// ─── Terminy kalendarzy "w przygotowaniu" ───────────────────

export interface RefreshResult {
  /** Roczniki, ktorych terminy przeliczono (kalendarz w przygotowaniu, zatwierdzony program). */
  cohortIds: string[];
  report: GenerateReport | null;
}

/**
 * Dopoki kalendarz rocznika jest "w przygotowaniu", terminy przeliczaja sie same po kazdej zmianie
 * planu (umieszczenia, terminy reczne, kalendarz, ustawienia rocznika w semestrze) — widzi je tylko
 * planista, wiec nie ma czego chronic przed cicha zmiana. W opublikowanym kalendarzu terminy zmienia
 * wylacznie "Generuj terminy" (z podgladem), a zmiana wzorca daje "terminy nieaktualne".
 * Wywolujacy trzyma blokade planu semestru (services/planLock) — to zapis terminow.
 */
export async function refreshPlanningTerms(term: AcademicTerm, cohortIds: string[]): Promise<RefreshResult> {
  const ids = [...new Set(cohortIds)];
  if (ids.length === 0) return { cohortIds: [], report: null };
  const contexts = await activeCohorts(term, null, ids);
  const calendars = await calendarsFor(term, contexts);
  const planning = contexts
    .filter((c) => calendars.get(c.cohort.id)?.status === 'PLANNING' && c.cohort.programVersion.status === 'APPROVED')
    .map((c) => c.cohort.id);
  if (planning.length === 0) return { cohortIds: [], report: null };
  const report = await generate(term, { facultyId: null, cohortIds: planning, fromDate: null, dryRun: false, relevantOccupancy: true });
  return { cohortIds: planning, report };
}

/** Dopisek do komunikatu zapisu planu: terminy przeliczone same albo czekaja na "Generuj terminy". */
export function termsNote(refresh: RefreshResult): string {
  if (refresh.cohortIds.length === 0) return 'terminy zmienia sie po "Generuj terminy"';
  const conflicts = refresh.report?.conflicts.length ?? 0;
  return conflicts > 0 ? `terminy przeliczone (pominiete przez kolizje: ${conflicts})` : 'terminy przeliczone';
}
