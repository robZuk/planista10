import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import {
  blockDays,
  blockLabel,
  gridBreaks,
  gridSet,
  gridTime,
  numberBlocks,
  parseGridDays,
  sharedDays,
  toMinutes,
  validateBlocks,
  WEEK_ORDER,
  weekdayLabel,
  type GridDay,
  type WeekdayName,
} from '../lib/timeGrid';
import { placementsOnDays, placementsOutsideDays } from '../services/timeGrids';
import { plural } from '../lib/plural';
import type { TimeGridCreate, TimeGridUpdate } from '../schemas/timeGrid';

/**
 * Siatki godzin wydzialow (stacjonarna i niestacjonarna) i siatki dnia — wlasne bloki dla
 * wybranych dni (np. piatek niestacjonarnych od 16:00). Dni siatek jednego wydzialu i trybu sa
 * rozlaczne. Bloki obowiazujace w dniach z ulozonym planem (biezacy semestr) sa zablokowane:
 * umieszczenia wskazuja bloki numerem. Dni i okno godzin mozna zmieniac, o ile nie wyrzucaja
 * poza siatke juz ulozonych zajec.
 */

const gridInclude = {
  faculty: { select: { id: true, name: true, shortName: true } },
  blocks: { orderBy: { order: 'asc' as const } },
} satisfies Prisma.TimeGridInclude;

type GridRow = Prisma.TimeGridGetPayload<{ include: typeof gridInclude }>;

const sortDays = (days: GridDay[]) => [...days].sort((a, b) => WEEK_ORDER.indexOf(a.day) - WEEK_ORDER.indexOf(b.day));
const dayList = (days: WeekdayName[]) => days.map(weekdayLabel).join(', ');
const siblingsOf = (grid: GridRow, all: GridRow[]) =>
  all.filter((g) => g.facultyId === grid.facultyId && g.studyMode === grid.studyMode && g.id !== grid.id);

/** Okna godzin i powtorzone dni — wspolne dla zmiany i zalozenia siatki. */
function assertDays(days: GridDay[]) {
  const bad = days.find((d) => d.from && d.to && toMinutes(d.from) >= toMinutes(d.to));
  if (bad) throw new AppError(400, `Okno godzin (${bad.from}-${bad.to}) konczy sie przed startem`);
  if (new Set(days.map((d) => d.day)).size !== days.length) throw new AppError(400, 'Dzien powtarza sie na liscie');
}

function blockRows(blocks: { startTime: string; endTime: string }[]) {
  const problems = validateBlocks(blocks);
  if (problems.length > 0) throw new AppError(400, problems.join('; '));
  return numberBlocks(blocks).map((b) => ({ order: b.order, startTime: b.startTime, endTime: b.endTime, label: blockLabel(b.startTime, b.endTime) }));
}

async function serialize(grid: GridRow, all: GridRow[]) {
  const days = parseGridDays(grid.days);
  const others = siblingsOf(grid, all).map((g) => ({ days: parseGridDays(g.days) }));
  return {
    id: grid.id,
    faculty: grid.faculty,
    studyMode: grid.studyMode,
    base: grid.base,
    days,
    blocks: grid.blocks.map((b) => ({ id: b.id, order: b.order, startTime: b.startTime, endTime: b.endTime, label: b.label })),
    breaks: gridBreaks(grid.blocks),
    locked: (await placementsOnDays(grid.facultyId, grid.studyMode, blockDays({ base: grid.base, days }, others))) > 0,
  };
}

/** Siatki wydzialu i trybu siatki `grid` (z nia sama). */
const familyOf = (grid: { facultyId: string; studyMode: GridRow['studyMode'] }) =>
  prisma.timeGrid.findMany({ where: { facultyId: grid.facultyId, studyMode: grid.studyMode }, include: gridInclude });

export const listGrids = asyncHandler(async (_req, res) => {
  const grids = await prisma.timeGrid.findMany({
    include: gridInclude,
    orderBy: [{ faculty: { shortName: 'asc' } }, { studyMode: 'asc' }, { base: 'desc' }, { createdAt: 'asc' }],
  });
  res.json({ data: await Promise.all(grids.map((g) => serialize(g, grids))) });
});

