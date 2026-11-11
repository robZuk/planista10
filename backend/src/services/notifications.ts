import type { NotificationKind } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * Powiadomienia w aplikacji (dzwonek w naglowku) miedzy dziekanatem a prowadzacym. Tworzymy je
 * przy zgloszeniach zmian i przy zmianach terminow prowadzacego wprowadzonych przez dziekanat.
 * Bez e-maili — uzytkownik widzi je po zalogowaniu (licznik nieprzeczytanych).
 */

export interface NotificationInput {
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string | null;
  requestId?: string | null;
}

/** Jedno powiadomienie dla kazdego odbiorcy (bez powtorzen i bez autora zmiany). */
export async function notify(userIds: string[], n: NotificationInput, exceptUserId?: string | null): Promise<number> {
  const recipients = [...new Set(userIds)].filter((id) => id && id !== exceptUserId);
  if (recipients.length === 0) return 0;
  await prisma.notification.createMany({
    data: recipients.map((userId) => ({ userId, kind: n.kind, title: n.title, body: n.body, link: n.link ?? null, requestId: n.requestId ?? null })),
  });
  return recipients.length;
}

/** Planisci wydzialu (konta dziekanatu); gdy wydzial ich nie ma — administratorzy. */
export async function facultyPlannerIds(facultyId: string): Promise<string[]> {
  const deans = await prisma.user.findMany({ where: { role: 'DEAN_OFFICE', facultyId }, select: { id: true } });
  if (deans.length > 0) return deans.map((u) => u.id);
  return (await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } })).map((u) => u.id);
}

/** Konto prowadzacego (Instructor ↔ User 1:1); brak konta = brak powiadomienia. */
export async function instructorUserIds(instructorId: string | null): Promise<string[]> {
  if (!instructorId) return [];
  return (await prisma.user.findMany({ where: { instructorId }, select: { id: true } })).map((u) => u.id);
}
