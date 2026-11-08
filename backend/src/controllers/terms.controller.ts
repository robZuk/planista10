import type { CalendarStatus, Prisma, StudyMode } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import { assertFacultyScope, getCallerScope } from '../lib/facultyScope';
import { fromIsoDate, isIsoDate, todayIso } from '../lib/isoDate';
import { holidaysInRange } from '../lib/holidays';
import { validateCalendar } from '../lib/teachingCalendar';
import { academicYearOf, parseTermKey, termKey, termLabel, termOrdinal, type TermRef } from '../lib/terms';
import {
  bodyToInput,
  calendarInclude,
  childrenData,
  pickDefaultTerm,
  preview,
  proposeCalendar,
  serializeCalendar,
} from '../services/termCalendars';
import type { CalendarBody } from '../schemas/termCalendar';
import { calendarUsage, type CalendarUsage } from '../services/plan';

/** Semestr z klucza URL ("2026-Z") albo 404. */
async function findTerm(key: string) {
  const ref = parseTermKey(key);
  if (!ref) throw new AppError(400, 'Nieprawidlowy klucz semestru (oczekiwano np. 2026-Z)');
  const term = await prisma.academicTerm.findUnique({ where: { startYear_type: ref } });
  if (!term) throw new AppError(404, 'Semestr nie istnieje');
  return term;
}

function termDto(term: TermRef & { id: string }) {
  return {
    id: term.id,
    key: termKey(term),
    label: termLabel(term),
    academicYear: academicYearOf(term),
    startYear: term.startYear,
    type: term.type,
    ordinal: termOrdinal(term),
  };
}

/** Kalendarz nie do ruszenia po archiwizacji — tylko admin moze go odarchiwizowac. */
function assertEditable(status: CalendarStatus) {
  if (status === 'ARCHIVED') {
    throw new AppError(409, 'Kalendarz jest w archiwum — tylko do odczytu');
  }
}

function assertConsistent(body: CalendarBody, studyMode: StudyMode) {
  const problems = validateCalendar(bodyToInput(body, studyMode));
  if (problems.length > 0) throw new AppError(400, problems.join('; '));
}

// ─── Semestry ────────────────────────────────────────────────

/**
 * Lista semestrow z kalendarzami widocznymi dla wywolujacego i semestrem domyslnym
 * dla przelacznika. Dziekanat widzi kalendarze tylko swojego wydzialu; prowadzacy
 * i studenci — tylko opublikowane i archiwalne.
 */
export const listTerms = asyncHandler(async (req, res) => {
  const scope = await getCallerScope(req);
  const terms = await prisma.academicTerm.findMany({
    include: {
      calendars: {
        select: { id: true, facultyId: true, studyMode: true, name: true, status: true, kind: true },
        where: {
          ...(scope.isAdmin ? {} : scope.isPlanner ? { facultyId: scope.facultyId ?? '__none__' } : {}),
          ...(scope.isPlanner ? {} : { status: { in: ['PUBLISHED', 'ARCHIVED'] as CalendarStatus[] } }),
        },
      },
    },
  });
  terms.sort((a, b) => termOrdinal(b) - termOrdinal(a));
  res.json({
    data: terms.map((term) => ({ ...termDto(term), calendars: term.calendars })),
    defaultKey: pickDefaultTerm(terms, scope.facultyId, todayIso()),
  });
});

export const createTerm = asyncHandler(async (req, res) => {
  const { startYear, type } = req.body as TermRef;
  const exists = await prisma.academicTerm.findUnique({ where: { startYear_type: { startYear, type } } });
  if (exists) throw new AppError(409, `Semestr ${termLabel({ startYear, type })} juz istnieje`);
  const term = await prisma.academicTerm.create({ data: { startYear, type } });
  res.status(201).json({ data: termDto(term), message: `Utworzono semestr ${termLabel(term)}` });
});

export const deleteTerm = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const calendars = await prisma.termCalendar.count({ where: { termId: term.id } });
  if (calendars > 0) {
    throw new AppError(409, 'Semestr ma kalendarze wydzialow — usun je najpierw');
  }
  await prisma.academicTerm.delete({ where: { id: term.id } });
  res.json({ message: `Usunieto semestr ${termLabel(term)}` });
});

/** Swieta ustawowe w zakresie dat — liczone, nie przechowywane. */
export const statutoryHolidays = asyncHandler(async (req, res) => {
  const from = String(req.query.from ?? '');
  const to = String(req.query.to ?? '');
  if (!isIsoDate(from) || !isIsoDate(to)) throw new AppError(400, 'Podaj zakres dat from/to (RRRR-MM-DD)');
  res.json({ data: holidaysInRange(from, to) });
});

