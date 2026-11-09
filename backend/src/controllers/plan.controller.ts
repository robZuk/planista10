import type { Request } from 'express';
import type { AcademicTerm, DayOfWeek } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import { assertFacultyScope, getCallerScope } from '../lib/facultyScope';
import { fromIsoDate, isIsoDate, toIsoDate } from '../lib/isoDate';
import { parseTermKey } from '../lib/terms';
import { findConflict, type BusySlot } from '../lib/materializer';
import { groupsOverlap, indexGroups } from '../lib/groupTree';
import { mapRangeByTime, type GridTime } from '../lib/timeGrid';
import { gridFor, loadGrids, pickGrid } from '../services/timeGrids';
import { toTreeGroup } from '../services/cohorts';
import { activeCohorts } from '../services/sections';
import { conflictMessage, singleConflictMessage } from '../lib/conflictMessage';
import {
  assertVersionApproved,
  availability,
  calendarFor,
  checkPlacement,
  generate,
  planView,
  termOccupancy,
  type OccupancyOptions,
  type PlacementInput,
} from '../services/plan';

/**
 * Plan semestru: umieszczenia (wzorzec) i terminy. Uklada wylacznie planista; terminy
 * powstaja tylko z "Generuj terminy" (najpierw podglad). Reczne poprawki terminow sa
 * zapisywane jako wyjatki i przezywaja ponowne generowanie.
 */

async function findTerm(key: string) {
  const ref = parseTermKey(key);
  if (!ref) throw new AppError(400, 'Nieprawidlowy klucz semestru');
  const term = await prisma.academicTerm.findUnique({ where: { startYear_type: ref } });
  if (!term) throw new AppError(404, 'Semestr nie istnieje');
  return term;
}

async function facultyOf(req: Request): Promise<string | null> {
  const scope = await getCallerScope(req);
  const requested =
    (typeof req.query.facultyId === 'string' ? req.query.facultyId : null) ??
    (typeof req.body?.facultyId === 'string' ? req.body.facultyId : null);
  if (scope.isAdmin) return requested && requested !== 'all' ? requested : null;
  if (!scope.facultyId) throw new AppError(403, 'Konto bez przypisanego wydzialu');
  return scope.facultyId;
}

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

function parsePlacement(body: Record<string, unknown>): PlacementInput {
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
  const startOrder = int(body.startOrder);
  const endOrder = int(body.endOrder);
  // Zajecia online: bez sali (online = true albo roomId = null).
  const online = body.online === true || body.roomId === null;
  if (typeof body.sectionId !== 'string' || !DAYS.includes(String(body.dayOfWeek)) || startOrder === null || endOrder === null || (!online && typeof body.roomId !== 'string')) {
    throw new AppError(400, 'Podaj zajecia, dzien, godziny i sale (albo zaznacz zajecia online)');
  }
  const cycle = body.cycle === 'ZJAZD' ? 'ZJAZD' : 'WEEK';
  const pattern = ['ALL', 'EVEN', 'ODD', 'LIST'].includes(String(body.pattern)) ? (body.pattern as PlacementInput['pattern']) : 'ALL';
  return {
    sectionId: body.sectionId,
    dayOfWeek: body.dayOfWeek as DayOfWeek,
    startOrder,
    endOrder,
    roomId: online ? null : (body.roomId as string),
    instructorId: typeof body.instructorId === 'string' && body.instructorId ? body.instructorId : null,
    cycle,
    pattern,
    numbers: Array.isArray(body.numbers) ? body.numbers.filter((n): n is number => Number.isInteger(n)) : [],
    fromIndex: int(body.fromIndex),
    toIndex: int(body.toIndex),
    jointKey: typeof body.jointKey === 'string' && body.jointKey.trim() ? body.jointKey.trim() : null,
  };
}

/** Bledy -> 400, kolizje -> 409 z kolizjami pogrupowanymi wg przyczyny i zajec (lib/conflictMessage). */
function rejectIfInvalid(check: Awaited<ReturnType<typeof checkPlacement>>) {
  if (check.errors.length > 0) throw new AppError(400, check.errors.join('; '));
  if (check.conflicts.length > 0) throw new AppError(409, conflictMessage(check.conflicts));
}

