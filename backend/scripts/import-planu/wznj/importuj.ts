/**
 * WZNJ (zima 2026/27): programy z siatek godzin (https://wznj.umg.edu.pl/programy-ksztalcenia) i plany zajec
 * (https://wznj.umg.edu.pl/plany) -> wersje programow, roczniki, grupy wg arkuszy, umieszczenia, obsada, prowadzacy
 * (baza kontaktow UMG), sale, zjazdy niestacjonarnych i siatka godzin niestacjonarnych WZNJ.
 * Dane: dane/wznj/plan.json (wznj/normalize.py), dane/wznj/osoby.json (wznj/osoby.py).
 *
 *   npx tsx scripts/import-planu/wznj/importuj.ts --setup [--apply]  # programy, roczniki, grupy, siatka, zjazdy + synchronizacja
 *   npx tsx scripts/import-planu/wznj/importuj.ts --plan [--apply]   # prowadzacy, sale, umieszczenia, obsada, terminy
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClassType, DayOfWeek, Prisma, StudentGroup } from '@prisma/client';
import { prisma } from '../../../src/lib/prisma';
import { autoSyncCohorts, changeCalendarStatus } from '../../../src/services/autoPlan';
import { TeachingCalendar } from '../../../src/lib/teachingCalendar';
import { toCalendarInput, calendarInclude } from '../../../src/services/termCalendars';

type Form = 'W' | 'C' | 'L' | 'P' | 'S';
interface Entry { subject: string; spec: string | null; semester: number; W: number; C: number; L: number; P: number; S: number; ects: number; exam: boolean }
interface ProgramDef { code: string; specs: string[]; specNames: Record<string, string>; totalSemesters: number; entries: Entry[] }
interface Item {
  cycle: 'WEEK' | 'ZJAZD'; date?: string; day?: DayOfWeek; start: string | number; end: string | number;
  entry: { subject: string; spec: string | null }; scopeSpec: string | null; form: Form; codes: number[]; teachers: string[];
  room: string | null; rooms?: string[]; firstDate?: string | null; cols?: [number, number];
  rhythm?: { half?: number; alt?: boolean; altOrder?: number; fromDate?: string; dates?: string[]; weeks?: number }; source: string;
}
interface CohortDef { program: string; version: string; year: number; type: 'WINTER' | 'SUMMER'; semester: number; specs: string[]; groups: Record<string, Partial<Record<Form, number[]>>>; lectureHalves: number[]; items: Item[] }
interface Plan { programs: Record<string, ProgramDef>; cohorts: CohortDef[] }
type Person = { lastName: string; firstName: string; title: string; email: string | null; unit: string | null };

const apply = process.argv.includes('--apply');
const phase = process.argv.includes('--setup') ? 'setup' : 'plan';
const plan: Plan = JSON.parse(readFileSync(join(__dirname, '../dane/wznj/plan.json'), 'utf8'));
const people: Record<string, Person> = JSON.parse(readFileSync(join(__dirname, '../dane/wznj/osoby.json'), 'utf8'));

const PROGRAMS = ['ZAR-S1', 'ZAR-N1', 'ZAR-S2', 'ZAR-N2', 'NOJ-S1', 'NOJ-N1', 'IJ-S2', 'IJ-N2'];
const LABEL = 'od naboru 2024/25';
const LABEL_L = 'od naboru 2025/26 L';
const SEED_LABEL = 'od naboru 2025/26';
// Harmonogram zjazdow WZNJ 2026/27 (semestr zimowy) — https://wznj.umg.edu.pl/harmonogram-zjazdow
const ZJAZDY = ['2026-10-02', '2026-10-09', '2026-10-23', '2026-11-06', '2026-11-20', '2026-12-04', '2026-12-11', '2027-01-08', '2027-01-15', '2027-01-29'];
// Godziny zajec niestacjonarnych WZNJ (arkusz "Godziny_zajęć" planow + blok wieczorny 18:40-21:05)
const NS_BLOCKS = [['08:00', '08:45'], ['08:50', '09:35'], ['09:40', '10:25'], ['10:35', '11:20'], ['11:25', '12:10'], ['12:15', '13:00'],
  ['13:30', '14:15'], ['14:20', '15:05'], ['15:10', '15:55'], ['16:05', '16:50'], ['16:55', '17:40'], ['17:45', '18:30'],
  ['18:40', '19:25'], ['19:30', '20:15'], ['20:20', '21:05']];
const CLASS: Record<Form, ClassType> = { W: 'LECTURE', C: 'EXERCISE', L: 'LAB', P: 'PROJECT', S: 'SEMINAR' };
const WEEKDAYS: DayOfWeek[] = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const D = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(D(s).getTime() + n * 86400000));
const dayOf = (s: string) => WEEKDAYS[D(s).getUTCDay()]!;
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();

async function cohortRow(tx: Prisma.TransactionClient, code: string, year: number, type: 'WINTER' | 'SUMMER') {
  const program = await tx.program.findUniqueOrThrow({ where: { code } });
  return tx.cohort.findFirst({ where: { programId: program.id, startTerm: { startYear: year, type } }, include: { groups: true } });
}

// ─── Setup: programy, roczniki, grupy, siatka, zjazdy ───────

async function setup(tx: Prisma.TransactionClient) {
  const wznj = await tx.faculty.findUniqueOrThrow({ where: { shortName: 'WZNJ' } });
  const terms = await tx.academicTerm.findMany();
  const termOf = (y: number, t: 'WINTER' | 'SUMMER') => terms.find((x) => x.startYear === y && x.type === t)!;
  const ij = await tx.fieldOfStudy.findFirstOrThrow({ where: { facultyId: wznj.id, shortName: 'IJ' } });

  // Nauki o Jakosci I st. to na stronie wydzialu kierunek Inzynieria Jakosci
  for (const [code, name] of [['NOJ-S1', 'Inżynieria Jakości (stacjonarne, I stopnia)'], ['NOJ-N1', 'Inżynieria Jakości (niestacjonarne, I stopnia)']]) {
    await tx.program.update({ where: { code }, data: { fieldOfStudyId: ij.id, name } });
  }
  console.log('~ NOJ-S1/N1 -> kierunek Inżynieria Jakości');

  // Wersje z seeda: inna etykieta (zwalnia "od naboru 2025/26")
  const ren = await tx.programVersion.updateMany({ where: { label: SEED_LABEL, program: { code: { in: PROGRAMS } } }, data: { label: 'testowa (seed)' } });
  console.log(`~ wersje z seeda przemianowane: ${ren.count}`);

  // Wszystkie zajecia, plan, terminy i obsada rocznikow WZNJ precz (plan testowy z seeda)
  const wznjCohorts = await tx.cohort.findMany({ where: { program: { code: { in: PROGRAMS } } }, select: { id: true } });
  const sectionIds = (await tx.classSection.findMany({ where: { cohortId: { in: wznjCohorts.map((c) => c.id) } }, select: { id: true } })).map((s) => s.id);
  const occ = await tx.occurrence.deleteMany({ where: { sectionId: { in: sectionIds } } });
  const pl = await tx.placement.deleteMany({ where: { sectionId: { in: sectionIds } } });
  const si = await tx.sectionInstructor.deleteMany({ where: { sectionId: { in: sectionIds } } });
  const sec = await tx.classSection.deleteMany({ where: { id: { in: sectionIds } } });
  console.log(`- plan testowy WZNJ: zajecia ${sec.count}, umieszczenia ${pl.count}, terminy ${occ.count}, obsada ${si.count}`);

  // Siatka godzin niestacjonarnych WZNJ wg planow (bloki 45 min)
  const nsGrid = await tx.timeGrid.findFirstOrThrow({ where: { facultyId: wznj.id, studyMode: 'PART_TIME', base: true } });
  await tx.timeBlock.deleteMany({ where: { gridId: nsGrid.id } });
  for (const [i, [a, b]] of NS_BLOCKS.entries()) await tx.timeBlock.create({ data: { gridId: nsGrid.id, order: i + 1, startTime: a!, endTime: b!, label: `${a}-${b}` } });
  console.log(`~ siatka niestacjonarna WZNJ: ${NS_BLOCKS.length} blokow 45 min`);

  // Zjazdy zimowe wg harmonogramu
  const zima = termOf(2026, 'WINTER');
  const calNs = await tx.termCalendar.findFirstOrThrow({ where: { termId: zima.id, facultyId: wznj.id, studyMode: 'PART_TIME' } });
  await tx.zjazd.deleteMany({ where: { calendarId: calNs.id } });
  for (const [i, f] of ZJAZDY.entries()) await tx.zjazd.create({ data: { calendarId: calNs.id, number: i + 1, startDate: D(f), endDate: D(addDays(f, 2)) } });
  console.log(`~ zjazdy WZNJ: ${ZJAZDY.length} (${ZJAZDY[0]} – ${addDays(ZJAZDY[ZJAZDY.length - 1]!, 2)})`);

  // Specjalnosci i wersje programow
  const subjects = new Map((await tx.subject.findMany()).map((s) => [s.name, s.id]));
  const subjectId = async (name: string) => {
    let id = subjects.get(name);
    if (!id) {
      id = (await tx.subject.create({ data: { name } })).id;
      subjects.set(name, id);
    }
    return id;
  };
  const versionId = new Map<string, string>();
  for (const key of Object.keys(plan.programs)) {
    const def = plan.programs[key]!;
    const code = key.replace('@L', '');
    const summer = key.endsWith('@L');
    // wersja naboru letniego tylko tam, gdzie sa roczniki letnie
    if (summer && !plan.cohorts.some((c) => c.version === key)) continue;
    const program = await tx.program.findUniqueOrThrow({ where: { code }, include: { fieldOfStudy: { include: { specializations: true } } } });
    const specId = new Map<string, string>();
    for (const short of new Set(def.entries.flatMap((e) => (e.spec ? [e.spec] : [])).concat(def.specs))) {
      let sp = program.fieldOfStudy.specializations.find((s) => s.shortName === short);
      if (!sp) {
        sp = await tx.specialization.create({ data: { fieldOfStudyId: program.fieldOfStudyId, shortName: short, name: def.specNames[short] ?? short } });
        program.fieldOfStudy.specializations.push(sp);
        console.log(`+ specjalnosc ${program.fieldOfStudy.shortName} ${short} — ${sp.name}`);
      }
      specId.set(short, sp.id);
    }
    const label = summer ? LABEL_L : LABEL;
    if (await tx.programVersion.findFirst({ where: { programId: program.id, label } })) throw new Error(`${code}: wersja "${label}" juz istnieje`);
    const version = await tx.programVersion.create({ data: { programId: program.id, label, status: 'APPROVED', totalSemesters: def.totalSemesters, defaultStartType: summer ? 'SUMMER' : 'WINTER' } });
    const order = new Map<number, number>();
    const seen = new Set<string>();
    let n = 0;
    for (const e of def.entries) {
      const k = `${e.subject}|${e.semester}|${e.spec ?? ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      order.set(e.semester, (order.get(e.semester) ?? 0) + 1);
      await tx.programEntry.create({
        data: {
          versionId: version.id, subjectId: await subjectId(e.subject), semester: e.semester, specializationId: e.spec ? specId.get(e.spec)! : null,
          orderInSemester: order.get(e.semester)!, hoursLecture: e.W, hoursExercise: e.C, hoursLab: e.L, hoursProject: e.P, hoursSeminar: e.S,
          ects: e.ects, assessmentType: e.exam ? 'EXAM' : 'CREDIT',
        },
      });
      n++;
    }
    versionId.set(key, version.id);
    console.log(`+ ${code} "${label}": ${n} pozycji, ${def.totalSemesters} sem.`);
  }

  // Roczniki: II st. stacjonarne IJ startuja w lecie; nowe roczniki letnie niestacjonarnych II st.
  for (const y of [2025, 2026]) {
    const c = await cohortRow(tx, 'IJ-S2', y, 'WINTER');
    if (c) {
      await tx.cohort.update({ where: { id: c.id }, data: { startTermId: termOf(y, 'SUMMER').id } });
      console.log(`~ IJ-S2 ${y}: nabor zimowy -> letni`);
    }
  }
  const ids: string[] = [];
  for (const cd of plan.cohorts) {
    let c = await cohortRow(tx, cd.program, cd.year, cd.type);
    const vid = versionId.get(cd.version) ?? versionId.get(cd.program)!;
    if (!c) {
      const program = await tx.program.findUniqueOrThrow({ where: { code: cd.program } });
      const created = await tx.cohort.create({ data: { programId: program.id, programVersionId: vid, startTermId: termOf(cd.year, cd.type).id, lectureMode: 'JOINT' } });
      await tx.studentGroup.create({ data: { cohortId: created.id, partitionKey: 'ROOT', size: 25 } });
      c = await cohortRow(tx, cd.program, cd.year, cd.type);
      console.log(`+ rocznik ${cd.program} ${cd.year} ${cd.type === 'SUMMER' ? 'letni' : 'zimowy'}`);
    }
    const cohort = c!;
    await tx.cohort.update({ where: { id: cohort.id }, data: { programVersionId: vid, lectureMode: cd.lectureHalves.length ? 'SEPARATE' : 'JOINT' } });
    const root = cohort.groups.find((g) => g.partitionKey === 'ROOT')!;
    let rest = cohort.groups.filter((g) => g.id !== root.id);
    while (rest.length) {
      const leaves = rest.filter((g) => !rest.some((o) => o.parentGroupId === g.id));
      await tx.studentGroup.deleteMany({ where: { id: { in: leaves.map((g) => g.id) } } });
      rest = rest.filter((g) => !leaves.includes(g));
    }
    const program = await tx.program.findUniqueOrThrow({ where: { code: cd.program }, include: { fieldOfStudy: { include: { specializations: true } } } });
    const mk = (data: Omit<Prisma.StudentGroupUncheckedCreateInput, 'cohortId'>) => tx.studentGroup.create({ data: { cohortId: cohort.id, ...data } });
    const desc: string[] = [];
    const buildScope = async (parent: StudentGroup, def: Partial<Record<Form, number[]>>, specId: string | null, toSemester: number | null) => {
      const cs = def.C ?? [];
      const ls = def.L ?? [];
      const ps = def.P ?? [];
      const cGroups: StudentGroup[] = [];
      for (const k of cs) cGroups.push(await mk({ partitionKey: 'C', code: String(k), size: Math.max(5, Math.round(parent.size / cs.length)), parentGroupId: parent.id, specializationId: specId, toSemester }));
      const per = cs.length && ls.length % cs.length === 0 ? ls.length / cs.length : 0;
      for (const [i, k] of ls.entries()) {
        const p = per ? cGroups[Math.floor(i / per)]! : parent;
        await mk({ partitionKey: 'L', code: String(k), size: Math.max(5, Math.round(p.size / (per || ls.length))), parentGroupId: p.id, specializationId: specId, toSemester });
      }
      for (const k of ps) await mk({ partitionKey: 'P', code: String(k), size: Math.max(5, Math.round(parent.size / ps.length)), parentGroupId: parent.id, specializationId: specId, toSemester });
      return `${cs.length ? `C ${cs.join(',')}` : ''}${ls.length ? ` L ${ls.join(',')}` : ''}${ps.length ? ` P ${ps.join(',')}` : ''}`.trim();
    };
    // Wyklady w dwoch grupach (I rok Zarzadzania stac.): grupy wykladowe bez specjalnosci do sem. 2
    if (cd.lectureHalves.length) {
      const all = cd.groups[''] ?? {};
      const halves: StudentGroup[] = [];
      for (const h of cd.lectureHalves) halves.push(await mk({ partitionKey: 'SPEC', code: `W${h}`, size: Math.round(root.size / cd.lectureHalves.length), parentGroupId: root.id, toSemester: 2 }));
      const part = (arr: number[] = [], i: number) => arr.slice(Math.round((arr.length * i) / halves.length), Math.round((arr.length * (i + 1)) / halves.length));
      for (const [i, h] of halves.entries()) desc.push(`wyklad ${cd.lectureHalves[i]}: ${await buildScope(h, { C: part(all.C, i), L: part(all.L, i), P: part(all.P, i) }, null, 2)}`);
    } else if (cd.groups['']) {
      desc.push(`wspolne: ${await buildScope(root, cd.groups['']!, null, null)}`);
    }
    for (const short of cd.specs) {
      const sp = program.fieldOfStudy.specializations.find((s) => s.shortName === short);
      if (!sp) throw new Error(`${cd.program} ${cd.year}: brak specjalnosci ${short}`);
      const sg = await mk({ partitionKey: 'SPEC', code: short, size: Math.max(10, Math.round(root.size / cd.specs.length)), parentGroupId: root.id, specializationId: sp.id });
      desc.push(`${short}: ${(await buildScope(sg, cd.groups[short] ?? {}, sp.id, null)) || '—'}`);
    }
    ids.push(cohort.id);
    console.log(`  ${cd.program} ${cd.year}${cd.type === 'SUMMER' ? 'L' : ''} (sem. ${cd.semester}, ${root.size} os.): ${desc.join('; ') || 'bez podzialu'}`);
  }
  return ids;
}

/**
 * Grupy laboratoryjne bez cwiczeniowego rodzica (liczba L nie dzieli sie przez liczbe C): rodzic wg planu —
 * cwiczeniowa z tego samego zakresu, ktora nigdy nie ma zajec rownoczesnie z laboratorium (inaczej to inni studenci).
 */
