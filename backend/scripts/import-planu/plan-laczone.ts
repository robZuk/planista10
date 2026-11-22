/**
 * Po imporcie planu wydzialu (domyslnie WE; inny: drugi argument, np. WN): duplikaty umieszczen (ten sam wyklad w arkuszach dwoch specjalnosci) precz,
 * umieszczenia roznych zajec w tej samej sali, czasie i rytmie u tego samego prowadzacego = zajecia
 * laczone (wspolny jointKey — nie koliduja ze soba). Potem terminy kalendarzy WE od nowa.
 *   npx tsx scripts/import-planu/plan-laczone.ts [WYDZIAL] [--apply]
 * Laczone sa tez zajecia tego samego przedmiotu, formy i rocznika w tej samej sali i czasie (np. WF kilku grup
 * w hali, laboratorium dwoch grup razem) — nawet przy roznych prowadzacych.
 */
import { prisma } from '../../src/lib/prisma';
import { changeCalendarStatus } from '../../src/services/autoPlan';

const apply = process.argv.includes('--apply');
const faculty = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'WE';

async function main() {
  const we = await prisma.faculty.findUniqueOrThrow({ where: { shortName: faculty } });
  const zima = await prisma.academicTerm.findFirstOrThrow({ where: { startYear: 2026, type: 'WINTER' } });
  await prisma.$transaction(
    async (tx) => {
      const pls = await tx.placement.findMany({ where: { facultyId: we.id, termId: zima.id }, orderBy: { createdAt: 'asc' }, include: { section: { select: { programEntryId: true, classType: true, cohortId: true } } } });
      const slot = (p: (typeof pls)[number]) => [p.dayOfWeek, p.startOrder, p.endOrder, p.cycle, p.pattern, p.numbers.join(','), p.fromIndex, p.toIndex].join('|');
      const seen = new Set<string>();
      const dups: string[] = [];
      for (const p of pls) {
        const k = `${p.sectionId}|${slot(p)}`;
        if (seen.has(k)) dups.push(p.id);
        else seen.add(k);
      }
      // te same zajecia w nakladajacym sie czasie i tygodniach (komorka rozciagnieta w arkuszu): zostaje dluzsze
      const weeks = (p: (typeof pls)[number]) => (p.cycle === 'ZJAZD' || p.pattern === 'LIST' ? new Set(p.numbers) : null);
      const left = pls.filter((p) => !dups.includes(p.id));
      for (const a of left) {
        if (dups.includes(a.id)) continue;
        for (const b of left) {
          if (a === b || dups.includes(b.id) || a.sectionId !== b.sectionId || a.dayOfWeek !== b.dayOfWeek || a.cycle !== b.cycle) continue;
          if (!(a.startOrder <= b.endOrder && b.startOrder <= a.endOrder)) continue;
          const wa = weeks(a), wb = weeks(b);
          if (wa && wb && ![...wa].some((x) => wb.has(x))) continue;
          if (!wa && (a.pattern !== b.pattern && a.pattern !== 'ALL' && b.pattern !== 'ALL')) continue;
          const fa = a.fromIndex ?? 1, ta = a.toIndex ?? 99, fb = b.fromIndex ?? 1, tb = b.toIndex ?? 99;
          if (!(fa <= tb && fb <= ta)) continue;
          // b krotsze albo zawarte w a -> precz
          if (b.endOrder - b.startOrder <= a.endOrder - a.startOrder) dups.push(b.id);
        }
      }
      await tx.placement.deleteMany({ where: { id: { in: dups } } });
      const rest = pls.filter((p) => !dups.includes(p.id));
      const groups = new Map<string, string[]>();
      for (const p of rest) {
        if (!p.roomId && !p.instructorId) continue;
        const k = `${slot(p)}|${p.roomId}|${p.instructorId}`;
        groups.set(k, [...(groups.get(k) ?? []), p.id]);
      }
      // ten sam przedmiot, forma i rocznik w tej samej sali i czasie (rozni prowadzacy) — dolacz do jednej grupy
      const byKey = new Map<string, string>();
      for (const [k, ids] of groups) for (const id of ids) byKey.set(id, k);
      const subj = new Map<string, string[]>();
      for (const p of rest) {
        if (!p.roomId) continue;
        const k = `${slot(p)}|${p.roomId}|${p.section.programEntryId}|${p.section.classType}|${p.section.cohortId}`;
        subj.set(k, [...(subj.get(k) ?? []), p.id]);
      }
      for (const ids of subj.values()) {
        const keys = [...new Set(ids.map((id) => byKey.get(id)!))];
        if (keys.length < 2) continue;
        const target = keys[0]!;
        for (const k of keys.slice(1)) {
          groups.set(target, [...groups.get(target)!, ...groups.get(k)!]);
          for (const id of groups.get(k)!) byKey.set(id, target);
          groups.delete(k);
        }
      }
      let joint = 0;
      let n = 0;
      for (const ids of groups.values()) {
        const secs = new Set(rest.filter((p) => ids.includes(p.id)).map((p) => p.sectionId));
        if (secs.size < 2) continue;
        n++;
        await tx.placement.updateMany({ where: { id: { in: ids } }, data: { jointKey: `${faculty.toLowerCase()}-${String(n).padStart(4, '0')}` } });
        joint += ids.length;
      }
      console.log(`duplikaty usuniete: ${dups.length}; zajecia laczone: ${n} kluczy, ${joint} umieszczen`);
      if (!apply) throw new Error('PODGLAD — nic nie zapisano (uruchom z --apply)');
    },
    { timeout: 300_000 },
  );
  // Terminy wydzialu kasujemy RAZ, przed przeliczeniem kalendarzy. Kasowanie w petli (przed kazdym
  // kalendarzem) usuwalo tez terminy przeliczone chwile wczesniej dla innego kalendarza wydzialu —
  // tak stacjonarne WE, WN i WZNJ zostaly bez terminow po przeliczeniu niestacjonarnych.
  await prisma.occurrence.deleteMany({ where: { termId: zima.id, kind: 'DERIVED', section: { cohort: { program: { fieldOfStudy: { facultyId: we.id } } } } } });
  for (const cal of await prisma.termCalendar.findMany({ where: { termId: zima.id, facultyId: we.id } })) {
    await prisma.termCalendar.update({ where: { id: cal.id }, data: { status: 'PLANNING' } });
    const { refresh } = await changeCalendarStatus(zima, { ...cal, status: 'PLANNING' }, 'PUBLISHED', () => prisma.termCalendar.update({ where: { id: cal.id }, data: { status: 'PUBLISHED' } }));
    const r = refresh.report as unknown as { total: number; conflicts: { reason?: string; kind?: string }[]; beyondHours: number; shortfalls: unknown[] } | null;
    console.log(`kalendarz ${cal.studyMode}: terminow ${r?.total}, kolizji ${r?.conflicts.length}, ponad godziny ${r?.beyondHours}, brakow ${r?.shortfalls.length}`);
    if (r) {
      const kinds = new Map<string, number>();
      for (const c of r.conflicts) {
        const k = JSON.stringify(c).match(/"(reason|kind|type)":"(\w+)"/)?.[2] ?? '?';
        kinds.set(k, (kinds.get(k) ?? 0) + 1);
      }
      console.log('  kolizje wg rodzaju:', JSON.stringify([...kinds]));
      console.log('  przyklad:', JSON.stringify(r.conflicts[0]).slice(0, 400));
    }
  }
}

main()
  .catch((e: Error) => {
    console.log(e.message);
    if (!e.message.startsWith('PODGLAD')) process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
