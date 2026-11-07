import type { CohortLectureMode, StudentGroup } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import { assertFacultyScope } from '../lib/facultyScope';
import { cohortSemesterInTerm, parseTermKey, termOfDate, termOrdinal, type TermRef } from '../lib/terms';
import { nextCodes, ROOT, SPEC } from '../lib/groupTree';
import {
  cohortDto,
  cohortGroupsView,
  cohortInclude,
  cohortLabel,
  loadCohort,
  semesterOf,
  studyYearOf,
} from '../services/cohorts';

/**
 * Roczniki i ich grupy. Rocznik powstaje raz (nabor) i idzie przez studia — grupy
 * przechodza z nim automatycznie, a ich nazwy przeliczaja sie z numeru semestru.
 * Korekty (scalenia, podzial na specjalnosci) zapisuje sie zakresem obowiazywania
 * grupy (od semestru / do semestru), a nie kasowaniem i zakladaniem od nowa.
 */

async function requireCohort(id: string) {
  const cohort = await loadCohort(id);
  if (!cohort) throw new AppError(404, 'Rocznik nie znaleziony');
  return cohort;
}

async function findTermByKey(key: string) {
  const ref = parseTermKey(key);
  if (!ref) throw new AppError(400, 'Nieprawidlowy klucz semestru');
  const term = await prisma.academicTerm.findUnique({ where: { startYear_type: ref } });
  if (!term) throw new AppError(404, 'Semestr nie istnieje');
  return term;
}

// ─── Roczniki ────────────────────────────────────────────────

export const listCohorts = asyncHandler(async (req, res) => {
  const facultyId = typeof req.query.facultyId === 'string' && req.query.facultyId !== 'all' ? req.query.facultyId : null;
  const cohorts = await prisma.cohort.findMany({
    where: facultyId ? { program: { fieldOfStudy: { facultyId } } } : {},
    include: { ...cohortInclude, _count: { select: { groups: true } } },
  });
  cohorts.sort(
    (a, b) => a.program.code.localeCompare(b.program.code) || termOrdinal(b.startTerm) - termOrdinal(a.startTerm),
  );
  res.json({ data: cohorts.map((c) => ({ ...cohortDto(c), groupCount: c._count.groups })) });
});

/**
 * Roczniki aktywne w semestrze (numer semestru programu w zakresie 1..N) z ich
 * semestrem, rokiem studiow i kalendarzem. Do tego programy, ktore w tym semestrze
 * moga przyjac nowy nabor, a jeszcze go nie maja — podpowiedz dla planisty.
 */
export const listTermCohorts = asyncHandler(async (req, res) => {
  const term = await findTermByKey(String(req.params.key));
  const facultyId = typeof req.query.facultyId === 'string' && req.query.facultyId !== 'all' ? req.query.facultyId : null;
  const cohorts = await prisma.cohort.findMany({
    where: facultyId ? { program: { fieldOfStudy: { facultyId } } } : {},
    include: {
      ...cohortInclude,
      terms: { where: { termId: term.id }, include: { calendar: { select: { id: true, name: true, kind: true } } } },
      groups: { select: { fromSemester: true, toSemester: true, size: true, partitionKey: true } },
    },
  });

  const active = cohorts
    .map((cohort) => {
      const override = cohort.terms[0];
      const semester = semesterOf(cohort, term, override?.semester);
      return { cohort, override, semester };
    })
    .filter(({ cohort, semester }) => semester >= 1 && semester <= cohort.programVersion.totalSemesters)
    .sort((a, b) => a.cohort.program.code.localeCompare(b.cohort.program.code) || a.semester - b.semester);

  // Kalendarze wydzialow w tym semestrze — domyslny = "Podstawowy" w trybie programu.
  const calendars = await prisma.termCalendar.findMany({
    where: { termId: term.id },
    select: { id: true, facultyId: true, studyMode: true, name: true, kind: true },
  });

  const data = active.map(({ cohort, override, semester }) => {
    const activeGroups = cohort.groups.filter(
      (g) => g.fromSemester <= semester && (g.toSemester === null || semester <= g.toSemester),
    );
    const own = calendars.filter(
      (c) => c.facultyId === cohort.program.fieldOfStudy.facultyId && c.studyMode === cohort.program.studyMode,
    );
    const calendar = override?.calendar ?? own.find((c) => c.name === 'Podstawowy') ?? own[0] ?? null;
    return {
      ...cohortDto(cohort),
      semester,
      studyYear: studyYearOf(semester),
      semesterOverridden: !!override,
      isNewIntake: semester === 1,
      calendar,
      calendarIsDefault: !override?.calendar,
      availableCalendars: own,
      groupCount: activeGroups.length,
      size: activeGroups.find((g) => g.partitionKey === ROOT)?.size ?? 0,
    };
  });

  // Programy bez naboru startujacego w tym semestrze (podpowiedz "Nowy nabor").
  const programs = await prisma.program.findMany({
    where: facultyId ? { fieldOfStudy: { facultyId } } : {},
    select: { id: true, code: true, name: true, studyMode: true, versions: { select: { defaultStartType: true } } },
  });
  const startedHere = new Set(cohorts.filter((c) => c.startTermId === term.id).map((c) => c.programId));
  const intakeCandidates = programs.filter(
    (p) => !startedHere.has(p.id) && p.versions.some((v) => v.defaultStartType === term.type),
  );

  res.json({ data, intakeCandidates });
});

