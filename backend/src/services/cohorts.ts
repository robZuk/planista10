import type { StudentGroup } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { cohortSemesterInTerm, termKey, termLabel, type TermRef } from '../lib/terms';
import { displayName, indexGroups, isActiveIn, type TreeGroup } from '../lib/groupTree';

/** Rocznik z tym, czego potrzeba do nazw i arytmetyki semestrow. */
export const cohortInclude = {
  program: {
    include: {
      fieldOfStudy: {
        select: {
          id: true,
          name: true,
          shortName: true,
          facultyId: true,
          specializations: { select: { id: true, name: true, shortName: true } },
        },
      },
    },
  },
  programVersion: { select: { id: true, label: true, status: true, totalSemesters: true } },
  startTerm: true,
};

export type CohortFull = NonNullable<Awaited<ReturnType<typeof loadCohort>>>;

export async function loadCohort(id: string) {
  return prisma.cohort.findUnique({ where: { id }, include: cohortInclude });
}

export function cohortLabel(cohort: { program: { code: string }; startTerm: TermRef; name?: string | null }): string {
  return cohort.name || `${cohort.program.code} · nabor ${termLabel(cohort.startTerm)}`;
}

/** Rok studiow dla numeru semestru programu (1-2 -> 1, 3-4 -> 2...). */
export function studyYearOf(semester: number): number {
  return Math.floor((semester - 1) / 2) + 1;
}

export function toTreeGroup(g: StudentGroup): TreeGroup {
  return {
    id: g.id,
    cohortId: g.cohortId,
    parentId: g.parentGroupId,
    partitionKey: g.partitionKey,
    code: g.code,
    specializationId: g.specializationId,
    fromSemester: g.fromSemester,
    toSemester: g.toSemester,
  };
}


/**
 * Grupy rocznika gotowe do pokazania w danym semestrze programu: nazwa liczona,
 * informacja o aktywnosci, liczba studentow i uzycie w (starym) planie.
 */
export async function cohortGroupsView(cohort: CohortFull, semester: number) {
  const groups = await prisma.studentGroup.findMany({
    where: { cohortId: cohort.id },
    include: { _count: { select: { members: true, sections: true, occurrences: true, subGroups: true } } },
    orderBy: [{ fromSemester: 'asc' }, { code: 'asc' }],
  });
  const tree = groups.map(toTreeGroup);
  const index = indexGroups(tree);
  const ctx = {
    fieldShortName: cohort.program.fieldOfStudy.shortName,
    specShortNames: new Map(cohort.program.fieldOfStudy.specializations.map((s) => [s.id, s.shortName])),
    partTime: cohort.program.studyMode === 'PART_TIME',
    semester,
  };
  return groups.map((g, i) => ({
    id: g.id,
    parentId: g.parentGroupId,
    partitionKey: g.partitionKey,
    code: g.code,
    specializationId: g.specializationId,
    size: g.size,
    fromSemester: g.fromSemester,
    toSemester: g.toSemester,
    active: isActiveIn(tree[i]!, semester),
    name: displayName(tree[i]!, index, ctx),
    memberCount: g._count.members,
    usedInPlan: g._count.sections + g._count.occurrences > 0,
    childCount: g._count.subGroups,
  }));
}

/** Semestr programu rocznika w semestrze kalendarzowym (z korekta z CohortTerm, jesli jest). */
export function semesterOf(cohort: { startTerm: TermRef }, term: TermRef, override?: number | null): number {
  return override ?? cohortSemesterInTerm(cohort.startTerm, term);
}

export function cohortDto(cohort: CohortFull) {
  return {
    id: cohort.id,
    name: cohort.name,
    label: cohortLabel(cohort),
    lectureMode: cohort.lectureMode,
    startTermKey: termKey(cohort.startTerm),
    startTermLabel: termLabel(cohort.startTerm),
    program: {
      id: cohort.program.id,
      code: cohort.program.code,
      name: cohort.program.name,
      studyMode: cohort.program.studyMode,
      degreeLevel: cohort.program.degreeLevel,
      fieldOfStudy: cohort.program.fieldOfStudy,
    },
    programVersion: cohort.programVersion,
  };
}