export const updateGrid = asyncHandler(async (req, res) => {
  const current = await prisma.timeGrid.findUnique({ where: { id: String(req.params.id) }, include: gridInclude });
  if (!current) throw new AppError(404, 'Siatka godzin nie znaleziona');
  const body = req.body as TimeGridUpdate;
  const siblings = siblingsOf(current, await familyOf(current));
  const currentDays = parseGridDays(current.days);
  const siblingDays = siblings.map((s) => ({ days: parseGridDays(s.days) }));

  let rows: ReturnType<typeof blockRows> | null = null;
  if (body.blocks) {
    if ((await placementsOnDays(current.facultyId, current.studyMode, blockDays({ base: current.base, days: currentDays }, siblingDays))) > 0) {
      throw new AppError(409, 'W dniach tej siatki sa juz ulozone zajecia (biezacy semestr) — zmiana blokow przesunelaby je. Dni i okno godzin mozna zmieniac.');
    }
    rows = blockRows(body.blocks);
  }
  let days: GridDay[] | null = null;
  if (body.days) {
    assertDays(body.days);
    days = sortDays(body.days);
    const clash = sharedDays([{ days }, ...siblingDays]);
    if (clash.length > 0) {
      throw new AppError(
        400,
        `${dayList(clash)}: ${clash.length === 1 ? 'ten dzien jest' : 'te dni sa'} juz w innej siatce tego wydzialu i trybu — najpierw zmien albo usun tamta siatke`,
      );
    }
    // Siatka dnia: dni odebrane wracaja do blokow podstawowej, dodane dotad liczyly sie wg podstawowej —
    // w obu przypadkach zmieniaja sie bloki ulozonych tam zajec. Podstawowa obowiazuje i w swoich dniach,
    // i w dniach spoza siatek, wiec zmiana jej dni nie zmienia blokow.
    if (!current.base) {
      const before = new Set(currentDays.map((d) => d.day));
      const after = new Set(days.map((d) => d.day));
      const moved = WEEK_ORDER.filter((day) => before.has(day) !== after.has(day));
      if ((await placementsOnDays(current.facultyId, current.studyMode, moved)) > 0) {
        throw new AppError(409, `${dayList(moved)}: sa tu ulozone zajecia — przejscie miedzy siatkami zmieniloby ich godziny`);
      }
    }
    // Bloki zostaja (zablokowane albo zmieniane razem) — czas umieszczen liczymy wg siatek po zmianie.
    const after = gridSet([
      { base: current.base, days, time: gridTime(rows ?? current.blocks) },
      ...siblings.map((s) => ({ base: s.base, days: parseGridDays(s.days), time: gridTime(s.blocks) })),
    ]);
    const outside = await placementsOutsideDays(current.facultyId, current.studyMode, after.days, (day) => after.forDay(day).time);
    if (outside.length > 0) {
      const list = outside
        .map((o) => `${o.problem} — ${plural(o.placements, 'umieszczenie', 'umieszczenia', 'umieszczen')} (${plural(o.cohorts, 'rocznik', 'roczniki', 'rocznikow')})`)
        .join('; ');
      throw new AppError(409, `Zmiana wyrzucilaby poza siatke ulozone zajecia: ${list}. Najpierw przenies te zajecia w Ukladaniu planu.`);
    }
  }

  const grid = await prisma.$transaction(async (tx) => {
    if (rows) {
      await tx.timeBlock.deleteMany({ where: { gridId: current.id } });
      await tx.timeBlock.createMany({ data: rows.map((r) => ({ ...r, gridId: current.id })) });
    }
    return tx.timeGrid.update({
      where: { id: current.id },
      data: days ? { days: days as unknown as Prisma.InputJsonValue } : { updatedAt: new Date() },
      include: gridInclude,
    });
  });
  res.json({ data: await serialize(grid, [grid, ...siblings]), message: 'Siatka godzin zapisana' });
});

