/**
 * Profil czasow kluczowych operacji planu na pelnej bazie (bez HTTP):
 *   docker exec -e DATABASE_URL=...planista10_pelne... planista10-backend-1 npx tsx scripts/pelne-dane/profil.ts
 */
import { prisma } from '../../src/lib/prisma';
import { activeCohorts } from '../../src/services/sections';
import { availability, calendarFor, checkPlacement, termOccupancy } from '../../src/services/plan';

async function time<T>(label: string, fn: () => Promise<T>, n = 3): Promise<T> {
  let out!: T;
  const ms: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    out = await fn();
    ms.push(performance.now() - t);
  }
  console.log(`${label.padEnd(44)} ${ms.map((x) => x.toFixed(0).padStart(6)).join(' ')} ms`);
  return out;
}

async function main() {
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { startYear_type: { startYear: 2026, type: 'WINTER' } } });
  const contexts = await time('activeCohorts (wszystkie)', () => activeCohorts(term, null));
  await time(`calendarFor x ${contexts.length} (N+1)`, async () => {
    for (const c of contexts) await calendarFor(term, c);
  });
  const busy = await time('termOccupancy', () => termOccupancy(term));
  console.log(`  zajetych slotow: ${busy.length}`);
  const all = await time('termOccupancy + wygenerowane (bez filtra)', () => termOccupancy(term, { includeGenerated: true }), 1);
  console.log(`  zajetych slotow: ${all.length}`);
  const placement = await prisma.placement.findFirstOrThrow({ where: { termId: term.id }, include: { section: true } });
  await time('availability (1 zajecia)', () =>
    availability(term, placement.sectionId, 2, { cycle: placement.cycle, pattern: 'ALL', numbers: [] }),
  );
  await time('checkPlacement (zapis umieszczenia)', () =>
    checkPlacement(
      term,
      {
        sectionId: placement.sectionId,
        dayOfWeek: placement.dayOfWeek,
        startOrder: placement.startOrder,
        endOrder: placement.endOrder,
        roomId: placement.roomId,
        instructorId: placement.instructorId,
        cycle: placement.cycle,
        pattern: placement.pattern,
        numbers: placement.numbers,
        fromIndex: placement.fromIndex,
        toIndex: placement.toIndex,
        jointKey: placement.jointKey,
      },
      placement.id,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