/**
 * Nowy nabor. Wersja programu domyslnie ta sama co u poprzedniego naboru (albo
 * najnowsza zatwierdzona); struktura grup — skopiowana z poprzedniego naboru
 * (grupy obowiazujace w 1. semestrze), z mozliwoscia pominiecia.
 */
export const createCohort = asyncHandler(async (req, res) => {
  const body = req.body as {
    programId: string;
    startTermKey: string;
    programVersionId?: string;
    copyStructure?: boolean;
    rootSize?: number;
  };
  const program = await prisma.program.findUnique({
    where: { id: body.programId },
    include: { fieldOfStudy: true, versions: { orderBy: { createdAt: 'desc' } } },
  });
  if (!program) throw new AppError(400, 'Program nie istnieje');
  await assertFacultyScope(req, program.fieldOfStudy.facultyId);
  const startTerm = await findTermByKey(body.startTermKey);

  const exists = await prisma.cohort.findUnique({
    where: { programId_startTermId: { programId: program.id, startTermId: startTerm.id } },
  });
  if (exists) throw new AppError(409, 'Ten nabor juz istnieje');

  // Poprzedni nabor = najpozniej startujacy przed tym.
  const earlier = await prisma.cohort.findMany({ where: { programId: program.id }, include: { startTerm: true } });
  const previous = earlier
    .filter((c) => termOrdinal(c.startTerm) < termOrdinal(startTerm))
    .sort((a, b) => termOrdinal(b.startTerm) - termOrdinal(a.startTerm))[0];

  const versionId =
    body.programVersionId ??
    previous?.programVersionId ??
    program.versions.find((v) => v.status === 'APPROVED')?.id ??
    program.versions[0]?.id;
  if (!versionId) throw new AppError(409, 'Program nie ma zadnej wersji — dodaj ja najpierw');
  if (!program.versions.some((v) => v.id === versionId)) throw new AppError(400, 'Wersja nie nalezy do programu');

  const sourceGroups =
    body.copyStructure !== false && previous
      ? await prisma.studentGroup.findMany({
          where: { cohortId: previous.id, fromSemester: { lte: 1 }, OR: [{ toSemester: null }, { toSemester: { gte: 1 } }] },
        })
      : [];

  const cohort = await prisma.$transaction(async (tx) => {
    const created = await tx.cohort.create({
      data: { programId: program.id, programVersionId: versionId, startTermId: startTerm.id },
    });
    const base = { cohortId: created.id, fromSemester: 1 };
    const sourceRoot = sourceGroups.find((g) => g.partitionKey === ROOT);
    const root = await tx.studentGroup.create({
      data: {
        ...base,
        partitionKey: ROOT,
        size: body.rootSize ?? sourceRoot?.size ?? 0,
      },
    });
    // Kopia drzewa: rodzic przed dzieckiem, z mapowaniem starych id na nowe.
    const idMap = new Map<string, string>();
    if (sourceRoot) idMap.set(sourceRoot.id, root.id);
    let pending = sourceGroups.filter((g) => g.partitionKey !== ROOT);
    while (pending.length > 0) {
      const ready = pending.filter((g) => g.parentGroupId && idMap.has(g.parentGroupId));
      if (ready.length === 0) break; // osierocone w zrodle — pomijamy
      for (const g of ready) {
        const copy = await tx.studentGroup.create({
          data: {
            ...base,
            specializationId: g.specializationId,
            partitionKey: g.partitionKey,
            code: g.code,
            size: g.size,
            parentGroupId: idMap.get(g.parentGroupId!)!,
            preferredRoomId: g.preferredRoomId,
          },
        });
        idMap.set(g.id, copy.id);
      }
      const done = new Set(ready.map((g) => g.id));
      pending = pending.filter((g) => !done.has(g.id));
    }
    return created;
  });

  const full = await requireCohort(cohort.id);
  res.status(201).json({
    data: cohortDto(full),
    message: `Utworzono ${cohortLabel(full)}${sourceGroups.length > 0 ? ' ze struktura grup poprzedniego naboru' : ''}`,
  });
});