export const getPlan = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const cohortId = String(req.query.cohortId ?? '');
  if (!cohortId) throw new AppError(400, 'Wskaz rocznik');
  res.json({ data: await planView(term, cohortId) });
});

export const getAvailability = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const numbers = String(req.query.numbers ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  res.json({
    data: await availability(term, String(req.query.sectionId ?? ''), Math.max(1, Number(req.query.length) || 2), {
      roomId: typeof req.query.roomId === 'string' && req.query.roomId ? req.query.roomId : undefined,
      cycle: req.query.cycle === 'ZJAZD' ? 'ZJAZD' : 'WEEK',
      pattern: numbers.length > 0 ? 'LIST' : 'ALL',
      numbers,
    }),
  });
});

export const createPlacement = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const input = parsePlacement(req.body);
  const section = await prisma.classSection.findUnique({ where: { id: input.sectionId } });
  if (!section) throw new AppError(404, 'Zajecia nie znalezione');
  await assertFacultyScope(req, section.facultyId);
  const check = await checkPlacement(term, input);
  rejectIfInvalid(check);
  const data = await prisma.placement.create({ data: { ...input, termId: term.id, facultyId: section.facultyId } });
  res.status(201).json({ data, message: `Zajecia umieszczone (${check.dates} terminow w semestrze)` });
});

async function loadPlacement(id: string) {
  const placement = await prisma.placement.findUnique({
    where: { id },
    include: { term: true, section: { select: { cohort: { include: { program: true, programVersion: true, startTerm: true } } } } },
  });
  if (!placement) throw new AppError(404, 'Umieszczenie nie znalezione');
  return placement;
}

export const updatePlacement = asyncHandler(async (req, res) => {
  const current = await loadPlacement(String(req.params.id));
  await assertFacultyScope(req, current.facultyId);
  const input = parsePlacement({ ...current, ...req.body, sectionId: current.sectionId });
  const check = await checkPlacement(current.term, input, current.id);
  rejectIfInvalid(check);
  // Zajecia laczone: ten sam rzeczywisty czas, sala i rytm dla calej grupy umieszczen. Wydzialy
  // moga miec rozne siatki — bloki pozostalych umieszczen przenosimy po godzinach (checkPlacement
  // sprawdzil juz, ze te godziny istnieja w ich siatkach).
  const joined = input.jointKey
    ? await prisma.placement.findMany({
        where: { termId: current.termId, jointKey: input.jointKey, id: { not: current.id } },
        include: { section: { select: { cohort: { select: { program: { select: { studyMode: true } } } } } } },
      })
    : [];
  const ownGrid = (await gridFor(current.facultyId, current.section.cohort.program.studyMode)).time;
  const grids = joined.length ? await loadGrids() : new Map();
  const moves = joined.map((j) => {
    const other = pickGrid(grids, j.facultyId, j.section.cohort.program.studyMode);
    const orders = other ? mapRangeByTime(ownGrid, other.time, input.startOrder, input.endOrder) : null;
    if (!orders) throw new AppError(400, 'Zajecia laczone: godzin nie ma w siatce wydzialu polaczonych zajec');
    return { id: j.id, ...orders };
  });
  const data = await prisma.$transaction(async (tx) => {
    const updated = await tx.placement.update({ where: { id: current.id }, data: input });
    for (const m of moves) {
      await tx.placement.update({
        where: { id: m.id },
        data: {
          dayOfWeek: input.dayOfWeek,
          startOrder: m.startOrder,
          endOrder: m.endOrder,
          roomId: input.roomId,
          cycle: input.cycle,
          pattern: input.pattern,
          numbers: input.numbers,
          fromIndex: input.fromIndex,
          toIndex: input.toIndex,
        },
      });
    }
    return updated;
  });
  res.json({ data, message: 'Umieszczenie zapisane — terminy zmienia sie po "Generuj terminy"' });
});

