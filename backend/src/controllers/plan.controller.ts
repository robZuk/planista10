import type { Request } from 'express';
import type { DayOfWeek } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import { assertFacultyScope, getCallerScope, assertCohortsInScope } from '../lib/facultyScope';
import { fromIsoDate, isIsoDate, toIsoDate } from '../lib/isoDate';
import { parseTermKey } from '../lib/terms';
import { mapRangeByTime } from '../lib/timeGrid';
import { inPeriod } from '../lib/teachingCalendar';
import { gridFor, loadGrids, pickGrid } from '../services/timeGrids';
import { activeCohorts } from '../services/sections';
import { conflictMessage } from '../lib/conflictMessage';
import { pdfFileName } from '../lib/planPrint';
import { renderPlanPdf } from '../lib/planPdf';
import { renderSheetPdf } from '../lib/planSheetPdf';
import { planPrint, type PrintSubject } from '../services/planPrint';
import { instructorOccupancy, roomOccupancy } from '../services/occupancyView';
import {
  assertPlanEditable,
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
  calendarFor,
  checkPlacement,
  generate,
  planView,
  refreshPlanningTerms,
  termsNote,
  type PlacementInput,
} from '../services/plan';

/**
 * Plan semestru: umieszczenia (wzorzec) i terminy. Uklada wylacznie planista. Terminy rocznikow
 * z kalendarzem "w przygotowaniu" przeliczaja sie po kazdym zapisie planu (refreshPlanningTerms),
 * w opublikowanym — tylko z "Generuj terminy" (najpierw podglad). Reczne poprawki terminow sa
 * zapisywane jako wyjatki i przezywaja ponowne generowanie. Zapisy ida pod blokada planu semestru.
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

/**
 * Druk planu (PDF): rocznik (arkusz dla studentow, opcjonalnie grupa), prowadzacy albo sala —
 * dokladnie jeden z parametrow cohortId / instructorId / roomId.
 */
export const getPlanPdf = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const param = (name: string) => (typeof req.query[name] === 'string' && req.query[name] ? String(req.query[name]) : null);
  const cohortId = param('cohortId');
  const instructorId = param('instructorId');
  const roomId = param('roomId');
  if ([cohortId, instructorId, roomId].filter(Boolean).length !== 1) throw new AppError(400, 'Wskaz rocznik, prowadzacego albo sale');
  const subject: PrintSubject = cohortId
    ? { kind: 'cohort', cohortId, groupId: param('groupId') }
    : instructorId
      ? { kind: 'instructor', instructorId }
      : { kind: 'room', roomId: roomId! };
  const print = await planPrint(term, subject);
  const pdf = print.kind === 'sheet' ? await renderSheetPdf(print.document) : await renderPlanPdf(print.document);
  const fileName = pdfFileName([print.document.title.split(' — ')[0] ?? 'plan', `${term.startYear}-${term.type === 'SUMMER' ? 'L' : 'Z'}`]);
  req.log.info({ subject: subject.kind, layout: print.kind, bytes: pdf.length }, 'wydruk planu');
  res
    .type('application/pdf')
    .set('Content-Disposition', `attachment; filename="${fileName}"`)
    .set('Access-Control-Expose-Headers', 'Content-Disposition')
    .send(pdf);
});

/** Tydzien widoku zajetosci: ?week=RRRR-MM-DD (dowolny dzien tygodnia); bez parametru — null. */
function occupancyWeek(req: Request): string | null {
  const week = typeof req.query.week === 'string' && req.query.week ? req.query.week : null;
  if (week !== null && !isIsoDate(week)) throw new AppError(400, 'Nieprawidlowa data tygodnia (RRRR-MM-DD)');
  return week;
}

/**
 * Zajetosc sal w tygodniu (cala uczelnia): ?week=RRRR-MM-DD (dowolny dzien tygodnia; bez parametru —
 * biezacy tydzien semestru albo pierwszy).
 */
export const getRoomOccupancy = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  res.json({ data: await roomOccupancy(term, occupancyWeek(req)) });
});

/** Zajetosc prowadzacych w tygodniu (cala uczelnia) — parametr tygodnia jak w zajetosci sal. */
export const getInstructorOccupancy = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  res.json({ data: await instructorOccupancy(term, occupancyWeek(req)) });
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
  const refresh = await refreshPlanningTerms(term, [section.cohortId]);
  // Bilans godzin jak w widoku planu (z limitem godzin zajec) — liczba dat we wzorcu bywa
  // wieksza niz liczba terminow, ktore faktycznie powstana (np. brakowala tylko 1 h).
  const planned = (await planView(term, section.cohortId)).sections.find((s) => s.id === section.id);
  const summary = planned
    ? `zaplanowane ${planned.plannedHours}/${planned.hours} h${planned.plannedHours < planned.hours ? ` — brakuje ${planned.hours - planned.plannedHours} h` : ''}`
    : `${check.dates} terminow w semestrze`;
  res.status(201).json({ data, message: `Zajecia umieszczone — ${summary}; ${termsNote(refresh)}` });
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
        include: { section: { select: { cohortId: true, cohort: { select: { program: { select: { studyMode: true } } } } } } },
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
  // Zajecia laczone przesuwaja tez umieszczenia innych rocznikow — ich terminy rowniez.
  const refresh = await refreshPlanningTerms(current.term, [current.section.cohort.id, ...joined.map((j) => j.section.cohortId)]);
  res.json({ data, message: `Umieszczenie zapisane — ${termsNote(refresh)}` });
});

