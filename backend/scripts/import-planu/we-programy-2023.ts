/**
 * Roczniki 2023 WE (biezace semestry VII-VIII ze starszych siatek). Programy studiow Wydzialu Elektrycznego (plany studiow ze strony we.umg.edu.pl, siatki-skany
 * przepisane do dane/we/*.txt i sprawdzone sumami semestrow — parsery/we_trans.py --json
 * dane/we/programy.json). Decyzje uzytkownika (21-22.11.2026):
 *  - nowe wersje programu od naboru 2024/25 (I st. i N2) albo wg planu (EIT-S2, STI-S2, ET-N1 2025),
 *  - roczniki WE od naboru 2024/25 przepiete na nowe wersje; ich testowy plan, obsada i zajecia
 *    usuniete, grupy przebudowane wg specjalnosci programu (ROOT zostaje, liczebnosc dzielona),
 *  - stacjonarne II st. zaczynaja sie w semestrze letnim: roczniki 2025 i 2026 zimowe -> letnie,
 *  - stare wersje z seeda (etykieta "od naboru 2025/26") -> "testowa (seed)" (zostaja przy rocznikach 2023).
 * Zajecia nowych wersji tworzy potem zwykla synchronizacja (autoSyncCohorts).
 *
 *   npx tsx scripts/import-planu/we-programy.ts            # podglad (transakcja wycofana)
 *   npx tsx scripts/import-planu/we-programy.ts --apply    # zapis + synchronizacja zajec
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssessmentType, Prisma, SemesterType } from '@prisma/client';
import { prisma } from '../../src/lib/prisma';
import { autoSyncCohorts } from '../../src/services/autoPlan';

type Cell = { W?: number; C?: number; L?: number; P?: number; S?: number; e?: number; exam?: boolean };
interface Entry {
  nr: string;
  subject: string;
  spec: string | null;
  sems: Record<string, Cell>;
}
interface ProgramFile {
  file: string;
  program: string;
  version: string | null;
  entries: Entry[];
}

const apply = process.argv.includes('--apply');
const files: ProgramFile[] = JSON.parse(readFileSync(join(__dirname, 'dane/we/programy.json'), 'utf8'));
const fileOf = (name: string) => {
  const f = files.find((x) => x.file.endsWith(`/${name}`));
  if (!f) throw new Error(`Brak ${name} w programy.json`);
  return f;
};

/** Specjalnosci kierunkow: kod z siatki -> skrot w bazie i nazwa. */
const SPECS: Record<string, Record<string, { short: string; name: string }>> = {
  ET: {
    EO: { short: 'EAO', name: 'Elektroautomatyka Okrętowa' },
    EAO: { short: 'EAO', name: 'Elektroautomatyka Okrętowa' },
    ETO: { short: 'EAO', name: 'Elektroautomatyka Okrętowa' },
    AP: { short: 'AP', name: 'Automatyka Przemysłowa' },
    EA: { short: 'EA', name: 'Elektroautomatyka' },
    KSS: { short: 'KSS', name: 'Komputerowe Systemy Sterowania' },
    OZE: { short: 'OZE', name: 'Odnawialne Źródła Energii i Elektromobilność' },
  },
  EiT: {
    EP: { short: 'EP', name: 'Elektronika Programowalna' },
    EM: { short: 'EM', name: 'Elektronika Morska' },
    SiST: { short: 'SiST', name: 'Systemy i Sieci Teleinformatyczne' },
    SEM: { short: 'SEM', name: 'Systemy Elektroniki Morskiej' },
    SIST: { short: 'SiST', name: 'Systemy i Sieci Teleinformatyczne' },
    SE: { short: 'SE', name: 'Systemy Elektroniczne' },
    AiBS: { short: 'AiBSI', name: 'Administracja i Bezpieczeństwo Systemów Informatycznych' },
    EiAM: { short: 'EiAM', name: 'Elektronika i Automatyka Morska' },
  },
  INF: {
    AIR: { short: 'AIR', name: 'Aplikacje Internetu Rzeczy' },
    AIiM: { short: 'AIiM', name: 'Aplikacje Internetowe i Mobilne' },
  },
  STI: {
    APD: { short: 'APD', name: 'Analiza i Przetwarzanie Danych' },
    BTD: { short: 'BTD', name: 'Bezpieczeństwo Transmisji Danych' },
  },
};

interface Plan {
  program: string;
  field: keyof typeof SPECS;
  file: string;
  label: string;
  semesters: number;
  start: SemesterType;
  /** Roczniki (rok naboru zimowego w bazie); `toSummer` — przestawic na nabor letni tego roku. */
  cohorts: number[];
  toSummer?: boolean;
}