export const deletePlacement = asyncHandler(async (req, res) => {
  const current = await loadPlacement(String(req.params.id));
  await assertFacultyScope(req, current.facultyId);
  assertVersionApproved(current.section.cohort);
  // Wygenerowane terminy zostaja (placementId -> null) do najblizszego generowania. Odlaczamy je
  // jawnie (a nie przez ON DELETE SET NULL), zeby updatedAt zapisal chwile usuniecia — po niej
  // plan pokazuje "terminy nieaktualne", dopoki terminow nie wygeneruje sie od nowa.
  await prisma.$transaction([
    prisma.occurrence.updateMany({ where: { placementId: current.id }, data: { placementId: null } }),
    prisma.placement.delete({ where: { id: current.id } }),
  ]);
  res.json({ message: 'Umieszczenie usuniete — jego terminy znikna przy kolejnym "Generuj terminy"' });
});

export const generateTerms = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const facultyId = await facultyOf(req);
  const { dryRun = true, cohortIds, fromDate } = req.body as { dryRun?: boolean; cohortIds?: string[]; fromDate?: string | null };
  if (fromDate && !isIsoDate(fromDate)) throw new AppError(400, 'Nieprawidlowa data "od kiedy"');
  const report = await generate(term, { facultyId, cohortIds, fromDate: fromDate ?? null, dryRun });
  res.json({
    data: report,
    message: dryRun
      ? 'Podglad generowania'
      : `Wygenerowano ${report.total} terminow (+${report.added}, zmienione ${report.changed}, usuniete ${report.removed}); kolizje: ${report.conflicts.length}`,
  });
});

// ─── Terminy ─────────────────────────────────────────────────

export const listOccurrences = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const cohortId = String(req.query.cohortId ?? '');
  const from = typeof req.query.from === 'string' && isIsoDate(req.query.from) ? fromIsoDate(req.query.from) : undefined;
  const to = typeof req.query.to === 'string' && isIsoDate(req.query.to) ? fromIsoDate(req.query.to) : undefined;
  const [ctx] = await activeCohorts(term, null, [cohortId]);
  if (!ctx) throw new AppError(404, 'Rocznik nie ma zajec w tym semestrze');
  const rows = await prisma.occurrence.findMany({
    where: { termId: term.id, section: { cohortId }, ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    include: {
      section: { select: { classType: true, programEntry: { select: { subject: { select: { name: true } } } } } },
      room: { select: { number: true, building: { select: { name: true } } } },
      instructor: { select: { title: true, firstName: true, lastName: true } },
    },
    orderBy: [{ date: 'asc' }, { startMinute: 'asc' }],
  });
  const exceptionKeys = new Set(
    (
      await prisma.placementException.findMany({
        where: { placement: { termId: term.id, section: { cohortId } } },
        select: { placementId: true, originalDate: true },
      })
    ).map((e) => `${e.placementId}|${toIsoDate(e.originalDate)}`),
  );
  res.json({
    data: rows.map((o) => ({
      id: o.id,
      sectionId: o.sectionId,
      placementId: o.placementId,
      date: toIsoDate(o.date),
      originalDate: o.originalDate ? toIsoDate(o.originalDate) : null,
      startOrder: o.startOrder,
      endOrder: o.endOrder,
      startMinute: o.startMinute,
      endMinute: o.endMinute,
      subject: o.section.programEntry.subject.name,
      classType: o.section.classType,
      group: ctx.nameOf(o.groupId),
      groupId: o.groupId,
      room: o.room ? { id: o.roomId, label: `${o.room.number} (${o.room.building.name})` } : { id: null, label: 'ON-LINE' },
      instructor: o.instructor ? `${o.instructor.title ?? ''} ${o.instructor.firstName} ${o.instructor.lastName}`.trim() : 'NN',
      instructorId: o.instructorId,
      kind: o.kind,
      status: o.status,
      changed: !!o.placementId && !!o.originalDate && exceptionKeys.has(`${o.placementId}|${toIsoDate(o.originalDate)}`),
      note: o.note,
    })),
  });
});

/** Kolizje terminu na konkretnej dacie z zajetoscia calej uczelni (bez niego samego). */
async function occurrenceConflicts(term: AcademicTerm, slot: Omit<BusySlot, 'label'>, opts: OccupancyOptions) {
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
async function assertPlanEditable(termId: string, cohortId: string): Promise<GridTime> {
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: termId } });
  const [ctx] = await activeCohorts(term, null, [cohortId]);
  const calendar = ctx ? await calendarFor(term, ctx) : null;
  if (!ctx || !calendar) throw new AppError(409, 'Rocznik nie ma kalendarza w tym semestrze');
  if (calendar.status === 'ARCHIVED') throw new AppError(409, 'Kalendarz w archiwum — terminy tylko do odczytu');
  assertVersionApproved(ctx.cohort);
  return (await gridFor(ctx.cohort.program.fieldOfStudy.facultyId, ctx.cohort.program.studyMode)).time;
}