/**
 * "Plan zjazdu" (studia niestacjonarne): zmiana zajec tylko w jednym zjezdzie albo ich
 * przeniesienie z tego zjazdu do innego (`toZjazd`). Umieszczenie obejmujace kilka zjazdow traci
 * zjazd `zjazd` (zostaje "na wybranych zjazdach": pozostale), a zajecia z niego dostaja wlasne
 * umieszczenie w zjezdzie docelowym z nowym dniem, godzinami, sala i prowadzacym. Kolizje nowego
 * miejsca jak przy umieszczeniu; obie zmiany w jednej transakcji.
 */
export const splitPlacementZjazd = asyncHandler(async (req, res) => {
  const current = await loadPlacement(String(req.params.id));
  await assertFacultyScope(req, current.facultyId);
  const zjazd = Number.isInteger(req.body?.zjazd) ? (req.body.zjazd as number) : null;
  if (current.cycle !== 'ZJAZD' || zjazd === null) throw new AppError(400, 'Wskaz zjazd (tylko zajecia w rytmie zjazdowym)');
  if (current.jointKey) throw new AppError(400, 'Zajecia laczone zmienia sie we wszystkich zjazdach naraz');
  const [ctx] = await activeCohorts(current.term, null, [current.section.cohort.id]);
  const calendar = ctx ? await calendarFor(current.term, ctx) : null;
  const target = calendar?.zjazdy.find((z) => z.number === zjazd);
  if (!calendar || !target) throw new AppError(400, 'Nie ma takiego zjazdu w kalendarzu rocznika');
  const covered = calendar.zjazdy.map((z) => z.number).filter((n) => inPeriod(current, n));
  if (!covered.includes(zjazd)) throw new AppError(400, 'Tych zajec nie ma w tym zjezdzie');
  const rest = covered.filter((n) => n !== zjazd);
  if (rest.length === 0) throw new AppError(400, 'Zajecia sa tylko w tym zjezdzie — zapisz zmiane calego umieszczenia');
  // Zjazd docelowy: ten sam (inny dzien, godziny, sala w tym zjezdzie) albo inny (przeniesienie).
  const toZjazd = req.body?.toZjazd == null ? zjazd : Number.isInteger(req.body.toZjazd) ? (req.body.toZjazd as number) : null;
  if (toZjazd === null || !calendar.zjazdy.some((z) => z.number === toZjazd)) {
    throw new AppError(400, 'Nie ma takiego zjazdu docelowego w kalendarzu rocznika');
  }
  // Nowe miejsce: tylko zjazd docelowy, bez zakresu od-do i bez laczenia z innymi zajeciami.
  const input = parsePlacement({
    ...req.body,
    sectionId: current.sectionId,
    cycle: 'ZJAZD',
    pattern: 'LIST',
    numbers: [toZjazd],
    fromIndex: null,
    toIndex: null,
    jointKey: null,
  });
  // Kolizje: stare umieszczenie pomijamy, gdy w zjezdzie docelowym go nie bedzie (znika z niego albo
  // nigdy tam nie bylo — pozostale zjazdy to inne daty). Gdy zostaje tam tez stare (np. "kazdy
  // zjazd"), jego termin sie liczy — inaczej dwa spotkania tych zajec moglyby wypasc naraz.
  const check = await checkPlacement(current.term, input, rest.includes(toZjazd) ? undefined : current.id);
  rejectIfInvalid(check);
  const data = await prisma.$transaction(async (tx) => {
    // Przeniesienia pojedynczych terminow z tego zjazdu dotyczyly starego miejsca.
    await tx.placementException.deleteMany({
      where: { placementId: current.id, originalDate: { gte: target.startDate, lte: target.endDate } },
    });
    await tx.placement.update({ where: { id: current.id }, data: { pattern: 'LIST', numbers: rest, fromIndex: null, toIndex: null } });
    return tx.placement.create({ data: { ...input, termId: current.termId, facultyId: current.facultyId } });
  });
  const refresh = await refreshPlanningTerms(current.term, [current.section.cohort.id]);
  const what = toZjazd === zjazd ? 'Zajecia zmienione tylko w tym zjezdzie' : 'Zajecia przeniesione do innego zjazdu';
  res.status(201).json({ data, message: `${what} — ${termsNote(refresh)}` });
});

