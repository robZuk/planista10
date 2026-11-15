import type { AcademicTerm } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { toIsoDate } from '../lib/isoDate';
import { formatMinutes } from '../lib/timeGrid';
import { activeCohorts } from './sections';

/**
 * Zajecia do odrobienia: odwolane terminy semestru (wydzialu albo calej uczelni) i ich stan —
 * odrobione (jest aktywny termin reczny wskazujacy je przez makeupOfId) albo do odrobienia.
 * Odwoluje i odrabia tylko planista (Ukladanie planu → Terminy).
 */

const personName = (p: { title: string | null; firstName: string; lastName: string } | null) =>
  p ? `${p.title ?? ''} ${p.firstName} ${p.lastName}`.trim() : '';

export async function listMakeups(term: AcademicTerm, scope: { facultyId: string | null }) {
  const cancelled = await prisma.occurrence.findMany({
    where: {
      termId: term.id,
      status: 'CANCELLED',
      instructorId: { not: null },
      ...(scope.facultyId ? { facultyId: scope.facultyId } : {}),
    },
    include: {
      instructor: { select: { title: true, firstName: true, lastName: true } },
      section: { select: { id: true, classType: true, cohortId: true, programEntry: { select: { subject: { select: { name: true } } } }, cohort: { select: { program: { select: { code: true } } } } } },
    },
    orderBy: [{ date: 'asc' }, { startMinute: 'asc' }],
  });
  const ids = cancelled.map((o) => o.id);
  const makeups = ids.length
    ? await prisma.occurrence.findMany({ where: { makeupOfId: { in: ids }, status: { not: 'CANCELLED' } }, orderBy: { date: 'asc' } })
    : [];
  const madeUp = new Map<string, (typeof makeups)[number]>();
  for (const m of makeups) if (!madeUp.has(m.makeupOfId!)) madeUp.set(m.makeupOfId!, m);
  const cohortIds = [...new Set(cancelled.map((o) => o.section.cohortId))];
  // Pusta lista rocznikow w activeCohorts znaczy "wszystkie" — bez odwolan nie pytamy o nic.
  const contexts = cohortIds.length > 0 ? await activeCohorts(term, null, cohortIds) : [];
  const nameOf = new Map(contexts.map((c) => [c.cohort.id, c.nameOf]));
  return cancelled.map((o) => {
    const m = madeUp.get(o.id);
    return {
      occurrenceId: o.id,
      sectionId: o.section.id,
      date: toIsoDate(o.date),
      time: `${formatMinutes(o.startMinute)}–${formatMinutes(o.endMinute)}`,
      subject: o.section.programEntry.subject.name,
      classType: o.section.classType,
      program: o.section.cohort.program.code,
      group: nameOf.get(o.section.cohortId)?.(o.groupId) ?? '',
      instructor: personName(o.instructor),
      hours: o.endOrder - o.startOrder + 1,
      note: o.note,
      state: m ? ('MADE_UP' as const) : ('TODO' as const),
      makeup: m ? { date: toIsoDate(m.date), time: `${formatMinutes(m.startMinute)}–${formatMinutes(m.endMinute)}` } : null,
    };
  });
}
