import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { groupsOverlap, indexGroups } from '../lib/groupTree';
import { toTreeGroup } from './cohorts';

/**
 * Kto widzi ktore terminy. Student i prowadzacy — tylko z opublikowanych (i archiwalnych)
 * kalendarzy; student: zajecia grup nakladajacych sie na jego grupy (wyklad calego
 * rocznika, jego grupa cwiczeniowa...), prowadzacy: swoje. Planisci widza wszystko
 * (dziekanat — swoj wydzial).
 */

/** Grupy, ktorych zajecia dotycza studenta (nakladajace sie na jego grupy). */
export async function studentVisibleGroupIds(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { studentGroups: { select: { id: true, cohortId: true } } },
  });
  const member = (user?.studentGroups ?? []).filter((g) => g.cohortId);
  if (member.length === 0) return [];
  const groups = await prisma.studentGroup.findMany({ where: { cohortId: { in: [...new Set(member.map((g) => g.cohortId!))] } } });
  const index = indexGroups(groups.map(toTreeGroup));
  return groups.filter((g) => member.some((m) => groupsOverlap(m.id, g.id, index))).map((g) => g.id);
}

/** Pary wydzial|tryb z opublikowanym albo archiwalnym kalendarzem (dowolnego semestru). */
export async function publishedScopes(): Promise<Set<string>> {
  const calendars = await prisma.termCalendar.findMany({
    where: { status: { in: ['PUBLISHED', 'ARCHIVED'] } },
    select: { termId: true, facultyId: true, studyMode: true },
  });
  return new Set(calendars.map((c) => `${c.termId}|${c.facultyId}|${c.studyMode}`));
}

/** Warunek na terminy widoczne dla uzytkownika (bez filtra publikacji — ten nakladamy po pobraniu). */
export async function occurrenceScope(user: {
  id: string;
  role: string;
  instructorId: string | null;
  facultyId: string | null;
}): Promise<{ where: Prisma.OccurrenceWhereInput; publishedOnly: boolean } | null> {
  if (user.role === 'STUDENT') {
    const ids = await studentVisibleGroupIds(user.id);
    return ids.length ? { where: { groupId: { in: ids } }, publishedOnly: true } : null;
  }
  if (user.role === 'INSTRUCTOR') {
    return user.instructorId ? { where: { instructorId: user.instructorId }, publishedOnly: true } : null;
  }
  if (user.role === 'DEAN_OFFICE') return { where: user.facultyId ? { facultyId: user.facultyId } : { id: '__none__' }, publishedOnly: false };
  return { where: {}, publishedOnly: false };
}
