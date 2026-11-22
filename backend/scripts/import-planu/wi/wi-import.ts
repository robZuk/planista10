/**
 * Wydzial Informatyki (WI): kierunek, programy, siatki godzin, kalendarze zimy 2026/27, roczniki z grupami
 * (faza --setup) oraz plan zajec z prowadzacymi (faza --plan). Dane: dane/wi/{programy,plan,osoby}.json
 * (parsery wi_*.py ze stron wi.umg.edu.pl/programy-studiow i /plan-zajec).
 *
 *   npx tsx scripts/import-planu/wi/wi-import.ts --setup [--apply]
 *   npx tsx scripts/import-planu/wi/wi-import.ts --plan [--apply]
 * Bez --apply: podglad (transakcja wycofana). Po --setup --apply: synchronizacja zajec (autoSyncCohorts).
 * Po --plan --apply: terminy (refreshPlanningTerms) i publikacja kalendarzy WI.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClassType, DayOfWeek, Prisma, SemesterType, StudyMode } from '@prisma/client';
import { prisma } from '../../../src/lib/prisma';
import { autoSyncCohorts, changeCalendarStatus } from '../../../src/services/autoPlan';

const apply = process.argv.includes('--apply');
const phase = process.argv.includes('--plan') ? 'plan' : 'setup';
const dane = join(__dirname, '../dane/wi');
const load = <T>(f: string): T => JSON.parse(readFileSync(join(dane, f), 'utf8'));

type Cell = { W?: number; C?: number; L?: number; P?: number; e?: number; exam?: boolean };
interface ProgramFile {
  program: string;
  semesters: number;
  entries: { nr: string; subject: string; spec: string | null; sems: Record<string, Cell> }[];
}
interface PlanRec {
  cohort: string;
  sem: number;
  day?: DayOfWeek;
  date?: string;
  start: string;
  end?: string;
  blocks?: number;
  subject: string;
  form: ClassType;
  group: string;
  room: string | null;
  roomNote?: string | null;
  person: string | null;
  pattern: 'ALL' | 'ODD' | 'EVEN';
  fromIndex: number | null;
  toIndex: number | null;
}
interface Person {
  firstName: string;
  lastName: string;
  title: string | null;
  email: string;
  unit: string | null;
}

const PROGRAMS: { code: string; name: string; degree: 'BACHELOR' | 'MASTER'; mode: StudyMode; label: string; start: SemesterType }[] = [
  { code: 'INF-WI-S1', name: 'Informatyka WI (stacjonarne, I stopnia)', degree: 'BACHELOR', mode: 'FULL_TIME', label: 'od naboru 2025/26', start: 'WINTER' },
  { code: 'INF-WI-N1', name: 'Informatyka WI (niestacjonarne, I stopnia)', degree: 'BACHELOR', mode: 'PART_TIME', label: 'od naboru 2025/26', start: 'WINTER' },
  { code: 'INF-WI-S2', name: 'Informatyka WI (stacjonarne, II stopnia)', degree: 'MASTER', mode: 'FULL_TIME', label: 'od naboru 2025/26 L', start: 'SUMMER' },
  { code: 'INF-WI-N2', name: 'Informatyka WI (niestacjonarne, II stopnia)', degree: 'MASTER', mode: 'PART_TIME', label: 'od naboru 2025/26 L', start: 'SUMMER' },
];
const SPECS = { IA: 'Inteligentne Aplikacje', PSA: 'Programowanie Systemów Autonomicznych' } as const;

/** Roczniki: grupy cwiczeniowe -> laboratoryjne (i projektowe o tych samych numerach). */
const COHORTS: { key: string; program: string; year: number; c: Record<string, number[]> }[] = [
  { key: 'INF-WI-S1:2026', program: 'INF-WI-S1', year: 2026, c: { 1: [1, 2], 2: [3, 4], 3: [5, 6] } },
  { key: 'INF-WI-S1:2025', program: 'INF-WI-S1', year: 2025, c: { 1: [1, 2], 2: [3, 4] } },
  { key: 'INF-WI-N1:2026', program: 'INF-WI-N1', year: 2026, c: { 1: [1, 2] } },
  { key: 'INF-WI-N1:2025', program: 'INF-WI-N1', year: 2025, c: { 1: [1] } },
  { key: 'INF-WI-N2:2026', program: 'INF-WI-N2', year: 2026, c: { 1: [1, 2] } },
];
const LAB_SIZE = 15;

