import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import { blockLabel, gridBreaks, numberBlocks, parseGridDays, toMinutes, validateBlocks, WEEK_ORDER } from '../lib/timeGrid';
import { gridLocked } from '../services/timeGrids';
import type { TimeGridUpdate } from '../schemas/timeGrid';

/**
 * Siatki godzin wydzialow (stacjonarna i niestacjonarna). Bloki zablokowane, gdy wydzial ma
 * juz plan w tym trybie w biezacym semestrze; dni i okno godzin mozna zmieniac zawsze
 * (dotycza nowych umieszczen).
 */

const gridInclude = {
  faculty: { select: { id: true, name: true, shortName: true } },
  blocks: { orderBy: { order: 'asc' as const } },
} satisfies Prisma.TimeGridInclude;

type GridRow = Prisma.TimeGridGetPayload<{ include: typeof gridInclude }>;

async function serialize(grid: GridRow) {
  return {
    id: grid.id,
    faculty: grid.faculty,
    studyMode: grid.studyMode,
    days: parseGridDays(grid.days),
    blocks: grid.blocks.map((b) => ({ id: b.id, order: b.order, startTime: b.startTime, endTime: b.endTime, label: b.label })),
    breaks: gridBreaks(grid.blocks),
    locked: await gridLocked(grid.facultyId, grid.studyMode),
  };
}

export const listGrids = asyncHandler(async (_req, res) => {
  const grids = await prisma.timeGrid.findMany({ include: gridInclude, orderBy: [{ faculty: { shortName: 'asc' } }, { studyMode: 'asc' }] });
  res.json({ data: await Promise.all(grids.map(serialize)) });
});

export const updateGrid = asyncHandler(async (req, res) => {
  const current = await prisma.timeGrid.findUnique({ where: { id: String(req.params.id) }, include: gridInclude });
  if (!current) throw new AppError(404, 'Siatka godzin nie znaleziona');
  const body = req.body as TimeGridUpdate;

  let rows: { order: number; startTime: string; endTime: string; label: string }[] | null = null;
  if (body.blocks) {
    if (await gridLocked(current.facultyId, current.studyMode)) {
      throw new AppError(409, 'Wydzial ma juz plan w tym trybie w biezacym semestrze — zmiana blokow przesunelaby zajecia. Dni i okno godzin mozna zmieniac.');
    }
    const problems = validateBlocks(body.blocks);
    if (problems.length > 0) throw new AppError(400, problems.join('; '));
    rows = numberBlocks(body.blocks).map((b) => ({ order: b.order, startTime: b.startTime, endTime: b.endTime, label: blockLabel(b.startTime, b.endTime) }));
  }
  if (body.days) {
    const bad = body.days.find((d) => d.from && d.to && toMinutes(d.from) >= toMinutes(d.to));
    if (bad) throw new AppError(400, `Okno godzin (${bad.from}-${bad.to}) konczy sie przed startem`);
    if (new Set(body.days.map((d) => d.day)).size !== body.days.length) throw new AppError(400, 'Dzien powtarza sie na liscie');
  }
  const days = body.days ? [...body.days].sort((a, b) => WEEK_ORDER.indexOf(a.day) - WEEK_ORDER.indexOf(b.day)) : null;

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
  res.json({ data: await serialize(grid), message: 'Siatka godzin zapisana' });
});
