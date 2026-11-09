import type { AcademicTerm, ClassType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { indexGroups } from '../lib/groupTree';
import { termLabel, termOrdinal } from '../lib/terms';
import { toTreeGroup, cohortLabel } from './cohorts';
import { activeCohorts, groupSignature } from './sections';
import { calendarFor, checkPlacement, type PlacementInput } from './plan';
import { conflictShort } from '../lib/conflictMessage';

/**
 * "Przenies plan z zeszlego roku" — uruchamiane WYLACZNIE przyciskiem planisty, dla
 * wybranych rocznikow, zawsze najpierw jako podglad. Zrodlo: poprzedni rocznik tego
 * samego programu w tym samym semestrze programu, w ostatnim wczesniejszym semestrze
 * kalendarzowym tego samego typu, ktory ma plan. Dopasowanie zajec: przedmiot + forma
 * + sygnatura grupy. Dzien, godziny, sala i rytm przechodza; prowadzacy — z tegorocznej
 * obsady. Kazde przeniesione umieszczenie przechodzi te sama walidacje co reczne —
 * kolidujace nie sa zapisywane, tylko zgloszone. Zajecia z juz ulozonym planem sa pomijane.
 */

export interface CarryPlanRow {
  cohort: string;
  subject: string;
  classType: ClassType;
  group: string;
  source?: string;
  problem?: string;
}

export interface CarryPlanReport {
  created: CarryPlanRow[];
  conflicts: CarryPlanRow[];
  unmatched: CarryPlanRow[];
  skipped: number;
  sources: { cohort: string; source: string | null }[];
}

export async function carryPlan(
  term: AcademicTerm,
  opts: { facultyId: string | null; cohortIds: string[]; dryRun: boolean },
): Promise<CarryPlanReport> {
  const report: CarryPlanReport = { created: [], conflicts: [], unmatched: [], skipped: 0, sources: [] };
  const contexts = await activeCohorts(term, opts.facultyId, opts.cohortIds);

  for (const ctx of contexts) {
    const label = cohortLabel(ctx.cohort);
    const calendar = await calendarFor(term, ctx);
    // Kandydaci na zrodlo: umieszczenia tego programu we wczesniejszych semestrach tego samego typu,
    // w zajeciach rocznikow, ktore byly wtedy w tym samym semestrze programu.
    const candidates = await prisma.placement.findMany({
      where: {
        term: { type: term.type, startYear: { lt: term.startYear } },
        section: { cohort: { programId: ctx.cohort.programId } },
      },
      include: {
        term: true,
        section: {
          include: {
            programEntry: { select: { subjectId: true, semester: true } },
            cohort: { include: { groups: true } },
          },
        },
      },
    });
    const sameSemester = candidates.filter((p) => p.section.programEntry.semester === ctx.semester);
    const latest = sameSemester.reduce<number>((max, p) => Math.max(max, termOrdinal(p.term)), -1);
    const source = sameSemester.filter((p) => termOrdinal(p.term) === latest);
    report.sources.push({ cohort: label, source: source[0] ? termLabel(source[0].term) : null });
    if (source.length === 0) continue;

    const indexByCohort = new Map<string, ReturnType<typeof indexGroups>>();
    const sourceByKey = new Map<string, typeof source>();
    for (const p of source) {
      let index = indexByCohort.get(p.section.cohortId);
      if (!index) {
        index = indexGroups(p.section.cohort.groups.map(toTreeGroup));
        indexByCohort.set(p.section.cohortId, index);
      }
      const key = `${p.section.programEntry.subjectId}|${p.section.classType}|${groupSignature(p.section.groupId, index)}`;
      sourceByKey.set(key, [...(sourceByKey.get(key) ?? []), p]);
    }

    const targets = await prisma.classSection.findMany({
      where: { termId: term.id, cohortId: ctx.cohort.id, status: 'ACTIVE' },
      include: { programEntry: { include: { subject: true } }, instructors: true, _count: { select: { placements: true } } },
    });
    for (const t of targets) {
      const row: CarryPlanRow = {
        cohort: label,
        subject: t.programEntry.subject.name,
        classType: t.classType,
        group: ctx.nameOf(t.groupId),
      };
      if (t._count.placements > 0) {
        report.skipped++;
        continue;
      }
      const matches = sourceByKey.get(`${t.programEntry.subjectId}|${t.classType}|${groupSignature(t.groupId, ctx.index)}`);
      if (!matches) {
        report.unmatched.push(row);
        continue;
      }
      const staff = t.instructors.map((i) => i.instructorId).filter((x): x is string => !!x);
      for (const p of matches) {
        const cycle = calendar?.kind === 'ZJAZD' ? 'ZJAZD' : 'WEEK';
        const input: PlacementInput = {
          sectionId: t.id,
          dayOfWeek: p.dayOfWeek,
          startOrder: p.startOrder,
          endOrder: p.endOrder,
          roomId: p.roomId,
          instructorId: p.instructorId && staff.includes(p.instructorId) ? p.instructorId : (staff[0] ?? null),
          // Zmiana rytmu kalendarza (tydzien <-> zjazdy) — wybrane numery nie maja sensu, bierzemy wszystkie.
          cycle,
          pattern: cycle === p.cycle ? p.pattern : 'ALL',
          numbers: cycle === p.cycle ? p.numbers : [],
          fromIndex: cycle === p.cycle ? p.fromIndex : null,
          toIndex: cycle === p.cycle ? p.toIndex : null,
          jointKey: null,
        };
        const check = await checkPlacement(term, input);
        const sourceLabel = termLabel(p.term);
        if (check.errors.length > 0 || check.conflicts.length > 0) {
          report.conflicts.push({
            ...row,
            source: sourceLabel,
            problem:
              check.errors.join('; ') || conflictShort(check.conflicts),
          });
          continue;
        }
        report.created.push({ ...row, source: sourceLabel });
        if (!opts.dryRun) {
          await prisma.placement.create({ data: { ...input, termId: term.id, facultyId: t.facultyId } });
        }
      }
    }
  }
  return report;
}
