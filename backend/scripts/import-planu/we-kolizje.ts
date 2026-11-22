/** Podglad generowania terminow WE (zima 2026/27): kolizje i braki godzin. npx tsx scripts/import-planu/we-kolizje.ts */
import { prisma } from '../../src/lib/prisma';
import { generate } from '../../src/services/plan';

async function main() {
  const we = await prisma.faculty.findUniqueOrThrow({ where: { shortName: 'WE' } });
  const zima = await prisma.academicTerm.findFirstOrThrow({ where: { startYear: 2026, type: 'WINTER' } });
  const r = await generate(zima, { facultyId: we.id, fromDate: null, dryRun: true });
  const key = (c: { section: string; reason: string; with: string }) => `${c.reason} | ${c.section} | ${c.with}`;
  const cnt = new Map<string, number>();
  for (const c of r.conflicts) cnt.set(key(c), (cnt.get(key(c)) ?? 0) + 1);
  console.log(`terminow ${r.total}, kolizji ${r.conflicts.length}, ponad godziny ${r.beyondHours}, brakow ${r.shortfalls.length}`);
  for (const [k, v] of [...cnt].sort((a, b) => b[1] - a[1])) console.log(v, k);
  console.log('--- braki');
  for (const s of r.shortfalls) console.log(JSON.stringify(s));
}
main().finally(() => prisma.$disconnect());
