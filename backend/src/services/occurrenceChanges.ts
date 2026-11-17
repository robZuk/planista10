import type { AcademicTerm, ClassSection, Occurrence, Placement } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { fromIsoDate, isIsoDate, toIsoDate, weekdayOf } from '../lib/isoDate';
import { findConflict, type CandidateSlot } from '../lib/materializer';
import { groupsOverlap, indexGroups } from '../lib/groupTree';
import { dayWindowProblem, type GridTime } from '../lib/timeGrid';
import { singleConflictMessage } from '../lib/conflictMessage';
import { TeachingCalendar, WEEKDAY_ENUM } from '../lib/teachingCalendar';
import { assessSlot, SLOT_WARNINGS_CODE, type SlotAssessment } from '../lib/occurrenceSlot';
import { gridFor, type FacultyGrids } from './timeGrids';
import { toCalendarInput } from './termCalendars';
import { toTreeGroup } from './cohorts';
import { activeCohorts } from './sections';
import { assertVersionApproved, calendarFor, termOccupancy, type OccupancyOptions } from './plan';

/**
 * Zmiany pojedynczych terminow — przeniesienie, przywrocenie wg wzorca i termin reczny
 * (zajecia dodatkowe) wprowadza tylko planista (Ukladanie planu → Terminy). Terminy z wzorca
 * przenosimy wyjatkiem (PlacementException), ktory przezyje ponowne generowanie; terminy
 * reczne — wprost. Kazda zmiana daty/godzin/sali sprawdza kolizje w calej uczelni.
 *
 * Odwolan i odrobien nie ma: zajecia, ktore maja sie odbyc w innym dniu, planista przenosi.
 *
 * Dotyczy tylko studiow niestacjonarnych. Na stacjonarnych obowiazuje ten sam plan w kazdym
 * tygodniu (+ kalendarz Rektora): pojedynczych terminow sie nie przenosi, a zmiana planu od
 * tygodnia to zmiana wzorca (umieszczenia od-do tygodnia) — terminy sa tylko do wgladu.
 */

export type OccurrenceFull = Occurrence & { placement: Placement | null; section: ClassSection };

/** Kolizje terminu na konkretnej dacie z zajetoscia calej uczelni (bez niego samego). */
export async function occurrenceConflicts(term: AcademicTerm, slot: CandidateSlot, opts: OccupancyOptions) {
  // Wspolna zajetosc uczelni (wzorce z wyjatkami, terminy reczne i wygenerowane) na te date —
  // zawezona do rocznika grupy, sali i prowadzacego terminu (tylko one moga z nim kolidowac).
  const group = await prisma.studentGroup.findUniqueOrThrow({ where: { id: slot.groupId }, select: { cohortId: true } });
  const relevantTo = { cohortId: group.cohortId, roomId: slot.roomId, instructorId: slot.instructorId };
  const busy = (await termOccupancy(term, { ...opts, includeGenerated: true, relevantTo })).filter((b) => b.date === slot.date);
  const groups = await prisma.studentGroup.findMany({ where: { cohortId: group.cohortId } });
  const index = indexGroups(groups.map(toTreeGroup));
  return findConflict(slot, busy, (a, b) => groupsOverlap(a, b, index));
}

/**
 * Terminy rocznika wolno zmieniac: kalendarz nie w archiwum, rocznik niestacjonarny (stacjonarne
 * maja terminy tylko do wgladu — patrz naglowek modulu) i wersja programu zatwierdzona.
 * Zwraca siatki godzin wydzialu i trybu rocznika — bloki terminu zamieniamy na rzeczywisty czas
 * wg siatki dnia tygodnia, w ktory termin wypada (siatka dnia albo podstawowa).
 */
export async function assertPlanEditable(termId: string, cohortId: string): Promise<FacultyGrids> {
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: termId } });
  const [ctx] = await activeCohorts(term, null, [cohortId]);
  const calendar = ctx ? await calendarFor(term, ctx) : null;
  if (!ctx || !calendar) throw new AppError(409, 'Rocznik nie ma kalendarza w tym semestrze');
  if (calendar.status === 'ARCHIVED') throw new AppError(409, 'Kalendarz w archiwum — terminy tylko do odczytu');
  if (ctx.cohort.program.studyMode === 'FULL_TIME') {
    throw new AppError(
      409,
      'Studia stacjonarne: terminy sa tylko do wgladu — plan zmieniasz we wzorcu tygodnia (od-do tygodnia), potem „Generuj terminy”',
    );
  }
  assertVersionApproved(ctx.cohort);
  return gridFor(ctx.cohort.program.fieldOfStudy.facultyId, ctx.cohort.program.studyMode);
}

/** Bloki obowiazujace w dniu tygodnia daty (np. piatek niestacjonarnych ma wlasne bloki). */
const gridOfDate = (grids: FacultyGrids, date: string): GridTime => grids.forDay(WEEKDAY_ENUM[weekdayOf(date)]!).time;

