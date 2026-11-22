/**
 * Plany zajec WE (zima 2026/27) z https://we.umg.edu.pl/plany -> grupy rocznikow, umieszczenia, obsada,
 * prowadzacy (baza kontaktow UMG), sale, zjazdy kalendarza niestacjonarnego, terminy.
 * Dane: dane/we/plan.json (parsery/we_norm.py) i dane/we/osoby.json (parsery/we_osoby.py).
 *
 *   npx tsx scripts/import-planu/we-plan.ts --setup [--apply]   # grupy wg arkuszy + synchronizacja zajec
 *   npx tsx scripts/import-planu/we-plan.ts --plan [--apply]    # zjazdy, prowadzacy, sale, umieszczenia, obsada, terminy
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClassType, DayOfWeek, Prisma, StudentGroup } from '@prisma/client';
import { prisma } from '../../src/lib/prisma';
import { autoSyncCohorts, changeCalendarStatus } from '../../src/services/autoPlan';
import { TeachingCalendar } from '../../src/lib/teachingCalendar';
import { toCalendarInput, calendarInclude } from '../../src/services/termCalendars';

interface SpecDef { slots: number; cOf: number[] }
interface Plan {
  structure: Record<string, { sem: number; mode: string; specs: Record<string, SpecDef> }>;
  records: Rec[];
}
interface Rec {
  cohort: string; sem: number; spec: string | null; day?: DayOfWeek; date?: string; start: string; end: string;
  subject: string; form: ClassType; slots: number[] | null; room: string | null; person: string | null;
  pattern: 'ALL' | 'ODD' | 'EVEN' | 'LIST'; fromIndex: number | null; toIndex: number | null; dates: string[]; src: string;
}
type Person = { lastName: string; firstName: string; title: string; email: string | null; unit: string | null } | null;

const apply = process.argv.includes('--apply');
const phase = process.argv.includes('--setup') ? 'setup' : process.argv.includes('--reset') ? 'reset' : 'plan';
const plan: Plan = JSON.parse(readFileSync(join(__dirname, 'dane/we/plan.json'), 'utf8'));
const people: Record<string, Person> = JSON.parse(readFileSync(join(__dirname, 'dane/we/osoby.json'), 'utf8'));
const LAB_SIZE = 12;
const WEEKDAYS: DayOfWeek[] = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => iso(new Date(D(s).getTime() + n * 86400000));
const dayOf = (s: string) => WEEKDAYS[D(s).getUTCDay()]!;

async function cohortOf(tx: Prisma.TransactionClient, key: string) {
  const [code, start] = key.split(':') as [string, string];
  const year = Number(start.slice(0, 4));
  const type = start.endsWith('S') ? 'SUMMER' : 'WINTER';
  const program = await tx.program.findUniqueOrThrow({ where: { code } });
  return tx.cohort.findFirstOrThrow({
    where: { programId: program.id, startTerm: { startYear: year, type } },
    include: { groups: true, programVersion: { include: { entries: { include: { specialization: true } } } }, program: { include: { fieldOfStudy: { include: { specializations: true } } } } },
  });
}

async function setup(tx: Prisma.TransactionClient) {
  const ids: string[] = [];
  for (const [key, st] of Object.entries(plan.structure)) {
    const c = await cohortOf(tx, key);
    const root = c.groups.find((g) => g.partitionKey === 'ROOT')!;
    // zajecia puste (z synchronizacji) i grupy poza ROOT precz
    const busy = await tx.classSection.count({ where: { cohortId: c.id, OR: [{ placements: { some: {} } }, { instructors: { some: {} } }, { occurrences: { some: {} } }] } });
    if (busy) throw new Error(`${key}: rocznik ma zajecia z planem/obsada (${busy})`);
    await tx.classSection.deleteMany({ where: { cohortId: c.id } });
    let rest = c.groups.filter((g) => g.id !== root.id);
    while (rest.length) {
      const leaves = rest.filter((g) => !rest.some((o) => o.parentGroupId === g.id));
      await tx.studentGroup.deleteMany({ where: { id: { in: leaves.map((g) => g.id) } } });
      rest = rest.filter((g) => !leaves.includes(g));
    }
    const specByShort = new Map(c.program.fieldOfStudy.specializations.map((s) => [s.shortName, s]));
    // semestr startu specjalnosci (pierwsza pozycja specjalnosciowa po biezacym)
    const specSems = c.programVersion.entries.filter((e) => e.specializationId).map((e) => e.semester);
    const specStart = Math.min(...specSems.filter((s) => s > st.sem), 99);
    let total = 0;
    const mk = (data: Omit<Prisma.StudentGroupUncheckedCreateInput, 'cohortId'>) => tx.studentGroup.create({ data: { cohortId: c.id, ...data } });
    const buildTree = async (parent: StudentGroup, def: SpecDef, specId: string | null, toSemester: number | null, fromSemester: number) => {
      // jedna kolumna (specjalnosc bez podzialu): jedna grupa C/L/P — zeby wspolne cwiczenia i laboratoria mialy zajecia
      if (def.slots <= 1) def = { slots: 1, cOf: [1] };
      const nc = Math.max(...def.cOf);
      let sum = 0;
      for (let ci = 1; ci <= nc; ci++) {
        const slots = def.cOf.map((x, i) => (x === ci ? i + 1 : 0)).filter(Boolean);
        const size = slots.length * LAB_SIZE;
        sum += size;
        const cg = await mk({ partitionKey: 'C', code: String(ci), size, parentGroupId: parent.id, specializationId: specId, fromSemester, toSemester });
        for (const k of slots) {
          const lg = await mk({ partitionKey: 'L', code: String(k), size: LAB_SIZE, parentGroupId: cg.id, specializationId: specId, fromSemester, toSemester });
          await mk({ partitionKey: 'P', code: String(k), size: LAB_SIZE, parentGroupId: lg.id, specializationId: specId, fromSemester, toSemester });
        }
      }
      return sum;
    };
    const desc: string[] = [];
    for (const [spec, def] of Object.entries(st.specs)) {
      if (!spec) {
        const to = specStart < 99 ? specStart - 1 : null;
        total += await buildTree(root, def, null, to, 1);
        desc.push(`wspolne: ${def.slots} lab., ${Math.max(...def.cOf)} cw.${to ? ` (do sem. ${to})` : ''}`);
        if (specStart < 99) {
          // specjalnosci programu od semestru specStart: grupa ćw. A i laboratoryjne
          const shorts = [...new Set(c.programVersion.entries.filter((e) => e.specialization && e.semester >= specStart).map((e) => e.specialization!.shortName))];
          for (const sh of shorts) {
            const sp = specByShort.get(sh)!;
            const size = Math.max(10, Math.round(total / shorts.length));
            const sg = await mk({ partitionKey: 'SPEC', code: sh, size, parentGroupId: root.id, specializationId: sp.id, fromSemester: specStart });
            const cg = await mk({ partitionKey: 'C', code: 'A', size, parentGroupId: sg.id, specializationId: sp.id, fromSemester: specStart });
            const nl = Math.max(1, Math.ceil(size / 15));
            for (let j = 1; j <= nl; j++) await mk({ partitionKey: 'L', code: `A${j}`, size: Math.round(size / nl), parentGroupId: cg.id, specializationId: sp.id, fromSemester: specStart });
          }
          desc.push(`specjalnosci od sem. ${specStart}: ${shorts.join('/')}`);
        }
      } else {
        const sp = specByShort.get(spec);
        if (!sp) throw new Error(`${key}: brak specjalnosci ${spec}`);
        const sg = await mk({ partitionKey: 'SPEC', code: spec, size: 1, parentGroupId: root.id, specializationId: sp.id });
        const size = await buildTree(sg, def, sp.id, null, 1);
        await tx.studentGroup.update({ where: { id: sg.id }, data: { size } });
        total += size;
        desc.push(`${spec}: ${def.slots} lab.`);
      }
    }
    await tx.studentGroup.update({ where: { id: root.id }, data: { size: total } });
    await tx.cohort.update({ where: { id: c.id }, data: { lectureMode: 'JOINT' } });
    ids.push(c.id);
    console.log(`${key} (sem. ${st.sem}): ${total} os.; ${desc.join('; ')}`);
  }
  return ids;
}

function blocks(grid: { order: number; startTime: string; endTime: string }[], start: string, end: string) {
  const s = grid.find((b) => b.startTime === start);
  const e = [...grid].reverse().find((b) => b.endTime <= end && b.order >= (s?.order ?? 99)) ;
  if (!s || !e) return null;
  return { startOrder: s.order, endOrder: e.order };
}

async function planPhase(tx: Prisma.TransactionClient) {
  const we = await tx.faculty.findUniqueOrThrow({ where: { shortName: 'WE' } });
  const zima = await tx.academicTerm.findFirstOrThrow({ where: { startYear: 2026, type: 'WINTER' } });
  const grids = await tx.timeGrid.findMany({ where: { facultyId: we.id, base: true }, include: { blocks: true } });
  const gridOf = (mode: string) => grids.find((g) => g.studyMode === mode)!.blocks.sort((a, b) => a.order - b.order);

  // Zjazdy niestacjonarnych: wszystkie weekendy z arkuszy (piatek-niedziela), kalendarz do ostatniego.
  const calNs = await tx.termCalendar.findFirstOrThrow({ where: { termId: zima.id, facultyId: we.id, studyMode: 'PART_TIME' } });
  const fridays = [...new Set(plan.records.filter((r) => r.date).map((r) => {
    const wd = D(r.date!).getUTCDay();
    return addDays(r.date!, wd === 5 ? 0 : wd === 6 ? -1 : -2);
  }))].sort();
  await tx.zjazd.deleteMany({ where: { calendarId: calNs.id } });
  for (const [i, f] of fridays.entries()) await tx.zjazd.create({ data: { calendarId: calNs.id, number: i + 1, startDate: D(f), endDate: D(addDays(f, 2)) } });
  const lastDay = addDays(fridays[fridays.length - 1]!, 2);
  if (lastDay > iso(calNs.endDate)) await tx.termCalendar.update({ where: { id: calNs.id }, data: { endDate: D(lastDay) } });
  console.log(`zjazdy WE: ${fridays.length} (${fridays[0]} – ${lastDay})`);
  const zjazdOf = (d: string) => fridays.findIndex((f) => f <= d && d <= addDays(f, 2)) + 1;
  const calSt = await tx.termCalendar.findFirstOrThrow({ where: { termId: zima.id, facultyId: we.id, studyMode: 'FULL_TIME' }, include: calendarInclude });
  const teaching = new TeachingCalendar(toCalendarInput(calSt));

  // Prowadzacy: po e-mailu z bazy kontaktow; bez e-maila — po nazwisku na WE albo nowy z adresem zastepczym.
  const depts = await tx.department.findMany({ include: { faculty: true } });
  const faculties = await tx.faculty.findMany();
  const instructorId = new Map<string, string>();
  let created = 0;
  for (const [raw, p] of Object.entries(people)) {
    if (!p) continue;
    const email = p.email ?? `${p.lastName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')}@plan-we.invalid`;
    let ins = await tx.instructor.findUnique({ where: { email } });
    if (!ins && !p.email) ins = await tx.instructor.findFirst({ where: { lastName: p.lastName, facultyId: we.id, email: { not: { endsWith: '@planista.test' } } } });
    if (!ins) {
      const [unitFac, unitName] = (p.unit ?? '').split(' / ');
      const dept = depts.find((d) => d.name === unitName && (d.faculty ? d.faculty.name === unitFac : true));
      const fac = faculties.find((f) => f.name === unitFac);
      ins = await tx.instructor.create({
        data: { firstName: p.firstName, lastName: p.lastName, title: p.title, email, departmentId: dept?.id ?? null, facultyId: dept ? dept.facultyId : (fac?.id ?? we.id) },
      });
      created++;
    }
    instructorId.set(raw, ins.id);
  }
  console.log(`prowadzacy: ${new Set(instructorId.values()).size} osob, nowych ${created}`);

  // Sale
  const rooms = await tx.room.findMany({ include: { building: true } });
  const roomId = async (num: string, form: ClassType) => {
    const letter = num.charAt(0);
    const b = await tx.building.findFirst({ where: { name: `Budynek ${letter}` } });
    const hit = rooms.find((r) => r.number === num && (!b || r.buildingId === b.id)) ?? rooms.find((r) => r.number === num && !/\(/.test(r.building.name));
    if (hit) return hit.id;
    if (!b) return null;
    const r = await tx.room.create({ data: { number: num, buildingId: b.id, type: form === 'LAB' ? 'LAB' : form === 'LECTURE' ? 'LECTURE' : 'EXERCISE', capacity: form === 'LECTURE' ? 80 : 30 }, include: { building: true } });
    rooms.push(r);
    return r.id;
  };

  // Zajecia i grupy rocznikow
  const cohorts = new Map<string, Awaited<ReturnType<typeof cohortOf>>>();
  for (const key of Object.keys(plan.structure)) cohorts.set(key, await cohortOf(tx, key));
  const sections = await tx.classSection.findMany({
    where: { termId: zima.id, cohortId: { in: [...cohorts.values()].map((c) => c.id) } },
    include: { programEntry: { include: { subject: true, specialization: true } } },
  });
  const problems: string[] = [];
  const staff = new Map<string, Map<string, number>>();
  const ns = new Map<string, { data: Prisma.PlacementUncheckedCreateInput; numbers: Set<number> }>();
  let placed = 0;
  let roomsBefore = rooms.length;
  for (const r of plan.records) {
    const c = cohorts.get(r.cohort)!;
    const groups = await tx.studentGroup.findMany({ where: { cohortId: c.id } });
    const byId = new Map(groups.map((g) => [g.id, g]));
    const ancestors = (g: StudentGroup) => {
      const out = [g.id];
      let p = g.parentGroupId ? byId.get(g.parentGroupId) : undefined;
      while (p) { out.push(p.id); p = p.parentGroupId ? byId.get(p.parentGroupId) : undefined; }
      return out;
    };
    // liscie (L i P) slotow w poddrzewie specjalnosci rekordu
    const specRoot = r.spec ? groups.find((g) => g.partitionKey === 'SPEC' && g.code === r.spec) : groups.find((g) => g.partitionKey === 'ROOT');
    if (!specRoot) { problems.push(`${r.src}: brak grupy ${r.spec}`); continue; }
    const inSpec = (g: StudentGroup) => ancestors(g).includes(specRoot.id);
    const active = (g: StudentGroup) => g.fromSemester <= r.sem && (g.toSemester === null || r.sem <= g.toSemester);
    let leaves = groups.filter((g) => (g.partitionKey === 'L' || g.partitionKey === 'P') && inSpec(g) && active(g) && (!r.slots || r.slots.includes(Number(g.code))));
    if (!leaves.length) leaves = [specRoot];
    const covered = new Set(leaves.flatMap((g) => ancestors(g)));
    const secs = sections.filter((s) => s.cohortId === c.id && s.classType === r.form && s.programEntry.subject.name === r.subject && covered.has(s.groupId)
      && (!s.programEntry.specialization || s.programEntry.specialization.shortName === r.spec || !r.spec));
    if (!secs.length) { problems.push(`${r.src} ${r.day ?? r.date} ${r.start} ${r.subject} ${r.form} sloty ${r.slots ?? '*'}: brak zajec`); continue; }
    const ins = r.person ? instructorId.get(r.person) ?? null : null;
    const room = r.room ? await roomId(r.room, r.form) : null;
    const mode = plan.structure[r.cohort]!.mode;
    const b = blocks(gridOf(mode), r.start, r.end);
    if (!b) { problems.push(`${r.src} ${r.start}-${r.end} ${r.subject}: poza siatka`); continue; }
    for (const s of secs) {
      if (ins) {
        const m = staff.get(s.id) ?? new Map<string, number>();
        m.set(ins, (m.get(ins) ?? 0) + (b.endOrder - b.startOrder + 1));
        staff.set(s.id, m);
      }
      if (r.date) {
        const day = dayOf(r.date);
        const key = [s.id, day, b.startOrder, b.endOrder, room, ins].join('|');
        const e = ns.get(key) ?? { data: { sectionId: s.id, termId: zima.id, facultyId: we.id, dayOfWeek: day, ...b, roomId: room, instructorId: ins, cycle: 'ZJAZD', pattern: 'LIST', numbers: [] }, numbers: new Set<number>() };
        e.numbers.add(zjazdOf(r.date));
        ns.set(key, e);
      } else {
        const numbers = r.pattern === 'LIST' ? [...new Set(r.dates.map((d) => teaching.weekIndexOf(d)).filter((x): x is number => x !== null))].sort((a, b2) => a - b2) : [];
        await tx.placement.create({
          data: { sectionId: s.id, termId: zima.id, facultyId: we.id, dayOfWeek: r.day!, ...b, roomId: room, instructorId: ins, cycle: 'WEEK', pattern: r.pattern === 'LIST' && !numbers.length ? 'ALL' : r.pattern, numbers, fromIndex: r.fromIndex, toIndex: r.toIndex },
        });
        placed++;
      }
    }
  }
  for (const e of ns.values()) {
    await tx.placement.create({ data: { ...e.data, numbers: [...e.numbers].sort((a, b) => a - b) } });
    placed++;
  }
  // Obsada: prowadzacy z umieszczen, godziny proporcjonalnie do blokow
  let staffed = 0;
  for (const [sid, m] of staff) {
    const sec = sections.find((s) => s.id === sid)!;
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    let left = sec.hours;
    const list = [...m.entries()];
    for (const [i, [ins, n]] of list.entries()) {
      const h = i === list.length - 1 ? left : Math.round((sec.hours * n) / total);
      left -= h;
      await tx.sectionInstructor.create({ data: { sectionId: sid, instructorId: ins, hours: Math.max(0, h) } });
      staffed++;
    }
  }
  console.log(`umieszczen: ${placed}, wierszy obsady: ${staffed}, nowych sal: ${rooms.length - roomsBefore}, problemow: ${problems.length}`);
  for (const p of problems) console.log('  ', p);
}

async function main() {
  let ids: string[] = [];
  await prisma.$transaction(
    async (tx) => {
      if (phase === 'setup') ids = await setup(tx);
      else if (phase === 'reset') {
        // plan i obsada WE z zimy precz (grupy i zajecia zostaja) — przed ponownym --plan
        const we = await tx.faculty.findUniqueOrThrow({ where: { shortName: 'WE' } });
        const zima = await tx.academicTerm.findFirstOrThrow({ where: { startYear: 2026, type: 'WINTER' } });
        const secWhere = { termId: zima.id, cohort: { program: { fieldOfStudy: { facultyId: we.id } } } };
        const o = await tx.occurrence.deleteMany({ where: { section: secWhere } });
        const pl = await tx.placement.deleteMany({ where: { termId: zima.id, facultyId: we.id } });
        const si = await tx.sectionInstructor.deleteMany({ where: { section: secWhere } });
        console.log(`usuniete: terminy ${o.count}, umieszczenia ${pl.count}, obsada ${si.count}`);
      } else await planPhase(tx);
      if (!apply) throw new Error('PODGLAD — nic nie zapisano (uruchom z --apply)');
    },
    { timeout: 900_000, maxWait: 60_000 },
  );
  if (phase === 'setup') {
    console.log('Synchronizacja zajec:', JSON.stringify(await autoSyncCohorts(ids)));
    return;
  }
  if (phase === 'reset') return;
  // terminy: kalendarze WE przez "w przygotowaniu" -> publikacja (przeliczenie terminow)
  const we = await prisma.faculty.findUniqueOrThrow({ where: { shortName: 'WE' } });
  const zima = await prisma.academicTerm.findFirstOrThrow({ where: { startYear: 2026, type: 'WINTER' } });
  for (const cal of await prisma.termCalendar.findMany({ where: { termId: zima.id, facultyId: we.id } })) {
    await prisma.termCalendar.update({ where: { id: cal.id }, data: { status: 'PLANNING' } });
    const { refresh } = await changeCalendarStatus(zima, { ...cal, status: 'PLANNING' }, 'PUBLISHED', () => prisma.termCalendar.update({ where: { id: cal.id }, data: { status: 'PUBLISHED' } }));
    console.log(`kalendarz ${cal.studyMode}: opublikowany`, JSON.stringify(refresh.report ? { ...refresh.report, conflicts: (refresh.report as { conflicts?: unknown[] }).conflicts?.length } : null).slice(0, 300));
  }
}

main()
  .catch((e: Error) => {
    console.log(e.message);
    if (!e.message.startsWith('PODGLAD')) process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
