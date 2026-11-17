import type { ClassType, DegreeLevel, Prisma, ProgramVersionStatus, SemesterType, StudyMode } from '@prisma/client';
import { CLASS_LABEL_PL } from '../lib/scheduleTime';
import { plural } from '../lib/plural';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import { assertFacultyScope } from '../lib/facultyScope';
import type { ProgramEntryInput } from '../schemas/program';
import { lockedEntryChanges, lockedEntryDeleteMessage, lockedEntryMessage } from '../lib/programEntryLock';
import { cohortLabel } from '../services/cohorts';

/**
 * Programy studiow (nowy model). Program = kierunek + poziom + tryb; wersja programu
 * obowiazuje wiele rocznikow. Zatwierdzonej wersji nie edytuje sie po cichu — zmiana
 * programu to nowa wersja sklonowana z poprzedniej (albo swiadome cofniecie do projektu).
 * Zmieniac moze admin albo planista wydzialu, do ktorego nalezy kierunek.
 */

const programInclude = {
  fieldOfStudy: { select: { id: true, name: true, shortName: true, facultyId: true, faculty: { select: { id: true, shortName: true, name: true } } } },
  versions: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      _count: { select: { entries: true } },
      clonedFrom: { select: { id: true, label: true } },
    },
  },
};

async function loadProgram(id: string) {
  const program = await prisma.program.findUnique({ where: { id }, include: { fieldOfStudy: true } });
  if (!program) throw new AppError(404, 'Program nie znaleziony');
  return program;
}

async function loadVersion(id: string) {
  const version = await prisma.programVersion.findUnique({
    where: { id },
    include: { program: { include: { fieldOfStudy: true } } },
  });
  if (!version) throw new AppError(404, 'Wersja programu nie znaleziona');
  return version;
}

function assertDraft(status: ProgramVersionStatus) {
  if (status === 'APPROVED') {
    throw new AppError(
      409,
      'Wersja jest zatwierdzona — utworz nowa wersje (klon) albo cofnij ja do projektu, zeby zmieniac przedmioty',
    );
  }
}

/** Specjalnosc musi nalezec do kierunku programu (albo null = przedmiot wspolny). */
async function assertSpecialization(fieldOfStudyId: string, specializationId: string | null) {
  if (!specializationId) return;
  const spec = await prisma.specialization.findUnique({ where: { id: specializationId } });
  if (!spec || spec.fieldOfStudyId !== fieldOfStudyId) {
    throw new AppError(400, 'Specjalnosc nie nalezy do kierunku tego programu');
  }
}

/**
 * Pozycja bez zadnych godzin i bez ECTS nic nie wnosi do programu (i nie da zajec). Bez godzin,
 * ale z ECTS — dozwolona (np. praktyka zawodowa, praca dyplomowa).
 */
function assertEntryHasContent(input: ProgramEntryInput) {
  const hours = input.hoursLecture + input.hoursExercise + input.hoursLab + input.hoursProject + input.hoursSeminar;
  if (hours === 0 && input.ects === 0) {
    throw new AppError(400, 'Podaj godziny zajec albo punkty ECTS — pozycja bez godzin i bez ECTS nic nie wnosi do programu');
  }
}

