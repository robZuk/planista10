import type { Request } from 'express';
import { prisma } from '../lib/prisma';
import { plural } from '../lib/plural';
import { CLASS_LABEL_PL } from '../lib/scheduleTime';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import { assertFacultyScope, getCallerScope } from '../lib/facultyScope';
import { parseTermKey } from '../lib/terms';
import { activeCohorts, carryInstructors, syncSections } from '../services/sections';
import { replaceStaff, setPersonStaff } from '../services/staffing';
import { staffProblem } from '../lib/staffing';
import { aggregateWorkload } from '../lib/workload';
import { departmentLabel } from '../lib/department';
import { cohortLabel } from '../services/cohorts';
import { archivedCohortIds } from '../services/cohortCalendar';
import { assertCohortTermWritable, refreshPlanningTerms, termsNote } from '../services/plan';
import { changePlanStaff, staffMismatches, type StaffChange } from '../services/planStaff';

/**
 * Zajecia semestru i obsada. Dziekanat dziala na swoim wydziale, admin na wybranym
 * (albo calej uczelni). Obsada to osobny etap przed ukladaniem planu: kto prowadzi
 * ile godzin danych zajec; brak prowadzacego = NN.
 */

async function findTerm(key: string) {
  const ref = parseTermKey(key);
  if (!ref) throw new AppError(400, 'Nieprawidlowy klucz semestru');
  const term = await prisma.academicTerm.findUnique({ where: { startYear_type: ref } });
  if (!term) throw new AppError(404, 'Semestr nie istnieje');
  return term;
}

/** Wydzial, na ktorym dziala zadanie: dziekanat — wlasny, admin — z parametru (null = wszystkie). */
async function facultyOf(req: Request): Promise<string | null> {
  const scope = await getCallerScope(req);
  const requested =
    (typeof req.query.facultyId === 'string' ? req.query.facultyId : null) ??
    (typeof req.body?.facultyId === 'string' ? req.body.facultyId : null);
  if (scope.isAdmin) return requested && requested !== 'all' ? requested : null;
  if (!scope.facultyId) throw new AppError(403, 'Konto bez przypisanego wydzialu');
  return scope.facultyId;
}

function instructorName(i: { title: string | null; firstName: string; lastName: string } | null): string {
  return i ? `${i.title ?? ''} ${i.firstName} ${i.lastName}`.trim() : 'NN';
}

function departmentOf(
  rows: { classType: string; department: { id: string; name: string; shortName: string; faculty: { shortName: string } | null } }[],
  classType: string,
) {
  const d = rows.find((r) => r.classType === classType)?.department;
  return d ? { id: d.id, name: d.name, label: departmentLabel(d) } : null;
}