/** Zakres blokow -> minuty; blok spoza siatki kalendarza to blad wejscia. */
export function minutesOf(grid: GridTime, startOrder: number, endOrder: number) {
  const time = grid.range(startOrder, endOrder);
  if (!time) throw new AppError(400, 'Godziny poza siatka godzin wydzialu');
  return time;
}

/**
 * Nowe miejsce terminu wzgledem kalendarza rocznika (semestr, swieta, przerwy, zjazdy)
 * i okna godzin dnia w siatce wydzialu. Data poza semestrem od razu blokuje (400).
 */
async function slotAssessment(term: AcademicTerm, cohortId: string, date: string, time: { startMinute: number; endMinute: number }): Promise<SlotAssessment> {
  const [ctx] = await activeCohorts(term, null, [cohortId]);
  const calendar = ctx ? await calendarFor(term, ctx) : null;
  if (!ctx || !calendar) throw new AppError(409, 'Rocznik nie ma kalendarza w tym semestrze');
  const grid = await gridFor(ctx.cohort.program.fieldOfStudy.facultyId, ctx.cohort.program.studyMode);
  const weekday = WEEKDAY_ENUM[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
  const assessment = assessSlot(
    new TeachingCalendar(toCalendarInput(calendar)).dayInfo(date),
    dayWindowProblem(grid.days, weekday, time.startMinute, time.endMinute),
  );
  if (assessment.blocking) throw new AppError(400, assessment.blocking);
  return assessment;
}

/** Ostrzezenia (swieto, dzien bez zajec, godziny poza oknem) wymagaja potwierdzenia — 409 z lista dla frontu. */
function assertWarningsConfirmed(assessment: SlotAssessment, confirmed: boolean | undefined): void {
  if (assessment.warnings.length === 0 || confirmed) return;
  throw new AppError(409, `Termin poza zwyklym planem: ${assessment.warnings.join('; ')}`, {
    code: SLOT_WARNINGS_CODE,
    warnings: assessment.warnings,
  });
}

const isDerived = (occ: OccurrenceFull) => occ.kind === 'DERIVED' && !!occ.placement && !!occ.originalDate;

/** Przywrocenie przeniesionego terminu z wzorca (usuwa wyjatek). Wraca na miejsce z wzorca — z kontrola kolizji. */
export async function restoreOccurrence(occ: OccurrenceFull, grids: FacultyGrids): Promise<void> {
  if (!isDerived(occ)) throw new AppError(400, 'Przywracac mozna tylko terminy z wzorca');
  const p = occ.placement!;
  const length = occ.endOrder - occ.startOrder + 1;
  const endOrder = Math.min(p.endOrder, p.startOrder + length - 1);
  // Miejsce z wzorca: bloki siatki dnia umieszczenia (jak przy generowaniu).
  const time = minutesOf(grids.forDay(p.dayOfWeek).time, p.startOrder, endOrder);
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: occ.termId } });
  const date = toIsoDate(occ.originalDate!);
  const conflict = await occurrenceConflicts(
    term,
    { date, ...time, roomId: p.roomId, instructorId: p.instructorId, groupId: occ.groupId, jointKey: p.jointKey },
    { excludePatternKey: `${p.id}|${date}`, excludeOccurrenceId: occ.id },
  );
  if (conflict) throw new AppError(409, singleConflictMessage(conflict));
  await prisma.$transaction([
    prisma.placementException.deleteMany({ where: { placementId: p.id, originalDate: occ.originalDate! } }),
    prisma.occurrence.update({
      where: { id: occ.id },
      data: {
        date: occ.originalDate!,
        startOrder: p.startOrder,
        endOrder,
        ...time,
        roomId: p.roomId,
        instructorId: p.instructorId,
        jointKey: p.jointKey,
        // Powod przeniesienia nie dotyczy terminu wg wzorca (generowanie tez go nie niesie).
        note: null,
      },
    }),
  ]);
}

export interface MoveInput {
  date?: string;
  startOrder?: number;
  endOrder?: number;
  roomId?: string | null;
  /** true = online (bez sali); false + roomId = do sali; brak = bez zmiany. */
  online?: boolean;
  instructorId?: string | null;
  note?: string | null;
  /** Planista potwierdzil ostrzezenia o dniu/godzinach (patrz lib/occurrenceSlot). */
  confirmWarnings?: boolean;
}

/**
 * Przeniesienie terminu (data, godziny, sala, prowadzacy) — z kontrola kolizji. Bloki liczymy
 * wg siatki dnia tygodnia nowej daty (np. przeniesienie z soboty na piatek bierze bloki piatku).
 */
