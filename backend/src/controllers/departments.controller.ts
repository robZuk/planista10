import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { departmentLabel } from '../lib/department';
import { plural } from '../lib/plural';
import { asyncHandler } from '../middleware/asyncHandler';

/**
 * Katedry (zaklady, studia) — jednostki, ktore przysylaja obciazenia swoich prowadzacych.
 * Edytuje je admin (tak jak prowadzacych), dziekanat widzi liste. Katedra wydzialowa
 * ustala wydzial swoich prowadzacych (KEO-WE -> WE); miedzywydzialowa (SJO) go nie zmienia.
 */

const departmentInclude = {
  faculty: { select: { id: true, name: true, shortName: true } },
  _count: { select: { instructors: true, programEntries: true } },
} satisfies Prisma.DepartmentInclude;

const prowadzacych = (n: number) => plural(n, 'prowadzacy', 'prowadzacych', 'prowadzacych');

export const getAll = asyncHandler(async (_req, res) => {
  const data = await prisma.department.findMany({ include: departmentInclude, orderBy: { shortName: 'asc' } });
  res.json({ data });
});

export const getOne = asyncHandler(async (req, res) => {
  const data = await prisma.department.findUnique({
    where: { id: String(req.params.id) },
    include: {
      ...departmentInclude,
      instructors: {
        select: { id: true, title: true, firstName: true, lastName: true, email: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      },
    },
  });
  if (!data) throw new AppError(404, 'Katedra nie znaleziona');
  res.json({ data });
});

async function assertFacultyExists(facultyId: string | null | undefined): Promise<void> {
  if (!facultyId) return;
  const faculty = await prisma.faculty.findUnique({ where: { id: facultyId }, select: { id: true } });
  if (!faculty) throw new AppError(400, 'Wybrany wydzial nie istnieje');
}

/**
 * Skrot katedry jest unikalny w wydziale, a jednostki bez wydzialu — miedzy soba. Bez
 * wielkosci liter: "keo" i "KEO" na jednym wydziale to ta sama katedra w zleceniu.
 */
async function assertShortNameFree(shortName: string, facultyId: string | null, exceptId?: string): Promise<void> {
  const other = await prisma.department.findFirst({
    where: {
      shortName: { equals: shortName.trim(), mode: 'insensitive' },
      facultyId,
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    include: { faculty: { select: { shortName: true } } },
  });
  if (other) throw new AppError(409, `Skrot ${departmentLabel(other)} ma juz katedra „${other.name}”`);
}

export const create = asyncHandler(async (req, res) => {
  const { name, shortName, facultyId = null } = req.body as { name: string; shortName: string; facultyId?: string | null };
  await assertFacultyExists(facultyId);
  await assertShortNameFree(shortName, facultyId);
  const data = await prisma.department.create({ data: { name, shortName, facultyId }, include: departmentInclude });
  res.status(201).json({ data, message: `Katedra ${departmentLabel(data)} utworzona` });
});

export const update = asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const current = await prisma.department.findUnique({ where: { id } });
  if (!current) throw new AppError(404, 'Katedra nie znaleziona');
  const { name, shortName, facultyId } = req.body as { name?: string; shortName?: string; facultyId?: string | null };
  if (facultyId !== undefined) await assertFacultyExists(facultyId);
  if (shortName !== undefined || facultyId !== undefined) {
    await assertShortNameFree(shortName ?? current.shortName, facultyId === undefined ? current.facultyId : facultyId, id);
  }
  // Prowadzacy katedry wydzialowej maja jej wydzial — przeniesienie katedry na inny wydzial
  // przenosi ich razem z nia. Katedra zmieniona na miedzywydzialowa zostawia im ich wydzial.
  const moveTo = facultyId && facultyId !== current.facultyId ? facultyId : null;
  const data = await prisma.$transaction(async (tx) => {
    const updated = await tx.department.update({ where: { id }, data: { name, shortName, facultyId }, include: departmentInclude });
    if (moveTo) await tx.instructor.updateMany({ where: { departmentId: id }, data: { facultyId: moveTo } });
    return updated;
  });
  res.json({ data, message: `Katedra ${departmentLabel(data)} zaktualizowana` });
});

export const remove = asyncHandler(async (req, res) => {
  const department = await prisma.department.findUnique({ where: { id: String(req.params.id) }, include: departmentInclude });
  if (!department) throw new AppError(404, 'Katedra nie znaleziona');
  // Prowadzacy straciliby katedre po cichu (klucz obcy ustawilby NULL) — wymagamy decyzji.
  if (department._count.instructors > 0) {
    throw new AppError(
      409,
      `Nie mozna usunac katedry ${departmentLabel(department)} — ma ${prowadzacych(department._count.instructors)}. ` +
        'Najpierw zmien ich katedre (sklad katedry albo „Prowadzacy”).',
    );
  }
  // Katedra przypisana do form zajec przedmiotow (zlecenie wydzialu) — klucz obcy RESTRICT.
  if (department._count.programEntries > 0) {
    throw new AppError(
      409,
      `Nie mozna usunac katedry ${departmentLabel(department)} — prowadzi ${plural(department._count.programEntries, 'forme zajec', 'formy zajec', 'form zajec')} przedmiotow. ` +
        'Najpierw przypisz je innej katedrze (Obsada → Zlecenia).',
    );
  }
  await prisma.department.delete({ where: { id: department.id } });
  res.json({ message: `Katedra ${departmentLabel(department)} usunieta` });
});

/**
 * Sklad katedry — pelna lista jej prowadzacych. Odpieci zostaja bez katedry (ze swoim
 * wydzialem); przypieci z innej katedry przechodza do tej. Katedra wydzialowa ustala
 * wydzial przypietych.
 */
export const setInstructors = asyncHandler(async (req, res) => {
  const department = await prisma.department.findUnique({ where: { id: String(req.params.id) }, include: departmentInclude });
  if (!department) throw new AppError(404, 'Katedra nie znaleziona');
  const ids = [...new Set((req.body as { instructorIds: string[] }).instructorIds)];
  // Prowadzacy usuniety w miedzyczasie (inne okno) — czytelny komunikat zamiast cichego pominiecia.
  if (ids.length > 0 && (await prisma.instructor.count({ where: { id: { in: ids } } })) !== ids.length) {
    throw new AppError(409, 'Ktorys z wybranych prowadzacych zostal usuniety — odswiez liste i wybierz ponownie');
  }
  const removed = await prisma.$transaction(async (tx) => {
    const unpinned = await tx.instructor.updateMany({
      where: { departmentId: department.id, id: { notIn: ids } },
      data: { departmentId: null },
    });
    if (ids.length > 0) {
      await tx.instructor.updateMany({
        where: { id: { in: ids } },
        data: { departmentId: department.id, ...(department.facultyId ? { facultyId: department.facultyId } : {}) },
      });
    }
    return unpinned.count;
  });
  res.json({
    data: { instructors: ids.length, removed },
    message:
      `Sklad katedry ${departmentLabel(department)}: ${prowadzacych(ids.length)}` +
      (removed > 0 ? ` (bez tej katedry: ${removed})` : ''),
  });
});