const PLANS: Plan[] = [
  { program: 'ET-S1', field: 'ET', file: 'EL-S1-2023.txt', label: 'od naboru 2023/24', semesters: 7, start: 'WINTER', cohorts: [2023] },
  { program: 'EIT-S1', field: 'EiT', file: 'EIT-S1-2023.txt', label: 'od naboru 2023/24', semesters: 7, start: 'WINTER', cohorts: [2023] },
  { program: 'INF-S1', field: 'INF', file: 'INF-S1-2023.txt', label: 'od naboru 2023/24', semesters: 7, start: 'WINTER', cohorts: [2023] },
  { program: 'ET-N1', field: 'ET', file: 'EL-N1-2022.txt', label: 'od naboru 2022/23', semesters: 8, start: 'WINTER', cohorts: [2023] },
  { program: 'EIT-N1', field: 'EiT', file: 'EIT-N1-2022.txt', label: 'od naboru 2022/23', semesters: 8, start: 'WINTER', cohorts: [2023] },
];

const LAB_SIZE = 15;

/** Godziny pozycji: seminaria w siatkach bywaja w kolumnie C albo L — u nas S; praktyki bez godzin. */
function hours(subject: string, c: Cell) {
  const h = { hoursLecture: c.W ?? 0, hoursExercise: c.C ?? 0, hoursLab: c.L ?? 0, hoursProject: c.P ?? 0, hoursSeminar: c.S ?? 0 };
  if (/^Praktyka/i.test(subject)) return { hoursLecture: 0, hoursExercise: 0, hoursLab: 0, hoursProject: 0, hoursSeminar: 0 };
  if (/^Seminarium/i.test(subject)) {
    const all = h.hoursLecture + h.hoursExercise + h.hoursLab + h.hoursProject + h.hoursSeminar;
    return { hoursLecture: 0, hoursExercise: 0, hoursLab: 0, hoursProject: 0, hoursSeminar: all };
  }
  return h;
}

/** n czesci liczby (pierwsze wieksze o 1). */
const split = (total: number, n: number) => Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0));

