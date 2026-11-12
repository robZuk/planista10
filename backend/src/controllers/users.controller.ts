import bcrypt from 'bcryptjs';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import { signAccessToken } from '../lib/jwt';

/**
 * Zarzadzanie kontami (tylko ADMIN) + impersonacja.
 *
 * Impersonacja = admin dostaje krotki access token wystawiony na innego
 * uzytkownika, aby zobaczyc system jego oczami (diagnostyka uprawnien/planu).
 * Token jest tylko do odczytu (middleware authenticate odrzuca zapisy).
 * Token niesie tylko { sub, role } — reszta (instructorId, grupy) i tak jest
 * dociagana z bazy po stronie backendu, wiec podszycie sie pod role wystarcza.
 *
 * Walidacja wejscia (pola, format email, min. dlugosc hasla, dozwolone role)
 * jest w validateBody(userCreateSchema/userUpdateSchema) na trasie.
 */

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  instructorId: true,
  facultyId: true,
  createdAt: true,
  instructor: { select: { id: true, firstName: true, lastName: true, title: true } },
  studentGroups: { select: { id: true, code: true, partitionKey: true } },
} as const;

/** Grupy w odpowiedzi z krotka nazwa (pelna liczy sie z rocznika — patrz /cohort-groups/options). */
function withGroupNames<T extends { studentGroups: { id: string; code: string | null; partitionKey: string }[] }>(user: T) {
  return {
    ...user,
    studentGroups: user.studentGroups.map((g) => ({ id: g.id, name: `${g.partitionKey}${g.code ? `-${g.code}` : ''}` })),
  };
}

/**
 * Konto dziekanatu bez wydzialu nie moze niczego zmienic (assertFacultyScope), a widzialoby plan
 * calej uczelni z przyciskami, ktore koncza sie bledem — wiec wydzial jest wymagany i musi istniec.
 */
async function assertDeanFaculty(role: Role, facultyId: string | null | undefined): Promise<void> {
  if (role !== 'DEAN_OFFICE') return;
  if (!facultyId) throw new AppError(400, 'Konto dziekanatu wymaga wydzialu — wybierz wydzial');
  if (!(await prisma.faculty.findUnique({ where: { id: facultyId } }))) throw new AppError(400, 'Wydzial nie istnieje');
}

/**
 * Unikalny e-mail i jeden prowadzacy = jedno konto — czytelny komunikat zamiast ogolnego
 * "Rekord o podanych danych juz istnieje" z bazy. E-mail porownujemy bez wielkosci liter
 * (Jan@ i jan@ to w praktyce ten sam adres).
 */
async function assertUnique(userId: string | null, email: string | undefined, instructorId: string | null | undefined) {
  const notMe = userId ? { NOT: { id: userId } } : {};
  if (email) {
    const other = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, ...notMe }, select: { name: true } });
    if (other) throw new AppError(409, `Adres ${email} ma juz konto: ${other.name}`);
  }
  if (instructorId) {
    const other = await prisma.user.findFirst({ where: { instructorId, ...notMe }, select: { email: true } });
    if (other) throw new AppError(409, `Ten prowadzacy ma juz konto ${other.email} — prowadzacy moze miec jedno konto`);
  }
}

// GET /api/users
export const getAll = asyncHandler(async (_req, res) => {
  const data = await prisma.user.findMany({ select: userSelect, orderBy: { createdAt: 'asc' } });
  res.json({ data: data.map(withGroupNames) });
});

// POST /api/users
export const create = asyncHandler(async (req, res) => {
  const { name, email, password, role, instructorId, studentGroupIds, facultyId } = req.body as {
    name: string;
    email: string;
    password: string;
    role: Role;
    instructorId?: string | null;
    studentGroupIds?: string[];
    facultyId?: string | null;
  };
  await assertDeanFaculty(role, facultyId);
  await assertUnique(null, email, role === 'INSTRUCTOR' ? instructorId : null);

  const data = await prisma.user.create({
    data: {
      name,
      email,
      password: bcrypt.hashSync(password, 12),
      role,
      instructorId: role === 'INSTRUCTOR' ? instructorId || null : null,
      facultyId: role === 'DEAN_OFFICE' ? facultyId || null : null,
      ...(role === 'STUDENT' && Array.isArray(studentGroupIds)
        ? { studentGroups: { connect: studentGroupIds.map((id) => ({ id })) } }
        : {}),
    },
    select: userSelect,
  });
  res.status(201).json({ data: withGroupNames(data), message: 'Uzytkownik utworzony' });
});

// PUT /api/users/:id
export const update = asyncHandler(async (req, res) => {
  const { name, email, role, instructorId, studentGroupIds, password, facultyId } = req.body as {
    name?: string;
    email?: string;
    role?: Role;
    instructorId?: string | null;
    studentGroupIds?: string[];
    password?: string;
    facultyId?: string | null;
  };

  // Wydzial dziekanatu po zmianie: nowa rola i nowy wydzial albo dotychczasowe.
  const current = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, role: true, facultyId: true } });
  if (!current) throw new AppError(404, 'Uzytkownik nie znaleziony');
  await assertDeanFaculty(role ?? current.role, facultyId !== undefined ? facultyId || null : current.facultyId);
  await assertUnique(current.id, email, instructorId);
  // Odebranie roli administratora: nie sobie (zamknieta droga powrotu) i nie ostatniemu adminowi.
  if (current.role === 'ADMIN' && role && role !== 'ADMIN') {
    if (current.id === req.user!.id) throw new AppError(400, 'Nie mozesz odebrac sobie roli administratora');
    if ((await prisma.user.count({ where: { role: 'ADMIN' } })) <= 1) {
      throw new AppError(409, 'To ostatnie konto administratora — najpierw nadaj te role komus innemu');
    }
  }

  // Powiazania sa juz zawezone przez rolę po stronie frontendu
  // (instructorId=null gdy nie-INSTRUCTOR, studentGroupIds=[] gdy nie-STUDENT).
  const data = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      ...(name ? { name } : {}),
      ...(email ? { email } : {}),
      ...(role ? { role } : {}),
      ...(instructorId !== undefined ? { instructorId: instructorId || null } : {}),
      ...(facultyId !== undefined ? { facultyId: facultyId || null } : {}),
      ...(studentGroupIds !== undefined
        ? { studentGroups: { set: studentGroupIds.map((id) => ({ id })) } }
        : {}),
      ...(password ? { password: bcrypt.hashSync(password, 12) } : {}),
    },
    select: userSelect,
  });
  res.json({ data: withGroupNames(data), message: 'Uzytkownik zaktualizowany' });
});

// DELETE /api/users/:id
export const remove = asyncHandler(async (req, res) => {
  if (req.user?.id === req.params.id) {
    throw new AppError(400, 'Nie mozesz usunac wlasnego konta');
  }
  await prisma.user.delete({ where: { id: req.params.id } });
  res.json({ message: 'Uzytkownik usuniety' });
});

// POST /api/users/:id/impersonate
export const impersonate = asyncHandler(async (req, res) => {
  if (req.user?.id === req.params.id) {
    throw new AppError(400, 'Nie mozesz podszyc sie pod samego siebie');
  }
  const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: userSelect });
  if (!target) throw new AppError(404, 'Uzytkownik nie znaleziony');

  // Krotki token (2h) — sesja podgladowa, nieodnawialna (brak refresh tokenu) i tylko do
  // odczytu (`imp` -> authenticate odrzuca zapisy).
  const accessToken = signAccessToken({ sub: target.id, role: target.role, imp: req.user!.id }, '2h');
  res.json({ data: { accessToken, user: withGroupNames(target) } });
});