export const updateCohort = asyncHandler(async (req, res) => {
  const cohort = await requireCohort(String(req.params.id));
  await assertFacultyScope(req, cohort.program.fieldOfStudy.facultyId);
  const body = req.body as { programVersionId?: string; lectureMode?: CohortLectureMode; name?: string | null };
  if (body.programVersionId) {
    const version = await prisma.programVersion.findUnique({ where: { id: body.programVersionId } });
    if (!version || version.programId !== cohort.programId) throw new AppError(400, 'Wersja nie nalezy do programu rocznika');
  }
  await prisma.cohort.update({
    where: { id: cohort.id },
    data: {
      programVersionId: body.programVersionId,
      lectureMode: body.lectureMode,
      name: body.name === undefined ? undefined : body.name?.trim() || null,
    },
  });
  res.json({ data: cohortDto(await requireCohort(cohort.id)), message: 'Rocznik zapisany' });
});

export const deleteCohort = asyncHandler(async (req, res) => {
  const cohort = await requireCohort(String(req.params.id));
  await assertFacultyScope(req, cohort.program.fieldOfStudy.facultyId);
  const used = await prisma.studentGroup.count({
    where: {
      cohortId: cohort.id,
      OR: [{ sections: { some: {} } }, { occurrences: { some: {} } }, { members: { some: {} } }],
    },
  });
  if (used > 0) throw new AppError(409, 'Grupy rocznika sa w planie albo maja studentow — nie mozna go usunac');
  await prisma.$transaction(async (tx) => {
    // Od lisci do korzenia (FK rodzica).
    let groups = await tx.studentGroup.findMany({ where: { cohortId: cohort.id }, select: { id: true, parentGroupId: true } });
    while (groups.length > 0) {
      const parents = new Set(groups.map((g) => g.parentGroupId).filter(Boolean));
      const leaves = groups.filter((g) => !parents.has(g.id)).map((g) => g.id);
      await tx.studentGroup.deleteMany({ where: { id: { in: leaves } } });
      groups = groups.filter((g) => !leaves.includes(g.id));
    }
    await tx.cohort.delete({ where: { id: cohort.id } });
  });
  res.json({ message: 'Rocznik usuniety' });
});

/** Korekta rocznika w semestrze: numer semestru (wyjatkowo) i kalendarz. */
export const setCohortTerm = asyncHandler(async (req, res) => {
  const term = await findTermByKey(String(req.params.key));
  const cohort = await requireCohort(String(req.params.cohortId));
  await assertFacultyScope(req, cohort.program.fieldOfStudy.facultyId);
  const body = req.body as { semester?: number | null; calendarId?: string | null };
  if (body.calendarId) {
    const calendar = await prisma.termCalendar.findUnique({ where: { id: body.calendarId } });
    if (!calendar || calendar.termId !== term.id || calendar.facultyId !== cohort.program.fieldOfStudy.facultyId) {
      throw new AppError(400, 'Kalendarz nie nalezy do tego semestru i wydzialu');
    }
    if (calendar.studyMode !== cohort.program.studyMode) {
      throw new AppError(400, 'Kalendarz jest dla innego trybu studiow');
    }
  }
  const computed = semesterOf(cohort, term as TermRef);
  const semester = body.semester ?? computed;
  if (semester < 1 || semester > cohort.programVersion.totalSemesters) {
    throw new AppError(400, `Semestr musi byc w zakresie 1-${cohort.programVersion.totalSemesters}`);
  }
  const data = await prisma.cohortTerm.upsert({
    where: { cohortId_termId: { cohortId: cohort.id, termId: term.id } },
    create: { cohortId: cohort.id, termId: term.id, semester, calendarId: body.calendarId ?? null },
    update: { semester, ...(body.calendarId !== undefined ? { calendarId: body.calendarId } : {}) },
  });
  res.json({ data, message: 'Zapisano ustawienia rocznika w semestrze' });
});

// ─── Grupy rocznika ──────────────────────────────────────────

