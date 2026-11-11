import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import { foldName } from '../lib/foldName';

/**
 * Nazwa i skrot kierunku unikalne w obrebie wydzialu — bez wielkosci liter i polskich znakow
 * ("transport" == "Transport"); skrot trafia do nazw grup i kodow, wiec tez nie moze sie powtorzyc.
 */
async function assertFieldFree(facultyId: string, name: string, shortName: string, exceptId?: string) {
  const others = await prisma.fieldOfStudy.findMany({
    where: { facultyId, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { name: true, shortName: true },
  });
  const byName = others.find((f) => foldName(f.name) === foldName(name));
  if (byName) throw new AppError(409, `Kierunek „${byName.name}” juz istnieje na tym wydziale`);
  const byShort = others.find((f) => foldName(f.shortName) === foldName(shortName));
  if (byShort) throw new AppError(409, `Skrot ${byShort.shortName} ma juz kierunek „${byShort.name}” na tym wydziale`);
}

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
  await assertFieldFree(facultyId, name, shortName);
  const data = await prisma.fieldOfStudy.create({ data: { name, shortName, facultyId } });
  res.status(201).json({ data, message: 'Kierunek utworzony' });
});

export const update = asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const { name, shortName } = req.body as { name: string; shortName: string };
  const field = await prisma.fieldOfStudy.findUnique({ where: { id } });
  if (!field) throw new AppError(404, 'Kierunek nie znaleziony');
  await assertFieldFree(field.facultyId, name, shortName, id);
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
