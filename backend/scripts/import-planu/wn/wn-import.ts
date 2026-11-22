/**
 * Import Wydzialu Nawigacyjnego: programy z siatek (dane/wn/programy.json), plan zima 2026/27
 * (dane/wn/plan.json z arktur.umg.edu.pl) i prowadzacy z bazy kontaktow UMG (dane/wn/prowadzacy.json).
 *
 * Kroki (jedna transakcja): wersje programow; roczniki WN przepiete na nowe wersje, ich zajecia/plan/
 * obsada z seeda usuniete; grupy przebudowane (ROOT zostaje, specjalnosci z planu, ponizej grupy z kolumn
 * arkusza: pary kolumn -> C, pojedyncze -> L); siatka niestacjonarna WN (czwartek, blok 20:10) i zjazdy
 * tygodniowe czw-nd wg dat planu; sale i prowadzacy (upsert po e-mailu); zajecia i umieszczenia.
 * Po transakcji: synchronizacja zajec (additive) i generowanie terminow WN w zimie 2026/27.
 *
 *   npx tsx scripts/import-planu/wn/wn-import.ts            # podglad
 *   npx tsx scripts/import-planu/wn/wn-import.ts --apply
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClassType, DayOfWeek, Prisma, SemesterType } from '@prisma/client';
import { prisma } from '../../../src/lib/prisma';
import { autoSyncCohorts } from '../../../src/services/autoPlan';
import { generate } from '../../../src/services/plan';
import { TeachingCalendar } from '../../../src/lib/teachingCalendar';
import { toCalendarInput, calendarInclude } from '../../../src/services/termCalendars';
import { toIsoDate } from '../../../src/lib/isoDate';

type Cell = { W?: number; C?: number; L?: number; S?: number; e?: number };
interface Version {
  program: string;
  label: string;
  semesters: number;
  start: SemesterType;
  specs: string[];
  cohorts: [number, 'W' | 'S'][];
  entries: { subject: string; spec: string | null; sem: number; cell: Cell }[];
}
interface Person { last: string; first: string; title?: string }
interface Rec {
  mode: 'FULL_TIME' | 'PART_TIME';
  program: string;
  year: number;
  type: 'W' | 'S';
  sem: number;
  spec: string | null;
  source: string;
  raw: string;
  subject: string;
  form: ClassType;
  groups: string[];
  allGroups: string[];
  day?: DayOfWeek;
  date?: string;
  start: number;
  end: number;
  room: string | null;
  person: Person | null;
  from?: string | null;
  weeks?: number | null;
  half?: 1 | 2 | null;
  parity?: boolean;
  online?: boolean;
}
interface Staff { lastName: string; firstName: string; title: string | null; email: string | null; unit: string[] }

const apply = process.argv.includes('--apply');
const dir = join(__dirname, '../dane/wn');
const versions: Version[] = JSON.parse(readFileSync(join(dir, 'programy.json'), 'utf8'));
const recs: Rec[] = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'));
const staff: Record<string, Staff> = JSON.parse(readFileSync(join(dir, 'prowadzacy.json'), 'utf8'));

const SPEC_NAMES: Record<string, string> = {
  TiL: 'Transport i Logistyka', EST: 'Eksploatacja Systemów Transportowych', MSTiL: 'Morskie Systemy Transportowe i Logistyczne',
  LSO: 'Logistyka w Sektorze Offshore', ESTiL: 'Eksploatacja Systemów Transportowych i Logistycznych',
  'ZIiŚTŚ': 'Zarządzanie Infrastrukturą i Środkami Transportu Śródlądowego', TO: 'Technologie Offshorowe', EZ: 'Eksploatacja Zbiornikowców',
  MSI: 'Morskie Systemy Informacyjne', ZBTM: 'Zarządzanie Bezpieczeństwem w Transporcie Morskim', APSE: 'Administrowanie Polską Strefą Ekonomiczną',
  PHiON: 'Pomiary Hydrograficzne i Oznakowanie Nawigacyjne', 'ŻA': 'Żegluga Arktyczna',
};
const FIELD_OF: Record<string, string> = { NAW: 'NAW', TR: 'TR' };
const hoursOf = (c: Cell, t: ClassType) => ({ LECTURE: c.W, EXERCISE: c.C, LAB: c.L, SEMINAR: c.S, PROJECT: 0 })[t] ?? 0;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const DOW: DayOfWeek[] = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const dowOf = (d: string) => DOW[new Date(`${d}T12:00:00Z`).getUTCDay()]!;
const groupCode = (col: string) => col.replace(/^GR\./, '');

async function main() {
  const counts: Record<string, number> = {};
  const inc = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
  const touched: string[] = [];
  const warnings: string[] = [];

  await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const wn = await tx.faculty.findUniqueOrThrow({ where: { shortName: 'WN' } });
      const term = await tx.academicTerm.findFirstOrThrow({ where: { startYear: 2026, type: 'WINTER' } });
      const terms = await tx.academicTerm.findMany();
      const termOf = (y: number, t: 'W' | 'S') => terms.find((x) => x.startYear === y && x.type === (t === 'W' ? 'WINTER' : 'SUMMER'))!;

      // ── Siatki WN: niestacjonarna z czwartkiem od 16:00 i blokiem 20:10-20:55 ─────────────
      const grids = await tx.timeGrid.findMany({ where: { facultyId: wn.id }, include: { blocks: true } });
      const ft = grids.find((g) => g.studyMode === 'FULL_TIME' && g.base)!;
      const pt = grids.find((g) => g.studyMode === 'PART_TIME' && g.base)!;
      const ptDays = pt.days as { day: string; from: string | null; to: string | null }[];
      if (!ptDays.some((d) => d.day === 'THURSDAY')) {
        await tx.timeGrid.update({ where: { id: pt.id }, data: { days: [{ day: 'THURSDAY', from: '16:00', to: null }, ...ptDays] } });
        inc('siatka ns: czwartek');
      }
      if (!pt.blocks.some((b) => b.startTime === '20:10')) {
        const order = Math.max(...pt.blocks.map((b) => b.order)) + 1;
        const blk = await tx.timeBlock.create({ data: { gridId: pt.id, order, startTime: '20:10', endTime: '20:55', label: '20:10-20:55' } });
        pt.blocks.push(blk);
        inc('siatka ns: blok 20:10');
      }
      const blocksOf = (g: typeof ft) => [...g.blocks].sort((a, b) => a.order - b.order).map((b) => ({ order: b.order, s: toMin(b.startTime), e: toMin(b.endTime) }));
      const ftBlocks = blocksOf(ft);
      const ptBlocks = blocksOf(pt);
      /** Bloki siatki dla przedzialu minut: start = blok o najwiekszym pokryciu poczatku, liczba = round(min/45). */
      const snap = (blocks: { order: number; s: number; e: number }[], start: number, end: number) => {
        const n = Math.max(1, Math.round((end - start) / 45));
        let best = 0;
        let bestScore = -Infinity;
        for (let i = 0; i + n <= blocks.length; i++) {
          const span = blocks.slice(i, i + n);
          const ov = span.reduce((acc, b) => acc + Math.max(0, Math.min(b.e, end) - Math.max(b.s, start)), 0);
          const score = ov - Math.abs(span[0]!.s - start) * 0.01;
          if (score > bestScore) {
            bestScore = score;
            best = i;
          }
        }
        return { startOrder: blocks[best]!.order, endOrder: blocks[Math.min(best + n, blocks.length) - 1]!.order };
      };

      // ── Kalendarz niestacjonarny WN: zjazdy tygodniowe czw-nd wg dat planu ───────────────
      const ptCal = await tx.termCalendar.findFirstOrThrow({ where: { termId: term.id, facultyId: wn.id, studyMode: 'PART_TIME' }, include: calendarInclude });
      const ptDates = [...new Set(recs.filter((r) => r.mode === 'PART_TIME').map((r) => r.date!))].sort();
      const thursdayOf = (d: string) => {
        const dt = new Date(`${d}T12:00:00Z`);
        const back = (dt.getUTCDay() + 7 - 4) % 7;
        dt.setUTCDate(dt.getUTCDate() - back);
        return dt.toISOString().slice(0, 10);
      };
      const weeks = [...new Set(ptDates.map(thursdayOf))].sort();
      await tx.zjazd.deleteMany({ where: { calendarId: ptCal.id } });
      for (const [i, thu] of weeks.entries()) {
        const sun = new Date(`${thu}T12:00:00Z`);
        sun.setUTCDate(sun.getUTCDate() + 3);
        await tx.zjazd.create({ data: { calendarId: ptCal.id, number: i + 1, startDate: new Date(`${thu}T00:00:00Z`), endDate: new Date(`${sun.toISOString().slice(0, 10)}T00:00:00Z`) } });
      }
      const lastDay = weeks.length ? new Date(`${weeks[weeks.length - 1]}T12:00:00Z`) : null;
      if (lastDay) {
        lastDay.setUTCDate(lastDay.getUTCDate() + 3);
        const end = lastDay.toISOString().slice(0, 10);
        if (end > toIsoDate(ptCal.endDate)) await tx.termCalendar.update({ where: { id: ptCal.id }, data: { endDate: new Date(`${end}T00:00:00Z`) } });
        if (thursdayOf(ptDates[0]!) < toIsoDate(ptCal.startDate)) await tx.termCalendar.update({ where: { id: ptCal.id }, data: { startDate: new Date(`${thursdayOf(ptDates[0]!)}T00:00:00Z`) } });
      }
      inc('zjazdy ns', weeks.length);
      const zjazdOf = new Map<string, number>();
      for (const d of ptDates) zjazdOf.set(d, weeks.indexOf(thursdayOf(d)) + 1);
      const ftCalRow = await tx.termCalendar.findFirstOrThrow({ where: { termId: term.id, facultyId: wn.id, studyMode: 'FULL_TIME' }, include: calendarInclude });
      const ftCal = new TeachingCalendar(toCalendarInput(ftCalRow));

      // ── Wersje programow ─────────────────────────────────────────────────────────────────
      const subjects = new Map((await tx.subject.findMany()).map((s) => [s.name, s.id]));
      const subjectId = async (name: string) => {
        let id = subjects.get(name);
        if (!id) {
          id = (await tx.subject.create({ data: { name } })).id;
          subjects.set(name, id);
          inc('nowe przedmioty');
        }
        return id;
      };
      const renamed = await tx.programVersion.updateMany({
        where: { label: 'od naboru 2025/26', program: { code: { in: [...new Set(versions.map((v) => v.program))] } } },
        data: { label: 'testowa (seed)' },
      });
      inc('wersje seed przemianowane', renamed.count);

      const entryIndex = new Map<string, { id: string; cell: Cell }>(); // program|label|sem|spec|subject
      const versionOfCohort = new Map<string, { id: string; v: Version; specIds: Map<string, string> }>();
      for (const v of versions) {
        const program = await tx.program.findUniqueOrThrow({ where: { code: v.program } });
        const specIds = new Map<string, string>();
        for (const code of v.specs) {
          let sp = await tx.specialization.findFirst({ where: { fieldOfStudyId: program.fieldOfStudyId, shortName: code } });
          if (!sp) {
            sp = await tx.specialization.create({ data: { fieldOfStudyId: program.fieldOfStudyId, shortName: code, name: SPEC_NAMES[code] ?? code } });
            inc('nowe specjalnosci');
          }
          specIds.set(code, sp.id);
        }
        const version = await tx.programVersion.create({
          data: { programId: program.id, label: v.label, status: 'APPROVED', totalSemesters: v.semesters, defaultStartType: v.start },
        });
        inc('wersje programow');
        const order = new Map<number, number>();
        for (const e of v.entries) {
          order.set(e.sem, (order.get(e.sem) ?? 0) + 1);
          const pe = await tx.programEntry.create({
            data: {
              versionId: version.id,
              subjectId: await subjectId(e.subject),
              semester: e.sem,
              specializationId: e.spec ? specIds.get(e.spec)! : null,
              orderInSemester: order.get(e.sem)!,
              hoursLecture: e.cell.W ?? 0,
              hoursExercise: e.cell.C ?? 0,
              hoursLab: e.cell.L ?? 0,
              hoursSeminar: e.cell.S ?? 0,
              ects: Math.round(e.cell.e ?? 0),
            },
          });
          entryIndex.set(`${v.program}|${v.label}|${e.sem}|${e.spec ?? ''}|${e.subject}`, { id: pe.id, cell: e.cell });
          inc('pozycje programow');
        }
        for (const [y, t] of v.cohorts) versionOfCohort.set(`${v.program}|${y}${t}`, { id: version.id, v, specIds });
      }

      // ── Roczniki: plan seed precz, nowa wersja, grupy ──────────────────────────────────
      const cohortRow = new Map<string, { id: string; rootId: string }>();
      const groupByCols = new Map<string, Map<string, string>>(); // cohortKey -> "GR.01,GR.02" -> groupId
      for (const [key, ver] of versionOfCohort) {
        const [prog, yt] = key.split('|');
        const y = Number(yt!.slice(0, 4));
        const t = yt!.slice(4) as 'W' | 'S';
        const program = await tx.program.findUniqueOrThrow({ where: { code: prog! } });
        const cohort = await tx.cohort.findFirst({ where: { programId: program.id, startTermId: termOf(y, t).id }, include: { groups: true } });
        if (!cohort) {
          warnings.push(`brak rocznika ${key}`);
          continue;
        }
        const sections = (await tx.classSection.findMany({ where: { cohortId: cohort.id }, select: { id: true } })).map((s) => s.id);
        inc('usuniete terminy', (await tx.occurrence.deleteMany({ where: { sectionId: { in: sections } } })).count);
        inc('usuniete umieszczenia', (await tx.placement.deleteMany({ where: { sectionId: { in: sections } } })).count);
        inc('usuniete zajecia', (await tx.classSection.deleteMany({ where: { id: { in: sections } } })).count);
        const root = cohort.groups.find((g) => g.partitionKey === 'ROOT')!;
        // czlonkowie usuwanych grup -> ROOT
        const others = cohort.groups.filter((g) => g.id !== root.id).map((g) => g.id);
        if (others.length) {
          await tx.$executeRawUnsafe(
            `insert into "_StudentGroupMembers" ("A","B") select $1, "B" from "_StudentGroupMembers" where "A" = any($2::text[]) on conflict do nothing`,
            root.id,
            others,
          );
          await tx.$executeRawUnsafe(`delete from "_StudentGroupMembers" where "A" = any($1::text[])`, others);
        }
        let rest = cohort.groups.filter((g) => g.id !== root.id);
        while (rest.length) {
          const leaves = rest.filter((g) => !rest.some((o) => o.parentGroupId === g.id));
          await tx.studentGroup.deleteMany({ where: { id: { in: leaves.map((g) => g.id) } } });
          rest = rest.filter((g) => !leaves.includes(g));
        }
        await tx.cohort.update({ where: { id: cohort.id }, data: { programVersionId: ver.id } });
        touched.push(cohort.id);
        cohortRow.set(key, { id: cohort.id, rootId: root.id });

        // specjalnosci: z planu rocznika, a bez planu — wszystkie z wersji
        const mine = recs.filter((r) => `${r.program}|${r.year}${r.type}` === key);
        const specCodes = mine.length ? [...new Set(mine.map((r) => r.spec).filter((s): s is string => !!s))] : ver.v.specs;
        const lectureNode = new Map<string, { id: string; size: number }>();
        const per = Math.max(1, Math.floor(root.size / Math.max(1, specCodes.length)));
        for (const code of specCodes) {
          const g = await tx.studentGroup.create({
            data: { cohortId: cohort.id, partitionKey: 'SPEC', code, specializationId: ver.specIds.get(code)!, size: specCodes.length === 1 ? root.size : per, parentGroupId: root.id },
          });
          lectureNode.set(code, { id: g.id, size: g.size });
          inc('grupy');
        }
        if (!mine.length) continue;
        const node = specCodes.length ? lectureNode.get(specCodes[0]!)! : { id: root.id, size: root.size };
        const specId = specCodes.length ? ver.specIds.get(specCodes[0]!)! : null;
        const cols = [...new Set(mine.flatMap((r) => r.allGroups))].sort();
        const map = new Map<string, string>();
        map.set(cols.join(','), node.id);
        // przedzialy kolumn uzyte w planie (bez calego rocznika), od najszerszych; zostaja tylko nieprzecinajace sie
        const spans = [...new Set(mine.map((r) => r.groups.slice().sort().join(',')).filter((s) => s && s !== cols.join(',')))]
          .map((s) => s.split(','))
          .filter((s) => s.length > 1)
          .sort((a, b) => b.length - a.length);
        const kept: string[][] = [];
        for (const s of spans) {
          const crosses = kept.some((k) => k.some((c) => s.includes(c)) && !s.every((c) => k.includes(c)) && !k.every((c) => s.includes(c)));
          if (!crosses && !kept.some((k) => k.join(',') === s.join(','))) kept.push(s);
        }
        const size = (n: number) => Math.max(1, Math.round((node.size * n) / cols.length));
        const created = new Map<string, string>(); // span -> id
        const parentOf = (s: string[]) => {
          const cands = kept.filter((k) => k.length > s.length && s.every((c) => k.includes(c))).sort((a, b) => a.length - b.length);
          return cands.length ? created.get(cands[0]!.join(','))! : node.id;
        };
        for (const s of kept) {
          const g = await tx.studentGroup.create({
            data: { cohortId: cohort.id, partitionKey: 'C', code: `${groupCode(s[0]!)}-${groupCode(s[s.length - 1]!)}`, specializationId: specId, size: size(s.length), parentGroupId: parentOf(s) },
          });
          created.set(s.join(','), g.id);
          map.set(s.join(','), g.id);
          inc('grupy');
        }
        for (const c of cols) {
          const g = await tx.studentGroup.create({
            data: { cohortId: cohort.id, partitionKey: cols.length > 1 ? 'L' : 'C', code: groupCode(c), specializationId: specId, size: size(1), parentGroupId: parentOf([c]) },
          });
          map.set(c, g.id);
          inc('grupy');
        }
        groupByCols.set(key, map);
      }

      // ── Sale ────────────────────────────────────────────────────────────────────────────
      const buildingFor = async (room: string) => {
        let name: string;
        let address: string | null = null;
        let faculty: string | null = null;
        if (/^(lab |MW$)/i.test(room)) {
          name = 'SDM2 (Sędzickiego 19)';
          address = 'ul. Sędzickiego 19, Gdynia';
        } else if (/^[ABCFHI]\d/.test(room) || room === 'Aula (Morska)') {
          name = `Budynek ${room === 'Aula (Morska)' ? 'A' : room[0]}`;
        } else {
          name = 'Budynek WN (Al. Jana Pawła II 3)';
          address = 'Al. Jana Pawła II 3, Gdynia';
          faculty = wn.id;
        }
        const b = await tx.building.findUnique({ where: { name } });
        return b ?? (await tx.building.create({ data: { name, address, facultyId: faculty } }));
      };
      const roomIds = new Map<string, string>();
      const roomId = async (room: string | null) => {
        if (!room) return null;
        const hit = roomIds.get(room);
        if (hit) return hit;
        const b = await buildingFor(room);
        let r = await tx.room.findFirst({ where: { buildingId: b.id, number: room } });
        if (!r) {
          const type = /aula/i.test(room) ? 'LECTURE' : /basen/i.test(room) ? 'SPORTS' : /^lab/i.test(room) ? 'LAB' : 'EXERCISE';
          r = await tx.room.create({ data: { buildingId: b.id, number: room, type, capacity: /aula/i.test(room) ? 200 : 30 } });
          inc('nowe sale');
        }
        roomIds.set(room, r.id);
        return r.id;
      };

      // ── Prowadzacy ──────────────────────────────────────────────────────────────────────
      const departments = await tx.department.findMany({ include: { faculty: true } });
      const faculties = await tx.faculty.findMany();
      const personIds = new Map<string, string>();
      const personId = async (p: Person | null) => {
        if (!p) return null;
        const key = `${p.last}|${p.first}`;
        if (personIds.has(key)) return personIds.get(key)!;
        const s = staff[key];
        if (!s) return null;
        const unitName = s.unit[1] ?? null;
        const facName = s.unit[0] ?? null;
        const fac = faculties.find((f) => f.name.toLowerCase() === (facName ?? '').toLowerCase());
        let dept: { id: string; facultyId: string | null } | undefined = unitName ? departments.find((d) => d.name.toLowerCase() === unitName.replace(/\s+/g, ' ').toLowerCase() && (!fac || d.facultyId === fac.id)) : undefined;
        if (!dept && unitName && fac?.id === wn.id && /^(Katedra|Zakład|Centrum)/.test(unitName)) {
          const short = unitName.replace(/\s+/g, ' ').split(/[\s-]+/).filter((w) => w && w[0] === w[0]!.toUpperCase()).map((w) => w[0]).join('');
          const ex = await tx.department.findFirst({ where: { facultyId: wn.id, shortName: short } });
          const d2 = ex ?? (await tx.department.create({ data: { facultyId: wn.id, shortName: short, name: unitName.replace(/\s+/g, ' ') } }));
          if (!ex) inc('nowe katedry WN');
          departments.push({ ...d2, faculty: wn });
          dept = d2;
        }
        let inst = s.email ? await tx.instructor.findUnique({ where: { email: s.email } }) : null;
        if (!inst) inst = await tx.instructor.findFirst({ where: { lastName: s.lastName, firstName: s.firstName, NOT: { email: { endsWith: '@planista.test' } } } });
        if (inst) {
          if (!inst.firstName || !inst.title) await tx.instructor.update({ where: { id: inst.id }, data: { firstName: inst.firstName || s.firstName, title: inst.title || s.title } });
          inc('prowadzacy istniejacy');
        } else {
          const email = s.email ?? `${s.lastName}.${s.firstName}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z.\-]/g, '') + '@plan-wn.invalid';
          inst = await tx.instructor.upsert({
            where: { email },
            update: {},
            create: { email, firstName: s.firstName, lastName: s.lastName, title: s.title, departmentId: dept?.id ?? null, facultyId: dept ? dept.facultyId : (fac?.id ?? null) },
          });
          inc(s.email ? 'prowadzacy nowi (UMG)' : 'prowadzacy nowi (bez UMG)');
        }
        personIds.set(key, inst.id);
        return inst.id;
      };

      // ── Zajecia i umieszczenia ──────────────────────────────────────────────────────────
      const sectionIds = new Map<string, { id: string; hours: number }>();
      const sectionFor = async (cohortId: string, entryId: string, type: ClassType, groupId: string, hours: number) => {
        const k = `${entryId}|${type}|${groupId}`;
        let s = sectionIds.get(k);
        if (!s) {
          const row = await tx.classSection.create({ data: { termId: term.id, cohortId, programEntryId: entryId, classType: type, groupId, hours: Math.max(1, hours), facultyId: wn.id } });
          s = { id: row.id, hours: row.hours };
          sectionIds.set(k, s);
          inc('zajecia');
        }
        return s;
      };
      const staffed = new Set<string>();
      // niestacjonarne: rekordy roznych dat skladamy w jedno umieszczenie z lista zjazdow
      const nsGroups = new Map<string, { rec: Rec; zjazdy: Set<number> }>();
      let skipped = 0;
      for (const r of recs) {
        const key = `${r.program}|${r.year}${r.type}`;
        const ver = versionOfCohort.get(key);
        const coh = cohortRow.get(key);
        const map = groupByCols.get(key);
        if (!ver || !coh || !map) {
          skipped++;
          continue;
        }
        const entry =
          entryIndex.get(`${r.program}|${ver.v.label}|${r.sem}|${r.spec ?? ''}|${r.subject}`) ?? entryIndex.get(`${r.program}|${ver.v.label}|${r.sem}||${r.subject}`);
        if (!entry) {
          warnings.push(`brak pozycji programu: ${key} s${r.sem} ${r.subject}`);
          skipped++;
          continue;
        }
        if (r.mode === 'PART_TIME') {
          const k = [key, r.subject, r.form, r.groups.join(','), dowOf(r.date!), r.start, r.end, r.room ?? '', r.person ? `${r.person.last}|${r.person.first}` : ''].join('#');
          const g = nsGroups.get(k) ?? { rec: r, zjazdy: new Set<number>() };
          g.zjazdy.add(zjazdOf.get(r.date!)!);
          nsGroups.set(k, g);
          continue;
        }
        await place(r, entry, coh.id, map, { cycle: 'WEEK' });
      }
      for (const { rec, zjazdy } of nsGroups.values()) {
        const key = `${rec.program}|${rec.year}${rec.type}`;
        const ver = versionOfCohort.get(key)!;
        const entry =
          entryIndex.get(`${rec.program}|${ver.v.label}|${rec.sem}|${rec.spec ?? ''}|${rec.subject}`) ?? entryIndex.get(`${rec.program}|${ver.v.label}|${rec.sem}||${rec.subject}`)!;
        await place(rec, entry, cohortRow.get(key)!.id, groupByCols.get(key)!, { cycle: 'ZJAZD', numbers: [...zjazdy].sort((a, b) => a - b) });
      }
      inc('pominiete rekordy', skipped);

      async function place(r: Rec, entry: { id: string; cell: Cell }, cohortId: string, map: Map<string, string>, rhythm: { cycle: 'WEEK' | 'ZJAZD'; numbers?: number[] }) {
        const span = r.groups.slice().sort().join(',');
        let groupId = map.get(span);
        if (!groupId) {
          // przedzial nieobecny w drzewie (przecina inne) — najmniejsza grupa zawierajaca
          const cands = [...map.entries()].filter(([k]) => r.groups.every((g) => k.split(',').includes(g))).sort((a, b) => a[0].split(',').length - b[0].split(',').length);
          groupId = cands[0]?.[1];
          if (!groupId) return;
          inc('grupa zastepcza (przedzial przecina drzewo)');
        }
        const hours = hoursOf(entry.cell, r.form) || entry.cell.W || entry.cell.C || entry.cell.L || entry.cell.S || 15;
        const section = await sectionFor(cohortId, entry.id, r.form, groupId, hours);
        const blocks = snap(r.mode === 'FULL_TIME' ? ftBlocks : ptBlocks, r.start, r.end);
        const instructorId = await personId(r.person);
        const room = r.online ? null : await roomId(r.room);
        let pattern: 'ALL' | 'EVEN' | 'ODD' | 'LIST' = 'ALL';
        let fromIndex: number | null = null;
        let toIndex: number | null = null;
        let numbers: number[] = [];
        if (rhythm.cycle === 'ZJAZD') {
          pattern = 'LIST';
          numbers = rhythm.numbers!;
        } else {
          const w0 = r.from ? ftCal.weekIndexOf(r.from) : null;
          if (r.parity && w0) pattern = w0 % 2 === 1 ? 'ODD' : 'EVEN';
          if (r.half === 1) toIndex = 8;
          if (r.half === 2) fromIndex = 8;
          if (w0 && w0 > 1) fromIndex = Math.max(fromIndex ?? 0, w0);
          if (r.weeks && (w0 ?? fromIndex)) toIndex = (w0 ?? fromIndex!) + (r.parity ? 2 : 1) * (r.weeks - 1);
        }
        await tx.placement.create({
          data: {
            sectionId: section.id, termId: term.id, facultyId: wn.id, dayOfWeek: r.mode === 'FULL_TIME' ? r.day! : dowOf(r.date!),
            ...blocks, roomId: room, instructorId, cycle: rhythm.cycle, pattern, numbers, fromIndex, toIndex,
          },
        });
        inc(r.mode === 'FULL_TIME' ? 'umieszczenia stac.' : 'umieszczenia niestac.');
        if (instructorId && !staffed.has(`${section.id}|${instructorId}`)) {
          staffed.add(`${section.id}|${instructorId}`);
          await tx.sectionInstructor.create({ data: { sectionId: section.id, instructorId, hours: section.hours } });
          inc('obsada');
        }
      }

      // ── Fikcyjni prowadzacy WN z seeda bez zajec ────────────────────────────────────────
      const seed = await tx.instructor.findMany({ where: { facultyId: wn.id, email: { endsWith: '@planista.test' } }, select: { id: true } });
      let removed = 0;
      for (const s of seed) {
        const used =
          (await tx.placement.count({ where: { instructorId: s.id } })) +
          (await tx.sectionInstructor.count({ where: { instructorId: s.id } })) +
          (await tx.occurrence.count({ where: { instructorId: s.id } })) +
          (await tx.placementException.count({ where: { newInstructorId: s.id } })) +
          (await tx.externalBusy.count({ where: { instructorId: s.id } })) +
          (await tx.user.count({ where: { instructorId: s.id } }));
        if (!used) {
          await tx.instructor.delete({ where: { id: s.id } });
          removed++;
        }
      }
      inc('usunieci prowadzacy seed WN', removed);
      console.log(JSON.stringify(counts, null, 1));
      for (const w of [...new Set(warnings)].slice(0, 60)) console.log('UWAGA', w);
      if (!apply) throw new Error('PODGLAD — nic nie zapisano (uruchom z --apply)');
    },
    { timeout: 600_000, maxWait: 30_000 },
  );

  const sync = await autoSyncCohorts(touched);
  console.log('Synchronizacja zajec:', JSON.stringify(sync));
  const term = await prisma.academicTerm.findFirstOrThrow({ where: { startYear: 2026, type: 'WINTER' } });
  const wn = await prisma.faculty.findUniqueOrThrow({ where: { shortName: 'WN' } });
  const gen = await generate(term, { facultyId: wn.id, dryRun: false });
  console.log('Terminy:', JSON.stringify(gen).slice(0, 400));
}

main()
  .catch((e: Error) => {
    console.log(e.message);
    if (!e.message.startsWith('PODGLAD')) {
      console.log(e.stack);
      process.exitCode = 1;
    }
  })
  .finally(() => prisma.$disconnect());