/** Siatka stacjonarna: pary 2x45 min z przerwa 15 min (plany WI maja dowolne starty co 15 min — najblizszy blok). */
const GRID_FULL = [
  ['07:15', '08:00'], ['08:00', '08:45'], ['09:00', '09:45'], ['09:45', '10:30'], ['10:45', '11:30'], ['11:30', '12:15'],
  ['12:30', '13:15'], ['13:15', '14:00'], ['14:15', '15:00'], ['15:00', '15:45'], ['16:00', '16:45'], ['16:45', '17:30'],
  ['17:45', '18:30'], ['18:30', '19:15'], ['19:30', '20:15'], ['20:15', '21:00'],
];
/** Siatka niestacjonarna: bloki 3x45 min (8:00-10:25, 10:35-13:00, 13:30-15:55, 16:05-18:30, 18:40-21:05). */
const GRID_PART = [
  ['08:00', '08:45'], ['08:50', '09:35'], ['09:40', '10:25'], ['10:35', '11:20'], ['11:25', '12:10'], ['12:15', '13:00'],
  ['13:30', '14:15'], ['14:20', '15:05'], ['15:10', '15:55'], ['16:05', '16:50'], ['16:55', '17:40'], ['17:45', '18:30'],
  ['18:40', '19:25'], ['19:30', '20:15'], ['20:20', '21:05'],
];
const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const WEEKDAYS: DayOfWeek[] = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const dayOf = (iso: string) => WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()]!;
const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** "Wychowanie fizyczne I, II, III, IV" -> "Wychowanie fizyczne" (lista numerow); "Matematyka I" zostaje. */
const subjectName = (n: string) => n.replace(/\s+[IVX]+(,\s*[IVX]+)+$/, '').trim();
function hoursOf(subject: string, c: Cell) {
  const h = { hoursLecture: c.W ?? 0, hoursExercise: c.C ?? 0, hoursLab: c.L ?? 0, hoursProject: c.P ?? 0, hoursSeminar: 0 };
  if (/^Seminarium|^Proseminarium/i.test(subject)) return { hoursLecture: 0, hoursExercise: 0, hoursLab: 0, hoursProject: 0, hoursSeminar: h.hoursLecture + h.hoursExercise + h.hoursLab + h.hoursProject };
  return h;
}

/** Blok startowy i koncowy dla [start, end] w siatce: liczba blokow z dlugosci (45 min), start najblizszy. */
function blocksFor(grid: string[][], start: string, end: string | undefined, count?: number) {
  const n = Math.max(1, count ?? Math.round((min(end!) - min(start)) / 45));
  let best = 0;
  let diff = Infinity;
  for (let i = 0; i + n <= grid.length; i++) {
    const d = Math.abs(min(grid[i]![0]!) - min(start));
    if (d < diff) {
      diff = d;
      best = i;
    }
  }
  return { startOrder: best + 1, endOrder: best + n, shift: diff };
}

