import type { AcademicTerm } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { assertFacultyScope } from '../lib/facultyScope';
import { CLASS_LABEL_PL } from '../lib/scheduleTime';
import { staffProblem, withPersonHours, type StaffRow } from '../lib/staffing';
import { activeCohorts } from './sections';
import { archivedCohortIds } from './cohortCalendar';

/**
 * Zapis obsady wielu zajec naraz — wszystko albo nic (okno grup przedmiotu w „Zajeciach”
 * i okno zajec prowadzacego w „Obciazeniach”). Te same zasady co okno jednych zajec:
 * zakres wydzialu zajec (dziekanat moze przypisac osobe z katedry innego wydzialu — liczy
 * sie wydzial zajec), archiwum tylko do odczytu, suma godzin, prowadzacy istnieja.
 */

export interface StaffChange {
  sectionId: string;
  rows: StaffRow[];
}

async function loadSections(req: Request, term: AcademicTerm, sectionIds: string[]) {
  const ids = [...new Set(sectionIds)];
  if (ids.length !== sectionIds.length) throw new AppError(400, 'Te same zajecia powtarzaja sie w zmianach');
  const sections = await prisma.classSection.findMany({
    where: { id: { in: ids }, termId: term.id },
    include: {
      programEntry: { select: { subject: { select: { name: true } } } },
      instructors: { select: { instructorId: true, hours: true } },
    },
  });
  if (sections.length !== ids.length) {
    throw new AppError(404, 'Ktores z zajec nie naleza juz do tego semestru (np. po synchronizacji) — odswiez liste');
  }
  for (const facultyId of new Set(sections.map((s) => s.facultyId))) await assertFacultyScope(req, facultyId);
  const contexts = await activeCohorts(term, null, [...new Set(sections.map((s) => s.cohortId))]);
  const nameOf = new Map(contexts.map((c) => [c.cohort.id, c.nameOf]));
  const label = (s: (typeof sections)[number]) =>
    [s.programEntry.subject.name, CLASS_LABEL_PL[s.classType], nameOf.get(s.cohortId)?.(s.groupId)].filter(Boolean).join(' · ');
  const archived = await archivedCohortIds(term, contexts);
  const locked = sections.find((s) => archived.has(s.cohortId));
  if (locked) throw new AppError(409, `${label(locked)}: kalendarz rocznika w archiwum — obsada tylko do odczytu`);
  return { sections, label };
}

async function writeStaff(changes: StaffChange[]): Promise<void> {
  const ids = [...new Set(changes.flatMap((c) => c.rows.map((r) => r.instructorId)).filter((id): id is string => !!id))];
  // Prowadzacy usuniety w miedzyczasie (inne okno) — czytelny komunikat zamiast bledu klucza obcego.
  if (ids.length > 0 && (await prisma.instructor.count({ where: { id: { in: ids } } })) !== ids.length) {
    throw new AppError(409, 'Ktorys z wybranych prowadzacych zostal usuniety — odswiez liste i wybierz ponownie');
  }
  await prisma.$transaction(
    changes.flatMap((c) => [
      prisma.sectionInstructor.deleteMany({ where: { sectionId: c.sectionId } }),
      prisma.sectionInstructor.createMany({ data: c.rows.map((r) => ({ sectionId: c.sectionId, instructorId: r.instructorId, hours: r.hours })) }),
    ]),
  );
}

/** Obsada wskazanych zajec podmieniona w calosci (pusta lista = zajecia bez obsady). */
export async function replaceStaff(req: Request, term: AcademicTerm, changes: StaffChange[]): Promise<void> {
  const { sections, label } = await loadSections(req, term, changes.map((c) => c.sectionId));
  const byId = new Map(sections.map((s) => [s.id, s]));
  for (const change of changes) {
    const section = byId.get(change.sectionId)!;
    const problem = staffProblem(change.rows, section.hours);
    if (problem) throw new AppError(400, `${label(section)}: ${problem}`);
  }
  await writeStaff(changes);
}

/**
 * Godziny jednej osoby w wybranych zajeciach (0 = bez niej); obsada innych zostaje, a NN
 * ustepuje (lib/staffing.withPersonHours). Zwraca sume godzin osoby w tych zajeciach.
 */
export async function setPersonStaff(
  req: Request,
  term: AcademicTerm,
  instructorId: string,
  items: { sectionId: string; hours: number }[],
): Promise<{ hours: number; sections: number }> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId }, select: { id: true } });
  if (!instructor) throw new AppError(404, 'Prowadzacy nie istnieje — odswiez liste');
  const { sections, label } = await loadSections(req, term, items.map((i) => i.sectionId));
  const byId = new Map(sections.map((s) => [s.id, s]));
  const changes = items.map((item) => {
    const section = byId.get(item.sectionId)!;
    const rows = withPersonHours(section.instructors, instructorId, item.hours, section.hours);
    const problem = staffProblem(rows, section.hours);
    if (problem) {
      // Najczestszy przypadek: zajecia ma juz ktos inny — mowimy, ile godzin zostalo wolnych.
      const others = section.instructors.filter((r) => r.instructorId && r.instructorId !== instructorId).reduce((s, r) => s + r.hours, 0);
      throw new AppError(
        400,
        problem.startsWith('Suma')
          ? `${label(section)}: wolnych godzin ${Math.max(0, section.hours - others)} z ${section.hours} — reszte prowadza inni`
          : `${label(section)}: ${problem}`,
      );
    }
    return { sectionId: item.sectionId, rows };
  });
  await writeStaff(changes);
  return { hours: items.reduce((s, i) => s + i.hours, 0), sections: items.filter((i) => i.hours > 0).length };
}