export const getCohortGroups = asyncHandler(async (req, res) => {
  const cohort = await requireCohort(String(req.params.id));
  const semester = Math.max(1, Number(req.query.semester) || 1);
  res.json({ data: { cohort: cohortDto(cohort), semester, groups: await cohortGroupsView(cohort, semester) } });
});

async function loadGroupInCohort(id: string) {
  const group = await prisma.studentGroup.findUnique({ where: { id } });
  if (!group?.cohortId) throw new AppError(404, 'Grupa nie znaleziona');
  const cohort = await requireCohort(group.cohortId);
  return { group, cohort };
}

/** Specjalnosc grupy wynika z przodka SPEC — dziedziczymy ja, zeby stary model tez ja widzial. */
async function inheritedSpecialization(parent: StudentGroup): Promise<string | null> {
  return parent.specializationId ?? null;
}

interface NewGroupInput {
  parentId: string;
  partitionKey: string;
  code?: string;
  specializationId?: string | null;
  size: number;
  fromSemester?: number;
  toSemester?: number | null;
}

async function createGroupIn(cohort: Awaited<ReturnType<typeof requireCohort>>, input: NewGroupInput) {
  const parent = await prisma.studentGroup.findUnique({ where: { id: input.parentId } });
  if (!parent || parent.cohortId !== cohort.id) throw new AppError(400, 'Grupa nadrzedna nie nalezy do rocznika');
  const partitionKey = input.partitionKey.trim().toUpperCase();
  if (partitionKey === ROOT) throw new AppError(400, 'Rocznik ma juz korzen');
  if (partitionKey === SPEC) {
    if (parent.partitionKey !== ROOT) throw new AppError(400, 'Specjalnosci dziela caly rocznik (rodzic = rocznik)');
    const spec = cohort.program.fieldOfStudy.specializations.find((s) => s.id === input.specializationId);
    if (!spec) throw new AppError(400, 'Wybierz specjalnosc kierunku');
    input.code = spec.shortName;
  }
  if (!/^[A-Z][A-Z0-9]{0,7}$/.test(partitionKey)) {
    throw new AppError(400, 'Podzial: litera lub krotki kod (np. C, L, P, S, JEZ)');
  }
  const siblings = await prisma.studentGroup.findMany({
    where: { parentGroupId: parent.id, partitionKey },
    select: { code: true, fromSemester: true, toSemester: true },
  });
  const from = input.fromSemester ?? 1;
  const to = input.toSemester ?? null;
  const code = input.code?.trim() || nextCodes(1, partitionKey === 'L' && parent.partitionKey === 'C' ? parent.code : null, siblings.map((s) => s.code ?? ''))[0]!;
  const clash = siblings.some(
    (s) => s.code === code && s.fromSemester <= (to ?? 99) && (s.toSemester === null || s.toSemester >= from),
  );
  if (clash) throw new AppError(409, `Grupa ${partitionKey}-${code} juz istnieje w tym zakresie semestrow`);

  return prisma.studentGroup.create({
    data: {
      specializationId: partitionKey === SPEC ? input.specializationId! : await inheritedSpecialization(parent),
      cohortId: cohort.id,
      parentGroupId: parent.id,
      partitionKey,
      code,
      size: input.size,
      fromSemester: from,
      toSemester: to,
    },
  });
}

export const createGroup = asyncHandler(async (req, res) => {
  const cohort = await requireCohort(String(req.params.id));
  await assertFacultyScope(req, cohort.program.fieldOfStudy.facultyId);
  const group = await createGroupIn(cohort, req.body as NewGroupInput);
  res.status(201).json({ data: group, message: 'Grupa dodana' });
});

/**
 * Kreator struktury: pod kazdym wskazanym rodzicem N grup danego podzialu
 * (np. pod kazda grupa cwiczeniowa 2 laboratoryjne -> A1, A2, B1, B2).
 */