async function setup(tx: Prisma.TransactionClient) {
  const wi = await tx.faculty.findUniqueOrThrow({ where: { shortName: 'WI' } });
  const terms = await tx.academicTerm.findMany();
  const term = (y: number, t: SemesterType) => terms.find((x) => x.startYear === y && x.type === t)!;
  const zima = term(2026, 'WINTER');

  for (const [short, name] of [['ZIS', 'Zakład Inżynierii Systemów'], ['ZSA', 'Zakład Systemów Autonomicznych']] as const) {
    if (!(await tx.department.findFirst({ where: { facultyId: wi.id, shortName: short } }))) {
      await tx.department.create({ data: { facultyId: wi.id, shortName: short, name } });
      console.log(`+ zaklad ${short}-WI`);
    }
  }
  const field =
    (await tx.fieldOfStudy.findFirst({ where: { facultyId: wi.id, name: 'Informatyka' } })) ??
    (await tx.fieldOfStudy.create({ data: { facultyId: wi.id, name: 'Informatyka', shortName: 'INF' } }));
  const specId: Record<string, string> = {};
  for (const [short, name] of Object.entries(SPECS)) {
    const s = (await tx.specialization.findFirst({ where: { fieldOfStudyId: field.id, shortName: short } })) ?? (await tx.specialization.create({ data: { fieldOfStudyId: field.id, shortName: short, name } }));
    specId[short] = s.id;
  }

  // Programy i wersje
  const files = load<ProgramFile[]>('programy.json');
  const subjects = new Map((await tx.subject.findMany()).map((s) => [s.name, s.id]));
  const subjectId = async (name: string): Promise<string> => {
    const hit = subjects.get(name);
    if (hit) return hit;
    const s = await tx.subject.create({ data: { name } });
    subjects.set(name, s.id);
    return s.id;
  };
  const versionOf: Record<string, string> = {};
  for (const p of PROGRAMS) {
    const f = files.find((x) => x.program === p.code)!;
    const program =
      (await tx.program.findUnique({ where: { code: p.code } })) ??
      (await tx.program.create({ data: { code: p.code, name: p.name, fieldOfStudyId: field.id, degreeLevel: p.degree, studyMode: p.mode } }));
    if (await tx.programVersion.findFirst({ where: { programId: program.id, label: p.label } })) throw new Error(`${p.code}: wersja juz jest`);
    const v = await tx.programVersion.create({ data: { programId: program.id, label: p.label, status: 'APPROVED', totalSemesters: f.semesters, defaultStartType: p.start } });
    versionOf[p.code] = v.id;
    const order = new Map<number, number>();
    let n = 0;
    for (const e of f.entries) {
      const name = subjectName(e.subject);
      for (const [k, c] of Object.entries(e.sems)) {
        const sem = Number(k);
        order.set(sem, (order.get(sem) ?? 0) + 1);
        await tx.programEntry.create({
          data: {
            versionId: v.id, subjectId: await subjectId(name), semester: sem, specializationId: e.spec ? specId[e.spec]! : null,
            orderInSemester: order.get(sem)!, ...(/^Praktyka/i.test(name) ? {} : hoursOf(name, c)), ects: Math.round(c.e ?? 0),
            assessmentType: c.exam ? 'EXAM' : 'CREDIT',
          },
        });
        n++;
      }
    }
    console.log(`+ ${p.code} "${p.label}": ${n} pozycji`);
  }

  // Siatki godzin
  for (const [mode, grid, days] of [
    ['FULL_TIME', GRID_FULL, ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']],
    ['PART_TIME', GRID_PART, ['FRIDAY', 'SATURDAY', 'SUNDAY']],
  ] as const) {
    if (await tx.timeGrid.findFirst({ where: { facultyId: wi.id, studyMode: mode } })) continue;
    await tx.timeGrid.create({
      data: {
        facultyId: wi.id, studyMode: mode, base: true, days: days.map((d) => ({ day: d, from: null, to: null })),
        blocks: { create: grid.map(([s, e], i) => ({ order: i + 1, startTime: s!, endTime: e!, label: `${s}-${e}` })) },
      },
    });
    console.log(`+ siatka WI ${mode}: ${grid.length} blokow`);
  }

  // Kalendarze zimy 2026/27 (wzor: WE; zjazdy z planu niestacjonarnego WI)
  const we = await tx.faculty.findUniqueOrThrow({ where: { shortName: 'WE' } });
  const weCal = await tx.termCalendar.findMany({ where: { termId: zima.id, facultyId: we.id }, include: { breaks: true, days: true } });
  const plan = load<PlanRec[]>('plan.json');
  const nsDates = [...new Set(plan.filter((r) => r.date).map((r) => r.date!))].sort();
  const zjazdy: { start: string; end: string }[] = [];
  for (const d of nsDates) {
    const last = zjazdy[zjazdy.length - 1];
    if (last && (D(d).getTime() - D(last.end).getTime()) / 864e5 <= 2) last.end = d;
    else zjazdy.push({ start: d, end: d });
  }
  for (const mode of ['FULL_TIME', 'PART_TIME'] as const) {
    if (await tx.termCalendar.findFirst({ where: { termId: zima.id, facultyId: wi.id, studyMode: mode } })) continue;
    const src = weCal.find((c) => c.studyMode === mode)!;
    await tx.termCalendar.create({
      data: {
        termId: zima.id, facultyId: wi.id, studyMode: mode, kind: mode === 'FULL_TIME' ? 'WEEKLY' : 'ZJAZD', status: 'PLANNING',
        startDate: src.startDate, endDate: mode === 'PART_TIME' ? D(nsDates[nsDates.length - 1]! > iso(src.endDate) ? nsDates[nsDates.length - 1]! : iso(src.endDate)) : src.endDate,
        breaks: { create: src.breaks.map((b) => ({ name: b.name, startDate: b.startDate, endDate: b.endDate })) },
        days: { create: src.days.map((d) => ({ date: d.date, kind: d.kind, name: d.name, followsWeekday: d.followsWeekday, closedFromBlockOrder: null })) },
        ...(mode === 'PART_TIME' ? { zjazdy: { create: zjazdy.map((z, i) => ({ number: i + 1, startDate: D(z.start), endDate: D(z.end) })) } } : {}),
      },
    });
    console.log(`+ kalendarz WI ${mode}${mode === 'PART_TIME' ? ` (${zjazdy.length} zjazdow)` : ''}`);
  }

  // Roczniki i grupy
  const ids: string[] = [];
  for (const c of COHORTS) {
    const program = await tx.program.findUniqueOrThrow({ where: { code: c.program } });
    const start = term(c.year, 'WINTER');
    if (await tx.cohort.findFirst({ where: { programId: program.id, startTermId: start.id } })) throw new Error(`${c.key} juz jest`);
    const labs = Object.values(c.c).flat();
    const cohort = await tx.cohort.create({ data: { programId: program.id, programVersionId: versionOf[c.program]!, startTermId: start.id, lectureMode: 'JOINT' } });
    const root = await tx.studentGroup.create({ data: { cohortId: cohort.id, partitionKey: 'ROOT', size: labs.length * LAB_SIZE } });
    for (const [code, ls] of Object.entries(c.c)) {
      const cg = await tx.studentGroup.create({ data: { cohortId: cohort.id, partitionKey: 'C', code, size: ls.length * LAB_SIZE, parentGroupId: root.id } });
      for (const l of ls) {
        await tx.studentGroup.create({ data: { cohortId: cohort.id, partitionKey: 'L', code: String(l), size: LAB_SIZE, parentGroupId: cg.id } });
        await tx.studentGroup.create({ data: { cohortId: cohort.id, partitionKey: 'P', code: String(l), size: LAB_SIZE, parentGroupId: cg.id } });
      }
    }
    ids.push(cohort.id);
    console.log(`+ rocznik ${c.key}: C ${Object.keys(c.c).length}, L/P ${labs.length}`);
  }
  return ids;
}

async function planPhase(tx: Prisma.TransactionClient) {
  const wi = await tx.faculty.findUniqueOrThrow({ where: { shortName: 'WI' } });
  const zima = await tx.academicTerm.findFirstOrThrow({ where: { startYear: 2026, type: 'WINTER' } });
  const plan = load<PlanRec[]>('plan.json').filter((r) => r.subject);
  const people = load<Record<string, Person>>('osoby.json');
  const cal = await tx.termCalendar.findFirstOrThrow({ where: { termId: zima.id, facultyId: wi.id, studyMode: 'PART_TIME' }, include: { zjazdy: true } });
  const zjazdOf = (d: string) => cal.zjazdy.find((z) => iso(z.startDate) <= d && d <= iso(z.endDate))!.number;

  // Prowadzacy: upsert po e-mailu; istniejacych (takze innych wydzialow) nie przepinamy.
  const depts = await tx.department.findMany({ include: { faculty: true } });
  const faculties = await tx.faculty.findMany();
  const instructorId = new Map<string, string>();
  let created = 0;
  for (const [raw, p] of Object.entries(people)) {
    let ins = await tx.instructor.findUnique({ where: { email: p.email } });
    if (!ins) {
      const [unitFac, unitName] = (p.unit ?? '').split(' / ');
      const dept = depts.find((d) => d.name === unitName && (d.faculty ? d.faculty.name === unitFac : true));
      const fac = faculties.find((f) => f.name === unitFac);
      ins = await tx.instructor.create({
        data: { firstName: p.firstName, lastName: p.lastName, title: p.title, email: p.email, departmentId: dept?.id ?? null, facultyId: dept ? dept.facultyId : (fac?.id ?? null) },
      });
      created++;
    }
    instructorId.set(raw, ins.id);
  }
  console.log(`prowadzacy: ${instructorId.size} napisow, ${new Set(instructorId.values()).size} osob, nowych ${created}`);

  // Sale: numer -> sala w budynku z litery numeru ("Budynek F"), brakujace dodane
  const rooms = await tx.room.findMany({ include: { building: true } });
  const roomId = async (num: string) => {
    const letter = num.charAt(0);
    const b = await tx.building.findFirst({ where: { name: `Budynek ${letter}` } });
    const hit = rooms.find((r) => r.number === num && (!b || r.buildingId === b.id)) ?? rooms.find((r) => r.number === num);
    if (hit) return hit.id;
    if (!b) throw new Error(`Brak budynku dla sali ${num}`);
    const r = await tx.room.upsert({
      where: { number_buildingId: { number: num, buildingId: b.id } },
      create: { number: num, buildingId: b.id, type: letter === 'F' ? 'COMPUTER_LAB' : 'LECTURE', capacity: 30 },
      update: {},
      include: { building: true },
    });
    rooms.push(r);
    console.log(`+ sala ${num} (${b.name})`);
    return r.id;
  };

  // Zajecia rocznikow
  const cohorts = new Map<string, { id: string; groups: { id: string; partitionKey: string; code: string | null }[] }>();
  for (const c of COHORTS) {
    const program = await tx.program.findUniqueOrThrow({ where: { code: c.program } });
    const cohort = await tx.cohort.findFirstOrThrow({ where: { programId: program.id, startTerm: { startYear: c.year, type: 'WINTER' } }, include: { groups: true } });
    cohorts.set(c.key, cohort);
  }
  const sections = await tx.classSection.findMany({
    where: { termId: zima.id, cohortId: { in: [...cohorts.values()].map((c) => c.id) } },
    include: { programEntry: { include: { subject: true } }, instructors: true },
  });
  const groupOf = (key: string, code: string) => {
    const c = cohorts.get(key)!;
    if (code === 'ROOT') return c.groups.find((g) => g.partitionKey === 'ROOT')!;
    return c.groups.find((g) => g.partitionKey === code.charAt(0) && g.code === code.slice(1));
  };
  const problems: string[] = [];
  type Key = string;
  const ns = new Map<Key, { data: Prisma.PlacementUncheckedCreateInput; numbers: Set<number> }>();
  let placed = 0;
  const staff = new Map<string, Map<string, number>>(); // sekcja -> prowadzacy -> liczba umieszczen
  for (const r of plan) {
    const cohort = cohorts.get(r.cohort)!;
    const g = groupOf(r.cohort, r.group);
    const sec = g && sections.find((s) => s.cohortId === cohort.id && s.groupId === g.id && s.classType === r.form && s.programEntry.subject.name === subjectName(r.subject));
    if (!sec) {
      problems.push(`${r.cohort} ${r.day ?? r.date} ${r.start} ${r.subject} ${r.form} ${r.group}: brak zajec`);
      continue;
    }
    const ins = r.person ? instructorId.get(r.person) ?? null : null;
    if (ins) {
      const m = staff.get(sec.id) ?? new Map();
      m.set(ins, (m.get(ins) ?? 0) + 1);
      staff.set(sec.id, m);
    }
    const room = r.room ? await roomId(r.room) : null;
    if (r.date) {
      const b = blocksFor(GRID_PART, r.start, undefined, r.blocks);
      const day = dayOf(r.date);
      const key = [sec.id, day, b.startOrder, b.endOrder, room, ins].join('|');
      const e = ns.get(key) ?? {
        data: { sectionId: sec.id, termId: zima.id, facultyId: wi.id, dayOfWeek: day, startOrder: b.startOrder, endOrder: b.endOrder, roomId: room, instructorId: ins, cycle: 'ZJAZD', pattern: 'LIST', numbers: [] },
        numbers: new Set<number>(),
      };
      e.numbers.add(zjazdOf(r.date));
      ns.set(key, e);
    } else {
      const b = blocksFor(GRID_FULL, r.start, r.end);
      if (b.shift > 0) problems.push(`~ ${r.cohort} ${r.day} ${r.start}-${r.end} ${r.subject} ${r.group}: blok ${GRID_FULL[b.startOrder - 1]![0]} (przesuniecie ${b.shift} min)`);
      await tx.placement.create({
        data: { sectionId: sec.id, termId: zima.id, facultyId: wi.id, dayOfWeek: r.day!, startOrder: b.startOrder, endOrder: b.endOrder, roomId: room, instructorId: ins, cycle: 'WEEK', pattern: r.pattern, fromIndex: r.fromIndex, toIndex: r.toIndex, numbers: [] },
      });
      placed++;
    }
  }
  for (const e of ns.values()) {
    await tx.placement.create({ data: { ...e.data, numbers: [...e.numbers].sort((a, b) => a - b) } });
    placed++;
  }
  // Obsada: prowadzacy umieszczen, godziny proporcjonalnie do liczby umieszczen
  let staffed = 0;
  for (const [sid, m] of staff) {
    const sec = sections.find((s) => s.id === sid)!;
    if (sec.instructors.length > 0) continue;
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    let left = sec.hours;
    const list = [...m.entries()];
    for (const [i, [ins, n]] of list.entries()) {
      const h = i === list.length - 1 ? left : Math.round((sec.hours * n) / total);
      left -= h;
      await tx.sectionInstructor.create({ data: { sectionId: sid, instructorId: ins, hours: h } });
      staffed++;
    }
  }
  console.log(`umieszczen: ${placed}, wierszy obsady: ${staffed}`);
  for (const p of problems) console.log('  ', p);
  return [...cohorts.values()].map((c) => c.id);
}

async function main() {
  let ids: string[] = [];
  await prisma.$transaction(
    async (tx) => {
      ids = phase === 'setup' ? await setup(tx) : await planPhase(tx);
      if (!apply) throw new Error('PODGLAD — nic nie zapisano (uruchom z --apply)');
    },
    { timeout: 600_000, maxWait: 60_000 },
  );
  if (phase === 'setup') {
    console.log('Synchronizacja zajec:', JSON.stringify(await autoSyncCohorts(ids)));
  } else {
    const wi = await prisma.faculty.findUniqueOrThrow({ where: { shortName: 'WI' } });
    const zima = await prisma.academicTerm.findFirstOrThrow({ where: { startYear: 2026, type: 'WINTER' } });
    for (const cal of await prisma.termCalendar.findMany({ where: { termId: zima.id, facultyId: wi.id } })) {
      const { refresh } = await changeCalendarStatus(zima, cal, 'PUBLISHED', () => prisma.termCalendar.update({ where: { id: cal.id }, data: { status: 'PUBLISHED' } }));
      console.log(`kalendarz ${cal.studyMode}: opublikowany, terminy:`, JSON.stringify(refresh.report ? { ...refresh.report, conflicts: undefined } : null).slice(0, 400));
    }
  }
}

main()
  .catch((e: Error) => {
    console.log(e.message);
    if (!e.message.startsWith('PODGLAD')) process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
