import type { AcademicTerm, ClassType, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { IsoDate } from '../lib/isoDate';
import { expandDates, TeachingCalendar } from '../lib/teachingCalendar';
import { formatMinutes, weekdayLabel, type MinuteRange } from '../lib/timeGrid';
import { weekPatternLabel } from '../lib/planPrint';
import { CLASS_LABEL_PL } from '../lib/scheduleTime';
import { instructorConflicts, proposeInstructor, staffMismatch, type InstructorBusy, type StaffMismatchKind, type TimedDate } from '../lib/planStaff';
import { activeCohorts, type CohortContext } from './sections';
import { calendarsFor } from './cohortCalendar';
import { toCalendarInput } from './termCalendars';
import { gridFor, type FacultyGrids } from './timeGrids';
import { cohortLabel } from './cohorts';
import { refreshPlanningTerms, termOccupancy, type RefreshResult } from './plan';

/**
 * Plan a obsada. Umieszczenie niesie prowadzacego wybranego z obsady swoich zajec (grupy); zmiana
 * obsady planu nie zmienia, wiec plan potrafi sie z nia rozjechac (lib/planStaff: prowadzacy spoza
 * obsady albo NN mimo pelnej obsady). Strona "Obsada" pokazuje takie zajecia, a planista przepina
 * prowadzacego w planie z podgladem: sprawdzamy tylko kolizje prowadzacego (sala i grupy sie nie
 * zmieniaja), na tych samych datach co przy umieszczaniu, takze miedzy zmianami z jednej listy.
 * Po zapisie terminy jak po kazdej zmianie planu: w przygotowaniu przeliczaja sie same,
 * w opublikowanym kalendarzu sa nieaktualne do "Generuj terminy".
 */

const personSelect = { id: true, title: true, firstName: true, lastName: true } as const;

const placementInclude = {
  instructor: { select: personSelect },
  section: {
    select: {
      id: true,
      cohortId: true,
      classType: true,
      groupId: true,
      hours: true,
      programEntry: { select: { orderInSemester: true, subject: { select: { name: true } }, specialization: { select: { shortName: true } } } },
      instructors: { select: { instructorId: true, hours: true, instructor: { select: personSelect } } },
    },
  },
} satisfies Prisma.PlacementInclude;

type PlacementRow = Prisma.PlacementGetPayload<{ include: typeof placementInclude }>;

interface Person {
  id: string;
  name: string;
}

function personName(p: { title: string | null; firstName: string; lastName: string }): string {
  return `${p.title ?? ''} ${p.firstName} ${p.lastName}`.trim();
}

/** Rocznik z kalendarzem poza archiwum: kalendarz zajec i siatki godzin jego wydzialu i trybu. */
interface CohortEnv {
  ctx: CohortContext;
  calendar: TeachingCalendar;
  grids: FacultyGrids;
}

async function cohortEnvs(term: AcademicTerm, contexts: CohortContext[]): Promise<Map<string, CohortEnv>> {
  const calendars = await calendarsFor(term, contexts);
  const grids = new Map<string, Promise<FacultyGrids>>();
  const out = new Map<string, CohortEnv>();
  for (const ctx of contexts) {
    const calendar = calendars.get(ctx.cohort.id);
    if (!calendar || calendar.status === 'ARCHIVED') continue;
    const { facultyId } = ctx.cohort.program.fieldOfStudy;
    const key = `${facultyId}|${ctx.cohort.program.studyMode}`;
    if (!grids.has(key)) grids.set(key, gridFor(facultyId, ctx.cohort.program.studyMode));
    out.set(ctx.cohort.id, { ctx, calendar: new TeachingCalendar(toCalendarInput(calendar)), grids: await grids.get(key)! });
  }
  return out;
}

const timeOf = (p: PlacementRow, env: CohortEnv): MinuteRange | null => env.grids.forDay(p.dayOfWeek).time.range(p.startOrder, p.endOrder);

/** "wtorek 08:00–09:30 tyg. parzyste" / "sobota 10:00–11:30 zjazd 2,4". */
function slotLabel(p: PlacementRow, time: MinuteRange | null): string {
  const clock = time ? `${formatMinutes(time.startMinute)}–${formatMinutes(time.endMinute)}` : `bloki ${p.startOrder}–${p.endOrder}`;
  const rhythm = weekPatternLabel(p);
  return [weekdayLabel(p.dayOfWeek), clock, p.cycle === 'ZJAZD' ? rhythm.replace(/^tyg\./, 'zjazd') || 'kazdy zjazd' : rhythm]
    .filter(Boolean)
    .join(' ');
}

const sectionLabel = (p: PlacementRow, env: CohortEnv) =>
  `${p.section.programEntry.subject.name} (${CLASS_LABEL_PL[p.section.classType]}) ${env.ctx.nameOf(p.section.groupId)}`;

export interface StaffMismatchRow {
  placementId: string;
  cohort: { id: string; label: string; code: string; semester: number };
  subject: string;
  specialization: string | null;
  classType: ClassType;
  group: string;
  /** Kiedy zajecia sa w planie (dzien, godziny, rytm). */
  slot: string;
  kind: StaffMismatchKind;
  /** Prowadzacy w planie (null = NN). */
  current: Person | null;
  /** Osoby z obsady zajec (bez NN), od najwiekszej liczby godzin. */
  staff: (Person & { hours: number })[];
  /** Podpowiedz: na kogo przepiac (null = NN). */
  proposed: string | null;
}

/** Zajecia w planie rozjechane z obsada — roczniki wydzialu (null = cala uczelnia) z kalendarzem poza archiwum. */
export async function staffMismatches(term: AcademicTerm, facultyId: string | null): Promise<StaffMismatchRow[]> {
  const envs = await cohortEnvs(term, await activeCohorts(term, facultyId));
  if (envs.size === 0) return [];
  const placements = await prisma.placement.findMany({
    where: { termId: term.id, section: { cohortId: { in: [...envs.keys()] } } },
    include: placementInclude,
    orderBy: [{ dayOfWeek: 'asc' }, { startOrder: 'asc' }],
  });
  const kinds = new Map(placements.map((p) => [p.id, staffMismatch(p.instructorId, p.section.instructors, p.section.hours)]));
  // Kto juz prowadzi zgodne umieszczenia tych zajec — podpowiedz woli osobe, ktorej jeszcze nie ma w planie.
  const used = new Map<string, Set<string>>();
  const usedOf = (sectionId: string) => used.get(sectionId) ?? used.set(sectionId, new Set()).get(sectionId)!;
  for (const p of placements) if (!kinds.get(p.id) && p.instructorId) usedOf(p.sectionId).add(p.instructorId);

  const rows: (StaffMismatchRow & { order: number })[] = [];
  for (const p of placements) {
    const kind = kinds.get(p.id);
    const env = envs.get(p.section.cohortId);
    if (!kind || !env) continue;
    const proposed = proposeInstructor(p.section.instructors, usedOf(p.sectionId));
    // Kolejne umieszczenie tych samych zajec dostaje nastepna osobe (podzial godzin miedzy prowadzacych).
    if (proposed) usedOf(p.sectionId).add(proposed);
    rows.push({
      placementId: p.id,
      cohort: { id: env.ctx.cohort.id, label: cohortLabel(env.ctx.cohort), code: env.ctx.cohort.program.code, semester: env.ctx.semester },
      subject: p.section.programEntry.subject.name,
      specialization: p.section.programEntry.specialization?.shortName ?? null,
      classType: p.section.classType,
      group: env.ctx.nameOf(p.section.groupId),
      slot: slotLabel(p, timeOf(p, env)),
      kind,
      current: p.instructor ? { id: p.instructor.id, name: personName(p.instructor) } : null,
      staff: p.section.instructors
        .filter((s) => s.instructor)
        .sort((a, b) => b.hours - a.hours)
        .map((s) => ({ id: s.instructor!.id, name: personName(s.instructor!), hours: s.hours })),
      proposed,
      order: p.section.programEntry.orderInSemester,
    });
  }
  const CLASS_ORDER: ClassType[] = ['LECTURE', 'EXERCISE', 'LAB', 'PROJECT', 'SEMINAR'];
  return rows
    .sort(
      (a, b) =>
        a.cohort.label.localeCompare(b.cohort.label, 'pl') ||
        a.order - b.order ||
        a.subject.localeCompare(b.subject, 'pl') ||
        CLASS_ORDER.indexOf(a.classType) - CLASS_ORDER.indexOf(b.classType) ||
        a.group.localeCompare(b.group, 'pl', { numeric: true }),
    )
    .map(({ order: _order, ...row }) => row);
}

export interface StaffChange {
  placementId: string;
  /** null = NN. */
  instructorId: string | null;
}

export interface StaffChangeCheck extends StaffChange {
  /** Powod, dla ktorego zmiany nie da sie zapisac (poza kolizjami); null = mozna. */
  error: string | null;
  /** Kolizje nowego prowadzacego (najwyzej jedna na date). */
  conflicts: { date: IsoDate; with: string }[];
}

export interface StaffChangeResult {
  results: StaffChangeCheck[];
  applied: number;
  refresh: RefreshResult | null;
}

/**
 * Przepiecie prowadzacego w umieszczeniach (dryRun — tylko sprawdzenie). Liczymy stan planu po zmianach:
 * umieszczenia z listy wypadaja z zajetosci planu, zmiany przyjete wczesniej z listy niosa nowego
 * prowadzacego (ta sama osoba w dwoch grupach naraz to kolizja), odrzucone — dotychczasowego. Dzieki
 * temu zamiana prowadzacych miedzy grupami rownoleglymi przechodzi w jednym kroku. Odrzucenie zmiany
 * przywraca jej dotychczasowego prowadzacego, wiec sprawdzamy do skutku (przyjetych tylko ubywa).
 * Zapisujemy razem tylko zmiany bez bledow i kolizji; wyjatki terminow z dotychczasowym prowadzacym
 * przechodza na nowego. Zapis wola miec blokade planu semestru.
 */
export async function changePlanStaff(
  term: AcademicTerm,
  changes: StaffChange[],
  opts: { dryRun: boolean; assertScope: (facultyId: string) => Promise<void> },
): Promise<StaffChangeResult> {
  const placements = await prisma.placement.findMany({ where: { id: { in: changes.map((c) => c.placementId) } }, include: placementInclude });
  const byId = new Map(placements.map((p) => [p.id, p]));
  for (const facultyId of new Set(placements.map((p) => p.facultyId))) await opts.assertScope(facultyId);
  const cohortIds = [...new Set(placements.filter((p) => p.termId === term.id).map((p) => p.section.cohortId))];
  const envs = cohortIds.length > 0 ? await cohortEnvs(term, await activeCohorts(term, null, cohortIds)) : new Map<string, CohortEnv>();

  interface Candidate {
    result: StaffChangeCheck;
    placement: PlacementRow;
    env: CohortEnv;
    dates: TimedDate[];
  }
  const results: StaffChangeCheck[] = [];
  const candidates: Candidate[] = [];
  for (const change of changes) {
    const result: StaffChangeCheck = { ...change, error: null, conflicts: [] };
    results.push(result);
    const p = byId.get(change.placementId);
    const env = p && p.termId === term.id ? envs.get(p.section.cohortId) : undefined;
    const time = p && env ? timeOf(p, env) : null;
    if (!p || p.termId !== term.id) result.error = 'Zajec nie ma w planie tego semestru';
    else if (!env) result.error = 'Kalendarz rocznika w archiwum — plan tylko do odczytu';
    else if (change.instructorId === p.instructorId) result.error = 'Bez zmiany';
    else if (change.instructorId && !p.section.instructors.some((s) => s.instructorId === change.instructorId)) {
      result.error = 'Prowadzacy spoza obsady tych zajec';
    } else if (change.instructorId && !time) result.error = 'Zajecia poza siatka godzin — popraw je w Ukladaniu planu';
    if (result.error || !p || !env) continue;
    candidates.push({ result, placement: p, env, dates: time ? expandDates(env.calendar, p).map((d) => ({ date: d.date, ...time })) : [] });
  }

  // Zajetosc osoby z punktu widzenia rocznika (jego wzorzec, terminy innych rocznikow, zajetosci
  // zewnetrzne) — bez umieszczen z listy: ich prowadzacych dokladamy nizej wedlug wyniku sprawdzenia.
  const excluded = candidates.map((c) => c.placement.id);
  const occupancy = new Map<string, Promise<InstructorBusy[]>>();
  const busyOf = (cohortId: string, instructorId: string) => {
    const key = `${cohortId}|${instructorId}`;
    if (!occupancy.has(key)) {
      occupancy.set(key, termOccupancy(term, { relevantTo: { cohortId, instructorId }, patternOfCohortId: cohortId, excludePlacementIds: excluded }));
    }
    return occupancy.get(key)!;
  };
  const slotsOf = (c: Candidate, instructorId: string | null, suffix: string): InstructorBusy[] =>
    instructorId
      ? c.dates.map((d) => ({ ...d, instructorId, jointKey: c.placement.jointKey, label: `${sectionLabel(c.placement, c.env)}${suffix}` }))
      : [];

  const accepted = new Set(candidates);
  for (let changed = true; changed; ) {
    changed = false;
    const rejected = candidates.filter((c) => !accepted.has(c)).flatMap((c) => slotsOf(c, c.placement.instructorId, ''));
    const earlier: InstructorBusy[] = [];
    for (const c of candidates) {
      if (!accepted.has(c)) continue;
      const to = c.result.instructorId;
      c.result.conflicts = to
        ? instructorConflicts(c.dates, to, c.placement.jointKey, [...(await busyOf(c.placement.section.cohortId, to)), ...rejected, ...earlier])
        : [];
      if (c.result.conflicts.length > 0) {
        accepted.delete(c);
        changed = true;
      } else earlier.push(...slotsOf(c, to, ' — z tej listy'));
    }
  }
  if (opts.dryRun || accepted.size === 0) return { results, applied: 0, refresh: null };

  await prisma.$transaction(
    [...accepted].flatMap(({ placement, result: { instructorId } }) => [
      prisma.placement.update({ where: { id: placement.id }, data: { instructorId } }),
      ...(placement.instructorId
        ? [
            prisma.placementException.updateMany({
              where: { placementId: placement.id, newInstructorId: placement.instructorId },
              data: { newInstructorId: instructorId },
            }),
          ]
        : []),
    ]),
  );
  const refresh = await refreshPlanningTerms(term, [...new Set([...accepted].map((a) => a.placement.section.cohortId))]);
  return { results, applied: accepted.size, refresh };
}
