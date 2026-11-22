/**
 * WI: grupy projektowe P<n> pod laboratoryjnymi L<n> (te same osoby) — wtedy P2 i L1 sa rozlaczne
 * (rozne galezie podzialu L), a P1 i L1 koliduja. Potem "Generuj terminy" dla WI.
 *   npx tsx scripts/import-planu/wi/wi-p-pod-l.ts [--apply]
 */
import { prisma } from '../../../src/lib/prisma';
import { generate } from '../../../src/services/plan';
import { withPlanLock } from '../../../src/services/planLock';

const apply = process.argv.includes('--apply');
async function main() {
  const wi = await prisma.faculty.findUniqueOrThrow({ where: { shortName: 'WI' } });
  const groups = await prisma.studentGroup.findMany({ where: { cohort: { program: { fieldOfStudy: { facultyId: wi.id } } } } });
  let n = 0;
  for (const p of groups.filter((g) => g.partitionKey === 'P')) {
    const l = groups.find((g) => g.cohortId === p.cohortId && g.partitionKey === 'L' && g.code === p.code);
    if (!l || p.parentGroupId === l.id) continue;
    if (apply) await prisma.studentGroup.update({ where: { id: p.id }, data: { parentGroupId: l.id } });
    n++;
  }
  console.log(`P pod L: ${n}${apply ? '' : ' (podglad)'}`);
  if (!apply) return;
  const t = await prisma.academicTerm.findFirstOrThrow({ where: { startYear: 2026, type: 'WINTER' } });
  const r: any = await withPlanLock(t.id, () => generate(t, { facultyId: wi.id, dryRun: false } as any));
  console.log(JSON.stringify({ ...(r.report ?? r), conflicts: (r.conflicts ?? r.report?.conflicts ?? []).length, shortfalls: (r.shortfalls ?? r.report?.shortfalls ?? []).map((s: any) => `${s.section} -${s.missing}`) }).slice(0, 2500));
}
main().finally(() => prisma.$disconnect());