export const listSections = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const facultyId = await facultyOf(req);
  const contexts = await activeCohorts(term, facultyId);
  const ctxById = new Map(contexts.map((c) => [c.cohort.id, c]));
  // Roczniki z kalendarzem w archiwum: ich zajecia i obsada sa tylko do odczytu.
  const archived = await archivedCohortIds(term, contexts);
  const cohortFilter = typeof req.query.cohortId === 'string' ? req.query.cohortId : null;

  const sections = await prisma.classSection.findMany({
    where: {
      termId: term.id,
      ...(facultyId ? { facultyId } : {}),
      ...(cohortFilter ? { cohortId: cohortFilter } : {}),
    },
    include: {
      programEntry: {
        select: {
          id: true,
          versionId: true,
          orderInSemester: true,
          subject: { select: { id: true, name: true, code: true } },
          specialization: { select: { shortName: true, name: true } },
          departments: {
            select: { classType: true, department: { select: { id: true, name: true, shortName: true, faculty: { select: { shortName: true } } } } },
          },
        },
      },
      group: { select: { id: true, partitionKey: true } },
      instructors: { include: { instructor: { select: { id: true, title: true, firstName: true, lastName: true } } } },
      // Prowadzacy umieszczen — do ostrzezenia "w planie prowadzacy spoza obsady".
      placements: { select: { instructorId: true } },
    },
  });

  const data = sections
    .map((s) => {
      const ctx = ctxById.get(s.cohortId);
      const assigned = s.instructors.reduce((sum, i) => sum + i.hours, 0);
      const staffIds = new Set(s.instructors.map((i) => i.instructorId).filter(Boolean));
      return {
        id: s.id,
        cohort: {
          id: s.cohortId,
          label: ctx ? cohortLabel(ctx.cohort) : '',
          code: ctx?.cohort.program.code ?? '',
          semester: ctx?.semester ?? 0,
          archived: archived.has(s.cohortId),
        },
        subject: s.programEntry.subject,
        programVersionId: s.programEntry.versionId,
        programEntryId: s.programEntryId,
        // Katedra formy zajec z programu (zlecenie wydzialu); null = jeszcze nieprzypisana.
        department: departmentOf(s.programEntry.departments, s.classType),
        order: s.programEntry.orderInSemester,
        specialization: s.programEntry.specialization?.shortName ?? null,
        specializationName: s.programEntry.specialization?.name ?? null,
        classType: s.classType,
        group: { id: s.group.id, partitionKey: s.group.partitionKey, name: ctx?.nameOf(s.groupId) ?? '' },
        hours: s.hours,
        status: s.status,
        assignedHours: assigned,
        hasVacancy: s.instructors.length === 0 || s.instructors.some((i) => !i.instructorId) || assigned < s.hours,
        // Umieszczenia, ktorych prowadzacy wypadl z obsady (obsada zmieniona po ulozeniu planu).
        planOutsideStaff: s.placements.filter((p) => p.instructorId && !staffIds.has(p.instructorId)).length,
        instructors: s.instructors.map((i) => ({
          id: i.id,
          instructorId: i.instructorId,
          name: instructorName(i.instructor),
          hours: i.hours,
        })),
      };
    })
    .sort(
      (a, b) =>
        a.cohort.code.localeCompare(b.cohort.code) ||
        a.cohort.semester - b.cohort.semester ||
        a.order - b.order ||
        a.subject.name.localeCompare(b.subject.name) ||
        a.classType.localeCompare(b.classType) ||
        a.group.name.localeCompare(b.group.name),
    );

  res.json({
    data,
    summary: {
      sections: data.length,
      hours: data.reduce((s, x) => s + x.hours, 0),
      assignedHours: data.reduce((s, x) => s + Math.min(x.assignedHours, x.hours), 0),
      vacancies: data.filter((x) => x.hasVacancy).length,
      orphaned: data.filter((x) => x.status === 'ORPHANED').length,
      planOutsideStaff: data.reduce((sum, x) => sum + x.planOutsideStaff, 0),
      // Caly widok w archiwum (zwykle caly semestr): akcje masowe nie maja czego zmieniac.
      archived: contexts.length > 0 && contexts.every((c) => archived.has(c.cohort.id)),
    },
  });
});

export const sync = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const facultyId = await facultyOf(req);
  const { dryRun = true, cohortIds } = req.body as { dryRun?: boolean; cohortIds?: string[] };
  const report = await syncSections(term, { facultyId, cohortIds, dryRun });
  if (!dryRun) {
    // Zmienione godziny, przywrocone i osierocone zajecia zmieniaja terminy rocznikow — w kalendarzu
    // w przygotowaniu przeliczamy je od razu (zapis idzie pod blokada semestru, jak cala trasa).
    const touched = [...report.hoursChanged, ...report.reactivated, ...report.orphaned].map((r) => r.cohortId);
    if (touched.length > 0) await refreshPlanningTerms(term, touched);
  }
  res.json({
    data: report,
    message: dryRun
      ? 'Podglad zmian'
      : `Zajecia zsynchronizowane: +${report.created.length}, zmiana godzin ${report.hoursChanged.length}, usunieto ${report.deleted.length}, osieroconych ${report.orphaned.length}`,
  });
});