/** Zakres blokow -> minuty; blok spoza siatki kalendarza to blad wejscia. */
function minutesOf(grid: GridTime, startOrder: number, endOrder: number) {
  const time = grid.range(startOrder, endOrder);
  if (!time) throw new AppError(400, 'Godziny poza siatka godzin wydzialu');
  return time;
}

/**
 * Zmiana pojedynczego terminu: odwolanie, przeniesienie (data/godziny/sala/prowadzacy)
 * albo przywrocenie wg wzorca. Dla terminow z wzorca zapisujemy wyjatek, ktory przezyje
 * ponowne generowanie; terminy reczne zmieniamy wprost.
 */
export const changeOccurrence = asyncHandler(async (req, res) => {
  const occ = await prisma.occurrence.findUnique({ where: { id: String(req.params.id) }, include: { placement: true, section: true } });
  if (!occ) throw new AppError(404, 'Termin nie znaleziony');
  await assertFacultyScope(req, occ.facultyId);
  const grid = await assertPlanEditable(occ.termId, occ.section.cohortId);
  const body = req.body as {
    action: 'CANCEL' | 'MODIFY' | 'RESTORE';
    date?: string;
    startOrder?: number;
    endOrder?: number;
    roomId?: string;
    /** true = przenies na online (bez sali); false + roomId = do sali. */
    online?: boolean;
    instructorId?: string | null;
    note?: string;
  };
  const derived = occ.kind === 'DERIVED' && occ.placement && occ.originalDate;

  if (body.action === 'RESTORE') {
    if (!derived) throw new AppError(400, 'Przywracac mozna tylko terminy z wzorca');
    const p = occ.placement!;
    const length = occ.endOrder - occ.startOrder + 1;
    const endOrder = Math.min(p.endOrder, p.startOrder + length - 1);
    const time = minutesOf(grid, p.startOrder, endOrder);
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
          status: 'SCHEDULED',
        },
      }),
    ]);
    res.json({ message: 'Termin przywrocony wg wzorca' });
    return;
  }

  if (body.action === 'CANCEL') {
    await prisma.$transaction([
      ...(derived
        ? [
            prisma.placementException.upsert({
              where: { placementId_originalDate: { placementId: occ.placementId!, originalDate: occ.originalDate! } },
              create: { placementId: occ.placementId!, originalDate: occ.originalDate!, action: 'CANCEL', note: body.note ?? null },
              update: { action: 'CANCEL', note: body.note ?? null },
            }),
          ]
        : []),
      prisma.occurrence.update({ where: { id: occ.id }, data: { status: 'CANCELLED', note: body.note ?? occ.note } }),
    ]);
    res.json({ message: 'Termin odwolany' });
    return;
  }

  // MODIFY
  const date = body.date ?? toIsoDate(occ.date);
  if (!isIsoDate(date)) throw new AppError(400, 'Nieprawidlowa data');
  const next = {
    date,
    startOrder: body.startOrder ?? occ.startOrder,
    endOrder: body.endOrder ?? occ.endOrder,
    roomId: body.online ? null : (body.roomId ?? occ.roomId),
    instructorId: body.instructorId === undefined ? occ.instructorId : body.instructorId,
  };
  if (next.endOrder < next.startOrder) throw new AppError(400, 'Nieprawidlowy zakres godzin');
  if (body.online === false && !next.roomId) throw new AppError(400, 'Wybierz sale (albo zostaw zajecia online)');
  const time = minutesOf(grid, next.startOrder, next.endOrder);
  const occTerm = await prisma.academicTerm.findUniqueOrThrow({ where: { id: occ.termId } });
  const conflict = await occurrenceConflicts(
    occTerm,
    { date: next.date, ...time, roomId: next.roomId, instructorId: next.instructorId, groupId: occ.groupId, jointKey: occ.jointKey },
    // Bez niego samego: termin wzorca (placement + data z wzorca) albo termin reczny/osierocony.
    derived ? { excludePatternKey: `${occ.placementId}|${toIsoDate(occ.originalDate!)}`, excludeOccurrenceId: occ.id } : { excludeOccurrenceId: occ.id },
  );
  if (conflict) throw new AppError(409, singleConflictMessage(conflict));
  await prisma.$transaction([
    ...(derived
      ? [
          prisma.placementException.upsert({
            where: { placementId_originalDate: { placementId: occ.placementId!, originalDate: occ.originalDate! } },
            create: {
              placementId: occ.placementId!,
              originalDate: occ.originalDate!,
              action: 'MODIFY',
              newDate: fromIsoDate(next.date),
              newStartOrder: next.startOrder,
              newEndOrder: next.endOrder,
              newRoomId: next.roomId,
              newOnline: next.roomId === null ? true : null,
              newInstructorId: next.instructorId,
              note: body.note ?? null,
            },
            update: {
              action: 'MODIFY',
              newDate: fromIsoDate(next.date),
              newStartOrder: next.startOrder,
              newEndOrder: next.endOrder,
              newRoomId: next.roomId,
              newOnline: next.roomId === null ? true : null,
              newInstructorId: next.instructorId,
              note: body.note ?? null,
            },
          }),
        ]
      : []),
    prisma.occurrence.update({
      where: { id: occ.id },
      data: { ...next, ...time, date: fromIsoDate(next.date), status: 'SCHEDULED', note: body.note ?? occ.note },
    }),
  ]);
  res.json({ message: 'Termin zmieniony' });
});

