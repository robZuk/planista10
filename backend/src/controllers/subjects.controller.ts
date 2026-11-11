import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';

/** Liczba wpisow programow z przedmiotem — front pokazuje zasieg zmiany nazwy i blokade usuwania. */
const usage = { _count: { select: { programEntries: true } } } as const;

export const getAll = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const data = await prisma.subject.findMany({
    where: search ? { name: { contains: String(search), mode: 'insensitive' } } : undefined,
    include: usage,
    orderBy: { name: 'asc' },
  });
  res.json({ data });
});

/**
 * Nazwa i kod przedmiotu sa unikalne w calej uczelni. Sprawdzamy wprost (nazwa bez
 * wzgledu na wielkosc liter), zeby powiedziec, CO sie powtarza, zamiast ogolnego 409.
 */
async function assertUnique(name: string, code: string | null, exceptId?: string): Promise<void> {
  const notSelf = exceptId ? { NOT: { id: exceptId } } : {};
  const sameName = await prisma.subject.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, ...notSelf } });
  if (sameName) throw new AppError(409, `Przedmiot o nazwie „${sameName.name}” juz istnieje`);
  if (code) {
    const sameCode = await prisma.subject.findFirst({ where: { code: { equals: code, mode: 'insensitive' }, ...notSelf } });
    if (sameCode) throw new AppError(409, `Kod ${sameCode.code} ma juz przedmiot „${sameCode.name}”`);
  }
}

const subjectInput = (body: { name: string; code?: string }) => ({ name: body.name, code: body.code || null });

export const create = asyncHandler(async (req, res) => {
  const { name, code } = subjectInput(req.body as { name: string; code?: string });
  await assertUnique(name, code);
  const data = await prisma.subject.create({ data: { name, code }, include: usage });
  res.status(201).json({ data, message: 'Przedmiot utworzony' });
});

/** Zmiana nazwy/kodu — slownik jest wspolny, wiec obejmuje wszystkie programy z tym przedmiotem. */
export const update = asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const { name, code } = subjectInput(req.body as { name: string; code?: string });
  if (!(await prisma.subject.findUnique({ where: { id } }))) throw new AppError(404, 'Przedmiot nie znaleziony');
  await assertUnique(name, code, id);
  const data = await prisma.subject.update({ where: { id }, data: { name, code }, include: usage });
  res.json({ data, message: 'Przedmiot zaktualizowany' });
});

export const remove = asyncHandler(async (req, res) => {
  const subject = await prisma.subject.findUnique({
    where: { id: String(req.params.id) },
    include: usage,
  });
  if (!subject) throw new AppError(404, 'Przedmiot nie znaleziony');
  if (subject._count.programEntries > 0) {
    throw new AppError(409, 'Nie mozna usunac przedmiotu uzywanego w programach studiow');
  }
  await prisma.subject.delete({ where: { id: subject.id } });
  res.json({ message: 'Przedmiot usuniety' });
});
