/**
 * Pelna baza testowa planista10 w skali uczelni (testy obciazenia i wydajnosci).
 *
 * WYCZYSZCZA I WYPELNIA baze — dziala TYLKO na bazie `planista10_pelne` (sprawdzane w
 * DATABASE_URL), zeby przypadkiem nie nadpisac danych deweloperskich.
 *
 *   docker exec -e DATABASE_URL=postgresql://postgres:password@db:5432/planista10_pelne?schema=public \
 *     planista10-backend-1 npx tsx scripts/pelne-dane/generuj.ts
 *
 * Zrodla: struktura.ts (wydzialy, kierunki, specjalnosci, liczby studentow, siatki) i
 * programy.json (prawdziwe plany studiow WN i WM). Reszta jest generowana deterministycznie:
 * programy WE i WZNJ, sale, FIKCYJNI prowadzacy, grupy, obsada i plan semestru zimowego
 * 2026/27 bez kolizji (zachlannie). Plan uklada tu skrypt wylacznie jako dane testowe —
 * w aplikacji plan zawsze uklada planista. Terminy powstaja prawdziwym `generate`.
 */
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import type { AcademicTerm, ClassType, DayOfWeek, RoomType, StudyMode } from '@prisma/client';
import { prisma } from '../../src/lib/prisma';
import { syncSections } from '../../src/services/sections';
import { generate } from '../../src/services/plan';
import { calendarInclude, toCalendarInput } from '../../src/services/termCalendars';
import { TeachingCalendar, expandDates } from '../../src/lib/teachingCalendar';
import { addDays, isoDate } from '../../src/lib/isoDate';
import { defaultTermDates, termOrdinal } from '../../src/lib/terms';
import { blockLabel, toMinutes } from '../../src/lib/timeGrid';
import {
  COMMON_BACHELOR_ECON,
  COMMON_BACHELOR_TECH,
  FACULTIES,
  FIELD_POOLS,
  FIRST_NAMES_F,
  FIRST_NAMES_M,
  LAST_NAMES,
  PROGRAMS,
  SPEC_TOPICS,
  type Mode,
  type ProgramDef,
} from './struktura';

const TARGET = { startYear: 2026, type: 'WINTER' as const };
const FORMS = ['W', 'C', 'L', 'P', 'S'] as const;
type Form = (typeof FORMS)[number];
interface Entry {
  name: string;
  sem: number;
  spec: string | null;
  W: number;
  C: number;
  L: number;
  P: number;
  S: number;
  ects: number;
}

// ─── Bezpiecznik ─────────────────────────────────────────────
const url = process.env.DATABASE_URL ?? '';
if (!/\/planista10_pelne(\?|$)/.test(url)) {
  console.error('Skrypt czysci baze — uruchamiaj tylko z DATABASE_URL wskazujacym planista10_pelne.');
  process.exit(1);
}

// ─── Losowanie deterministyczne ──────────────────────────────
let seed = 2026;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;
const ascii = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();

const t0 = Date.now();
const log = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

// ─── Programy generowane (WE, WZNJ) ──────────────────────────
function round5(h: number): number {
  return h === 0 ? 0 : Math.max(5, Math.round(h / 5) * 5);
}

function genEntries(def: ProgramDef): Entry[] {
  const pools = FIELD_POOLS[def.field]!;
  const tech = !['ZAR', 'NoJ', 'IJ'].includes(def.field);
  // NS: ok. 45% godzin ST (jak w prawdziwych programach NS WN/WM: 170-260 h na semestr).
  const factor = def.mode === 'PART_TIME' ? 0.45 : 1;
  const queue = def.level === 'BACHELOR' ? [...(tech ? COMMON_BACHELOR_TECH : COMMON_BACHELOR_ECON), ...pools.bachelor] : [...pools.master];
  const specFrom = def.level === 'BACHELOR' ? Math.ceil(def.semesters / 2) + 1 : 2;
  const out: Entry[] = [];
  let reuse = 0;
  const next = () => {
    const name = queue.shift();
    if (name) return name;
    reuse++;
    return `${pick(def.level === 'BACHELOR' ? pools.bachelor : pools.master)} ${reuse % 2 ? 'II' : 'III'}`;
  };
  const hours = (lab: boolean) => {
    const h = { W: pick([15, 30, 30]), C: pick([0, 15, 15, 30]), L: lab ? pick([0, 15, 30, 30]) : pick([0, 0, 15]), P: pick([0, 0, 0, 15]), S: 0 };
    return Object.fromEntries(FORMS.map((f) => [f, round5(h[f] * factor)])) as Record<Form, number>;
  };
  const push = (name: string, sem: number, spec: string | null, h: Record<Form, number>) => {
    const total = FORMS.reduce((a, f) => a + h[f], 0);
    out.push({ name, sem, spec, ...h, ects: Math.max(1, Math.round(total / (15 * factor))) });
  };
  const specTopic = new Map<string, number>();
  for (let sem = 1; sem <= def.semesters; sem++) {
    const last = sem === def.semesters;
    if (def.level === 'BACHELOR' ? sem < def.semesters : sem <= 2) push('Język angielski', sem, null, { W: 0, C: round5(30 * factor), L: 0, P: 0, S: 0 });
    if (def.level === 'BACHELOR' && def.mode === 'FULL_TIME' && sem <= 2) push('Wychowanie fizyczne', sem, null, { W: 0, C: 30, L: 0, P: 0, S: 0 });
    const specSem = def.specs.length > 0 && sem >= specFrom;
    const nCommon = specSem ? 3 : last ? 4 : 6;
    for (let i = 0; i < nCommon; i++) push(next(), sem, null, hours(tech));
    if (specSem) {
      for (const spec of def.specs) {
        for (let i = 0; i < 3; i++) {
          const k = specTopic.get(spec.short) ?? 0;
          specTopic.set(spec.short, k + 1);
          push(`${SPEC_TOPICS[k % SPEC_TOPICS.length]}${k >= SPEC_TOPICS.length ? ' II' : ''} (${spec.short})`, sem, spec.short, hours(tech));
        }
      }
    }
    if (last) push(def.level === 'BACHELOR' ? 'Seminarium dyplomowe' : 'Seminarium magisterskie', sem, null, { W: 0, C: 0, L: 0, P: 0, S: round5(30 * factor) });
  }
  return out;
}

