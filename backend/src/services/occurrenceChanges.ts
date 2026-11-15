import type { AcademicTerm, ClassSection, Occurrence, Placement } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { fromIsoDate, isIsoDate, toIsoDate } from '../lib/isoDate';
import { findConflict, type BusySlot } from '../lib/materializer';
import { groupsOverlap, indexGroups } from '../lib/groupTree';
import { dayWindowProblem, slotLabel, type GridTime } from '../lib/timeGrid';
import { singleConflictMessage } from '../lib/conflictMessage';
import { occurrenceKey } from '../lib/occurrenceKey';
import { TeachingCalendar, WEEKDAY_ENUM } from '../lib/teachingCalendar';
import { assessSlot, SLOT_WARNINGS_CODE, type SlotAssessment } from '../lib/occurrenceSlot';
import { gridFor } from './timeGrids';
import { toCalendarInput } from './termCalendars';
import { toTreeGroup } from './cohorts';
import { activeCohorts } from './sections';
import { assertVersionApproved, calendarFor, termOccupancy, type OccupancyOptions } from './plan';

/**
 * Zmiany pojedynczych terminow — odwolanie, przeniesienie, przywrocenie i termin reczny
 * (odrobienie) wprowadza tylko planista (Ukladanie planu → Terminy). Terminy z wzorca
 * zmieniamy wyjatkiem (PlacementException), ktory przezyje ponowne generowanie; terminy
 * reczne — wprost. Kazda zmiana daty/godzin/sali sprawdza kolizje w calej uczelni.
 */

export type OccurrenceFull = Occurrence & { placement: Placement | null; section: ClassSection };

/** Kolizje terminu na konkretnej dacie z zajetoscia calej uczelni (bez niego samego). */
export async function occurrenceConflicts(term: AcademicTerm, slot: Omit<BusySlot, 'label'>, opts: OccupancyOptions) {
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
 * Terminy rocznika wolno zmieniac: kalendarz nie w archiwum i wersja programu zatwierdzona.
 * Zwraca siatke godzin wydzialu i trybu rocznika — bloki terminu zamieniamy na rzeczywisty czas.
 */
export async function assertPlanEditable(termId: string, cohortId: string): Promise<GridTime> {
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: termId } });
  const [ctx] = await activeCohorts(term, null, [cohortId]);
  const calendar = ctx ? await calendarFor(term, ctx) : null;
  if (!ctx || !calendar) throw new AppError(409, 'Rocznik nie ma kalendarza w tym semestrze');
  if (calendar.status === 'ARCHIVED') throw new AppError(409, 'Kalendarz w archiwum — terminy tylko do odczytu');
  assertVersionApproved(ctx.cohort);
  return (await gridFor(ctx.cohort.program.fieldOfStudy.facultyId, ctx.cohort.program.studyMode)).time;
}

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

/** Aktywne odrobienie odwolanego terminu (termin reczny wskazujacy go kluczem obcym) albo null. */
export function activeMakeup(occurrenceId: string) {
  return prisma.occurrence.findFirst({ where: { makeupOfId: occurrenceId, status: { not: 'CANCELLED' } }, orderBy: { date: 'asc' } });
}

/** Trwaly klucz tekstowy terminu — zapisywany jeszcze obok klucza obcego (do usuniecia w etapie 4). */
const textKeyOf = (o: { id: string; kind: 'DERIVED' | 'MANUAL'; placementId: string | null; originalDate: Date | null }) =>
  occurrenceKey({ id: o.id, kind: o.kind, placementId: o.placementId, originalDate: o.originalDate ? toIsoDate(o.originalDate) : null });

/**
 * Odwolany termin, ktory ma juz odrobienie, nie wraca do planu (przywrocenie, przeniesienie) —
 * zajecia odbylyby sie dwa razy i liczyly podwojnie do godzin.
 */
async function assertNotMadeUp(occ: OccurrenceFull, what: string): Promise<void> {
  if (occ.status !== 'CANCELLED') return;
  const makeup = await activeMakeup(occ.id);
  if (makeup) {
    throw new AppError(
      409,
      `Te zajecia sa juz odrobione (${slotLabel(toIsoDate(makeup.date), makeup.startMinute, makeup.endMinute)}) — usun albo odwolaj odrobienie, zanim ${what}`,
    );
  }
}

