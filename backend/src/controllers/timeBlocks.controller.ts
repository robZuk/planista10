import { prisma } from '../lib/prisma';
import { asyncHandler } from '../middleware/asyncHandler';

/**
 * Bloki pierwszej siatki stacjonarnej (tylko odczyt, zgodnosc wsteczna). Siatki wydzialow
 * edytuje sie w /api/time-grids; plan bierze bloki z siatki wydzialu i trybu rocznika.
 */
export const getAll = asyncHandler(async (_req, res) => {
  const grid = await prisma.timeGrid.findFirst({ where: { studyMode: 'FULL_TIME' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  const data = grid ? await prisma.timeBlock.findMany({ where: { gridId: grid.id }, orderBy: { order: 'asc' } }) : [];
  res.json({ data });
});
