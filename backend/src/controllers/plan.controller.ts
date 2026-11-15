import type { Request } from 'express';
import type { DayOfWeek } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import { assertFacultyScope, getCallerScope, assertCohortsInScope } from '../lib/facultyScope';
import { fromIsoDate, isIsoDate, toIsoDate } from '../lib/isoDate';
import { parseTermKey } from '../lib/terms';
import { mapRangeByTime } from '../lib/timeGrid';
import { gridFor, loadGrids, pickGrid } from '../services/timeGrids';
import { activeCohorts } from '../services/sections';
import { conflictMessage } from '../lib/conflictMessage';
import { listMakeups } from '../services/makeups';
import {
  assertPlanEditable,
  cancelOccurrence,
  createManualOccurrence as createManual,
  moveOccurrence,
  restoreOccurrence,
  type ManualInput,
  type MoveInput,
} from '../services/occurrenceChanges';
import {
  assertCohortTermWritable,
  assertVersionApproved,
  availability,
  checkPlacement,
  generate,
  planView,
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

const MAX_PERIOD = 60;

function parsePlacement(body: Record<string, unknown>): PlacementInput {
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
  const startOrder = int(body.startOrder);
  const endOrder = int(body.endOrder);
  // Zajecia online: bez sali (online = true albo roomId = null).
  const online = body.online === true || body.roomId === null;
  if (typeof body.sectionId !== 'string' || !DAYS.includes(String(body.dayOfWeek)) || startOrder === null || endOrder === null || (!online && typeof body.roomId !== 'string')) {
    throw new AppError(400, 'Podaj zajecia, dzien, godziny i sale (albo zaznacz zajecia online)');
  }
  // Wybrane tygodnie/zjazdy: numery z sensownego zakresu, bez powtorzen (semestr nie ma ich wiecej niz 60).
  const numbers = Array.isArray(body.numbers) ? body.numbers.filter((n): n is number => Number.isInteger(n)) : [];
  if (numbers.some((n) => n < 1 || n > MAX_PERIOD)) throw new AppError(400, `Numery tygodni i zjazdow musza byc od 1 do ${MAX_PERIOD}`);
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
    numbers: [...new Set(numbers)].sort((a, b) => a - b),
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
  // Bilans godzin jak w widoku planu (z limitem godzin zajec) — liczba dat we wzorcu bywa
  // wieksza niz liczba terminow, ktore faktycznie powstana (np. brakowala tylko 1 h).
  const planned = (await planView(term, section.cohortId)).sections.find((s) => s.id === section.id);
  const summary = planned
    ? `zaplanowane ${planned.plannedHours}/${planned.hours} h${planned.plannedHours < planned.hours ? ` — brakuje ${planned.hours - planned.plannedHours} h` : ''}`
    : `${check.dates} terminow w semestrze`;
  res.status(201).json({ data, message: `Zajecia umieszczone — ${summary}` });
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
  // Bloki dnia, w ktory zajecia trafiaja (siatki dnia moga miec inne godziny niz podstawowa).
  const ownGrid = (await gridFor(current.facultyId, current.section.cohort.program.studyMode)).forDay(input.dayOfWeek).time;
  const grids = joined.length ? await loadGrids() : new Map();
  const moves = joined.map((j) => {
    const other = pickGrid(grids, j.facultyId, j.section.cohort.program.studyMode);
    const orders = other ? mapRangeByTime(ownGrid, other.forDay(input.dayOfWeek).time, input.startOrder, input.endOrder) : null;
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
  await assertCohortTermWritable(current.term, current.section.cohort.id, 'plan');
  // Wygenerowane terminy zostaja (placementId -> null) do najblizszego generowania. Odlaczamy je
  // jawnie (a nie przez ON DELETE SET NULL), zeby updatedAt zapisal chwile usuniecia — po niej
  // plan pokazuje "terminy nieaktualne", dopoki terminow nie wygeneruje sie od nowa.
  // Odrobienia wskazuja terminy kluczem obcym (id), wiec odlaczenie ich nie rusza.
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
  await assertCohortsInScope(req, cohortIds);
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
      // Odrobienie: data odrabianych zajec (z wzorca, gdy byly przeniesione).
      makeupOf: { select: { date: true, originalDate: true } },
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
  // Powiazanie odwolanie <-> odrobienie: odwolany termin pokazuje swoje odrobienie, odrobienie —
  // date odrabianych zajec (zeby nie trzeba bylo zgadywac, czemu "Przywroc" jest zablokowane).
  const cancelledIds = rows.filter((o) => o.status === 'CANCELLED').map((o) => o.id);
  const makeups = cancelledIds.length
    ? await prisma.occurrence.findMany({
        where: { makeupOfId: { in: cancelledIds }, status: { not: 'CANCELLED' } },
        select: { makeupOfId: true, date: true, startMinute: true, endMinute: true },
        orderBy: { date: 'asc' },
      })
    : [];
  const madeUpBy = new Map<string, { date: string; startMinute: number; endMinute: number }>();
  for (const m of makeups) {
    if (!madeUpBy.has(m.makeupOfId!)) madeUpBy.set(m.makeupOfId!, { date: toIsoDate(m.date), startMinute: m.startMinute, endMinute: m.endMinute });
  }
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
      madeUpBy: o.status === 'CANCELLED' ? (madeUpBy.get(o.id) ?? null) : null,
      makeupOf: o.makeupOf ? toIsoDate(o.makeupOf.originalDate ?? o.makeupOf.date) : null,
    })),
  });
});