async function nestLabs(tx: Prisma.TransactionClient, cohortId: string, cd: CohortDef) {
  const groups = await tx.studentGroup.findMany({ where: { cohortId } });
  const slot = (it: Item) => {
    const d = it.cycle === 'WEEK' ? it.day! : it.date!;
    const toMin = (v: string | number) => (typeof v === 'number' ? v * 60 : Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5)));
    return { d, a: toMin(it.start), b: toMin(it.end), alt: it.rhythm?.alt ? (it.firstDate ?? '') : '' };
  };
  const times = new Map<string, ReturnType<typeof slot>[]>();
  for (const it of cd.items) for (const k of it.codes) {
    if (it.form !== 'C' && it.form !== 'L') continue;
    const key = `${it.scopeSpec ?? ''}|${it.form}|${k}`;
    times.set(key, [...(times.get(key) ?? []), slot(it)]);
  }
  const clash = (x: ReturnType<typeof slot>[] = [], y: ReturnType<typeof slot>[] = []) =>
    x.some((p) => y.some((q) => p.d === q.d && p.a < q.b && q.a < p.b && (!p.alt || !q.alt || p.alt === q.alt)));
  let n = 0;
  for (const parent of groups) {
    const cs = groups.filter((g) => g.parentGroupId === parent.id && g.partitionKey === 'C');
    const ls = groups.filter((g) => g.parentGroupId === parent.id && g.partitionKey === 'L');
    if (!cs.length || !ls.length) continue;
    const scope = parent.partitionKey === 'SPEC' && cd.specs.includes(parent.code ?? '') ? parent.code! : '';
    const cap = Math.ceil(ls.length / cs.length);
    const load = new Map(cs.map((g) => [g.id, 0]));
    for (const l of ls) {
      const lt = times.get(`${scope}|L|${l.code}`);
      const ok = cs.filter((g) => !clash(lt, times.get(`${scope}|C|${g.code}`)) && load.get(g.id)! < cap);
      if (!lt?.length || !ok.length) continue;
      // najblizszy numerem (L1,L2 -> C1 ...), potem najmniej obciazony
      const ratio = (Number(l.code) - 1) / ls.length * cs.length;
      ok.sort((a, b) => Math.abs(Number(a.code) - 1 - ratio) - Math.abs(Number(b.code) - 1 - ratio) || load.get(a.id)! - load.get(b.id)!);
      const target = ok[0]!;
      load.set(target.id, load.get(target.id)! + 1);
      await tx.studentGroup.update({ where: { id: l.id }, data: { parentGroupId: target.id, size: Math.max(5, Math.round(target.size / cap)) } });
      n++;
    }
  }
  return n;
}

