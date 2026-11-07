import type { Request } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import { assertFacultyScope, getCallerScope } from '../lib/facultyScope';
import { parseTermKey } from '../lib/terms';
import { activeCohorts, carryInstructors, syncSections } from '../services/sections';
import { cohortLabel } from '../services/cohorts';

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

export const listSections = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const facultyId = await facultyOf(req);
  const contexts = await activeCohorts(term, facultyId);
  const ctxById = new Map(contexts.map((c) => [c.cohort.id, c]));
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
          orderInSemester: true,
          subject: { select: { id: true, name: true, code: true } },
          specialization: { select: { shortName: true } },
        },
      },
      group: { select: { id: true, partitionKey: true } },
      instructors: { include: { instructor: { select: { id: true, title: true, firstName: true, lastName: true } } } },
    },
  });

  const data = sections
    .map((s) => {
      const ctx = ctxById.get(s.cohortId);
      const assigned = s.instructors.reduce((sum, i) => sum + i.hours, 0);
      return {
        id: s.id,
        cohort: {
          id: s.cohortId,
          label: ctx ? cohortLabel(ctx.cohort) : '',
          code: ctx?.cohort.program.code ?? '',
          semester: ctx?.semester ?? 0,
        },
        subject: s.programEntry.subject,
        order: s.programEntry.orderInSemester,
        specialization: s.programEntry.specialization?.shortName ?? null,
        classType: s.classType,
        group: { id: s.group.id, partitionKey: s.group.partitionKey, name: ctx?.nameOf(s.groupId) ?? '' },
        hours: s.hours,
        status: s.status,
        assignedHours: assigned,
        hasVacancy: s.instructors.length === 0 || s.instructors.some((i) => !i.instructorId) || assigned < s.hours,
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
    },
  });
});

export const sync = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const facultyId = await facultyOf(req);
  const { dryRun = true, cohortIds } = req.body as { dryRun?: boolean; cohortIds?: string[] };
  const report = await syncSections(term, { facultyId, cohortIds, dryRun });
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
      : `Obsada przeniesiona dla ${report.matched.length} zajec; bez dopasowania: ${report.unmatched.length}`,
  });
});

/** Obsada zajec — podmiana w calosci. Wiersz bez prowadzacego = NN. */
export const setInstructors = asyncHandler(async (req, res) => {
  const section = await prisma.classSection.findUnique({ where: { id: String(req.params.id) } });
  if (!section) throw new AppError(404, 'Zajecia nie znalezione');
  await assertFacultyScope(req, section.facultyId);
  const { assignments } = req.body as { assignments?: { instructorId: string | null; hours: number }[] };
  if (!Array.isArray(assignments)) throw new AppError(400, 'Podaj liste obsady');
  for (const a of assignments) {
    if (!Number.isInteger(a.hours) || a.hours <= 0) throw new AppError(400, 'Godziny prowadzacego musza byc dodatnie');
  }
  const total = assignments.reduce((s, a) => s + a.hours, 0);
  if (total > section.hours) {
    throw new AppError(400, `Suma godzin obsady (${total}) przekracza godziny zajec (${section.hours})`);
  }
  const ids = assignments.map((a) => a.instructorId).filter((x): x is string => !!x);
  if (new Set(ids).size !== ids.length) throw new AppError(400, 'Prowadzacy powtarza sie w obsadzie');
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

/** Obciazenie prowadzacych w semestrze: godziny z obsady (na wybranym wydziale i lacznie). */
export const workload = asyncHandler(async (req, res) => {
  const term = await findTerm(String(req.params.key));
  const facultyId = await facultyOf(req);
  const rows = await prisma.sectionInstructor.findMany({
    where: { instructorId: { not: null }, section: { termId: term.id, status: 'ACTIVE' } },
    include: {
      instructor: { select: { id: true, title: true, firstName: true, lastName: true } },
      section: { select: { facultyId: true } },
    },
  });
  const map = new Map<string, { id: string; name: string; here: number; total: number }>();
  for (const r of rows) {
    const id = r.instructorId!;
    const item = map.get(id) ?? { id, name: instructorName(r.instructor), here: 0, total: 0 };
    item.total += r.hours;
    if (!facultyId || r.section.facultyId === facultyId) item.here += r.hours;
    map.set(id, item);
  }
  res.json({ data: [...map.values()].filter((x) => x.here > 0).sort((a, b) => b.here - a.here) });
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
    const base = [s.id, ctx?.cohort.program.code ?? '', ctx?.semester ?? '', s.programEntry.subject.name, s.classType, ctx?.nameOf(s.groupId) ?? '', s.hours];
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
  lines.slice(1).forEach((line, n) => {
    const cols = parseCsvLine(line);
    const [sectionId, , , , , , , email = '', hoursRaw = ''] = cols;
    const hours = Number(hoursRaw);
    if (!sectionId || !Number.isInteger(hours) || hours <= 0) {
      errors.push(`Wiersz ${n + 2}: brak id zajec albo niepoprawne godziny`);
      return;
    }
    const key = email.trim().toLowerCase();
    const instructorId = key === '' || key === 'nn' ? null : (byEmail.get(key) ?? undefined);
    if (instructorId === undefined) {
      errors.push(`Wiersz ${n + 2}: nie ma prowadzacego ${email}`);
      return;
    }
    grouped.set(sectionId, [...(grouped.get(sectionId) ?? []), { instructorId, hours }]);
  });

  const sections = await prisma.classSection.findMany({
    where: { id: { in: [...grouped.keys()] }, termId: term.id, ...(facultyId ? { facultyId } : {}) },
  });
  const known = new Map(sections.map((s) => [s.id, s]));
  let applied = 0;
  const ops = [];
  for (const [sectionId, assignments] of grouped) {
    const section = known.get(sectionId);
    if (!section) {
      errors.push(`Zajecia ${sectionId} nie naleza do tego semestru/wydzialu`);
      continue;
    }
    const total = assignments.reduce((s, a) => s + a.hours, 0);
    if (total > section.hours) {
      errors.push(`Zajecia ${sectionId}: suma ${total} h > ${section.hours} h`);
      continue;
    }
    applied++;
    ops.push(prisma.sectionInstructor.deleteMany({ where: { sectionId } }));
    ops.push(prisma.sectionInstructor.createMany({ data: assignments.map((a) => ({ ...a, sectionId })) }));
  }
  if (!dryRun && ops.length > 0) await prisma.$transaction(ops);
  res.json({
    data: { applied, errors },
    message: dryRun ? `Do wczytania: ${applied} zajec` : `Wczytano obsade ${applied} zajec`,
  });
});