// ─── Glowna procedura ────────────────────────────────────────
async function main() {
  log('Czyszczenie bazy planista10_pelne...');
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);

  const realPrograms = JSON.parse(fs.readFileSync(path.join(__dirname, 'programy.json'), 'utf-8')) as Record<
    string,
    { semesters: number; source: string; entries: Entry[] }
  >;

  // ── Wydzialy, siatki, budynki i sale ──
  log('Wydzialy, siatki godzin, sale...');
  const facultyId = new Map<string, string>();
  const rooms: { id: string; type: RoomType; capacity: number; facultyId: string | null }[] = [];
  const roomCreate = async (buildingId: string, fId: string | null, number: string, type: RoomType, capacity: number) => {
    const r = await prisma.room.create({ data: { buildingId, number, type, capacity } });
    rooms.push({ id: r.id, type, capacity, facultyId: fId });
  };
  for (const f of FACULTIES) {
    const faculty = await prisma.faculty.create({ data: { name: f.name, shortName: f.short } });
    facultyId.set(f.short, faculty.id);
    for (const mode of ['FULL_TIME', 'PART_TIME'] as const) {
      const g = f.grids[mode];
      await prisma.timeGrid.create({
        data: {
          facultyId: faculty.id,
          studyMode: mode,
          days: g.days,
          blocks: { create: g.blocks.map(([s, e], i) => ({ order: i + 1, startTime: s, endTime: e, label: blockLabel(s, e) })) },
        },
      });
    }
    const big = f.short === 'WN' ? [60, 80, 100, 120, 150, 180, 200, 240] : [60, 80, 100, 120, 150, 200];
    const plan: [RoomType, number[]][] = [
      ['LECTURE', big],
      ['EXERCISE', [30, 30, 30, 32, 32, 35, 35, 36, 40, 40, 40, 40, 30, 32]],
      ['LAB', [16, 16, 16, 16, 18, 18, 18, 20, 20, 16, 16, 18, 20, 16]],
      ['COMPUTER_LAB', [16, 16, 20, 24, 30, 30]],
      ['SEMINAR', [24, 24, 30, 30]],
    ];
    const buildings = [];
    for (const name of f.buildings) {
      buildings.push(await prisma.building.create({ data: { name, address: 'ul. Morska 81-87, Gdynia', facultyId: faculty.id } }));
    }
    let n = 0;
    for (const [type, caps] of plan) {
      for (const cap of caps) {
        const b = n % buildings.length;
        const floor = 1 + Math.floor(n / (buildings.length * 12));
        await roomCreate(buildings[b]!.id, faculty.id, `${floor}${String(10 + (n % 90)).padStart(2, '0')}`, type, cap);
        n++;
      }
    }
  }
  const aula = await prisma.building.create({ data: { name: 'Aula Główna', address: 'ul. Morska 81-87, Gdynia' } });
  await roomCreate(aula.id, null, 'Aula', 'LECTURE', 320);
  const hala = await prisma.building.create({ data: { name: 'Hala Sportowa', address: 'ul. Morska 81-87, Gdynia' } });
  for (const nr of ['S1', 'S2', 'S3', 'S4']) await roomCreate(hala.id, null, nr, 'SPORTS', 60);
  const sjo = await prisma.building.create({ data: { name: 'Studium Języków Obcych', address: 'ul. Morska 81-87, Gdynia' } });
  for (let i = 0; i < 16; i++) await roomCreate(sjo.id, null, `J${101 + i}`, 'EXERCISE', 30);

  // ── Kierunki, specjalnosci ──
  const fieldId = new Map<string, string>();
  const fieldName = new Map<string, string>();
  const specId = new Map<string, string>(); // field|short
  for (const f of FACULTIES) {
    for (const fd of f.fields) {
      const field = await prisma.fieldOfStudy.create({ data: { name: fd.name, shortName: fd.short, facultyId: facultyId.get(f.short)! } });
      fieldId.set(fd.short, field.id);
      fieldName.set(fd.short, fd.name);
    }
  }
  for (const p of PROGRAMS) {
    for (const s of p.specs) {
      const key = `${p.field}|${s.short}`;
      if (specId.has(key)) continue;
      const spec = await prisma.specialization.create({ data: { name: s.name, shortName: s.short, fieldOfStudyId: fieldId.get(p.field)! } });
      specId.set(key, spec.id);
    }
  }
  const facultyOfField = new Map(FACULTIES.flatMap((f) => f.fields.map((fd) => [fd.short, f.short] as const)));

  // ── Semestry ──
  // Tylko potrzebne semestry: biezacy rok akademicki i nabory rocznikow (zakladane przy pierwszym uzyciu),
  // zeby przelacznik semestru nie pokazywal pustych dawnych semestrow.
  const terms = new Map<string, AcademicTerm>();
  const termOf = async (key: string): Promise<AcademicTerm> => {
    const found = terms.get(key);
    if (found) return found;
    const [startYear, type] = key.split('-') as [string, 'WINTER' | 'SUMMER'];
    const created = await prisma.academicTerm.create({ data: { startYear: Number(startYear), type } });
    terms.set(key, created);
    return created;
  };
  const term = await termOf(`${TARGET.startYear}-${TARGET.type}`);
  await termOf(`${TARGET.startYear}-SUMMER`);

  // ── Kalendarze semestru zimowego 2026/27 ──
  log('Kalendarze...');
  const dates = defaultTermDates(term);
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const xmas = { startDate: isoDate(2026, 12, 23), endDate: isoDate(2027, 1, 1) };
  // 10 zjazdow (pt-nd), zwykle co 2 tygodnie, miejscami tydzien po tygodniu — jak w kalendarzach NS uczelni.
  const zjazdy = ['2026-10-02', '2026-10-16', '2026-10-30', '2026-11-13', '2026-11-20', '2026-12-04', '2026-12-18', '2027-01-08', '2027-01-15', '2027-01-29'].map(
    (start, i) => ({ number: i + 1, startDate: d(start), endDate: d(addDays(start, 2)) }),
  );
  for (const f of FACULTIES) {
    for (const mode of ['FULL_TIME', 'PART_TIME'] as const) {
      await prisma.termCalendar.create({
        data: {
          termId: term.id,
          facultyId: facultyId.get(f.short)!,
          studyMode: mode,
          kind: mode === 'FULL_TIME' ? 'WEEKLY' : 'ZJAZD',
          status: 'PUBLISHED',
          startDate: d(dates.startDate),
          endDate: d(dates.endDate),
          breaks: { create: [{ name: 'Przerwa świąteczna', startDate: d(xmas.startDate), endDate: d(xmas.endDate) }] },
          ...(mode === 'PART_TIME' ? { zjazdy: { create: zjazdy } } : {}),
        },
      });
    }
  }

  // ── Programy i wersje ──
  log('Programy studiow...');
  const entriesOf = new Map<string, Entry[]>();
  for (const p of PROGRAMS) {
    if (p.source === 'real') {
      const real = realPrograms[p.code];
      if (!real) throw new Error(`Brak programu ${p.code} w programy.json`);
      entriesOf.set(p.code, real.entries.filter((e) => e.sem <= p.semesters));
    } else {
      entriesOf.set(p.code, genEntries(p));
    }
  }
  const subjectNames = [...new Set([...entriesOf.values()].flat().map((e) => e.name))];
  await prisma.subject.createMany({ data: subjectNames.map((name) => ({ name })), skipDuplicates: true });
  const subjectId = new Map((await prisma.subject.findMany()).map((s) => [s.name, s.id]));

  const versionOf = new Map<string, { programId: string; versionId: string }>();
  for (const p of PROGRAMS) {
    const modeLabel = p.mode === 'FULL_TIME' ? 'stacjonarne' : 'niestacjonarne';
    const levelLabel = p.level === 'BACHELOR' ? 'I stopnia' : 'II stopnia';
    const name = p.code.startsWith('ESO')
      ? `${fieldName.get(p.field)} — Eksploatacja Siłowni Okrętowych i Obiektów Oceanotechnicznych (${modeLabel}, ${levelLabel})`
      : `${fieldName.get(p.field)} (${modeLabel}, ${levelLabel})`;
    const program = await prisma.program.create({
      data: { code: p.code, name, fieldOfStudyId: fieldId.get(p.field)!, degreeLevel: p.level, studyMode: p.mode },
    });
    const version = await prisma.programVersion.create({
      data: { programId: program.id, label: 'od naboru 2025/26', status: 'APPROVED', totalSemesters: p.semesters, defaultStartType: 'WINTER' },
    });
    const order = new Map<number, number>();
    await prisma.programEntry.createMany({
      data: entriesOf.get(p.code)!.map((e) => {
        const o = (order.get(e.sem) ?? 0) + 1;
        order.set(e.sem, o);
        return {
          versionId: version.id,
          subjectId: subjectId.get(e.name)!,
          semester: e.sem,
          specializationId: e.spec ? (specId.get(`${p.field}|${e.spec}`) ?? null) : null,
          orderInSemester: o,
          hoursLecture: e.W,
          hoursExercise: e.C,
          hoursLab: e.L,
          hoursProject: e.P,
          hoursSeminar: e.S,
          ects: e.ects,
          assessmentType: e.W >= 30 ? 'EXAM' : 'CREDIT',
        };
      }),
    });
    versionOf.set(p.code, { programId: program.id, versionId: version.id });
  }

  // ── Roczniki: liczby studentow z wydzialu x tryb, podzial wg wag ──
  log('Roczniki i grupy...');
  const targetOrd = termOrdinal(TARGET);
  interface CohortPlan {
    def: ProgramDef;
    startKey: string;
    semester: number;
    weight: number;
    size: number;
  }
  const cohortPlans: CohortPlan[] = [];
  const yearFactor = [1, 0.8, 0.7, 0.65];
  for (const p of PROGRAMS) {
    for (let y = 2026; y >= 2021; y--) {
      for (const type of ['WINTER', 'SUMMER'] as const) {
        if (type === 'SUMMER' && !p.summerIntake) continue;
        const sem = targetOrd - termOrdinal({ startYear: y, type }) + 1;
        if (sem < 1 || sem > p.semesters) continue;
        const base = p.weight ?? (p.level === 'BACHELOR' ? 1 : 0.5);
        const w = base * yearFactor[Math.min(3, Math.ceil(sem / 2) - 1)]! * (type === 'SUMMER' ? 0.6 : 1) * (1 + 0.15 * Math.max(0, p.specs.length - 1));
        cohortPlans.push({ def: p, startKey: `${y}-${type}`, semester: sem, weight: w, size: 0 });
      }
    }
  }
  for (const f of FACULTIES) {
    for (const mode of ['FULL_TIME', 'PART_TIME'] as const) {
      const list = cohortPlans.filter((c) => facultyOfField.get(c.def.field) === f.short && c.def.mode === mode);
      const sum = list.reduce((a, c) => a + c.weight, 0);
      for (const c of list) c.size = Math.max(12, Math.round((f.students[mode] * c.weight) / sum));
    }
  }

  const specEntries = new Map(PROGRAMS.map((p) => [p.code, new Set(entriesOf.get(p.code)!.filter((e) => e.spec).map((e) => e.spec!))]));
  let firstLabGroup: string | null = null;
  for (const c of cohortPlans) {
    const v = versionOf.get(c.def.code)!;
    const cohort = await prisma.cohort.create({
      data: {
        programId: v.programId,
        programVersionId: v.versionId,
        startTermId: (await termOf(c.startKey)).id,
        lectureMode: c.size > 320 ? 'SEPARATE' : 'JOINT',
      },
    });
    const root = await prisma.studentGroup.create({ data: { cohortId: cohort.id, partitionKey: 'ROOT', size: c.size } });
    const specs = c.def.specs.filter((s) => specEntries.get(c.def.code)!.has(s.short));
    const scopes: { id: string; size: number; specializationId: string | null }[] = [];
    if (specs.length > 0) {
      const each = Math.floor(c.size / specs.length);
      for (let i = 0; i < specs.length; i++) {
        const size = i === 0 ? c.size - each * (specs.length - 1) : each;
        const sid = specId.get(`${c.def.field}|${specs[i]!.short}`)!;
        const g = await prisma.studentGroup.create({
          data: { cohortId: cohort.id, partitionKey: 'SPEC', code: specs[i]!.short, specializationId: sid, size, parentGroupId: root.id },
        });
        scopes.push({ id: g.id, size, specializationId: sid });
      }
    } else scopes.push({ id: root.id, size: c.size, specializationId: null });
    for (const scope of scopes) {
      const nC = Math.max(1, Math.ceil(scope.size / 30));
      for (let i = 0; i < nC; i++) {
        const cSize = Math.ceil(scope.size / nC);
        const code = String.fromCharCode(65 + i);
        const cg = await prisma.studentGroup.create({
          data: { cohortId: cohort.id, partitionKey: 'C', code, size: cSize, specializationId: scope.specializationId, parentGroupId: scope.id },
        });
        const nL = Math.max(1, Math.ceil(cSize / 15));
        for (let j = 0; j < nL; j++) {
          const lg = await prisma.studentGroup.create({
            data: { cohortId: cohort.id, partitionKey: 'L', code: `${code}${j + 1}`, size: Math.ceil(cSize / nL), specializationId: scope.specializationId, parentGroupId: cg.id },
          });
          if (!firstLabGroup && c.def.code === 'NAW-S1' && c.semester === 1) firstLabGroup = lg.id;
        }
      }
    }
  }

  // ── Zajecia semestru (prawdziwa synchronizacja) ──
  log('Synchronizacja zajec semestru...');
  const sync = await syncSections(term, { facultyId: null, dryRun: false });
  log(`  zajec: ${sync.created.length}, problemow: ${sync.problems.length}`);

  const sections = await prisma.classSection.findMany({
    where: { termId: term.id },
    include: {
      group: true,
      programEntry: { include: { subject: true } },
      cohort: { include: { program: { include: { fieldOfStudy: true } }, groups: true } },
    },
  });

  // ── Prowadzacy (fikcyjni) i obsada ──
  log('Prowadzacy i obsada...');
  const isLang = (s: (typeof sections)[number]) => /^Język/.test(s.programEntry.subject.name);
  const isWF = (s: (typeof sections)[number]) => /Wychowanie fizyczne/i.test(s.programEntry.subject.name);
  const poolKey = (s: (typeof sections)[number]) => (isLang(s) ? 'SJO' : isWF(s) ? 'WF' : s.facultyId);
  const hoursByPool = new Map<string, number>();
  for (const s of sections) hoursByPool.set(poolKey(s), (hoursByPool.get(poolKey(s)) ?? 0) + s.hours);
  const CAP = 420;
  const pools = new Map<string, string[]>();
  const load = new Map<string, number>();
  const usedEmails = new Set<string>();
  const titles = ['prof. dr hab. inż.', 'dr hab. inż.', 'dr inż.', 'dr inż.', 'dr inż.', 'dr', 'dr', 'mgr inż.', 'mgr', 'kpt. ż.w. mgr inż.'];
  for (const [key, hours] of hoursByPool) {
    const count = Math.ceil(hours / 300);
    const facultyShort = FACULTIES.find((f) => facultyId.get(f.short) === key)?.short;
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const female = rand() < 0.42;
      const first = pick(female ? FIRST_NAMES_F : FIRST_NAMES_M);
      const stem = pick(LAST_NAMES);
      const last = /(sk|ck)$/.test(stem) ? stem + (female ? 'a' : 'i') : stem;
      let email = `${ascii(first)}.${ascii(last)}@planista.test`;
      for (let k = 2; usedEmails.has(email); k++) email = `${ascii(first)}.${ascii(last)}${k}@planista.test`;
      usedEmails.add(email);
      let title = pick(titles);
      if (title.startsWith('kpt.') && facultyShort !== 'WN') title = 'dr inż.';
      if (key === 'SJO') title = pick(['mgr', 'mgr', 'dr']);
      if (key === 'WF') title = 'mgr';
      const ins = await prisma.instructor.create({
        data: { firstName: first, lastName: last, email, title, facultyId: facultyShort ? facultyId.get(facultyShort)! : null },
      });
      ids.push(ins.id);
      load.set(ins.id, 0);
    }
    pools.set(key, ids);
  }
  const affinity = new Map<string, string[]>(); // subjectId -> prowadzacy
  const choose = (pool: string[], subject: string, hours: number, exclude: Set<string> = new Set()): string => {
    const aff = (affinity.get(subject) ?? []).filter((id) => !exclude.has(id) && load.get(id)! + hours <= CAP);
    const candidates = aff.length > 0 ? aff : pool.filter((id) => !exclude.has(id));
    let best = candidates[0]!;
    for (const id of candidates) if (load.get(id)! < load.get(best)!) best = id;
    return best;
  };
  const assign = (id: string, subject: string, hours: number) => {
    load.set(id, load.get(id)! + hours);
    const aff = affinity.get(subject) ?? [];
    if (!aff.includes(id)) affinity.set(subject, [...aff, id]);
  };
  const staffOf = new Map<string, string>();
  const buckets = new Map<string, typeof sections>();
  for (const s of sections) {
    const k = `${s.cohortId}|${s.programEntryId}|${s.classType}`;
    buckets.set(k, [...(buckets.get(k) ?? []), s]);
  }
  for (const list of buckets.values()) {
    const pool = pools.get(poolKey(list[0]!))!;
    const subject = list[0]!.programEntry.subjectId;
    let current: string | null = null;
    let groups = 0;
    for (const s of list) {
      if (!current || groups >= (s.classType === 'LECTURE' ? 99 : 3) || load.get(current)! + s.hours > CAP) {
        current = choose(pool, subject, s.hours);
        groups = 0;
      }
      assign(current, subject, s.hours);
      staffOf.set(s.id, current);
      groups++;
    }
  }

  // ── Plan bez kolizji (zachlannie, ostroznie: kolizje na poziomie dnia tygodnia) ──
  log('Plan zajec (zachlannie)...');
  const calendars = await prisma.termCalendar.findMany({ where: { termId: term.id }, include: calendarInclude });
  const grids = await prisma.timeGrid.findMany({ include: { blocks: true } });
  interface Slotting {
    blocks: { order: number; start: number; end: number }[];
    days: { day: DayOfWeek; from: number }[];
    count: Map<DayOfWeek, number>;
    /** Numery tygodni/zjazdow, w ktore wypada dzien (rosnaco). */
    indexes: Map<DayOfWeek, number[]>;
    cycle: 'WEEK' | 'ZJAZD';
    maxLen: number;
  }
  const slotting = new Map<string, Slotting>();
  for (const g of grids) {
    const cal = calendars.find((c) => c.facultyId === g.facultyId && c.studyMode === g.studyMode)!;
    const tc = new TeachingCalendar(toCalendarInput(cal));
    const cycle = g.studyMode === 'FULL_TIME' ? 'WEEK' : 'ZJAZD';
    const days = (g.days as { day: DayOfWeek; from: string | null }[]).map((x) => ({ day: x.day, from: x.from ? toMinutes(x.from) : 0 }));
    const indexes = new Map(days.map((x) => [x.day, expandDates(tc, { dayOfWeek: x.day, cycle, pattern: 'ALL' }).map((e) => e.index)] as const));
    const count = new Map([...indexes].map(([day, list]) => [day, list.length] as const));
    slotting.set(`${g.facultyId}|${g.studyMode}`, {
      blocks: [...g.blocks].sort((a, b) => a.order - b.order).map((b) => ({ order: b.order, start: toMinutes(b.startTime), end: toMinutes(b.endTime) })),
      days,
      count,
      indexes,
      cycle,
      maxLen: g.studyMode === 'FULL_TIME' ? 4 : 6,
    });
  }

  // Zajetosc: zasob|dzien -> [start, koniec, odNr, doNr, tryb, ...] (minuty, numery tygodni/zjazdow).
  // Ostroznie: rozne tryby (tydzien vs zjazd) maja inna numeracje — wtedy kazde nakladanie
  // godzin w tym samym dniu tygodnia to kolizja; w jednym trybie liczy sie tez zakres numerow.
  const busy = new Map<string, number[]>();
  const free = (key: string, s: number, e: number, from: number, to: number, mode: number) => {
    const a = busy.get(key);
    if (!a) return true;
    for (let i = 0; i < a.length; i += 5) {
      if (s < a[i + 1]! && a[i]! < e && (a[i + 4] !== mode || (from <= a[i + 3]! && a[i + 2]! <= to))) return false;
    }
    return true;
  };
  const take = (key: string, s: number, e: number, from: number, to: number, mode: number) => {
    const a = busy.get(key) ?? [];
    a.push(s, e, from, to, mode);
    busy.set(key, a);
  };
  // Grupy kolidujace: przodkowie + potomkowie (jak groupsOverlap).
  const related = new Map<string, string[]>();
  for (const cohort of new Map(sections.map((s) => [s.cohortId, s.cohort])).values()) {
    const parent = new Map(cohort.groups.map((g) => [g.id, g.parentGroupId]));
    const children = new Map<string, string[]>();
    for (const g of cohort.groups) if (g.parentGroupId) children.set(g.parentGroupId, [...(children.get(g.parentGroupId) ?? []), g.id]);
    for (const g of cohort.groups) {
      const out = [g.id];
      for (let p = parent.get(g.id); p; p = parent.get(p)) out.push(p);
      const stack = [...(children.get(g.id) ?? [])];
      while (stack.length) {
        const x = stack.pop()!;
        out.push(x);
        stack.push(...(children.get(x) ?? []));
      }
      related.set(g.id, out);
    }
  }
  const roomTypesFor = (s: (typeof sections)[number]): RoomType[] => {
    const name = s.programEntry.subject.name;
    const computer = /informat|program|komputer|cyfrow|sieci|baz danych|oprogramow|danych|aplikacj|algorytm|system/i.test(name);
    switch (s.classType as ClassType) {
      case 'LECTURE':
        return ['LECTURE'];
      case 'EXERCISE':
        return isWF(s) ? ['SPORTS'] : ['EXERCISE'];
      case 'LAB':
        return computer ? ['COMPUTER_LAB', 'LAB'] : ['LAB', 'COMPUTER_LAB'];
      case 'PROJECT':
        return computer ? ['COMPUTER_LAB', 'EXERCISE'] : ['EXERCISE', 'COMPUTER_LAB'];
      case 'SEMINAR':
        return ['SEMINAR', 'EXERCISE'];
    }
  };
  const sjoBuilding = new Set(rooms.filter((r) => r.facultyId === null && r.type === 'EXERCISE').map((r) => r.id));
  const roomsFor = (s: (typeof sections)[number]) => {
    const types = roomTypesFor(s);
    const size = s.group.size;
    return rooms
      .filter((r) => types.includes(r.type) && r.capacity >= size && (isLang(s) || !sjoBuilding.has(r.id)))
      .sort(
        (a, b) =>
          (isLang(s) ? (sjoBuilding.has(a.id) ? 0 : 1) - (sjoBuilding.has(b.id) ? 0 : 1) : 0) ||
          (a.facultyId === s.facultyId ? 0 : 1) - (b.facultyId === s.facultyId ? 0 : 1) ||
          types.indexOf(a.type) - types.indexOf(b.type) ||
          a.capacity - b.capacity,
      );
  };

  const placements: {
    sectionId: string;
    termId: string;
    facultyId: string;
    dayOfWeek: DayOfWeek;
    startOrder: number;
    endOrder: number;
    roomId: string;
    instructorId: string;
    cycle: 'WEEK' | 'ZJAZD';
    fromIndex: number | null;
    toIndex: number | null;
  }[] = [];
  const staffChanges = new Map<string, string>();
  let unplaced = 0;
  const unplacedSamples: string[] = [];
  const unplacedBy = new Map<string, number>();

  /** `single` — zajecia maja jedno umieszczenie (nie sa dzielone na kawalki). */
  const tryPlace = (s: (typeof sections)[number], hours: number, instructorId: string, rotate: number, sl: Slotting, single: boolean): boolean => {
    const roomList = roomsFor(s);
    const rel = related.get(s.groupId)!;
    const mode = sl.cycle === 'WEEK' ? 0 : 1;
    const minLen = Math.ceil(hours / Math.max(...[...sl.count.values()]));
    // Najpierw najkrotszy blok przez caly semestr; dluzszy blok = mniej tygodni/zjazdow (od poczatku).
    for (let len = Math.max(1, minLen); len <= sl.maxLen; len++) {
      for (let k = 0; k < sl.days.length; k++) {
        const day = sl.days[(k + rotate) % sl.days.length]!;
        const idx = sl.indexes.get(day.day) ?? [];
        const need = Math.ceil(hours / len);
        if (need > idx.length) continue;
        // Starty wyrownane do par (dla parzystej dlugosci) najpierw, potem pozostale.
        const starts = sl.blocks.map((_, i) => i).filter((i) => i + len <= sl.blocks.length);
        const orderedStarts = len % 2 === 0 ? [...starts.filter((i) => i % 2 === 0), ...starts.filter((i) => i % 2 === 1)] : starts;
        for (let w = 0; w + need <= idx.length; w++) {
          const from = idx[w]!;
          const to = idx[w + need - 1]!;
          for (const i of orderedStarts) {
            const startMin = sl.blocks[i]!.start;
            const endMin = sl.blocks[i + len - 1]!.end;
            if (startMin < day.from) continue;
            if (!rel.every((g) => free(`g:${g}|${day.day}`, startMin, endMin, from, to, mode))) continue;
            if (!free(`i:${instructorId}|${day.day}`, startMin, endMin, from, to, mode)) continue;
            const room = roomList.find((r) => free(`r:${r.id}|${day.day}`, startMin, endMin, from, to, mode));
            if (!room) continue;
            take(`g:${s.groupId}|${day.day}`, startMin, endMin, from, to, mode);
            take(`i:${instructorId}|${day.day}`, startMin, endMin, from, to, mode);
            take(`r:${room.id}|${day.day}`, startMin, endMin, from, to, mode);
            // Bez zakresu ("co tydzien"), gdy okno obejmuje caly semestr albo — w rytmie tygodniowym
            // (stacjonarne: ten sam plan w kazdym tygodniu) — zaczyna sie od pierwszego dnia zajec:
            // limit godzin konczy zajecia po `need` spotkaniach. Jawny zakres (np. "2..16") urywal
            // spotkanie po zmianie kalendarza (zamiany dni z kalendarza Rektora). Zakres zostaje dla
            // okna przesunietego, zjazdow i zajec w kilku umieszczeniach (limit liczy sie na zajecia).
            const full = w === 0 && (w + need === idx.length || (sl.cycle === 'WEEK' && single));
            placements.push({
              sectionId: s.id,
              termId: term.id,
              facultyId: s.facultyId,
              dayOfWeek: day.day,
              startOrder: sl.blocks[i]!.order,
              endOrder: sl.blocks[i + len - 1]!.order,
              roomId: room.id,
              instructorId,
              cycle: sl.cycle,
              fromIndex: full ? null : from,
              toIndex: full ? null : to,
            });
            return true;
          }
        }
      }
    }
    return false;
  };

  const ordered = [...sections].sort((a, b) => b.group.size - a.group.size || b.hours - a.hours || a.cohortId.localeCompare(b.cohortId));
  let idx = 0;
  for (const s of ordered) {
    idx++;
    const sl = slotting.get(`${s.facultyId}|${s.cohort.program.studyMode as StudyMode}`)!;
    const minDates = Math.min(...[...sl.count.values()].filter((n) => n > 0));
    const pieces = Math.max(1, Math.ceil(s.hours / (sl.maxLen * minDates)));
    let instructorId = staffOf.get(s.id)!;
    const rotate = idx % sl.days.length;
    let ok = true;
    for (let p = 0; p < pieces && ok; p++) {
      const h = p < pieces - 1 ? Math.ceil(s.hours / pieces) : s.hours - Math.ceil(s.hours / pieces) * (pieces - 1);
      if (tryPlace(s, h, instructorId, rotate + p, sl, pieces === 1)) continue;
      // Inny prowadzacy z tej samej puli (zmiana obsady), gdy przypisany nie ma wolnego terminu.
      const pool = pools.get(poolKey(s))!;
      const tried = new Set([instructorId]);
      let placed = false;
      for (let a = 0; a < 6 && !placed; a++) {
        const alt = choose(pool, s.programEntry.subjectId, s.hours, tried);
        tried.add(alt);
        if (tryPlace(s, h, alt, rotate + p, sl, pieces === 1)) {
          load.set(instructorId, load.get(instructorId)! - s.hours);
          assign(alt, s.programEntry.subjectId, s.hours);
          instructorId = alt;
          staffOf.set(s.id, alt);
          staffChanges.set(s.id, alt);
          placed = true;
        }
      }
      ok = placed;
    }
    if (!ok) {
      unplaced++;
      unplacedBy.set(s.cohort.program.code, (unplacedBy.get(s.cohort.program.code) ?? 0) + 1);
      if (unplacedSamples.length < 10) unplacedSamples.push(`${s.cohort.program.code} ${s.programEntry.subject.name} ${s.classType} ${s.hours}h gr.${s.group.size}`);
    }
  }
  log(`  umieszczen: ${placements.length}, zajec bez miejsca: ${unplaced}/${sections.length}`);
  for (const x of unplacedSamples) console.log(`    - ${x}`);
  if (unplacedBy.size) console.log(`    wg programu: ${[...unplacedBy].map(([k, v]) => `${k}:${v}`).join(', ')}`);

  await prisma.sectionInstructor.createMany({
    data: sections.map((s) => ({ sectionId: s.id, instructorId: staffOf.get(s.id)!, hours: s.hours })),
  });
  for (let i = 0; i < placements.length; i += 2000) {
    await prisma.placement.createMany({ data: placements.slice(i, i + 2000).map((p) => ({ ...p, pattern: 'ALL', numbers: [] })) });
  }

  // ── Uzytkownicy ──
  const hash = (plain: string) => bcrypt.hashSync(plain, 10);
  await prisma.user.create({ data: { email: 'admin@umg.edu.pl', password: hash('Admin1234!'), role: 'ADMIN', name: 'Administrator' } });
  for (const f of FACULTIES) {
    await prisma.user.create({
      data: {
        email: `dziekanat.${f.short.toLowerCase()}@umg.edu.pl`,
        password: hash('Dziekanat1234!'),
        role: 'DEAN_OFFICE',
        name: `Dziekanat ${f.short}`,
        facultyId: facultyId.get(f.short)!,
      },
    });
  }
  await prisma.user.create({
    data: { email: 'planista.wm@umg.edu.pl', password: hash('Planista1234!'), role: 'DEAN_OFFICE', name: 'Planista WM', facultyId: facultyId.get('WM')! },
  });
  const busiest = [...load.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  await prisma.user.create({
    data: { email: 'prowadzacy@umg.edu.pl', password: hash('Prowadzacy1234!'), role: 'INSTRUCTOR', name: 'Prowadzacy testowy', instructorId: busiest },
  });
  if (firstLabGroup) {
    await prisma.user.create({
      data: {
        email: 'student@umg.edu.pl',
        password: hash('Student1234!'),
        role: 'STUDENT',
        name: 'Student testowy',
        studentGroups: { connect: [{ id: firstLabGroup }] },
      },
    });
  }

  // ── Terminy: prawdziwe "Generuj terminy" per wydzial ──
  for (const f of FACULTIES) {
    const start = Date.now();
    const rep = await generate(term, { facultyId: facultyId.get(f.short)!, dryRun: false });
    log(
      `Generuj terminy ${f.short}: +${rep.added} (razem ${rep.total}), kolizji ${rep.conflicts.length}, ponad limit ${rep.beyondHours}, ` +
        `niedobory ${rep.shortfalls.length}, brak kalendarza ${rep.calendarsMissing.length} — ${((Date.now() - start) / 1000).toFixed(1)}s`,
    );
    for (const c of rep.conflicts.slice(0, 5)) console.log('    kolizja:', JSON.stringify(c));
  }

  const counts = {
    roczniki: await prisma.cohort.count(),
    grupy: await prisma.studentGroup.count(),
    przedmioty: await prisma.subject.count(),
    wpisyProgramu: await prisma.programEntry.count(),
    zajecia: await prisma.classSection.count(),
    prowadzacy: await prisma.instructor.count(),
    sale: await prisma.room.count(),
    umieszczenia: await prisma.placement.count(),
    terminy: await prisma.occurrence.count(),
  };
  log(`Gotowe: ${JSON.stringify(counts)}`);
  log(`Zmiany obsady przy ukladaniu: ${staffChanges.size}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
