import type { AcademicTerm, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import { fromIsoDate, toIsoDate } from '../lib/isoDate';
import { parseTermKey, termLabel, termOfDate } from '../lib/terms';
import { toMinutes } from '../lib/timeGrid';
import { plural } from '../lib/plural';
import { externalBusyProblems, externalClashes, normalizeDates, type ExternalClash } from '../lib/externalBusy';
import { termOccupancy } from '../services/plan';
import type { ExternalBusyBody } from '../schemas/externalBusy';

/**
 * Zajetosci zewnetrzne: czas prowadzacych i sal zajety przez zajecia innych wydzialow
 * (zgloszenia mailowe). Wpisuje je planista; licza sie do kolizji planu (services/plan.termOccupancy).
 * Kazda lista i zapis zwraca kolizje wpisu z planem — zgloszenie przychodzi czesto juz po
 * ulozeniu planu i planista musi wiedziec, co przelozyc. Zapis nie jest blokowany kolizja:
 * zajecia innego wydzialu sa faktem, a nie propozycja.
 */

const include = {
  instructor: { select: { id: true, title: true, firstName: true, lastName: true } },
  room: { select: { id: true, number: true, building: { select: { name: true } } } },
} satisfies Prisma.ExternalBusyInclude;

type Row = Prisma.ExternalBusyGetPayload<{ include: typeof include }>;

function toDto(row: Row, clashes: ExternalClash[]) {
  return {
    id: row.id,
    source: row.source,
    receivedOn: toIsoDate(row.receivedOn),
    instructor: row.instructor
      ? { id: row.instructor.id, name: `${row.instructor.title ?? ''} ${row.instructor.firstName} ${row.instructor.lastName}`.trim() }
      : null,
    room: row.room ? { id: row.room.id, label: `${row.room.number} (${row.room.building.name})` } : null,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    dates: row.dates.map(toIsoDate),
    note: row.note,
    clashes,
  };
}

async function findTerm(key: string): Promise<AcademicTerm> {
  const ref = parseTermKey(key);
  if (!ref) throw new AppError(400, 'Nieprawidlowy klucz semestru');
  const term = await prisma.academicTerm.findUnique({ where: { startYear_type: ref } });
  if (!term) throw new AppError(404, 'Semestr nie istnieje');
  return term;
}

/** Semestr w archiwum (wszystkie jego kalendarze) jest tylko do odczytu. */
async function assertTermWritable(termId: string): Promise<void> {
  const calendars = await prisma.termCalendar.findMany({ where: { termId }, select: { status: true } });
  if (calendars.length > 0 && calendars.every((c) => c.status === 'ARCHIVED')) {
    throw new AppError(409, 'Semestr jest w archiwum — zajetosci zewnetrzne tylko do odczytu');
  }
}

/**
 * Zajetosc planu (wzorce i wygenerowane terminy) bez samych zajetosci zewnetrznych — tylko sal
 * i prowadzacych z wpisow (cala uczelnia to dziesiatki tysiecy terminow).
 */
function planBusy(term: AcademicTerm, entries: { roomId: string | null; instructorId: string | null }[]) {
  const roomIds = [...new Set(entries.flatMap((e) => (e.roomId ? [e.roomId] : [])))];
  const instructorIds = [...new Set(entries.flatMap((e) => (e.instructorId ? [e.instructorId] : [])))];
  if (roomIds.length === 0 && instructorIds.length === 0) return Promise.resolve([]);
  return termOccupancy(term, { includeGenerated: true, skipExternal: true, onlyResources: { roomIds, instructorIds } });
}

/** "30.11.2026" — data w komunikacie (z rokiem, bo moze byc z innego roku akademickiego). */
const longDate = (d: string) => `${Number(d.slice(8, 10))}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

async function toData(body: ExternalBusyBody, term: AcademicTerm) {
  const startMinute = toMinutes(body.startTime);
  const endMinute = toMinutes(body.endTime);
  const dates = normalizeDates(body.dates);
  // Wpis nalezy do semestru — data z innego semestru nigdy nie zablokowalaby planu tego semestru,
  // a na liscie innego semestru by jej nie bylo (zima 1.10–14.02, lato 15.02–30.09: lib/terms.termOfDate).
  const outside = dates.filter((d) => {
    const t = termOfDate(d);
    return t.startYear !== term.startYear || t.type !== term.type;
  });
  if (outside.length > 0) {
    throw new AppError(400, `Daty spoza semestru ${termLabel(term)}: ${outside.slice(0, 5).map(longDate).join(', ')}${outside.length > 5 ? ` i jeszcze ${outside.length - 5}` : ''}`);
  }
  const problems = externalBusyProblems({ instructorId: body.instructorId, roomId: body.roomId, startMinute, endMinute, dates });
  if (problems.length > 0) throw new AppError(400, problems.join('; '));
  if (body.instructorId && !(await prisma.instructor.findUnique({ where: { id: body.instructorId }, select: { id: true } }))) {
    throw new AppError(400, 'Wybrany prowadzacy nie istnieje');
  }
  if (body.roomId && !(await prisma.room.findUnique({ where: { id: body.roomId }, select: { id: true } }))) {
    throw new AppError(400, 'Wybrana sala nie istnieje');
  }
  return {
    source: body.source,
    receivedOn: fromIsoDate(body.receivedOn),
    instructorId: body.instructorId,
    roomId: body.roomId,
    startMinute,
    endMinute,
    dates: dates.map(fromIsoDate),
    note: body.note?.trim() || null,
  };
}

/** Komunikat zapisu z ostrzezeniem o kolizjach z planem. */
function savedMessage(verb: string, clashes: ExternalClash[]): string {
  if (clashes.length === 0) return `Zajetosc zewnetrzna ${verb}`;
  const days = new Set(clashes.map((c) => c.date)).size;
  return `Zajetosc zewnetrzna ${verb}, ale koliduje z ulozonym planem (${plural(days, 'dzien', 'dni', 'dni')}) — przeloz kolidujace zajecia`;
}

export const list = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const rows = await prisma.externalBusy.findMany({
    where: { termId: term.id },
    include,
    orderBy: [{ source: 'asc' }, { startMinute: 'asc' }, { createdAt: 'asc' }],
  });
  const busy = await planBusy(term, rows);
  res.json({ data: rows.map((r) => toDto(r, externalClashes(r, busy))) });
});

export const create = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  await assertTermWritable(term.id);
  const data = await toData(req.body as ExternalBusyBody, term);
  const row = await prisma.externalBusy.create({ data: { ...data, termId: term.id }, include });
  const clashes = externalClashes(row, await planBusy(term, [row]));
  req.log.info({ externalBusyId: row.id, source: row.source, clashes: clashes.length }, 'dodano zajetosc zewnetrzna');
  res.status(201).json({ data: toDto(row, clashes), message: savedMessage('dodana', clashes) });
});

export const update = asyncHandler(async (req, res) => {
  const current = await prisma.externalBusy.findUnique({ where: { id: String(req.params.id) }, include: { term: true } });
  if (!current) throw new AppError(404, 'Zajetosc zewnetrzna nie znaleziona');
  await assertTermWritable(current.termId);
  const data = await toData(req.body as ExternalBusyBody, current.term);
  const row = await prisma.externalBusy.update({ where: { id: current.id }, data, include });
  const clashes = externalClashes(row, await planBusy(current.term, [row]));
  res.json({ data: toDto(row, clashes), message: savedMessage('zapisana', clashes) });
});

export const remove = asyncHandler(async (req, res) => {
  const current = await prisma.externalBusy.findUnique({ where: { id: String(req.params.id) } });
  if (!current) throw new AppError(404, 'Zajetosc zewnetrzna nie znaleziona');
  await assertTermWritable(current.termId);
  await prisma.externalBusy.delete({ where: { id: current.id } });
  res.json({ message: 'Zajetosc zewnetrzna usunieta' });
});
