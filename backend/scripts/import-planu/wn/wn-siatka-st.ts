/**
 * Siatka stacjonarna WN wg rzeczywistych godzin planow: ciagle bloki 45 min od 7:15 do 21:00 (WN zaczyna
 * zajecia o roznych porach — 7:30, 8:30, 9:15, 10:15, 12:45, 16:45...; stara siatka z przerwami sciagala
 * zajecia nastepujace po sobie w ten sam blok). Umieszczenia stacjonarne WN dopasowane od nowa do godzin
 * z dane/wn/plan.json (rekord: rocznik, przedmiot, dzien, sala, najblizsza godzina). Terminy przelicza
 * potem plan-laczone.ts WN --apply.
 *   npx tsx scripts/import-planu/wn/wn-siatka-st.ts [--apply]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../../../src/lib/prisma';

interface Rec { mode: string; program: string; year: number; subject: string; form: string; day: string; start: number; end: number; room: string | null }
const apply = process.argv.includes('--apply');
const recs: Rec[] = JSON.parse(readFileSync(join(__dirname, '../dane/wn/plan.json'), 'utf8')).filter((r: Rec) => r.mode === 'FULL_TIME');
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const NEW = Array.from({ length: 19 }, (_, i) => ({ order: i + 1, s: 435 + i * 45, e: 480 + i * 45 }));
function snap(start: number, end: number) {
  const n = Math.max(1, Math.round((end - start) / 45));
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i + n <= NEW.length; i++) {
    const span = NEW.slice(i, i + n);
    const ov = span.reduce((a, b) => a + Math.max(0, Math.min(b.e, end) - Math.max(b.s, start)), 0);
    const score = ov - Math.abs(span[0]!.s - start) * 0.01;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return { startOrder: NEW[best]!.order, endOrder: NEW[best + n - 1]!.order };
}

async function main() {
  await prisma.$transaction(async (tx) => {
    const wn = await tx.faculty.findUniqueOrThrow({ where: { shortName: 'WN' } });
    const grid = await tx.timeGrid.findFirstOrThrow({ where: { facultyId: wn.id, studyMode: 'FULL_TIME', base: true }, include: { blocks: true } });
    const old = new Map(grid.blocks.map((b) => [b.order, { s: toMin(b.startTime), e: toMin(b.endTime) }]));
    const pls = await tx.placement.findMany({
      where: { facultyId: wn.id, cycle: 'WEEK' },
      include: { room: true, section: { include: { programEntry: { include: { subject: true } }, cohort: { include: { program: true, startTerm: true } } } } },
    });
    let matched = 0;
    const changes: { id: string; startOrder: number; endOrder: number }[] = [];
    for (const p of pls) {
      const os = old.get(p.startOrder)!.s;
      const oe = old.get(p.endOrder)!.e;
      const c = p.section.cohort;
      const cands = recs.filter((r) => r.program === c.program.code && r.year === c.startTerm.startYear && r.subject === p.section.programEntry.subject.name
        && r.day === p.dayOfWeek && (r.room ?? null) === (p.room?.number ?? null) && Math.abs(r.start - os) <= 50);
      const best = cands.sort((a, b) => Math.abs(a.start - os) + Math.abs(a.end - oe) - (Math.abs(b.start - os) + Math.abs(b.end - oe)))[0];
      if (best) matched++;
      const nb = best ? snap(best.start, best.end) : snap(os, oe);
      changes.push({ id: p.id, ...nb });
    }
    await tx.timeBlock.deleteMany({ where: { gridId: grid.id } });
    for (const b of NEW) await tx.timeBlock.create({ data: { gridId: grid.id, order: b.order, startTime: fmt(b.s), endTime: fmt(b.e), label: `${fmt(b.s)}-${fmt(b.e)}` } });
    for (const ch of changes) await tx.placement.update({ where: { id: ch.id }, data: { startOrder: ch.startOrder, endOrder: ch.endOrder } });
    console.log(`siatka WN stac.: ${NEW.length} blokow ${fmt(NEW[0]!.s)}-${fmt(NEW[NEW.length - 1]!.e)}; umieszczen ${pls.length}, dopasowanych do planu ${matched}`);
    if (!apply) throw new Error('PODGLAD — nic nie zapisano (uruchom z --apply)');
  }, { timeout: 300_000 });
}

main()
  .catch((e: Error) => {
    console.log(e.message);
    if (!e.message.startsWith('PODGLAD')) process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