export const carry = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const facultyId = await facultyOf(req);
  const { dryRun = true } = req.body as { dryRun?: boolean };
  const report = await carryInstructors(term, { facultyId, dryRun });
  res.json({
    data: report,
    message: dryRun
      ? 'Podglad przeniesienia obsady'
      : `Obsada przeniesiona dla ${report.matched.length} zajec; bez dopasowania: ${report.unmatched.length}` +
        (report.archivedCohorts > 0 ? `; pominieto rocznikow w archiwum: ${report.archivedCohorts}` : ''),
  });
});

/** Obsada zajec — podmiana w calosci. Wiersz bez prowadzacego = NN. */
export const setInstructors = asyncHandler(async (req, res) => {
  const section = await prisma.classSection.findUnique({ where: { id: String(req.params.id) } });
  if (!section) throw new AppError(404, 'Zajecia nie znalezione');
  await assertFacultyScope(req, section.facultyId);
  const term = await prisma.academicTerm.findUniqueOrThrow({ where: { id: section.termId } });
  await assertCohortTermWritable(term, section.cohortId, 'obsada');
  const { assignments } = req.body as { assignments?: { instructorId: string | null; hours: number }[] };
  if (!Array.isArray(assignments)) throw new AppError(400, 'Podaj liste obsady');
  // Te same zasady co okna Obciazen i grup przedmiotu (lib/staffing).
  const problem = staffProblem(assignments, section.hours);
  if (problem) throw new AppError(400, problem);
  const total = assignments.reduce((s, a) => s + a.hours, 0);
  const ids = assignments.map((a) => a.instructorId).filter((x): x is string => !!x);
  // Prowadzacy usuniety w miedzyczasie (inne okno) — czytelny komunikat zamiast bledu klucza obcego.
  if (ids.length > 0 && (await prisma.instructor.count({ where: { id: { in: ids } } })) !== ids.length) {
    throw new AppError(409, 'Ktorys z wybranych prowadzacych zostal usuniety — odswiez liste i wybierz ponownie');
  }
  await prisma.$transaction([
    prisma.sectionInstructor.deleteMany({ where: { sectionId: section.id } }),
    prisma.sectionInstructor.createMany({
      data: assignments.map((a) => ({ sectionId: section.id, instructorId: a.instructorId || null, hours: a.hours })),
    }),
  ]);
  res.json({
    message: total < section.hours ? `Obsada zapisana — brakuje ${section.hours - total} h` : 'Obsada zapisana',
  });
});

/**
 * Obciazenia prowadzacych w semestrze — jak w arkuszach katedr: osoba (z katedra) → przedmiot
 * i forma w roczniku → grupy i godziny. Godziny na wybranym wydziale osobno stacjonarne
 * i niestacjonarne, do tego suma w calej uczelni (zajecia na innych wydzialach).
 */