/** Przywrocenie terminu z wzorca (usuwa wyjatek). Wraca na miejsce z wzorca — z kontrola kolizji. */
export async function restoreOccurrence(occ: OccurrenceFull, grid: GridTime): Promise<void> {
  if (!isDerived(occ)) throw new AppError(400, 'Przywracac mozna tylko terminy z wzorca');
  await assertNotMadeUp(occ, 'przywrocisz termin');
  const p = occ.placement!;
  const length = occ.endOrder - occ.startOrder + 1;
  const endOrder = Math.min(p.endOrder, p.startOrder + length - 1);
  const time = minutesOf(grid, p.startOrder, endOrder);
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
        status: 'SCHEDULED',
        // Powod odwolania/przeniesienia nie dotyczy terminu wg wzorca (generowanie tez go nie niesie).
        note: null,
      },
    }),
  ]);
}

/** Odwolanie terminu (z wzorca — wyjatkiem CANCEL). */
export async function cancelOccurrence(occ: OccurrenceFull, note: string | null): Promise<void> {
  await prisma.$transaction([
    ...(isDerived(occ)
      ? [
          prisma.placementException.upsert({
            where: { placementId_originalDate: { placementId: occ.placementId!, originalDate: occ.originalDate! } },
            create: { placementId: occ.placementId!, originalDate: occ.originalDate!, action: 'CANCEL', note },
            update: { action: 'CANCEL', note },
          }),
        ]
      : []),
    prisma.occurrence.update({ where: { id: occ.id }, data: { status: 'CANCELLED', note: note ?? occ.note } }),
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

/** Przeniesienie terminu (data, godziny, sala, prowadzacy) — z kontrola kolizji. */
export async function moveOccurrence(occ: OccurrenceFull, grid: GridTime, input: MoveInput): Promise<void> {
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
  await assertNotMadeUp(occ, 'przeniesiesz termin');
  const time = minutesOf(grid, next.startOrder, next.endOrder);
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
    action: 'MODIFY' as const,
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
      data: { ...next, ...time, date: fromIsoDate(next.date), status: 'SCHEDULED', note: note ?? occ.note },
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
  /** Odrobienie konkretnego odwolanego terminu (jego id) — nie zuzywa godzin drugi raz. */
  makeupOfId?: string | null;
  /** Planista potwierdzil ostrzezenia o dniu/godzinach (patrz lib/occurrenceSlot). */
  confirmWarnings?: boolean;
}

/** Termin reczny (odrobienie, zajecia jednorazowe) z kontrola kolizji. */
export async function createManualOccurrence(term: AcademicTerm, section: ClassSection, grid: GridTime, input: ManualInput) {
  const roomId = input.online ? null : (input.roomId ?? null);
  if (!isIsoDate(input.date) || !Number.isInteger(input.startOrder) || !Number.isInteger(input.endOrder) || input.endOrder < input.startOrder) {
    throw new AppError(400, 'Podaj date i godziny');
  }
  if (!input.online && !roomId) throw new AppError(400, 'Wybierz sale (albo zaznacz zajecia online)');
  // Odrobienie wskazanych zajec: musza to byc odwolane zajecia tej samej sekcji.
  let original: Occurrence | null = null;
  if (input.makeupOfId) {
    const found = await prisma.occurrence.findUnique({ where: { id: input.makeupOfId } });
    if (!found || found.sectionId !== section.id || found.status !== 'CANCELLED') {
      throw new AppError(400, 'Odrabiany termin nie jest odwolanym terminem tych zajec');
    }
    if (await activeMakeup(found.id)) throw new AppError(409, 'Te zajecia maja juz termin odrobienia');
    original = found;
  }
  // Prowadzacy: wskazany (null = NN); bez wskazania — z odrabianych zajec albo pierwszy z obsady.
  const instructorId =
    input.instructorId !== undefined
      ? input.instructorId
      : (original?.instructorId ??
        (await prisma.sectionInstructor.findFirst({ where: { sectionId: section.id, instructorId: { not: null } } }))?.instructorId ??
        null);
  const time = minutesOf(grid, input.startOrder, input.endOrder);
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
      status: 'MAKEUP',
      note: input.note ?? null,
      makeupOfId: original?.id ?? null,
      makeupOfKey: original ? textKeyOf(original) : null,
    },
  });
}