// ─── Kalendarze semestru ─────────────────────────────────────

export const listCalendars = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const scope = await getCallerScope(req);
  const requested = typeof req.query.facultyId === 'string' && req.query.facultyId !== 'all' ? req.query.facultyId : null;

  const where: Prisma.TermCalendarWhereInput = { termId: term.id };
  if (scope.isAdmin) {
    if (requested) where.facultyId = requested;
  } else if (scope.isPlanner) {
    if (!scope.facultyId) {
      res.json({ data: [] });
      return;
    }
    where.facultyId = scope.facultyId;
  } else {
    if (requested) where.facultyId = requested;
    where.status = { in: ['PUBLISHED', 'ARCHIVED'] };
  }

  const calendars = await prisma.termCalendar.findMany({
    where,
    include: calendarInclude,
    orderBy: [{ facultyId: 'asc' }, { studyMode: 'asc' }, { name: 'asc' }],
  });
  res.json({ data: calendars.map(serializeCalendar) });
});

export const calendarProposal = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const scope = await getCallerScope(req);
  const facultyId = scope.isAdmin ? String(req.query.facultyId ?? '') : scope.facultyId;
  if (!facultyId) throw new AppError(400, 'Wskaz wydzial');
  const studyMode = req.query.studyMode === 'PART_TIME' ? 'PART_TIME' : 'FULL_TIME';
  const name = typeof req.query.name === 'string' && req.query.name.trim() ? req.query.name.trim() : 'Podstawowy';
  res.json({ data: await proposeCalendar(term, facultyId, studyMode, name) });
});

export const previewCalendar = asyncHandler(async (req, res) => {
  const body = req.body as CalendarBody & { studyMode: StudyMode };
  const input = bodyToInput(body, body.studyMode);
  const problems = validateCalendar(input);
  // Przy rozjechanych datach podglad tygodni nie ma sensu — wystarcza problemy.
  res.json({ data: { problems, ...(input.startDate <= input.endDate ? preview(input) : {}) } });
});

/**
 * Zalozenie kalendarza. Dziekanat zaklada wylacznie dla swojego wydzialu; admin moze
 * wskazac wydzial albo zalozyc ten sam kalendarz kazdemu wydzialowi naraz — wydzialy,
 * ktore maja juz kalendarz tego trybu i wariantu, sa pomijane.
 */
export const createCalendar = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const body = req.body as CalendarBody & { studyMode: StudyMode; facultyId?: string; allFaculties?: boolean };
  assertConsistent(body, body.studyMode);

  const scope = await getCallerScope(req);
  let targets: string[];
  if (scope.isAdmin) {
    if (body.allFaculties) {
      targets = (await prisma.faculty.findMany({ select: { id: true } })).map((f) => f.id);
    } else if (body.facultyId) {
      targets = [body.facultyId];
    } else {
      throw new AppError(400, 'Wskaz wydzial albo zaznacz "wszystkie wydzialy"');
    }
  } else {
    if (!scope.facultyId) throw new AppError(403, 'Konto dziekanatu nie ma przypisanego wydzialu');
    targets = [scope.facultyId];
  }

  const existing = await prisma.termCalendar.findMany({
    where: { termId: term.id, studyMode: body.studyMode, name: body.name, facultyId: { in: targets } },
    select: { facultyId: true },
  });
  const taken = new Set(existing.map((c) => c.facultyId));
  const toCreate = targets.filter((id) => !taken.has(id));
  if (toCreate.length === 0) {
    throw new AppError(409, `Kalendarz "${body.name}" dla tego trybu juz istnieje`);
  }

  const children = childrenData(body);
  const created = await prisma.$transaction(
    toCreate.map((facultyId) =>
      prisma.termCalendar.create({
        data: {
          termId: term.id,
          facultyId,
          studyMode: body.studyMode,
          name: body.name,
          kind: body.kind,
          startDate: fromIsoDate(body.startDate),
          endDate: fromIsoDate(body.endDate),
          breaks: { create: children.breaks },
          days: { create: children.days },
          zjazdy: { create: children.zjazdy },
        },
        include: calendarInclude,
      }),
    ),
  );
  const skipped = targets.length - toCreate.length;
  res.status(201).json({
    data: created.map(serializeCalendar),
    message:
      created.length === 1
        ? 'Kalendarz utworzony'
        : `Kalendarz utworzony dla ${created.length} wydzialow${skipped ? ` (${skipped} pominieto — maja juz wlasny)` : ''}`,
  });
});

