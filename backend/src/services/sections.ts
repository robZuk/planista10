import type { AcademicTerm, ClassType, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { deriveSections, scaleHours, sectionKey, type DemandProblem } from '../lib/demand';
import { displayName, indexGroups, pathFromRoot, ROOT, type GroupIndex, type TreeGroup } from '../lib/groupTree';
import { cohortSemesterInTerm, termLabel, termOrdinal } from '../lib/terms';
import { cohortLabel, toTreeGroup } from './cohorts';

/**
 * Zajecia semestru (ClassSection) i obsada. Synchronizacja to idempotentny diff:
 * dodaje brakujace zajecia, poprawia godziny, a zbedne usuwa tylko wtedy, gdy nie maja
 * obsady — inaczej oznacza je jako ORPHANED (do decyzji planisty). Przeniesienie
 * obsady z poprzedniego roku uzupelnia wylacznie zajecia bez obsady.
 */

const cohortForTerm = {
  program: {
    include: { fieldOfStudy: { include: { specializations: { select: { id: true, shortName: true } } } } },
  },
  programVersion: { select: { id: true, totalSemesters: true } },
  startTerm: true,
  terms: true,
  groups: true,
} satisfies Prisma.CohortInclude;

type CohortForTerm = Prisma.CohortGetPayload<{ include: typeof cohortForTerm }>;

export interface CohortContext {
  cohort: CohortForTerm;
  semester: number;
  tree: TreeGroup[];
  index: GroupIndex;
  nameOf: (groupId: string) => string;
}

/** Roczniki aktywne w semestrze (opcjonalnie: wydzial, wybrane roczniki) z kontekstem nazw grup. */
export async function activeCohorts(term: AcademicTerm, facultyId: string | null, cohortIds?: string[]) {
  const cohorts = await prisma.cohort.findMany({
    where: {
      ...(facultyId ? { program: { fieldOfStudy: { facultyId } } } : {}),
      ...(cohortIds?.length ? { id: { in: cohortIds } } : {}),
    },
    include: cohortForTerm,
  });
  const result: CohortContext[] = [];
  for (const cohort of cohorts) {
    const override = cohort.terms.find((t) => t.termId === term.id);
    const semester = override?.semester ?? cohortSemesterInTerm(cohort.startTerm, term);
    if (semester < 1 || semester > cohort.programVersion.totalSemesters) continue;
    result.push(contextFor(cohort, semester));
  }
  return result;
}

function contextFor(cohort: CohortForTerm, semester: number): CohortContext {
  const tree = cohort.groups.map(toTreeGroup);
  const index = indexGroups(tree);
  const ctx = {
    fieldShortName: cohort.program.fieldOfStudy.shortName,
    specShortNames: new Map(cohort.program.fieldOfStudy.specializations.map((s) => [s.id, s.shortName])),
    partTime: cohort.program.studyMode === 'PART_TIME',
    semester,
  };
  return {
    cohort,
    semester,
    tree,
    index,
    nameOf: (groupId) => {
      const g = index.get(groupId);
      return g ? displayName(g, index, ctx) : '?';
    },
  };
}

/** Sygnatura grupy niezalezna od rocznika: "SPEC:DUT/C:A/L:A1" — do dopasowan rok do roku. */
export function groupSignature(groupId: string, index: GroupIndex): string {
  return pathFromRoot(groupId, index)
    .filter((g) => g.partitionKey !== ROOT)
    .map((g) => `${g.partitionKey}:${g.code ?? ''}`)
    .join('/');
}

// ─── Synchronizacja ──────────────────────────────────────────

export interface SyncRow {
  cohort: string;
  subject: string;
  classType: ClassType;
  group: string;
  hours: number;
  oldHours?: number;
  fallback?: boolean;
}

export interface SyncReport {
  created: SyncRow[];
  hoursChanged: SyncRow[];
  reactivated: SyncRow[];
  orphaned: SyncRow[];
  deleted: SyncRow[];
  unchanged: number;
  problems: { cohort: string; subject: string; message: string }[];
}

export async function syncSections(
  term: AcademicTerm,
  opts: { facultyId: string | null; cohortIds?: string[]; dryRun: boolean },
): Promise<SyncReport> {
  const report: SyncReport = { created: [], hoursChanged: [], reactivated: [], orphaned: [], deleted: [], unchanged: 0, problems: [] };
  const contexts = await activeCohorts(term, opts.facultyId, opts.cohortIds);
  const ops: Prisma.PrismaPromise<unknown>[] = [];

  for (const ctx of contexts) {
    const { cohort, semester } = ctx;
    const entries = await prisma.programEntry.findMany({
      where: { versionId: cohort.programVersionId, semester },
      include: { subject: { select: { name: true } } },
    });
    const subjectOf = new Map(entries.map((e) => [e.id, e.subject.name]));
    const { sections: desired, problems } = deriveSections({
      entries,
      groups: ctx.tree,
      semester,
      lectureMode: cohort.lectureMode,
    });
    const label = cohortLabel(cohort);
    report.problems.push(
      ...problems.map((p: DemandProblem) => ({ cohort: label, subject: subjectOf.get(p.programEntryId) ?? '', message: p.message })),
    );

    const existing = await prisma.classSection.findMany({
      where: { termId: term.id, cohortId: cohort.id },
      include: { _count: { select: { instructors: true } }, programEntry: { include: { subject: { select: { name: true } } } } },
    });
    const existingByKey = new Map(existing.map((s) => [sectionKey(s), s]));
    const desiredKeys = new Set(desired.map(sectionKey));
    const row = (s: { programEntryId: string; classType: ClassType; groupId: string; hours: number }, subject?: string): SyncRow => ({
      cohort: label,
      subject: subject ?? subjectOf.get(s.programEntryId) ?? '',
      classType: s.classType,
      group: ctx.nameOf(s.groupId),
      hours: s.hours,
    });

    for (const d of desired) {
      const found = existingByKey.get(sectionKey(d));
      if (!found) {
        report.created.push({ ...row(d), fallback: d.fallback });
        ops.push(
          prisma.classSection.create({
            data: {
              termId: term.id,
              cohortId: cohort.id,
              programEntryId: d.programEntryId,
              classType: d.classType,
              groupId: d.groupId,
              hours: d.hours,
              facultyId: cohort.program.fieldOfStudy.facultyId,
            },
          }),
        );
        continue;
      }
      if (found.status === 'ORPHANED') report.reactivated.push(row(d));
      else if (found.hours !== d.hours) report.hoursChanged.push({ ...row(d), oldHours: found.hours });
      else report.unchanged++;
      if (found.status === 'ORPHANED' || found.hours !== d.hours) {
        ops.push(prisma.classSection.update({ where: { id: found.id }, data: { status: 'ACTIVE', hours: d.hours } }));
      }
    }

    for (const s of existing) {
      if (desiredKeys.has(sectionKey(s))) continue;
      const r = row(s, s.programEntry.subject.name);
      if (s._count.instructors > 0) {
        if (s.status !== 'ORPHANED') {
          report.orphaned.push(r);
          ops.push(prisma.classSection.update({ where: { id: s.id }, data: { status: 'ORPHANED' } }));
        }
      } else {
        report.deleted.push(r);
        ops.push(prisma.classSection.delete({ where: { id: s.id } }));
      }
    }
  }

  if (!opts.dryRun && ops.length > 0) await prisma.$transaction(ops);
  return report;
}

// ─── Przenoszenie obsady ─────────────────────────────────────

export interface CarryRow {
  sectionId: string;
  cohort: string;
  subject: string;
  classType: ClassType;
  group: string;
  hours: number;
  source?: string;
  instructors?: { name: string; hours: number }[];
}

/**
 * Obsada z ostatniego wczesniejszego semestru tego samego typu (zima -> zima): te same
 * zajecia poprzedniego rocznika tego samego programu — ten sam przedmiot, forma i grupa
 * o tej samej sygnaturze (np. L-A1 w specjalnosci DUT). Uzupelnia tylko zajecia bez obsady.
 */
export async function carryInstructors(
  term: AcademicTerm,
  opts: { facultyId: string | null; dryRun: boolean },
): Promise<{ matched: CarryRow[]; unmatched: CarryRow[] }> {
  const contexts = await activeCohorts(term, opts.facultyId);
  const ctxByCohort = new Map(contexts.map((c) => [c.cohort.id, c]));
  const targets = await prisma.classSection.findMany({
    where: { termId: term.id, cohortId: { in: [...ctxByCohort.keys()] }, status: 'ACTIVE', instructors: { none: {} } },
    include: { programEntry: { include: { subject: true } } },
  });
  const programIds = [...new Set(contexts.map((c) => c.cohort.programId))];

  // Kandydaci: zajecia z obsada w tych samych programach, we wczesniejszych semestrach tego samego typu.
  const candidates = await prisma.classSection.findMany({
    where: {
      instructors: { some: {} },
      cohort: { programId: { in: programIds } },
      term: { type: term.type, startYear: { lt: term.startYear } },
    },
    include: {
      term: true,
      programEntry: { select: { subjectId: true } },
      instructors: { include: { instructor: { select: { firstName: true, lastName: true, title: true } } } },
      cohort: { include: { groups: true, program: { select: { id: true } } } },
    },
  });
  const sourceIndex = new Map<string, GroupIndex>();
  const keyOf = (programId: string, subjectId: string, classType: ClassType, signature: string) =>
    `${programId}|${subjectId}|${classType}|${signature}`;
  const best = new Map<string, (typeof candidates)[number]>();
  for (const c of candidates) {
    let index = sourceIndex.get(c.cohortId);
    if (!index) {
      index = indexGroups(c.cohort.groups.map(toTreeGroup));
      sourceIndex.set(c.cohortId, index);
    }
    const key = keyOf(c.cohort.program.id, c.programEntry.subjectId, c.classType, groupSignature(c.groupId, index));
    const current = best.get(key);
    if (!current || termOrdinal(c.term) > termOrdinal(current.term)) best.set(key, c);
  }

  const matched: CarryRow[] = [];
  const unmatched: CarryRow[] = [];
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const t of targets) {
    const ctx = ctxByCohort.get(t.cohortId)!;
    const base: CarryRow = {
      sectionId: t.id,
      cohort: cohortLabel(ctx.cohort),
      subject: t.programEntry.subject.name,
      classType: t.classType,
      group: ctx.nameOf(t.groupId),
      hours: t.hours,
    };
    const source = best.get(keyOf(ctx.cohort.programId, t.programEntry.subjectId, t.classType, groupSignature(t.groupId, ctx.index)));
    if (!source) {
      unmatched.push(base);
      continue;
    }
    const hours = scaleHours(source.instructors.map((i) => i.hours), t.hours);
    matched.push({
      ...base,
      source: termLabel(source.term),
      instructors: source.instructors.map((i, n) => ({
        name: i.instructor ? `${i.instructor.title ?? ''} ${i.instructor.firstName} ${i.instructor.lastName}`.trim() : 'NN',
        hours: hours[n]!,
      })),
    });
    ops.push(
      prisma.sectionInstructor.createMany({
        data: source.instructors.map((i, n) => ({ sectionId: t.id, instructorId: i.instructorId, hours: hours[n]! })),
      }),
    );
  }
  if (!opts.dryRun && ops.length > 0) await prisma.$transaction(ops);
  return { matched, unmatched };
}
