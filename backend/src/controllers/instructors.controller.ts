import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';

export const getAll = asyncHandler(async (req, res) => {
  const { facultyId } = req.query;
  const data = await prisma.instructor.findMany({
    where: facultyId ? { facultyId: String(facultyId) } : undefined,
    // Konto logowania powiazane z prowadzacym — okno usuwania ostrzega, ze straci ono plan.
    include: { faculty: true, user: { select: { id: true, name: true, email: true } } },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  res.json({ data });
});

export const getOne = asyncHandler(async (req, res) => {
  const data = await prisma.instructor.findUnique({
    where: { id: req.params.id },
    include: { faculty: true },
  });
  if (!data) throw new AppError(404, 'Prowadzacy nie znaleziony');
  res.json({ data });
});

/** E-mail prowadzacego jest unikalny — mowimy, kto go juz ma, zamiast ogolnego 409. */
async function assertEmailFree(email: string | undefined, exceptId?: string): Promise<void> {
  if (!email) return;
  const owner = await prisma.instructor.findFirst({
    where: { email: { equals: email, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (owner) {
    const who = `${owner.title ?? ''} ${owner.firstName} ${owner.lastName}`.trim();
    throw new AppError(409, `Adres ${email} ma juz prowadzacy ${who}`);
  }
}

export const create = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, title, facultyId } = req.body as {
    firstName: string;
    lastName: string;
    email: string;
    title?: string;
    facultyId?: string;
  };
  await assertEmailFree(email);
  const data = await prisma.instructor.create({
    data: { firstName, lastName, email, title, facultyId },
  });
  res.status(201).json({ data, message: 'Prowadzacy utworzony' });
});

export const update = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, title, facultyId } = req.body as {
    firstName?: string;
    lastName?: string;
    email?: string;
    title?: string;
    facultyId?: string;
  };
  await assertEmailFree(email, String(req.params.id));
  const data = await prisma.instructor.update({
    where: { id: req.params.id },
    data: { firstName, lastName, email, title, facultyId },
  });
  res.json({ data, message: 'Prowadzacy zaktualizowany' });
});

export const remove = asyncHandler(async (req, res) => {
  const instructor = await prisma.instructor.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { placements: true, occurrences: true, sectionAssignments: true } } },
  });
  if (!instructor) throw new AppError(404, 'Prowadzacy nie znaleziony');
  if (instructor._count.placements > 0 || instructor._count.occurrences > 0 || instructor._count.sectionAssignments > 0) {
    throw new AppError(409, 'Nie mozna usunac prowadzacego z obsady albo planu zajec');
  }
  await prisma.instructor.delete({ where: { id: req.params.id } });
  res.json({ message: 'Prowadzacy usuniety' });
});