/** Ten sam przedmiot w tym samym semestrze nie moze byc jednoczesnie wspolny i specjalnosciowy. */
async function assertNoOverlap(versionId: string, input: ProgramEntryInput, exceptId?: string) {
  const others = await prisma.programEntry.findMany({
    where: { versionId, subjectId: input.subjectId, semester: input.semester, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { specializationId: true },
  });
  const clash = others.some(
    (o) => o.specializationId === input.specializationId || o.specializationId === null || input.specializationId === null,
  );
  if (clash) {
    throw new AppError(
      409,
      input.specializationId === null
        ? 'Ten przedmiot jest juz w tym semestrze (wspolny albo dla specjalnosci)'
        : 'Ten przedmiot jest juz w tym semestrze dla tej specjalnosci albo jako wspolny',
    );
  }
}

// ─── Programy ────────────────────────────────────────────────

export const listPrograms = asyncHandler(async (req, res) => {
  const facultyId = typeof req.query.facultyId === 'string' && req.query.facultyId !== 'all' ? req.query.facultyId : null;
  const data = await prisma.program.findMany({
    where: facultyId ? { fieldOfStudy: { facultyId } } : {},
    include: programInclude,
    orderBy: [{ fieldOfStudy: { name: 'asc' } }, { degreeLevel: 'asc' }, { studyMode: 'asc' }],
  });
  res.json({ data });
});

/** Kod programu (cala uczelnia) i etykieta wersji (w programie) sa unikalne — czytelny 409. */
async function assertProgramCodeFree(code: string | undefined, exceptId?: string) {
  if (!code) return;
  const other = await prisma.program.findFirst({
    where: { code: { equals: code.trim(), mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (other) throw new AppError(409, `Kod ${other.code} ma juz program „${other.name}”`);
}

async function assertVersionLabelFree(programId: string, label: string | undefined, exceptId?: string) {
  if (!label) return;
  const other = await prisma.programVersion.findFirst({
    where: { programId, label: { equals: label.trim(), mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (other) throw new AppError(409, `Program ma juz wersje „${other.label}” — wybierz inna etykiete`);
}

export const createProgram = asyncHandler(async (req, res) => {
  const body = req.body as { code: string; name: string; fieldOfStudyId: string; degreeLevel: DegreeLevel; studyMode: StudyMode };
  const field = await prisma.fieldOfStudy.findUnique({ where: { id: body.fieldOfStudyId } });
  if (!field) throw new AppError(400, 'Kierunek nie istnieje');
  await assertFacultyScope(req, field.facultyId);
  await assertProgramCodeFree(body.code);
  const data = await prisma.program.create({ data: body, include: programInclude });
  res.status(201).json({ data, message: 'Program utworzony' });
});

export const updateProgram = asyncHandler(async (req, res) => {
  const program = await loadProgram(String(req.params.id));
  await assertFacultyScope(req, program.fieldOfStudy.facultyId);
  await assertProgramCodeFree((req.body as { code?: string }).code, program.id);
  const data = await prisma.program.update({
    where: { id: program.id },
    data: req.body as { code: string; name: string },
    include: programInclude,
  });
  res.json({ data, message: 'Program zapisany' });
});

export const deleteProgram = asyncHandler(async (req, res) => {
  const program = await loadProgram(String(req.params.id));
  await assertFacultyScope(req, program.fieldOfStudy.facultyId);
  const versions = await prisma.programVersion.count({ where: { programId: program.id } });
  if (versions > 0) throw new AppError(409, 'Program ma wersje — usun je najpierw');
  await prisma.program.delete({ where: { id: program.id } });
  res.json({ message: 'Program usuniety' });
});

// ─── Wersje ──────────────────────────────────────────────────

/** Nowa wersja: pusta albo klon istniejacej (przedmioty kopiowane 1:1, status: projekt). */
export const createVersion = asyncHandler(async (req, res) => {
  const program = await loadProgram(String(req.params.id));
  await assertFacultyScope(req, program.fieldOfStudy.facultyId);
  const body = req.body as {
    label: string;
    totalSemesters?: number;
    defaultStartType?: SemesterType;
    cloneFromVersionId?: string;
  };

  const source = body.cloneFromVersionId
    ? await prisma.programVersion.findUnique({ where: { id: body.cloneFromVersionId }, include: { entries: { include: { departments: true } } } })
    : null;
  if (body.cloneFromVersionId && (!source || source.programId !== program.id)) {
    throw new AppError(400, 'Wersja zrodlowa nie nalezy do tego programu');
  }
  const totalSemesters = body.totalSemesters ?? source?.totalSemesters;
  if (!totalSemesters) throw new AppError(400, 'Podaj liczbe semestrow');
  await assertVersionLabelFree(program.id, body.label);

  const data = await prisma.programVersion.create({
    data: {
      programId: program.id,
      label: body.label,
      status: 'DRAFT',
      totalSemesters,
      defaultStartType: body.defaultStartType ?? source?.defaultStartType ?? 'WINTER',
      clonedFromId: source?.id ?? null,
      entries: source
        ? {
            create: source.entries
              .filter((e) => e.semester <= totalSemesters)
              .map((e) => ({
                subjectId: e.subjectId,
                semester: e.semester,
                specializationId: e.specializationId,
                orderInSemester: e.orderInSemester,
                hoursLecture: e.hoursLecture,
                hoursExercise: e.hoursExercise,
                hoursLab: e.hoursLab,
                hoursProject: e.hoursProject,
                hoursSeminar: e.hoursSeminar,
                ects: e.ects,
                assessmentType: e.assessmentType,
                // Katedry form zajec (zlecenie wydzialu) ida z przedmiotem do nowej wersji.
                departments: { create: e.departments.map((d) => ({ classType: d.classType, departmentId: d.departmentId })) },
              })),
          }
        : undefined,
    },
    include: { _count: { select: { entries: true } } },
  });
  res.status(201).json({
    data,
    message: source ? `Utworzono wersje "${data.label}" jako kopie "${source.label}"` : `Utworzono pusta wersje "${data.label}"`,
  });
});

/** Wersja z przedmiotami pogrupowanymi po semestrach (z podsumowaniem ECTS i godzin). */
export const getVersion = asyncHandler(async (req, res) => {
  const version = await prisma.programVersion.findUnique({
    where: { id: String(req.params.id) },
    include: {
      program: {
        include: {
          fieldOfStudy: {
            include: {
              faculty: { select: { id: true, name: true, shortName: true } },
              specializations: { select: { id: true, name: true, shortName: true }, orderBy: { name: 'asc' } },
            },
          },
        },
      },
      clonedFrom: { select: { id: true, label: true } },
      // Roczniki na tej wersji — ostrzezenie przy cofaniu do projektu (blokuje ich plan).
      cohorts: { include: { startTerm: true, program: { select: { code: true } } }, orderBy: { startTerm: { startYear: 'desc' } } },
      entries: {
        include: {
          subject: { select: { id: true, name: true, code: true } },
          specialization: { select: { id: true, shortName: true, name: true } },
          // Pozycje z zajeciami: UI blokuje zmiane przedmiotu/specjalnosci/semestru i usuwanie.
          _count: { select: { sections: true } },
        },
        orderBy: [{ semester: 'asc' }, { orderInSemester: 'asc' }],
      },
    },
  });
  if (!version) throw new AppError(404, 'Wersja programu nie znaleziona');

  const { entries, cohorts, ...rest } = version;
  const semesters = Array.from({ length: version.totalSemesters }, (_, i) => {
    const semEntries = entries.filter((e) => e.semester === i + 1);
    return {
      semester: i + 1,
      totalEcts: semEntries.reduce((sum, e) => sum + e.ects, 0),
      totalHours: semEntries.reduce(
        (sum, e) => sum + e.hoursLecture + e.hoursExercise + e.hoursLab + e.hoursProject + e.hoursSeminar,
        0,
      ),
      entries: semEntries,
    };
  });
  // Pozycje poza zakresem semestrow (np. po skroceniu) — zeby nie zniknely z widoku.
  const outOfRange = entries.filter((e) => e.semester > version.totalSemesters);
  res.json({
    data: {
      version: { ...rest, cohorts: cohorts.map((c) => ({ id: c.id, label: cohortLabel(c) })) },
      semesters,
      outOfRange,
    },
  });
});

export const updateVersion = asyncHandler(async (req, res) => {
  const version = await loadVersion(String(req.params.id));
  await assertFacultyScope(req, version.program.fieldOfStudy.facultyId);
  const body = req.body as {
    label?: string;
    status?: ProgramVersionStatus;
    totalSemesters?: number;
    defaultStartType?: SemesterType;
  };
  await assertVersionLabelFree(version.programId, body.label, version.id);
  if (body.totalSemesters !== undefined && body.totalSemesters < version.totalSemesters) {
    const beyond = await prisma.programEntry.count({
      where: { versionId: version.id, semester: { gt: body.totalSemesters } },
    });
    if (beyond > 0) {
      throw new AppError(409, `W semestrach powyzej ${body.totalSemesters} sa przedmioty (${beyond}) — usun je najpierw`);
    }
  }
  const data = await prisma.programVersion.update({ where: { id: version.id }, data: body });
  res.json({
    data,
    message: body.status
      ? body.status === 'APPROVED'
        ? 'Wersja zatwierdzona'
        : 'Wersja cofnieta do projektu'
      : 'Wersja zapisana',
  });
});

export const deleteVersion = asyncHandler(async (req, res) => {
  const version = await loadVersion(String(req.params.id));
  await assertFacultyScope(req, version.program.fieldOfStudy.facultyId);
  const used = await prisma.cohort.count({ where: { programVersionId: version.id } });
  if (used > 0) throw new AppError(409, 'Wersja jest uzywana przez roczniki — nie mozna jej usunac');
  if (version.status === 'APPROVED') {
    throw new AppError(409, 'Zatwierdzonej wersji nie usuwa sie — cofnij ja najpierw do projektu');
  }
  await prisma.programVersion.delete({ where: { id: version.id } });
  res.json({ message: 'Wersja usunieta' });
});

// ─── Przedmioty w wersji ─────────────────────────────────────

export const addEntry = asyncHandler(async (req, res) => {
  const version = await loadVersion(String(req.params.id));
  await assertFacultyScope(req, version.program.fieldOfStudy.facultyId);
  assertDraft(version.status);
  const input = req.body as ProgramEntryInput;
  assertEntryHasContent(input);
  if (input.semester > version.totalSemesters) {
    throw new AppError(400, `Semestr musi byc w zakresie 1-${version.totalSemesters}`);
  }
  await assertSpecialization(version.program.fieldOfStudyId, input.specializationId);
  await assertNoOverlap(version.id, input);
  const last = await prisma.programEntry.aggregate({
    where: { versionId: version.id, semester: input.semester },
    _max: { orderInSemester: true },
  });
  const data = await prisma.programEntry.create({
    data: { ...input, versionId: version.id, orderInSemester: (last._max.orderInSemester ?? 0) + 1 },
  });
  res.status(201).json({ data, message: 'Przedmiot dodany do programu' });
});

async function loadEntry(id: string) {
  const entry = await prisma.programEntry.findUnique({
    where: { id },
    include: { version: { include: { program: { include: { fieldOfStudy: true } } } } },
  });
  if (!entry) throw new AppError(404, 'Pozycja programu nie znaleziona');
  return entry;
}

export const updateEntry = asyncHandler(async (req, res) => {
  const entry = await loadEntry(String(req.params.id));
  const { version } = entry;
  await assertFacultyScope(req, version.program.fieldOfStudy.facultyId);
  assertDraft(version.status);
  const input = req.body as ProgramEntryInput;
  assertEntryHasContent(input);
  if (input.semester > version.totalSemesters) {
    throw new AppError(400, `Semestr musi byc w zakresie 1-${version.totalSemesters}`);
  }
  // Pozycja z zajeciami: przedmiot, specjalnosc i semestr sa czescia historii planu.
  const changes = lockedEntryChanges(entry, input);
  if (changes.length > 0) {
    const sections = await prisma.classSection.count({ where: { programEntryId: entry.id } });
    if (sections > 0) throw new AppError(409, lockedEntryMessage(changes, sections));
  }
  await assertSpecialization(version.program.fieldOfStudyId, input.specializationId);
  await assertNoOverlap(version.id, input, entry.id);
  const data: Prisma.ProgramEntryUncheckedUpdateInput = { ...input };
  if (input.semester !== entry.semester) {
    const last = await prisma.programEntry.aggregate({
      where: { versionId: version.id, semester: input.semester },
      _max: { orderInSemester: true },
    });
    data.orderInSemester = (last._max.orderInSemester ?? 0) + 1;
  }
  const updated = await prisma.programEntry.update({ where: { id: entry.id }, data });
  res.json({ data: updated, message: 'Pozycja zapisana' });
});

export const deleteEntry = asyncHandler(async (req, res) => {
  const entry = await loadEntry(String(req.params.id));
  await assertFacultyScope(req, entry.version.program.fieldOfStudy.facultyId);
  assertDraft(entry.version.status);
  const sections = await prisma.classSection.count({ where: { programEntryId: entry.id } });
  if (sections > 0) throw new AppError(409, lockedEntryDeleteMessage(sections));
  await prisma.programEntry.delete({ where: { id: entry.id } });
  res.json({ message: 'Przedmiot usuniety z programu' });
});

/** Zmiana kolejnosci w semestrze: lista id w nowej kolejnosci. */
export const reorderEntries = asyncHandler(async (req, res) => {
  const version = await loadVersion(String(req.params.id));
  await assertFacultyScope(req, version.program.fieldOfStudy.facultyId);
  assertDraft(version.status);
  const { ids } = req.body as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) throw new AppError(400, 'Podaj liste id');
  const owned = await prisma.programEntry.count({ where: { id: { in: ids }, versionId: version.id } });
  if (owned !== ids.length) throw new AppError(400, 'Lista zawiera pozycje spoza tej wersji');
  await prisma.$transaction(
    ids.map((id, i) => prisma.programEntry.update({ where: { id }, data: { orderInSemester: i + 1 } })),
  );
  res.json({ message: 'Kolejnosc zapisana' });
});

const HOURS_OF: Record<ClassType, 'hoursLecture' | 'hoursExercise' | 'hoursLab' | 'hoursProject' | 'hoursSeminar'> = {
  LECTURE: 'hoursLecture',
  EXERCISE: 'hoursExercise',
  LAB: 'hoursLab',
  PROJECT: 'hoursProject',
  SEMINAR: 'hoursSeminar',
};

/**
 * Katedry form zajec przedmiotow (zlecenie wydzialu) — zbiorczo, np. z zakladki "Zlecenia"
 * w Obsadzie. Dziekanat tylko w programach swojego wydzialu; forma musi miec godziny. Zmiana
 * katedry nie rusza zajec, obsady ani planu, wiec mozna ja robic takze w zatwierdzonej wersji.
 */
export const setEntryDepartments = asyncHandler(async (req, res) => {
  const { items } = req.body as { items: { programEntryId: string; classType: ClassType; departmentId: string | null }[] };
  const entryIds = [...new Set(items.map((i) => i.programEntryId))];
  const entries = await prisma.programEntry.findMany({
    where: { id: { in: entryIds } },
    include: { subject: { select: { name: true } }, version: { select: { program: { select: { fieldOfStudy: { select: { facultyId: true } } } } } } },
  });
  if (entries.length !== entryIds.length) throw new AppError(404, 'Ktoras z pozycji programu juz nie istnieje — odswiez liste');
  for (const facultyId of new Set(entries.map((e) => e.version.program.fieldOfStudy.facultyId))) await assertFacultyScope(req, facultyId);
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const item of items) {
    const entry = byId.get(item.programEntryId)!;
    if (entry[HOURS_OF[item.classType]] <= 0) {
      throw new AppError(400, `${entry.subject.name}: forma ${CLASS_LABEL_PL[item.classType]} nie ma godzin w programie`);
    }
  }
  const departmentIds = [...new Set(items.map((i) => i.departmentId).filter((id): id is string => !!id))];
  if (departmentIds.length > 0 && (await prisma.department.count({ where: { id: { in: departmentIds } } })) !== departmentIds.length) {
    throw new AppError(409, 'Ktoras z wybranych katedr zostala usunieta — odswiez liste');
  }
  await prisma.$transaction(
    items.map((i) =>
      i.departmentId
        ? prisma.programEntryDepartment.upsert({
            where: { programEntryId_classType: { programEntryId: i.programEntryId, classType: i.classType } },
            create: { programEntryId: i.programEntryId, classType: i.classType, departmentId: i.departmentId },
            update: { departmentId: i.departmentId },
          })
        : prisma.programEntryDepartment.deleteMany({ where: { programEntryId: i.programEntryId, classType: i.classType } }),
    ),
  );
  const set = items.filter((i) => i.departmentId).length;
  res.json({
    message:
      set === items.length
        ? `Katedra zapisana: ${plural(set, 'pozycja', 'pozycje', 'pozycji')}`
        : set === 0
          ? `Bez katedry: ${plural(items.length, 'pozycja', 'pozycje', 'pozycji')}`
          : `Katedry zapisane: ${set}, bez katedry: ${items.length - set}`,
  });
});
