/** Czas "Generuj terminy" (podglad) per wydzial i dla calej uczelni na pelnej bazie. */
import { prisma } from '../../src/lib/prisma';
import { generate } from '../../src/services/plan';

async function main() {
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { startYear_type: { startYear: 2026, type: 'WINTER' } } });
  const faculties = await prisma.faculty.findMany({ orderBy: { shortName: 'asc' } });
  for (const f of [...faculties, null]) {
    const t = performance.now();
    const rep = await generate(term, { facultyId: f?.id ?? null, dryRun: true });
    console.log(`${(f?.shortName ?? 'uczelnia').padEnd(10)} ${(performance.now() - t).toFixed(0).padStart(6)} ms  terminow ${rep.total}, kolizji ${rep.conflicts.length}, bez zmian ${rep.unchanged}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