async function main() {
  const touched: string[] = [];
  await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      const subjects = new Map((await tx.subject.findMany()).map((s) => [s.name, s.id]));
      const subjectId = async (name: string) => {
        let id = subjects.get(name);
        if (!id) {
          id = (await tx.subject.create({ data: { name } })).id;
          subjects.set(name, id);
        }
        return id;
      };
      const terms = await tx.academicTerm.findMany();
      const termOf = (year: number, type: SemesterType) => {
        const t = terms.find((x) => x.startYear === year && x.type === type);
        if (!t) throw new Error(`Brak semestru ${year} ${type}`);
        return t;
      };


      for (const plan of PLANS) {
        const program = await tx.program.findUniqueOrThrow({ where: { code: plan.program }, include: { fieldOfStudy: true } });
        const data = fileOf(plan.file);

        // Specjalnosci (brakujace dodane, nazwy wg siatki).
        const specId = new Map<string, string>();
        for (const code of [...new Set(data.entries.flatMap((e) => (e.spec ? [e.spec] : [])))]) {
          const def = SPECS[plan.field]![code];
          if (!def) throw new Error(`${plan.program}: nieznana specjalnosc ${code}`);
          const existing = await tx.specialization.findFirst({ where: { fieldOfStudyId: program.fieldOfStudyId, shortName: def.short } });
          const spec = existing
            ? existing.name === def.name
              ? existing
              : await tx.specialization.update({ where: { id: existing.id }, data: { name: def.name } })
            : await tx.specialization.create({ data: { fieldOfStudyId: program.fieldOfStudyId, shortName: def.short, name: def.name } });
          if (!existing) console.log(`+ specjalnosc ${plan.field} ${def.short} — ${def.name}`);
          else if (existing.name !== def.name) console.log(`~ specjalnosc ${plan.field} ${def.short}: "${existing.name}" -> "${def.name}"`);
          specId.set(code, spec.id);
        }

        // Wersja programu z pozycjami.
        if (await tx.programVersion.findFirst({ where: { programId: program.id, label: plan.label } })) {
          throw new Error(`${plan.program}: wersja "${plan.label}" juz istnieje`);
        }
        const version = await tx.programVersion.create({
          data: { programId: program.id, label: plan.label, status: 'APPROVED', totalSemesters: plan.semesters, defaultStartType: plan.start },
        });
        const order = new Map<number, number>();
        let entries = 0;
        for (const e of data.entries) {
          for (const [semKey, cell] of Object.entries(e.sems)) {
            const semester = Number(semKey);
            if (semester > plan.semesters) throw new Error(`${plan.program}: ${e.subject} w semestrze ${semester}`);
            order.set(semester, (order.get(semester) ?? 0) + 1);
            await tx.programEntry.create({
              data: {
                versionId: version.id,
                subjectId: await subjectId(e.subject),
                semester,
                specializationId: e.spec ? specId.get(e.spec)! : null,
                orderInSemester: order.get(semester)!,
                ...hours(e.subject, cell),
                ects: Math.round(cell.e ?? 0),
                assessmentType: (cell.exam ? 'EXAM' : 'CREDIT') as AssessmentType,
              },
            });
            entries++;
          }
        }
        console.log(`+ ${plan.program} "${plan.label}": ${entries} pozycji, specjalnosci ${[...specId.keys()].join(', ')}`);

        // Roczniki: plan testowy precz, grupy wg specjalnosci, nowa wersja (i nabor letni dla II st. stac.).
        for (const year of plan.cohorts) {
          const cohort = await tx.cohort.findFirst({
            where: { programId: program.id, startTerm: { startYear: year, type: 'WINTER' } },
            include: { groups: true },
          });
          if (!cohort) throw new Error(`${plan.program}: brak rocznika ${year}`);
          const sections = (await tx.classSection.findMany({ where: { cohortId: cohort.id }, select: { id: true } })).map((s) => s.id);
          const occ = await tx.occurrence.deleteMany({ where: { sectionId: { in: sections } } });
          const pl = await tx.placement.deleteMany({ where: { sectionId: { in: sections } } });
          const sec = await tx.classSection.deleteMany({ where: { id: { in: sections } } });

          const root = cohort.groups.find((g) => g.partitionKey === 'ROOT');
          if (!root) throw new Error(`${plan.program} ${year}: rocznik bez grupy ROOT`);
          // Usuwanie od lisci (relacja rodzic-dziecko bez kaskady).
          let rest = cohort.groups.filter((g) => g.id !== root.id);
          while (rest.length > 0) {
            const leaves = rest.filter((g) => !rest.some((o) => o.parentGroupId === g.id));
            await tx.studentGroup.deleteMany({ where: { id: { in: leaves.map((g) => g.id) } } });
            rest = rest.filter((g) => !leaves.includes(g));
          }
          const codes = [...specId.keys()];
          const sizes = split(root.size, codes.length);
          for (const [i, code] of codes.entries()) {
            const short = SPECS[plan.field]![code]!.short;
            const spec = await tx.studentGroup.create({
              data: { cohortId: cohort.id, partitionKey: 'SPEC', code: short, specializationId: specId.get(code)!, size: sizes[i]!, parentGroupId: root.id },
            });
            const ex = await tx.studentGroup.create({
              data: { cohortId: cohort.id, partitionKey: 'C', code: 'A', specializationId: spec.specializationId, size: spec.size, parentGroupId: spec.id },
            });
            const labs = split(spec.size, Math.max(1, Math.ceil(spec.size / LAB_SIZE)));
            for (const [j, size] of labs.entries()) {
              await tx.studentGroup.create({
                data: { cohortId: cohort.id, partitionKey: 'L', code: `A${j + 1}`, specializationId: spec.specializationId, size, parentGroupId: ex.id },
              });
            }
          }
          await tx.cohort.update({
            where: { id: cohort.id },
            data: { programVersionId: version.id, ...(plan.toSummer ? { startTermId: termOf(year, 'SUMMER').id } : {}) },
          });
          touched.push(cohort.id);
          console.log(
            `  rocznik ${year}${plan.toSummer ? ' -> nabor letni' : ''}: usuniete zajecia ${sec.count} (umieszczenia ${pl.count}, terminy ${occ.count}), grupy ${codes.map((c) => SPECS[plan.field]![c]!.short).join('/')} z ${root.size} os.`,
          );
        }
      }
      if (!apply) throw new Error('PODGLAD — nic nie zapisano (uruchom z --apply)');
    },
    { timeout: 300_000, maxWait: 30_000 },
  );

  const sync = await autoSyncCohorts(touched);
  console.log('Synchronizacja zajec:', JSON.stringify(sync));
}

main()
  .catch((e: Error) => {
    console.log(e.message);
    if (!e.message.startsWith('PODGLAD')) process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
