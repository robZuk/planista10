import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import { foldName } from '../lib/foldName';

/**
 * Nazwa i skrot specjalnosci unikalne na kierunku — bez wielkosci liter i polskich znakow.
 * Skrot jest kodem grupy specjalnosci (np. SPEC-DUT), wiec powtorzony dawalby dwie takie same grupy.
 */
async function assertSpecFree(fieldOfStudyId: string, name: string, shortName: string, exceptId?: string) {
  const others = await prisma.specialization.findMany({
    where: { fieldOfStudyId, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { name: true, shortName: true },
  });
  const byName = others.find((s) => foldName(s.name) === foldName(name));
  if (byName) throw new AppError(409, `Specjalnosc „${byName.name}” juz istnieje na tym kierunku`);
  const byShort = others.find((s) => foldName(s.shortName) === foldName(shortName));
  if (byShort) throw new AppError(409, `Skrot ${byShort.shortName} ma juz specjalnosc „${byShort.name}” na tym kierunku`);
}

export const getAll = asyncHandler(async (req, res) => {
  const { fieldOfStudyId } = req.query;
  const data = await prisma.specialization.findMany({
    where: fieldOfStudyId ? { fieldOfStudyId: String(fieldOfStudyId) } : undefined,
    include: { fieldOfStudy: { include: { faculty: true } } },
    // Nazwa specjalnosci jest unikalna dopiero w parze z kierunkiem ([name, fieldOfStudyId]),
    // wiec sama nie porzadkuje listy jednoznacznie. Bez dosortowania dwie specjalnosci
    // o tej samej nazwie zamienialyby sie miejscami po edycji dowolnej z nich.
    orderBy: [{ name: 'asc' }, { fieldOfStudy: { name: 'asc' } }, { id: 'asc' }],
  });
  res.json({ data });
});

export const create = asyncHandler(async (req, res) => {
  const { name, shortName, fieldOfStudyId } = req.body as {
    name: string;
    shortName: string;
    fieldOfStudyId: string;
  };
  await assertSpecFree(fieldOfStudyId, name, shortName);
  const data = await prisma.specialization.create({ data: { name, shortName, fieldOfStudyId } });
  res.status(201).json({ data, message: 'Specjalnosc utworzona' });
});

export const update = asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const { name, shortName } = req.body as { name: string; shortName: string };
  const spec = await prisma.specialization.findUnique({ where: { id } });
  if (!spec) throw new AppError(404, 'Specjalnosc nie znaleziona');
  await assertSpecFree(spec.fieldOfStudyId, name, shortName, id);
  const data = await prisma.specialization.update({ where: { id }, data: { name, shortName } });
  res.json({ data, message: 'Specjalnosc zaktualizowana' });
});

export const remove = asyncHandler(async (req, res) => {
  const spec = await prisma.specialization.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { programEntries: true, studentGroups: true } } },
  });
  if (!spec) throw new AppError(404, 'Specjalnosc nie znaleziona');
  if (spec._count.programEntries > 0) {
    throw new AppError(409, 'Nie mozna usunac specjalnosci z przedmiotami w programach studiow');
  }
  if (spec._count.studentGroups > 0) {
    throw new AppError(409, 'Nie mozna usunac specjalnosci z przypisanymi grupami studenckimi');
  }
  await prisma.specialization.delete({ where: { id: req.params.id } });
  res.json({ message: 'Specjalnosc usunieta' });
});