export const createGroupsBulk = asyncHandler(async (req, res) => {
  const cohort = await requireCohort(String(req.params.id));
  await assertFacultyScope(req, cohort.program.fieldOfStudy.facultyId);
  const body = req.body as { parentIds: string[]; partitionKey: string; perParent: number; size: number; fromSemester?: number };
  if (!Array.isArray(body.parentIds) || body.parentIds.length === 0) throw new AppError(400, 'Wskaz grupy nadrzedne');
  if (!body.perParent || body.perParent < 1 || body.perParent > 26) throw new AppError(400, 'Liczba grup: 1-26');
  const created: StudentGroup[] = [];
  for (const parentId of body.parentIds) {
    const parent = await prisma.studentGroup.findUnique({ where: { id: parentId } });
    if (!parent || parent.cohortId !== cohort.id) throw new AppError(400, 'Grupa nadrzedna nie nalezy do rocznika');
    const partitionKey = body.partitionKey.trim().toUpperCase();
    const existing = await prisma.studentGroup.findMany({ where: { parentGroupId: parentId, partitionKey }, select: { code: true } });
    const nested = parent.partitionKey !== ROOT && parent.partitionKey !== SPEC;
    const codes = nextCodes(body.perParent, nested ? parent.code : null, existing.map((e) => e.code ?? ''));
    for (const code of codes) {
      created.push(
        await createGroupIn(cohort, { parentId, partitionKey, code, size: body.size, fromSemester: body.fromSemester ?? 1 }),
      );
    }
  }
  res.status(201).json({ data: created, message: `Dodano ${created.length} grup` });
});

export const updateGroup = asyncHandler(async (req, res) => {
  const { group, cohort } = await loadGroupInCohort(String(req.params.id));
  await assertFacultyScope(req, cohort.program.fieldOfStudy.facultyId);
  const body = req.body as { code?: string; size?: number; fromSemester?: number; toSemester?: number | null };
  if (body.size !== undefined && (!Number.isInteger(body.size) || body.size < 0)) {
    throw new AppError(400, 'Liczebnosc musi byc liczba nieujemna');
  }
  const from = body.fromSemester ?? group.fromSemester;
  const to = body.toSemester === undefined ? group.toSemester : body.toSemester;
  if (to !== null && to < from) throw new AppError(400, 'Grupa nie moze konczyc sie przed poczatkiem');
  if (group.partitionKey === ROOT && (from !== 1 || to !== null)) {
    throw new AppError(400, 'Korzen rocznika obowiazuje przez cale studia');
  }
  const data = await prisma.studentGroup.update({
    where: { id: group.id },
    data: {
      code: group.partitionKey === ROOT || group.partitionKey === SPEC ? undefined : body.code?.trim() || undefined,
      size: body.size,
      fromSemester: from,
      toSemester: to,
    },
  });
  res.json({ data, message: 'Grupa zapisana' });
});

export const deleteGroup = asyncHandler(async (req, res) => {
  const { group, cohort } = await loadGroupInCohort(String(req.params.id));
  await assertFacultyScope(req, cohort.program.fieldOfStudy.facultyId);
  if (group.partitionKey === ROOT) throw new AppError(409, 'Korzenia rocznika nie usuwa sie — usun caly rocznik');
  const [children, usage, members] = await Promise.all([
    prisma.studentGroup.count({ where: { parentGroupId: group.id } }),
    prisma.studentGroup.count({
      where: { id: group.id, OR: [{ sections: { some: {} } }, { occurrences: { some: {} } }] },
    }),
    prisma.user.count({ where: { studentGroups: { some: { id: group.id } } } }),
  ]);
  if (children > 0) throw new AppError(409, 'Grupa ma podgrupy — usun je najpierw');
  if (usage > 0) {
    throw new AppError(409, 'Grupa jest w planie zajec — zamiast usuwac, zakoncz ja na wybranym semestrze');
  }
  if (members > 0) throw new AppError(409, 'Grupa ma przypisanych studentow');
  await prisma.studentGroup.delete({ where: { id: group.id } });
  res.json({ message: 'Grupa usunieta' });
});

/**
 * Wszystkie grupy aktywnych rocznikow z nazwami liczonymi na biezacy semestr — do wyboru
 * grup studenta w Uzytkownikach. Student nalezy do najmniejszych grup; wyklady calego
 * rocznika i cwiczenia wynikaja z regul nakladania.
 */
export const listGroupOptions = asyncHandler(async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const current = termOfDate(today);
  const cohorts = await prisma.cohort.findMany({ include: cohortInclude });
  const data = [];
  for (const cohort of cohorts) {
    const semester = cohortSemesterInTerm(cohort.startTerm, current);
    if (semester < 1 || semester > cohort.programVersion.totalSemesters) continue;
    for (const g of await cohortGroupsView(cohort, semester)) {
      if (!g.active) continue;
      data.push({ id: g.id, label: `${cohort.program.code}: ${g.name}`, cohortId: cohort.id, leaf: g.childCount === 0 });
    }
  }
  data.sort((a, b) => a.label.localeCompare(b.label));
  res.json({ data });
});
