/** Podglad kolizji generowania terminow WZNJ (zima 2026/27): powody i najczestsze pary. npx tsx scripts/import-planu/wznj/kolizje.ts */
import { prisma } from '../../../src/lib/prisma';
import { generate } from '../../../src/services/plan';

async function main() {
  const wznj = await prisma.faculty.findUniqueOrThrow({ where: { shortName: 'WZNJ' } });
  const zima = await prisma.academicTerm.findFirstOrThrow({ where: { startYear: 2026, type: 'WINTER' } });
  const rep = await generate(zima, { facultyId: wznj.id, dryRun: true });
  const count = new Map<string, number>();
  for (const c of rep.conflicts) {
    const k = `${c.reason} | ${c.section} | ${c.with}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  console.log(`terminow ${rep.total}, kolizji ${rep.conflicts.length}, ponad godziny ${rep.beyondHours}`);
  const reasons = new Map<string, number>();
  for (const c of rep.conflicts) reasons.set(c.reason.split(':')[0]!, (reasons.get(c.reason.split(':')[0]!) ?? 0) + 1);
  console.log([...reasons].map(([k, v]) => `${v} ${k}`).join('\n'));
  for (const [k, v] of [...count].sort((a, b) => b[1] - a[1]).slice(0, Number(process.argv[2] ?? 40))) console.log(v, k);
}
main().finally(() => prisma.$disconnect());
