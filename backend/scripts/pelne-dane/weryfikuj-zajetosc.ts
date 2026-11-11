/**
 * Weryfikacja zawezonej zajetosci (termOccupancy z relevantTo) na pelnej bazie: dla losowych
 * umieszczen wynik zawezony == pelny zbior ograniczony do sali, prowadzacego i grup rocznika.
 */
import { prisma } from '../../src/lib/prisma';
import { termOccupancy } from '../../src/services/plan';
import type { BusySlot } from '../../src/lib/materializer';

const key = (b: BusySlot) => [b.date, b.startMinute, b.endMinute, b.roomId, b.instructorId, b.groupId, b.jointKey, b.label].join('|');

async function main() {
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { startYear_type: { startYear: 2026, type: 'WINTER' } } });
  const placements = await prisma.placement.findMany({ where: { termId: term.id }, include: { section: true } });
  const sample = Array.from({ length: 40 }, (_, i) => placements[(i * 7919) % placements.length]!);
  for (const includeGenerated of [false, true]) {
    const full = await termOccupancy(term, { includeGenerated });
    let bad = 0;
    for (const p of sample) {
      const groups = new Set((await prisma.studentGroup.findMany({ where: { cohortId: p.section.cohortId }, select: { id: true } })).map((g) => g.id));
      const relevantTo = { cohortId: p.section.cohortId, roomId: p.roomId, instructorId: p.instructorId };
      const filtered = await termOccupancy(term, { includeGenerated, relevantTo });
      const pick = (list: BusySlot[]) =>
        list.filter((b) => (p.roomId && b.roomId === p.roomId) || (p.instructorId && b.instructorId === p.instructorId) || groups.has(b.groupId)).map(key).sort();
      const a = pick(full);
      const b = pick(filtered);
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        bad++;
        console.log(`ROZNICA ${p.id}: pelny ${a.length}, zawezony ${b.length}`);
      }
    }
    console.log(`includeGenerated=${includeGenerated}: ${sample.length} umieszczen, roznic: ${bad} (pelny zbior: ${full.length} slotow)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
