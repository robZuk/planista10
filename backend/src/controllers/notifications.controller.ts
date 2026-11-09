import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';

/** Powiadomienia zalogowanego uzytkownika (dzwonek): ostatnie 30 i liczba nieprzeczytanych. */
export const list = asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const [data, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  res.json({ data, unread });
});

export const markRead = asyncHandler(async (req, res) => {
  const n = await prisma.notification.findUnique({ where: { id: String(req.params.id) } });
  if (!n || n.userId !== req.user!.id) throw new AppError(404, 'Powiadomienie nie znalezione');
  if (!n.readAt) await prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
  res.json({ message: 'Przeczytane' });
});

export const markAllRead = asyncHandler(async (req, res) => {
  const { count } = await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ message: `Oznaczono jako przeczytane: ${count}` });
});