/**
 * Siatka dnia: wlasne bloki dla wybranych dni wydzialu i trybu. Dni przechodza z siatki
 * podstawowej (albo dochodza nowe) w jednej transakcji. Zaklada sie ja przed ukladaniem planu
 * w tych dniach — ulozone zajecia wskazuja bloki numerem.
 */
export const createGrid = asyncHandler(async (req, res) => {
  const body = req.body as TimeGridCreate;
  const faculty = await prisma.faculty.findUnique({ where: { id: body.facultyId }, select: { id: true } });
  if (!faculty) throw new AppError(404, 'Wydzial nie znaleziony');
  const family = await familyOf(body);
  const base = family.find((g) => g.base);
  if (!base) throw new AppError(409, 'Wydzial nie ma siatki podstawowej dla tego trybu studiow');
  const rows = blockRows(body.blocks);
  assertDays(body.days);
  const days = sortDays(body.days);
  const clash = sharedDays([{ days }, ...family.filter((g) => !g.base).map((g) => ({ days: parseGridDays(g.days) }))]);
  if (clash.length > 0) {
    throw new AppError(400, `${dayList(clash)}: ${clash.length === 1 ? 'ten dzien ma' : 'te dni maja'} juz osobna siatke dnia`);
  }
  const moved = days.map((d) => d.day);
  if ((await placementsOnDays(body.facultyId, body.studyMode, moved)) > 0) {
    throw new AppError(
      409,
      `${dayList(moved)}: sa tu juz ulozone zajecia (biezacy semestr) — osobne bloki przesunelyby je. Siatke dnia zaklada sie przed ukladaniem planu w tych dniach.`,
    );
  }
  const baseDays = parseGridDays(base.days).filter((d) => !moved.includes(d.day));
  if (baseDays.length === 0) throw new AppError(400, 'Siatka podstawowa musi zachowac co najmniej jeden dzien zajec');

  const created = await prisma.$transaction(async (tx) => {
    await tx.timeGrid.update({ where: { id: base.id }, data: { days: baseDays as unknown as Prisma.InputJsonValue } });
    return tx.timeGrid.create({
      data: {
        facultyId: body.facultyId,
        studyMode: body.studyMode,
        base: false,
        days: days as unknown as Prisma.InputJsonValue,
        blocks: { create: rows },
      },
      include: gridInclude,
    });
  });
  res.status(201).json({ data: await serialize(created, await familyOf(created)), message: 'Siatka dnia zalozona' });
});

/** Usuniecie siatki dnia: jej dni wracaja do siatki podstawowej (z jej blokami). */
export const deleteGrid = asyncHandler(async (req, res) => {
  const current = await prisma.timeGrid.findUnique({ where: { id: String(req.params.id) }, include: gridInclude });
  if (!current) throw new AppError(404, 'Siatka godzin nie znaleziona');
  if (current.base) throw new AppError(400, 'Siatki podstawowej nie usuwa sie — mozesz zmienic jej bloki i dni');
  const days = parseGridDays(current.days);
  if ((await placementsOnDays(current.facultyId, current.studyMode, days.map((d) => d.day))) > 0) {
    throw new AppError(409, 'W dniach tej siatki sa ulozone zajecia — po usunieciu liczylyby sie wg blokow siatki podstawowej (inne godziny)');
  }
  const base = (await familyOf(current)).find((g) => g.base);
  if (!base) throw new AppError(409, 'Wydzial nie ma siatki podstawowej dla tego trybu studiow');
  const merged = sortDays([...parseGridDays(base.days), ...days.filter((d) => !parseGridDays(base.days).some((b) => b.day === d.day))]);
  await prisma.$transaction([
    prisma.timeGrid.update({ where: { id: base.id }, data: { days: merged as unknown as Prisma.InputJsonValue } }),
    prisma.timeGrid.delete({ where: { id: current.id } }),
  ]);
  res.json({ message: 'Siatka dnia usunieta — jej dni wracaja do siatki podstawowej' });
});