/**
 * Zmiana pojedynczego terminu: odwolanie, przeniesienie (data/godziny/sala/prowadzacy)
 * albo przywrocenie wg wzorca. Dla terminow z wzorca zapisujemy wyjatek, ktory przezyje
 * ponowne generowanie; terminy reczne zmieniamy wprost. Tylko planista (admin, dziekanat
 * wydzialu terminu) — prowadzacy nie odwoluje ani nie przenosi zajec. Tylko studia
 * niestacjonarne: stacjonarne maja terminy do wgladu (assertPlanEditable -> 409).
 */
export const changeOccurrence = asyncHandler(async (req, res) => {
  const occ = await prisma.occurrence.findUnique({ where: { id: String(req.params.id) }, include: { placement: true, section: true } });
  if (!occ) throw new AppError(404, 'Termin nie znaleziony');
  await assertFacultyScope(req, occ.facultyId);
  const grid = await assertPlanEditable(occ.termId, occ.section.cohortId);
  const body = req.body as { action: 'CANCEL' | 'MODIFY' | 'RESTORE' } & MoveInput;

  if (body.action === 'RESTORE') {
    await restoreOccurrence(occ, grid);
    res.json({ message: 'Termin przywrocony wg wzorca' });
    return;
  }
  if (body.action === 'CANCEL') {
    await cancelOccurrence(occ, body.note ?? null);
    res.json({ message: 'Termin odwolany' });
    return;
  }
  await moveOccurrence(occ, grid, body);
  res.json({ message: 'Termin zmieniony' });
});

/** Odwolane zajecia semestru i ich odrobienia (lista "Do odrobienia"); admin: ?facultyId albo wszystko. */
export const listCancelledToMakeUp = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  res.json({ data: await listMakeups(term, { facultyId: await facultyOf(req) }) });
});

/** Termin reczny (odrobienie, zajecia jednorazowe) — liczy sie do godzin i nie znika przy generowaniu. */
export const createManualOccurrence = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const body = req.body as { sectionId: string } & ManualInput;
  const section = await prisma.classSection.findUnique({ where: { id: body.sectionId } });
  if (!section || section.termId !== term.id) throw new AppError(400, 'Zajecia nie naleza do tego semestru');
  await assertFacultyScope(req, section.facultyId);
  const grid = await assertPlanEditable(term.id, section.cohortId);
  const data = await createManual(term, section, grid, body);
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