export async function moveOccurrence(occ: OccurrenceFull, grids: FacultyGrids, input: MoveInput): Promise<void> {
  const date = input.date ?? toIsoDate(occ.date);
  if (!isIsoDate(date)) throw new AppError(400, 'Nieprawidlowa data');
  const next = {
    date,
    startOrder: input.startOrder ?? occ.startOrder,
    endOrder: input.endOrder ?? occ.endOrder,
    roomId: input.online ? null : (input.roomId ?? occ.roomId),
    instructorId: input.instructorId === undefined ? occ.instructorId : input.instructorId,
  };
  if (next.endOrder < next.startOrder) throw new AppError(400, 'Nieprawidlowy zakres godzin');
  if (input.online === false && !next.roomId) throw new AppError(400, 'Wybierz sale (albo zostaw zajecia online)');
  const time = minutesOf(gridOfDate(grids, next.date), next.startOrder, next.endOrder);
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: occ.termId } });
  // Dzien i godziny oceniamy tylko przy zmianie miejsca w czasie (sama zmiana sali/prowadzacego ich nie rusza).
  const slotChanged = next.date !== toIsoDate(occ.date) || next.startOrder !== occ.startOrder || next.endOrder !== occ.endOrder;
  const assessment = slotChanged ? await slotAssessment(term, occ.section.cohortId, next.date, time) : null;
  const derived = isDerived(occ);
  const conflict = await occurrenceConflicts(
    term,
    { date: next.date, ...time, roomId: next.roomId, instructorId: next.instructorId, groupId: occ.groupId, jointKey: occ.jointKey },
    // Bez niego samego: termin wzorca (placement + data z wzorca) albo termin reczny/osierocony.
    derived ? { excludePatternKey: `${occ.placementId}|${toIsoDate(occ.originalDate!)}`, excludeOccurrenceId: occ.id } : { excludeOccurrenceId: occ.id },
  );
  if (conflict) throw new AppError(409, singleConflictMessage(conflict));
  if (assessment) assertWarningsConfirmed(assessment, input.confirmWarnings);
  const note = input.note ?? null;
  const exception = {
    newDate: fromIsoDate(next.date),
    newStartOrder: next.startOrder,
    newEndOrder: next.endOrder,
    newRoomId: next.roomId,
    newOnline: next.roomId === null ? true : null,
    newInstructorId: next.instructorId,
    note,
  };
  await prisma.$transaction([
    ...(derived
      ? [
          prisma.placementException.upsert({
            where: { placementId_originalDate: { placementId: occ.placementId!, originalDate: occ.originalDate! } },
            create: { placementId: occ.placementId!, originalDate: occ.originalDate!, ...exception },
            update: exception,
          }),
        ]
      : []),
    prisma.occurrence.update({
      where: { id: occ.id },
      data: { ...next, ...time, date: fromIsoDate(next.date), note: note ?? occ.note },
    }),
  ]);
}

export interface ManualInput {
  date: string;
  startOrder: number;
  endOrder: number;
  roomId?: string | null;
  online?: boolean;
  instructorId?: string | null;
  note?: string | null;
  /** Planista potwierdzil ostrzezenia o dniu/godzinach (patrz lib/occurrenceSlot). */
  confirmWarnings?: boolean;
}

/**
 * Termin reczny (zajecia dodatkowe, jednorazowe) z kontrola kolizji; bloki wg siatki dnia tygodnia
 * daty. Liczy sie do godzin zajec jak kazdy termin — przy generowaniu wzorzec da o tyle mniej.
 */
export async function createManualOccurrence(term: AcademicTerm, section: ClassSection, grids: FacultyGrids, input: ManualInput) {
  const roomId = input.online ? null : (input.roomId ?? null);
  if (!isIsoDate(input.date) || !Number.isInteger(input.startOrder) || !Number.isInteger(input.endOrder) || input.endOrder < input.startOrder) {
    throw new AppError(400, 'Podaj date i godziny');
  }
  if (!input.online && !roomId) throw new AppError(400, 'Wybierz sale (albo zaznacz zajecia online)');
  // Prowadzacy: wskazany (null = NN); bez wskazania — pierwszy z obsady.
  const instructorId =
    input.instructorId !== undefined
      ? input.instructorId
      : ((await prisma.sectionInstructor.findFirst({ where: { sectionId: section.id, instructorId: { not: null } } }))?.instructorId ?? null);
  const time = minutesOf(gridOfDate(grids, input.date), input.startOrder, input.endOrder);
  const assessment = await slotAssessment(term, section.cohortId, input.date, time);
  const conflict = await occurrenceConflicts(
    term,
    { date: input.date, ...time, roomId, instructorId, groupId: section.groupId, jointKey: null },
    {},
  );
  if (conflict) throw new AppError(409, singleConflictMessage(conflict));
  assertWarningsConfirmed(assessment, input.confirmWarnings);
  return prisma.occurrence.create({
    data: {
      termId: term.id,
      facultyId: section.facultyId,
      sectionId: section.id,
      date: fromIsoDate(input.date),
      startOrder: input.startOrder,
      endOrder: input.endOrder,
      ...time,
      roomId,
      instructorId,
      groupId: section.groupId,
      kind: 'MANUAL',
      note: input.note ?? null,
    },
  });
}