export const deletePlacement = asyncHandler(async (req, res) => {
  const current = await loadPlacement(String(req.params.id));
  await assertFacultyScope(req, current.facultyId);
  assertVersionApproved(current.section.cohort);
  await assertCohortTermWritable(current.term, current.section.cohort.id, 'plan');
  // Wygenerowane terminy zostaja (placementId -> null) do najblizszego generowania. Odlaczamy je
  // jawnie (a nie przez ON DELETE SET NULL), zeby updatedAt zapisal chwile usuniecia — po niej
  // plan pokazuje "terminy nieaktualne", dopoki terminow nie wygeneruje sie od nowa. W kalendarzu
  // "w przygotowaniu" przeliczenie zaraz po usunieciu kasuje je od razu.
  await prisma.$transaction([
    prisma.occurrence.updateMany({ where: { placementId: current.id }, data: { placementId: null } }),
    prisma.placement.delete({ where: { id: current.id } }),
  ]);
  const refresh = await refreshPlanningTerms(current.term, [current.section.cohort.id]);
  res.json({
    message: refresh.cohortIds.length > 0 ? 'Umieszczenie usuniete — terminy przeliczone' : 'Umieszczenie usuniete — jego terminy znikna przy kolejnym "Generuj terminy"',
  });
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
      changed: !!o.placementId && !!o.originalDate && exceptionKeys.has(`${o.placementId}|${toIsoDate(o.originalDate)}`),
      note: o.note,
    })),
  });
});

/**
 * Zmiana pojedynczego terminu: przeniesienie (data/godziny/sala/prowadzacy) albo przywrocenie
 * wg wzorca. Dla terminow z wzorca zapisujemy wyjatek, ktory przezyje ponowne generowanie;
 * terminy reczne zmieniamy wprost. Odwolan nie ma (zajecia sie przenosi). Tylko planista
 * (admin, dziekanat wydzialu terminu) — prowadzacy nie przenosi zajec. Tylko studia
 * niestacjonarne: stacjonarne maja terminy do wgladu (assertPlanEditable -> 409).
 */
export const changeOccurrence = asyncHandler(async (req, res) => {
  const body = req.body as { action?: string } & MoveInput;
  if (body.action === 'CANCEL') throw new AppError(400, 'Odwolan nie ma — zajecia, ktore maja sie odbyc w innym dniu, przenies');
  if (body.action !== 'MODIFY' && body.action !== 'RESTORE') throw new AppError(400, 'Nieznana zmiana terminu (MODIFY albo RESTORE)');
  const occ = await prisma.occurrence.findUnique({ where: { id: String(req.params.id) }, include: { placement: true, section: true } });
  if (!occ) throw new AppError(404, 'Termin nie znaleziony');
  await assertFacultyScope(req, occ.facultyId);
  const grid = await assertPlanEditable(occ.termId, occ.section.cohortId);

  if (body.action === 'RESTORE') {
    await restoreOccurrence(occ, grid);
    res.json({ message: 'Termin przywrocony wg wzorca' });
    return;
  }
  await moveOccurrence(occ, grid, body);
  res.json({ message: 'Termin zmieniony' });
});

/** Termin reczny (zajecia dodatkowe, jednorazowe) — liczy sie do godzin i nie znika przy generowaniu. */
export const createManualOccurrence = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const body = req.body as { sectionId: string } & ManualInput;
  const section = await prisma.classSection.findUnique({ where: { id: body.sectionId } });
  if (!section || section.termId !== term.id) throw new AppError(400, 'Zajecia nie naleza do tego semestru');
  await assertFacultyScope(req, section.facultyId);
  const grid = await assertPlanEditable(term.id, section.cohortId);
  const data = await createManual(term, section, grid, body);
  // Termin reczny zuzywa godziny — w kalendarzu "w przygotowaniu" terminy z wzorca od razu ustepuja.
  const refresh = await refreshPlanningTerms(term, [section.cohortId]);
  res.status(201).json({ data, message: `Termin reczny dodany${refresh.cohortIds.length > 0 ? ' — terminy przeliczone' : ''}` });
});

export const deleteManualOccurrence = asyncHandler(async (req, res) => {
  const occ = await prisma.occurrence.findUnique({ where: { id: String(req.params.id) }, include: { section: { select: { cohortId: true } } } });
  if (!occ) throw new AppError(404, 'Termin nie znaleziony');
  await assertFacultyScope(req, occ.facultyId);
  if (occ.kind !== 'MANUAL') throw new AppError(409, 'Termin z wzorca mozna przeniesc, ale nie usunac');
  await assertPlanEditable(occ.termId, occ.section.cohortId);
  await prisma.occurrence.delete({ where: { id: occ.id } });
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: occ.termId } });
  const refresh = await refreshPlanningTerms(term, [occ.section.cohortId]);
  res.json({ message: `Termin reczny usuniety${refresh.cohortIds.length > 0 ? ' — terminy przeliczone' : ''}` });
});