/** Termin reczny (odrobienie, zajecia jednorazowe) — liczy sie do godzin i nie znika przy generowaniu. */
export const createManualOccurrence = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const body = req.body as { sectionId: string; date: string; startOrder: number; endOrder: number; roomId?: string | null; online?: boolean; instructorId?: string | null; note?: string };
  const roomId = body.online ? null : (body.roomId ?? null);
  const section = await prisma.classSection.findUnique({ where: { id: body.sectionId } });
  if (!section || section.termId !== term.id) throw new AppError(400, 'Zajecia nie naleza do tego semestru');
  await assertFacultyScope(req, section.facultyId);
  const grid = await assertPlanEditable(term.id, section.cohortId);
  if (!isIsoDate(body.date) || !Number.isInteger(body.startOrder) || !Number.isInteger(body.endOrder) || body.endOrder < body.startOrder) {
    throw new AppError(400, 'Podaj date i godziny');
  }
  if (!body.online && !roomId) throw new AppError(400, 'Wybierz sale (albo zaznacz zajecia online)');
  const time = minutesOf(grid, body.startOrder, body.endOrder);
  const conflict = await occurrenceConflicts(
    term,
    { date: body.date, ...time, roomId, instructorId: body.instructorId ?? null, groupId: section.groupId, jointKey: null },
    {},
  );
  if (conflict) throw new AppError(409, singleConflictMessage(conflict));
  const data = await prisma.occurrence.create({
    data: {
      termId: term.id,
      facultyId: section.facultyId,
      sectionId: section.id,
      date: fromIsoDate(body.date),
      startOrder: body.startOrder,
      endOrder: body.endOrder,
      ...time,
      roomId,
      instructorId: body.instructorId ?? null,
      groupId: section.groupId,
      kind: 'MANUAL',
      status: 'MAKEUP',
      note: body.note ?? null,
    },
  });
  res.status(201).json({ data, message: 'Termin reczny dodany' });
});

export const deleteManualOccurrence = asyncHandler(async (req, res) => {
  const occ = await prisma.occurrence.findUnique({ where: { id: String(req.params.id) }, include: { section: { select: { cohortId: true } } } });
  if (!occ) throw new AppError(404, 'Termin nie znaleziony');
  await assertFacultyScope(req, occ.facultyId);
  if (occ.kind !== 'MANUAL') throw new AppError(409, 'Termin z wzorca mozna odwolac, ale nie usunac');
  await assertPlanEditable(occ.termId, occ.section.cohortId);
  await prisma.occurrence.delete({ where: { id: occ.id } });
  res.json({ message: 'Termin reczny usuniety' });
});
