import type { ClassType, RoomType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { roomTypeMap } from '../lib/scheduleTime';
import { plural } from '../lib/plural';
import { AppError } from '../lib/AppError';
import { asyncHandler } from '../middleware/asyncHandler';
import { foldName } from '../lib/foldName';

// ─── Budynki ─────────────────────────────────────────────────

/** Nazwa budynku i numer sali w budynku sa unikalne — czytelny 409 zamiast ogolnego bledu bazy. */
async function assertBuildingFree(name: string | undefined, exceptId?: string) {
  if (!name) return;
  // Budynkow jest kilkanascie — porownanie w JS, bez polskich znakow i wielkosci liter.
  const all = await prisma.building.findMany({ where: exceptId ? { NOT: { id: exceptId } } : {}, select: { name: true } });
  const other = all.find((b) => foldName(b.name) === foldName(name));
  if (other) throw new AppError(409, `Budynek „${other.name}” juz istnieje`);
}

async function assertRoomFree(buildingId: string, number: string | undefined, exceptId?: string) {
  if (!number) return;
  const other = await prisma.room.findFirst({
    where: { buildingId, number: { equals: number.trim(), mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (other) throw new AppError(409, `Sala ${other.number} juz jest w tym budynku`);
}

export const getAll = asyncHandler(async (_req, res) => {
  const data = await prisma.building.findMany({
    include: { faculty: true, rooms: true },
    orderBy: { name: 'asc' },
  });
  res.json({ data });
});

export const getOne = asyncHandler(async (req, res) => {
  const data = await prisma.building.findUnique({
    where: { id: req.params.id },
    include: { faculty: true, rooms: true },
  });
  if (!data) throw new AppError(404, 'Budynek nie znaleziony');
  res.json({ data });
});

export const create = asyncHandler(async (req, res) => {
  const { name, address, facultyId } = req.body as {
    name: string;
    address?: string;
    facultyId?: string;
  };
  await assertBuildingFree(name);
  const data = await prisma.building.create({ data: { name, address, facultyId } });
  res.status(201).json({ data, message: 'Budynek utworzony' });
});

export const update = asyncHandler(async (req, res) => {
  const { name, address, facultyId } = req.body as {
    name?: string;
    address?: string;
    facultyId?: string;
  };
  await assertBuildingFree(name, String(req.params.id));
  const data = await prisma.building.update({
    where: { id: req.params.id },
    data: { name, address, facultyId },
  });
  res.json({ data, message: 'Budynek zaktualizowany' });
});

export const remove = asyncHandler(async (req, res) => {
  const building = await prisma.building.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { rooms: true } } },
  });
  if (!building) throw new AppError(404, 'Budynek nie znaleziony');
  if (building._count.rooms > 0) throw new AppError(409, 'Usun najpierw wszystkie sale w budynku');
  await prisma.building.delete({ where: { id: req.params.id } });
  res.json({ message: 'Budynek usuniety' });
});

// ─── Sale ────────────────────────────────────────────────────

export const getRooms = asyncHandler(async (req, res) => {
  const data = await prisma.room.findMany({
    where: { buildingId: req.params.id },
    orderBy: { number: 'asc' },
  });
  res.json({ data });
});

export const createRoom = asyncHandler(async (req, res) => {
  const { number, type, capacity } = req.body as {
    number: string;
    type: RoomType;
    capacity: number;
  };
  await assertRoomFree(String(req.params.id), number);
  const data = await prisma.room.create({
    data: { number, type, capacity, buildingId: req.params.id },
  });
  res.status(201).json({ data, message: 'Sala utworzona' });
});

export const updateRoom = asyncHandler(async (req, res) => {
  const { number, type, capacity } = req.body as {
    number?: string;
    type?: RoomType;
    capacity?: number;
  };
  const current = await prisma.room.findUnique({ where: { id: String(req.params.roomId) }, select: { buildingId: true } });
  if (!current) throw new AppError(404, 'Sala nie znaleziona');
  await assertRoomFree(current.buildingId, number, String(req.params.roomId));
  const data = await prisma.room.update({
    where: { id: req.params.roomId },
    data: { number, type, capacity },
  });
  // Zmiany nie blokujemy (plan pokaze niezgodnosc), ale mowimy od razu, ile ulozonych zajec
  // ma teraz grupe wieksza niz sala — w semestrach, ktore nie sa w archiwum.
  const tooSmall = await prisma.placement.count({
    where: {
      roomId: data.id,
      section: { group: { size: { gt: data.capacity } } },
      term: { calendars: { some: { status: { not: 'ARCHIVED' } } } },
    },
  });
  // Typ sali: formy zajec, ktorym nowy typ nie pasuje (lib/scheduleTime.roomTypeMap).
  const misfitClassTypes = (Object.keys(roomTypeMap) as ClassType[]).filter((c) => !roomTypeMap[c].includes(data.type));
  const wrongType = misfitClassTypes.length
    ? await prisma.placement.count({
        where: {
          roomId: data.id,
          section: { classType: { in: misfitClassTypes } },
          term: { calendars: { some: { status: { not: 'ARCHIVED' } } } },
        },
      })
    : 0;
  const problems = [
    ...(tooSmall > 0 ? [`${plural(tooSmall, 'umieszczenie', 'umieszczenia', 'umieszczen')} z grupa wieksza niz ${data.capacity} os.`] : []),
    ...(wrongType > 0 ? [`${plural(wrongType, 'umieszczenie', 'umieszczenia', 'umieszczen')} zajec, do ktorych ten typ sali nie pasuje`] : []),
  ];
  const warning = problems.length > 0 ? `W planie tej sali: ${problems.join('; ')} — zobacz „Niezgodnosci w planie”` : null;
  res.json({ data, message: 'Sala zaktualizowana', warning });
});

export const removeRoom = asyncHandler(async (req, res) => {
  const room = await prisma.room.findUnique({
    where: { id: req.params.roomId },
    include: { _count: { select: { placements: true, occurrences: true } } },
  });
  if (!room) throw new AppError(404, 'Sala nie znaleziona');
  if (room._count.placements > 0 || room._count.occurrences > 0) {
    throw new AppError(409, 'Nie mozna usunac sali przypisanej do planu zajec');
  }
  await prisma.room.delete({ where: { id: req.params.roomId } });
  res.json({ message: 'Sala usunieta' });
});