// ─── Plan: prowadzacy, sale, umieszczenia, obsada ───────────

async function planPhase(tx: Prisma.TransactionClient) {
  const wznj = await tx.faculty.findUniqueOrThrow({ where: { shortName: 'WZNJ' } });
  const zima = await tx.academicTerm.findFirstOrThrow({ where: { startYear: 2026, type: 'WINTER' } });
  const grids = await tx.timeGrid.findMany({ where: { facultyId: wznj.id, base: true }, include: { blocks: true } });
  const gridOf = (mode: string) => grids.find((g) => g.studyMode === mode)!.blocks.sort((a, b) => a.order - b.order);
  const calSt = await tx.termCalendar.findFirstOrThrow({ where: { termId: zima.id, facultyId: wznj.id, studyMode: 'FULL_TIME' }, include: calendarInclude });
  const teaching = new TeachingCalendar(toCalendarInput(calSt));
  const zjazdOf = (d: string) => ZJAZDY.findIndex((f) => f <= d && d <= addDays(f, 2)) + 1;

  // Prowadzacy: najpierw po e-mailu (moga juz byc z importu innego wydzialu), bez e-maila — po nazwisku
  const depts = await tx.department.findMany({ include: { faculty: true } });
  const faculties = await tx.faculty.findMany();
  const instructorId = new Map<string, string>();
  let created = 0;
  let newDepts = 0;
  for (const [raw, p] of Object.entries(people)) {
    const email = p.email ?? `${fold(p.lastName).replace(/[^a-z-]/g, '')}@plan-wznj.invalid`;
    let ins = await tx.instructor.findUnique({ where: { email } });
    if (!ins && !p.email) ins = await tx.instructor.findFirst({ where: { lastName: p.lastName, email: { not: { endsWith: '@planista.test' } } } });
    if (!ins) {
      const [unitFac, unitName] = (p.unit ?? '').split(' / ');
      let dept = depts.find((d) => d.name === unitName && (d.faculty ? d.faculty.name === unitFac : true));
      if (!dept && unitFac === wznj.name && unitName?.startsWith('Katedra')) {
        const short = 'K' + unitName.replace(/^Katedra\s+/, '').split(/\s+/).map((w) => (w === 'i' ? 'i' : w.charAt(0).toUpperCase())).join('');
        const existing = await tx.department.findFirst({ where: { facultyId: wznj.id, shortName: short }, include: { faculty: true } });
        dept = existing ?? (await tx.department.create({ data: { facultyId: wznj.id, shortName: short, name: unitName }, include: { faculty: true } }));
        if (!existing) {
          depts.push(dept);
          newDepts++;
          console.log(`+ katedra ${short}-WZNJ — ${unitName}`);
        }
      }
      const fac = faculties.find((f) => f.name === unitFac);
      ins = await tx.instructor.create({
        data: { firstName: p.firstName, lastName: p.lastName, title: p.title || null, email, departmentId: dept?.id ?? null, facultyId: dept ? dept.facultyId : (fac?.id ?? wznj.id) },
      });
      created++;
    }
    instructorId.set(raw, ins.id);
  }
  const personOf = (t: string) => instructorId.get(t.replace(/^(prof|dr|mgr|inż|hab)\.?\s*/i, '').trim()) ?? null;
  console.log(`prowadzacy: ${new Set(instructorId.values()).size} osob, nowych ${created}, nowych katedr ${newDepts}`);

  // Sale: numer w budynku z litery ("B21" -> Budynek B), brakujace dopisane
  const rooms = await tx.room.findMany({ include: { building: true } });
  const roomsBefore = rooms.length;
  const roomId = async (num: string | null | undefined, form: Form) => {
    if (!num || num === 'ONLINE') return null;
    const letter = num.charAt(0);
    const b = await tx.building.findFirst({ where: { name: `Budynek ${letter}` } });
    const hit = rooms.find((r) => r.number === num && (!b || r.buildingId === b.id)) ?? rooms.find((r) => r.number === num && !/\(/.test(r.building.name));
    if (hit) return hit.id;
    if (!b) return null;
    const r = await tx.room.create({ data: { number: num, buildingId: b.id, type: form === 'L' ? 'LAB' : form === 'W' ? 'LECTURE' : 'EXERCISE', capacity: form === 'W' ? 80 : 30 }, include: { building: true } });
    rooms.push(r);
    return r.id;
  };

  // Ponowne uruchomienie: plan, terminy i obsada zimy WZNJ od nowa (prowadzacy i sale zostaja)
  const wznjSections = (await tx.classSection.findMany({ where: { termId: zima.id, cohort: { program: { code: { in: PROGRAMS } } } }, select: { id: true } })).map((s) => s.id);
  const wiped = await tx.placement.deleteMany({ where: { sectionId: { in: wznjSections } } });
  await tx.occurrence.deleteMany({ where: { sectionId: { in: wznjSections } } });
  await tx.sectionInstructor.deleteMany({ where: { sectionId: { in: wznjSections } } });
  if (wiped.count) console.log(`- poprzedni import planu WZNJ: ${wiped.count} umieszczen`);

  const problems: string[] = [];
  const staff = new Map<string, Map<string, number>>();
  const ns = new Map<string, { data: Prisma.PlacementUncheckedCreateInput; numbers: Set<number>; jk: string }>();
  const weekly: { data: Prisma.PlacementUncheckedCreateInput; jk: string }[] = [];
  const seenWeekly = new Set<string>();
  let reparented = 0;
  for (const cd of plan.cohorts) {
    if (!cd.items.length) continue;
    const c = (await cohortRow(tx, cd.program, cd.year, cd.type))!;
    reparented += await nestLabs(tx, c.id, cd);
    const groups = await tx.studentGroup.findMany({ where: { cohortId: c.id } });
    const byId = new Map(groups.map((g) => [g.id, g]));
    const ancestors = (g: StudentGroup) => {
      const out = [g.id];
      let p = g.parentGroupId ? byId.get(g.parentGroupId) : undefined;
      while (p) { out.push(p.id); p = p.parentGroupId ? byId.get(p.parentGroupId) : undefined; }
      return out;
    };
    const root = groups.find((g) => g.partitionKey === 'ROOT')!;
    const sections = await tx.classSection.findMany({
      where: { termId: zima.id, cohortId: c.id },
      include: { programEntry: { include: { subject: true, specialization: true } } },
    });
    const mode = cd.program.includes('-S') ? 'FULL_TIME' : 'PART_TIME';
    const grid = gridOf(mode);
    const colMid = (Math.min(...cd.items.map((i) => i.cols?.[0] ?? 99)) + Math.max(...cd.items.map((i) => i.cols?.[1] ?? 0))) / 2;
    for (const it of cd.items) {
      const scope = it.scopeSpec ? groups.find((g) => g.partitionKey === 'SPEC' && g.code === it.scopeSpec) ?? root : root;
      const inScope = (gid: string) => {
        const g = byId.get(gid)!;
        return ancestors(g).includes(scope.id) || ancestors(scope).includes(gid);
      };
      const ofEntry = sections.filter((s) => s.programEntry.subject.name === it.entry.subject && (s.programEntry.specialization?.shortName ?? null) === it.entry.spec);
      let secs = ofEntry.filter((s) => s.classType === CLASS[it.form] && inScope(s.groupId));
      if (!secs.length) {
        for (const f of ['C', 'L', 'P', 'S', 'W'] as Form[]) {
          secs = ofEntry.filter((s) => s.classType === CLASS[f] && inScope(s.groupId));
          if (secs.length) break;
        }
      }
      if (!secs.length) secs = ofEntry.filter((s) => s.classType === CLASS[it.form]);
      if (!secs.length) { problems.push(`${cd.program} ${cd.year} ${it.source}: brak zajec "${it.entry.subject}"${it.entry.spec ? ` [${it.entry.spec}]` : ''} ${it.form} (pozycji: ${ofEntry.length})`); continue; }
      // grupy wg numerow z planu (cwiczeniowe, laboratoryjne, wykladowe I roku)
      if (it.form === 'W' && cd.lectureHalves.length && it.cols) {
        // I rok Zarzadzania stac.: wyklad polowy rocznika wg kolumn arkusza
        const h = cd.lectureHalves[(it.cols[0] + it.cols[1]) / 2 < colMid ? 0 : 1];
        const half = secs.filter((s) => byId.get(s.groupId)!.code === `W${h}`);
        if (half.length) secs = half;
      } else if (it.codes.length) {
        const byCode = secs.filter((s) => {
          const g = byId.get(s.groupId)!;
          if (it.form === 'W') return g.code === `W${it.codes[0]}` || it.codes.some((k) => g.code === `W${k}`);
          return it.codes.includes(Number(g.code));
        });
        if (byCode.length) secs = byCode;
      }
      const joint = secs.length > 1 ? `wznj-${randomUUID()}` : null;
      const persons = it.teachers.map(personOf);
      const roomList = it.rooms?.length ? it.rooms : it.room ? [it.room] : [];
      for (const [si_, s] of secs.entries()) {
        const ins = (persons.length === secs.length ? persons[si_] : persons[0]) ?? null;
        const room = await roomId(roomList.length === secs.length ? roomList[si_] : roomList[0], it.form);
        let b: { startOrder: number; endOrder: number } | null;
        if (it.cycle === 'WEEK') {
          const s0 = grid.find((x) => x.startTime === `${String(it.start).padStart(2, '0')}:00`);
          const e0 = [...grid].reverse().find((x) => x.endTime <= `${String(it.end).padStart(2, '0')}:00`);
          b = s0 && e0 && e0.order >= s0.order ? { startOrder: s0.order, endOrder: e0.order } : null;
        } else {
          const s0 = grid.find((x) => x.startTime === it.start) ?? grid.find((x) => x.startTime > String(it.start));
          const e0 = [...grid].reverse().find((x) => x.endTime <= String(it.end));
          b = s0 && e0 && e0.order >= s0.order ? { startOrder: s0.order, endOrder: e0.order } : null;
        }
        if (!b) { problems.push(`${cd.program} ${cd.year} ${it.source} ${it.start}-${it.end}: poza siatka`); continue; }
        if (ins) {
          const m = staff.get(s.id) ?? new Map<string, number>();
          m.set(ins, (m.get(ins) ?? 0) + (b.endOrder - b.startOrder + 1));
          staff.set(s.id, m);
        }
        if (it.cycle === 'ZJAZD') {
          const z = zjazdOf(it.date!);
          if (!z) { problems.push(`${cd.program} ${cd.year} ${it.source} ${it.date}: poza zjazdami`); continue; }
          const day = dayOf(it.date!);
          const key = [s.id, day, b.startOrder, b.endOrder, room, ins].join('|');
          const e = ns.get(key) ?? { data: { sectionId: s.id, termId: zima.id, facultyId: wznj.id, dayOfWeek: day, ...b, roomId: room, instructorId: ins, cycle: 'ZJAZD', pattern: 'LIST', numbers: [], jointKey: joint }, numbers: new Set<number>(), jk: [day, b.startOrder, b.endOrder, room, ins, it.entry.subject].join('|') };
          e.numbers.add(z);
          ns.set(key, e);
        } else {
          const r = it.rhythm ?? {};
          let pattern: 'ALL' | 'ODD' | 'EVEN' | 'LIST' = 'ALL';
          let numbers: number[] = [];
          let fromIndex: number | null = null;
          let toIndex: number | null = null;
          if (r.dates?.length) {
            numbers = [...new Set(r.dates.map((d) => teaching.weekIndexOf(d)).filter((x): x is number => x !== null))].sort((a, b2) => a - b2);
            if (numbers.length) pattern = 'LIST';
          } else if (r.alt) {
            const w = it.firstDate ? teaching.weekIndexOf(it.firstDate) : null;
            pattern = w ? (w % 2 ? 'ODD' : 'EVEN') : (r.altOrder ?? 0) % 2 ? 'EVEN' : 'ODD';
          }
          if (r.half === 1) toIndex = 8;
          if (r.half === 2) fromIndex = 9;
          if (r.fromDate) fromIndex = teaching.weekIndexOf(r.fromDate) ?? fromIndex;
          if (r.weeks) toIndex = r.weeks;
          const shape = [it.day, b.startOrder, b.endOrder, room, ins, pattern, numbers.join(','), fromIndex, toIndex];
          // ten sam termin z kilku kolumn arkusza (np. wyklad specjalnosci) — raz
          if (seenWeekly.has([s.id, ...shape].join('|'))) continue;
          seenWeekly.add([s.id, ...shape].join('|'));
          weekly.push({
            data: { sectionId: s.id, termId: zima.id, facultyId: wznj.id, dayOfWeek: it.day!, ...b, roomId: room, instructorId: ins, cycle: 'WEEK', pattern, numbers, fromIndex, toIndex, jointKey: joint },
            jk: [...shape, it.entry.subject].join('|'),
          });
        }
      }
    }
  }
  // Zajecia laczone: ten sam przedmiot, czas, sala i prowadzacy dla kilku grup (osobne komorki arkusza)
  const all = [...weekly, ...[...ns.values()].map((e) => {
    const numbers = [...e.numbers].sort((a, b) => a - b);
    return { data: { ...e.data, numbers }, jk: `${e.jk}|${numbers.join(',')}` };
  })];
  const byJk = new Map<string, typeof all>();
  for (const p of all) if (p.data.roomId) byJk.set(p.jk, [...(byJk.get(p.jk) ?? []), p]);
  let joined = 0;
  for (const list of byJk.values()) {
    if (new Set(list.map((p) => p.data.sectionId)).size < 2) continue;
    const key = `wznj-${randomUUID()}`;
    for (const p of list) p.data.jointKey = key;
    joined++;
  }
  for (const p of all) await tx.placement.create({ data: p.data });
  const placed = all.length;
  console.log(`laboratoria przepiete pod cwiczenia: ${reparented}, zajec laczonych: ${joined}`);
  // Obsada: prowadzacy z umieszczen, godziny zajec proporcjonalnie do blokow
  let staffed = 0;
  const secHours = new Map((await tx.classSection.findMany({ where: { id: { in: [...staff.keys()] } }, select: { id: true, hours: true } })).map((s) => [s.id, s.hours]));
  for (const [sid, m] of staff) {
    const hours = secHours.get(sid)!;
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    let left = hours;
    const list = [...m.entries()];
    for (const [i, [ins, n]] of list.entries()) {
      const h = i === list.length - 1 ? left : Math.round((hours * n) / total);
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
      else await planPhase(tx);
      if (!apply) throw new Error('PODGLAD — nic nie zapisano (uruchom z --apply)');
    },
    { timeout: 900_000, maxWait: 60_000 },
  );
  if (phase === 'setup') {
    console.log('Synchronizacja zajec:', JSON.stringify(await autoSyncCohorts(ids)));
    return;
  }
  // terminy: kalendarze WZNJ przez "w przygotowaniu" -> publikacja (przeliczenie terminow)
  const wznj = await prisma.faculty.findUniqueOrThrow({ where: { shortName: 'WZNJ' } });
  const zima = await prisma.academicTerm.findFirstOrThrow({ where: { startYear: 2026, type: 'WINTER' } });
  for (const cal of await prisma.termCalendar.findMany({ where: { termId: zima.id, facultyId: wznj.id } })) {
    await prisma.termCalendar.update({ where: { id: cal.id }, data: { status: 'PLANNING' } });
    const { refresh } = await changeCalendarStatus(zima, { ...cal, status: 'PLANNING' }, 'PUBLISHED', () => prisma.termCalendar.update({ where: { id: cal.id }, data: { status: 'PUBLISHED' } }));
    const rep = refresh.report as { total?: number; conflicts?: unknown[]; shortfalls?: unknown[] } | null;
    console.log(`kalendarz ${cal.studyMode}: opublikowany, terminow ${rep?.total ?? '?'}, kolizji ${rep?.conflicts?.length ?? '?'}`);
  }
}

main()
  .catch((e: Error) => {
    console.log(e.message);
    if (!e.message.startsWith('PODGLAD')) process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
