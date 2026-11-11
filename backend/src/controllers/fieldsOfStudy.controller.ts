import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';

export const getAll = asyncHandler(async (req, res) => {
  const { facultyId } = req.query;
  const data = await prisma.fieldOfStudy.findMany({
    where: facultyId ? { facultyId: String(facultyId) } : undefined,
    include: { faculty: true },
    // Nazwa kierunku jest unikalna dopiero w parze z wydzialem ([name, facultyId]) —
    // patrz analogiczny komentarz w specializations.controller.
    orderBy: [{ name: 'asc' }, { faculty: { name: 'asc' } }, { id: 'asc' }],
  });
  res.json({ data });
});

export const create = asyncHandler(async (req, res) => {
  const { name, shortName, facultyId } = req.body as {
    name: string;
    shortName: string;
    facultyId: string;
  };
  const data = await prisma.fieldOfStudy.create({ data: { name, shortName, facultyId } });
  res.status(201).json({ data, message: 'Kierunek utworzony' });
});

export const update = asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const { name, shortName } = req.body as { name: string; shortName: string };
  const field = await prisma.fieldOfStudy.findUnique({ where: { id } });
  if (!field) throw new AppError(404, 'Kierunek nie znaleziony');
  // Nazwa unikalna w obrebie wydzialu — mowimy wprost, zamiast ogolnego 409.
  const clash = await prisma.fieldOfStudy.findFirst({
    where: { facultyId: field.facultyId, name: { equals: name, mode: 'insensitive' }, NOT: { id } },
  });
  if (clash) throw new AppError(409, `Kierunek „${clash.name}” juz istnieje na tym wydziale`);
  const data = await prisma.fieldOfStudy.update({ where: { id }, data: { name, shortName } });
  res.json({ data, message: 'Kierunek zaktualizowany' });
});

export const remove = asyncHandler(async (req, res) => {
  const field = await prisma.fieldOfStudy.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { specializations: true, programs: true } } },
  });
  if (!field) throw new AppError(404, 'Kierunek nie znaleziony');
  if (field._count.specializations > 0) {
    throw new AppError(409, 'Nie mozna usunac kierunku z przypisanymi specjalnosciami');
  }
  if (field._count.programs > 0) {
    throw new AppError(409, 'Nie mozna usunac kierunku z programami studiow');
  }
  await prisma.fieldOfStudy.delete({ where: { id: req.params.id } });
  res.json({ message: 'Kierunek usuniety' });
});