async function loadCalendar(id: string) {
  const calendar = await prisma.termCalendar.findUnique({ where: { id }, include: calendarInclude });
  if (!calendar) throw new AppError(404, 'Kalendarz nie znaleziony');
  return calendar;
}

/** Edycja calego kalendarza naraz — daty, przerwy, wyjatki dni i zjazdy podmieniane w transakcji. */
export const updateCalendar = asyncHandler(async (req, res) => {
  const current = await loadCalendar(String(req.params.id));
  await assertFacultyScope(req, current.facultyId);
  assertEditable(current.status);
  const body = req.body as CalendarBody;
  assertConsistent(body, current.studyMode);

  if (body.name !== current.name) {
    const clash = await prisma.termCalendar.findFirst({
      where: {
        termId: current.termId,
        facultyId: current.facultyId,
        studyMode: current.studyMode,
        name: body.name,
        id: { not: current.id },
      },
    });
    if (clash) throw new AppError(409, `Wariant "${body.name}" juz istnieje`);
  }

  const children = childrenData(body);
  const [, , , , updated] = await prisma.$transaction([
    prisma.calendarBreak.deleteMany({ where: { calendarId: current.id } }),
    prisma.calendarDay.deleteMany({ where: { calendarId: current.id } }),
    prisma.zjazd.deleteMany({ where: { calendarId: current.id } }),
    prisma.termCalendar.update({
      where: { id: current.id },
      data: {
        name: body.name,
        kind: body.kind,
        startDate: fromIsoDate(body.startDate),
        endDate: fromIsoDate(body.endDate),
        breaks: { create: children.breaks },
        days: { create: children.days },
        zjazdy: { create: children.zjazdy },
      },
    }),
    prisma.termCalendar.findUniqueOrThrow({ where: { id: current.id }, include: calendarInclude }),
  ]);
  res.json({ data: serializeCalendar(updated), message: 'Kalendarz zapisany' });
});

/**
 * Zmiana statusu. Dziekanat przelacza swoj kalendarz miedzy przygotowaniem,
 * publikacja i archiwum; wyjsc z archiwum moze tylko admin.
 */
export const setCalendarStatus = asyncHandler(async (req, res) => {
  const current = await loadCalendar(String(req.params.id));
  await assertFacultyScope(req, current.facultyId);
  const { status } = req.body as { status: CalendarStatus };
  if (current.status === 'ARCHIVED' && status !== 'ARCHIVED' && req.user!.role !== 'ADMIN') {
    throw new AppError(403, 'Kalendarz z archiwum moze przywrocic tylko administrator');
  }
  const updated = await prisma.termCalendar.update({
    where: { id: current.id },
    data: { status },
    include: calendarInclude,
  });
  res.json({ data: serializeCalendar(updated), message: 'Status kalendarza zmieniony' });
});

/** Liczba z rzeczownikiem w polskiej odmianie: 1 rocznik, 2 roczniki, 5 rocznikow. */
function countOf(n: number, one: string, few: string, many: string): string {
  const word = n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;
  return `${n} ${word}`;
}

/** Powod, dla ktorego kalendarza nie wolno usunac (null = mozna). */
export function calendarDeleteBlock(usage: CalendarUsage): string | null {
  if (usage.placements === 0 && usage.occurrences === 0) return null;
  const parts = [
    usage.placements > 0 && countOf(usage.placements, 'umieszczenie', 'umieszczenia', 'umieszczen'),
    usage.occurrences > 0 && countOf(usage.occurrences, 'termin', 'terminy', 'terminow'),
  ].filter(Boolean);
  return (
    `Wedlug tego kalendarza ${countOf(usage.cohortsWithPlan, 'rocznik ma', 'roczniki maja', 'rocznikow ma')} ${parts.join(' i ')}. ` +
    'Usuniecie zostawiloby ich plan bez kalendarza — najpierw usun umieszczenia tych rocznikow ' +
    'albo przypisz roczniki do innego wariantu kalendarza (Roczniki i grupy).'
  );
}

export const getCalendarUsage = asyncHandler(async (req, res) => {
  const current = await loadCalendar(String(req.params.id));
  const usage = await calendarUsage(current);
  res.json({ data: { ...usage, deleteBlock: calendarDeleteBlock(usage) } });
});

export const deleteCalendar = asyncHandler(async (req, res) => {
  const current = await loadCalendar(String(req.params.id));
  await assertFacultyScope(req, current.facultyId);
  assertEditable(current.status);
  const block = calendarDeleteBlock(await calendarUsage(current));
  if (block) throw new AppError(409, block);
  await prisma.termCalendar.delete({ where: { id: current.id } });
  res.json({ message: 'Kalendarz usuniety' });
});
