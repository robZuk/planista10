import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { groupsOverlap, indexGroups } from '../lib/groupTree';
import { toTreeGroup } from './cohorts';
import { activeCohorts } from './sections';
import { calendarsFor } from './cohortCalendar';

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

/**
 * Roczniki, ktorych plan widza studenci i prowadzacy: wlasny kalendarz rocznika w danym
 * semestrze jest opublikowany albo w archiwum (wariant "w planowaniu" — jeszcze nie, nawet
 * gdy wydzial ma inne opublikowane kalendarze). Klucz: `termId|cohortId`.
 */
export async function publishedCohortKeys(pairs: { termId: string; cohortId: string }[]): Promise<Set<string>> {
  const keys = new Set<string>();
  const byTerm = new Map<string, Set<string>>();
  for (const p of pairs) byTerm.set(p.termId, (byTerm.get(p.termId) ?? new Set()).add(p.cohortId));
  for (const [termId, cohortIds] of byTerm) {
    const term = await prisma.academicTerm.findUnique({ where: { id: termId } });
    if (!term) continue;
    const contexts = await activeCohorts(term, null, [...cohortIds]);
    for (const [cohortId, cal] of await calendarsFor(term, contexts)) {
      if (cal && cal.status !== 'PLANNING') keys.add(`${termId}|${cohortId}`);
    }
  }
  return keys;
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