export const workload = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const facultyId = await facultyOf(req);
  const contexts = await activeCohorts(term, facultyId);
  const ctxById = new Map(contexts.map((c) => [c.cohort.id, c]));
  const rows = await prisma.sectionInstructor.findMany({
    where: { instructorId: { not: null }, section: { termId: term.id, status: 'ACTIVE' } },
    select: {
      instructorId: true,
      hours: true,
      section: {
        select: {
          id: true,
          hours: true,
          facultyId: true,
          cohortId: true,
          programEntryId: true,
          classType: true,
          groupId: true,
          programEntry: { select: { orderInSemester: true, subject: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  // Zajecia laczone miedzy kierunkami: klucze z umieszczen tej osoby w tych zajeciach — obciazenie
  // liczy je raz (lib/workload.jointCounting), choc w obsadzie sa w kazdym roczniku osobno.
  const joints = await prisma.placement.findMany({
    where: { termId: term.id, jointKey: { not: null }, instructorId: { not: null } },
    select: { sectionId: true, instructorId: true, jointKey: true },
  });
  const jointKeysOf = new Map<string, Set<string>>();
  for (const p of joints) {
    const k = `${p.instructorId}|${p.sectionId}`;
    jointKeysOf.set(k, (jointKeysOf.get(k) ?? new Set()).add(p.jointKey!));
  }
  // Opis zajec spoza widoku (inny wydzial) do "laczone z ..." — tylko gdy sa laczone.
  const outsideJoint = [
    ...new Set(rows.filter((r) => jointKeysOf.has(`${r.instructorId}|${r.section.id}`) && !ctxById.has(r.section.cohortId)).map((r) => r.section.cohortId)),
  ];
  const codeOf = new Map(
    (outsideJoint.length
      ? await prisma.cohort.findMany({ where: { id: { in: outsideJoint } }, select: { id: true, program: { select: { code: true } } } })
      : []
    ).map((c) => [c.id, c.program.code]),
  );
  const people = aggregateWorkload(
    rows.map((r) => {
      const s = r.section;
      const ctx = !facultyId || s.facultyId === facultyId ? ctxById.get(s.cohortId) : undefined;
      const jointKeys = [...(jointKeysOf.get(`${r.instructorId}|${s.id}`) ?? [])];
      return {
        jointKeys,
        label: ctx ? `${ctx.cohort.program.code} · ${ctx.nameOf(s.groupId)}` : (codeOf.get(s.cohortId) ?? 'inny wydzial'),
        instructorId: r.instructorId!,
        hours: r.hours,
        sectionId: s.id,
        sectionHours: s.hours,
        cohortId: s.cohortId,
        programEntryId: s.programEntryId,
        classType: s.classType,
        view: ctx
          ? {
              cohort: { id: ctx.cohort.id, code: ctx.cohort.program.code, semester: ctx.semester, label: cohortLabel(ctx.cohort) },
              subject: s.programEntry.subject,
              order: s.programEntry.orderInSemester,
              group: ctx.nameOf(s.groupId),
              studyMode: ctx.cohort.program.studyMode,
            }
          : null,
      };
    }),
  );
  const instructors = await prisma.instructor.findMany({
    where: { id: { in: people.map((p) => p.instructorId) } },
    select: {
      id: true,
      title: true,
      firstName: true,
      lastName: true,
      department: { select: { id: true, name: true, shortName: true, faculty: { select: { shortName: true } } } },
    },
  });
  const byId = new Map(instructors.map((i) => [i.id, i]));
  res.json({
    data: people.map(({ instructorId, ...person }) => {
      const instructor = byId.get(instructorId) ?? null;
      const department = instructor?.department;
      return {
        id: instructorId,
        name: instructorName(instructor),
        department: department ? { id: department.id, name: department.name, label: departmentLabel(department) } : null,
        ...person,
      };
    }),
  });
});

/** Obsada wielu zajec naraz (np. wszystkie grupy przedmiotu) — wszystko albo nic. */
export const replaceStaffHandler = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const { changes } = req.body as { changes: { sectionId: string; assignments: { instructorId: string | null; hours: number }[] }[] };
  await replaceStaff(req, term, changes.map((c) => ({ sectionId: c.sectionId, rows: c.assignments })));
  res.json({ message: `Obsada zapisana: ${plural(changes.length, 'zajecia', 'zajecia', 'zajec')}` });
});

/** Godziny jednej osoby w wybranych zajeciach (Obciazenia) — obsada innych zostaje. */
export const personStaffHandler = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const { items } = req.body as { items: { sectionId: string; hours: number }[] };
  const result = await setPersonStaff(req, term, String(req.params.instructorId), items);
  res.json({
    data: result,
    message:
      result.sections > 0
        ? `Obciazenie zapisane: ${plural(result.sections, 'grupa', 'grupy', 'grup')}, ${result.hours} h`
        : 'Prowadzacy nie prowadzi juz tych zajec',
  });
});

const CSV_HEADER = 'id_zajec;rocznik;semestr;przedmiot;forma;grupa;godziny;prowadzacy_email;godziny_prowadzacego';

/** Eksport obsady do CSV (srednik, UTF-8 z BOM) — do rozeslania katedrom i wczytania z powrotem. */
export const exportCsv = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const facultyId = await facultyOf(req);
  const contexts = await activeCohorts(term, facultyId);
  const ctxById = new Map(contexts.map((c) => [c.cohort.id, c]));
  const sections = await prisma.classSection.findMany({
    where: { termId: term.id, status: 'ACTIVE', ...(facultyId ? { facultyId } : {}) },
    include: {
      programEntry: { include: { subject: true } },
      instructors: { include: { instructor: { select: { email: true } } } },
    },
  });
  const esc = (v: string | number) => {
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_HEADER];
  for (const s of sections) {
    const ctx = ctxById.get(s.cohortId);
    const base = [s.id, ctx?.cohort.program.code ?? '', ctx?.semester ?? '', s.programEntry.subject.name, CLASS_LABEL_PL[s.classType], ctx?.nameOf(s.groupId) ?? '', s.hours];
    const rows = s.instructors.length > 0 ? s.instructors : [{ instructor: null, hours: s.hours }];
    for (const i of rows) lines.push([...base, i.instructor?.email ?? 'NN', i.hours].map(esc).join(';'));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="obsada-${String(req.params.key)}.csv"`);
  res.send('﻿' + lines.join('\n'));
});

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ';') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Import obsady z CSV w formacie eksportu. Wiersze grupujemy po id zajec; obsada
 * zajec z pliku zastepuje dotychczasowa. Zly wiersz nie przerywa importu — trafia do raportu.
 */
export const importCsv = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const facultyId = await facultyOf(req);
  const { csv, dryRun = true } = req.body as { csv?: string; dryRun?: boolean };
  if (!csv) throw new AppError(400, 'Brak tresci pliku');
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines[0]?.startsWith('id_zajec')) throw new AppError(400, 'Nieznany format — uzyj pliku z eksportu obsady');

  const instructors = await prisma.instructor.findMany({ select: { id: true, email: true } });
  const byEmail = new Map(instructors.map((i) => [i.email.toLowerCase(), i.id]));
  const grouped = new Map<string, { instructorId: string | null; hours: number }[]>();
  const errors: string[] = [];
  // Zajecia z choc jednym blednym wierszem pomijamy w calosci — inaczej literowka w e-mailu
  // po cichu odebralaby komus godziny (obsada z pliku zastepuje dotychczasowa).
  const brokenRows = new Map<string, number[]>();
  // Komunikaty o zajeciach wskazuja wiersze pliku i opis z pliku, nie id (UUID nic nie mowi).
  const rowsOf = new Map<string, number[]>();
  const labelOf = new Map<string, string>();
  const where = (sectionId: string) => {
    const rows = rowsOf.get(sectionId) ?? [];
    const label = labelOf.get(sectionId);
    return `${rows.length === 1 ? 'Wiersz' : 'Wiersze'} ${rows.join(', ')}${label ? ` (${label})` : ''}`;
  };
  lines.slice(1).forEach((line, n) => {
    const cols = parseCsvLine(line);
    const [sectionId, , , subject = '', form = '', group = '', , email = '', hoursRaw = ''] = cols;
    if (sectionId) {
      rowsOf.set(sectionId, [...(rowsOf.get(sectionId) ?? []), n + 2]);
      if (!labelOf.has(sectionId)) labelOf.set(sectionId, [subject, form, group].filter(Boolean).join(' · '));
    }
    const hours = Number(hoursRaw);
    const fail = (message: string) => {
      errors.push(`Wiersz ${n + 2}: ${message}`);
      if (sectionId) brokenRows.set(sectionId, [...(brokenRows.get(sectionId) ?? []), n + 2]);
    };
    if (!sectionId || !Number.isInteger(hours) || hours <= 0) return fail('brak id zajec albo niepoprawne godziny');
    const key = email.trim().toLowerCase();
    const instructorId = key === '' || key === 'nn' ? null : (byEmail.get(key) ?? undefined);
    if (instructorId === undefined) return fail(`nie ma prowadzacego ${email}`);
    grouped.set(sectionId, [...(grouped.get(sectionId) ?? []), { instructorId, hours }]);
  });
  for (const [sectionId, rows] of brokenRows) {
    if (!grouped.delete(sectionId)) continue;
    errors.push(`${where(sectionId)}: zajecia pominiete w calosci — popraw bledne wiersze (${rows.join(', ')}), obsada zostaje bez zmian`);
  }

  const sections = await prisma.classSection.findMany({
    where: { id: { in: [...grouped.keys()] }, termId: term.id, ...(facultyId ? { facultyId } : {}) },
  });
  const known = new Map(sections.map((s) => [s.id, s]));
  const archived = await archivedCohortIds(term, await activeCohorts(term, facultyId));
  let applied = 0;
  const ops = [];
  for (const [sectionId, assignments] of grouped) {
    const section = known.get(sectionId);
    if (!section) {
      errors.push(`${where(sectionId)}: zajecia nie naleza do tego semestru/wydzialu`);
      continue;
    }
    if (archived.has(section.cohortId)) {
      errors.push(`${where(sectionId)}: kalendarz rocznika w archiwum — obsada tylko do odczytu`);
      continue;
    }
    const total = assignments.reduce((s, a) => s + a.hours, 0);
    if (total > section.hours) {
      errors.push(`${where(sectionId)}: suma godzin prowadzacych ${total} h przekracza godziny zajec (${section.hours} h)`);
      continue;
    }
    applied++;
    ops.push(prisma.sectionInstructor.deleteMany({ where: { sectionId } }));
    ops.push(prisma.sectionInstructor.createMany({ data: assignments.map((a) => ({ ...a, sectionId })) }));
  }
  if (!dryRun && ops.length > 0) await prisma.$transaction(ops);
  res.json({
    data: { applied, errors },
    message: dryRun
      ? `Do wczytania: ${plural(applied, 'zajecia', 'zajecia', 'zajec')}`
      : `Wczytano obsade: ${plural(applied, 'zajecia', 'zajecia', 'zajec')}`,
  });
});

/** Zajecia w planie rozjechane z obsada (prowadzacy spoza obsady albo NN mimo pelnej obsady). */
export const planStaffList = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  res.json({ data: await staffMismatches(term, await facultyOf(req)) });
});

/**
 * Przepiecie prowadzacego w planie: dryRun — kolizje kazdej zmiany; zapis — tylko zmiany bez bledow
 * i kolizji, potem terminy jak po kazdej zmianie planu (w przygotowaniu — przeliczone od razu).
 */
export const planStaffChange = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const { changes, dryRun } = req.body as { changes: StaffChange[]; dryRun: boolean };
  const result = await changePlanStaff(term, changes, { dryRun, assertScope: (facultyId) => assertFacultyScope(req, facultyId) });
  if (dryRun) {
    res.json({ data: { results: result.results, applied: 0 } });
    return;
  }
  const skipped = result.results.filter((r) => r.error || r.conflicts.length > 0).length;
  if (result.applied > 0) {
    req.log.info({ termId: term.id, applied: result.applied, skipped }, 'przepieto prowadzacych w planie');
  }
  res.json({
    data: { results: result.results, applied: result.applied },
    message:
      result.applied > 0
        ? `Prowadzacy przepieci w planie: ${plural(result.applied, 'zajecia', 'zajecia', 'zajec')}${result.refresh ? `; ${termsNote(result.refresh)}` : ''}`
        : 'Nic nie przepieto',
    ...(skipped > 0 ? { warning: `Pominiete (kolizje albo bledy): ${plural(skipped, 'zajecia', 'zajecia', 'zajec')}` } : {}),
  });
});
