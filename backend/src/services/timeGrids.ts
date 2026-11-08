import type { Prisma, StudyMode } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { blockLabel, defaultGridDays, gridTime, parseGridDays, type GridDay, type GridTime } from '../lib/timeGrid';

/**
 * Siatki godzin wydzialow: kazdy wydzial ma siatke stacjonarna i niestacjonarna. Siatka
 * rocznika = siatka wydzialu jego kierunku dla trybu studiow programu.
 */

export interface FacultyGrid {
  id: string;
  facultyId: string;
  studyMode: StudyMode;
  days: GridDay[];
  time: GridTime;
  blocks: { id: string; order: number; startTime: string; endTime: string; label: string }[];
}

const key = (facultyId: string, studyMode: StudyMode) => `${facultyId}|${studyMode}`;

function toFacultyGrid(g: Prisma.TimeGridGetPayload<{ include: { blocks: true } }>): FacultyGrid {
  const blocks = [...g.blocks].sort((a, b) => a.order - b.order);
  return { id: g.id, facultyId: g.facultyId, studyMode: g.studyMode, days: parseGridDays(g.days), time: gridTime(blocks), blocks };
}

/** Wszystkie siatki (kilka wydzialow x 2) — jeden odczyt na zadanie. */
export async function loadGrids(): Promise<Map<string, FacultyGrid>> {
  const grids = await prisma.timeGrid.findMany({ include: { blocks: true } });
  return new Map(grids.map((g) => [key(g.facultyId, g.studyMode), toFacultyGrid(g)]));
}

/** Siatka wydzialu i trybu; brak siatki to blad konfiguracji (zaklada ja migracja / nowy wydzial). */
export async function gridFor(facultyId: string, studyMode: StudyMode): Promise<FacultyGrid> {
  const grid = await prisma.timeGrid.findUnique({ where: { facultyId_studyMode: { facultyId, studyMode } }, include: { blocks: true } });
  if (!grid) throw new AppError(409, 'Wydzial nie ma siatki godzin dla tego trybu studiow — ustaw ja w "Siatki godzin"');
  return toFacultyGrid(grid);
}

/** Siatka z mapy wczytanej przez loadGrids (dla rocznika: wydzial kierunku + tryb programu). */
export function pickGrid(grids: Map<string, FacultyGrid>, facultyId: string, studyMode: StudyMode): FacultyGrid | undefined {
  return grids.get(key(facultyId, studyMode));
}

/** Bloki startowe nowej siatki: 07:00-20:00 co godzine (jak dotychczasowa siatka). */
function defaultBlocks() {
  const pad = (n: number) => String(n).padStart(2, '0');
  return Array.from({ length: 13 }, (_, i) => {
    const startTime = `${pad(7 + i)}:00`;
    const endTime = `${pad(8 + i)}:00`;
    return { order: i + 1, startTime, endTime, label: blockLabel(startTime, endTime) };
  });
}

/** Dane do utworzenia obu siatek nowego wydzialu (zagniezdzony create). */
export function defaultGridsCreate() {
  return (['FULL_TIME', 'PART_TIME'] as const).map((studyMode) => ({
    studyMode,
    days: defaultGridDays(studyMode) as unknown as Prisma.InputJsonValue,
    blocks: { create: defaultBlocks() },
  }));
}

/**
 * Czy bloki siatki sa zablokowane: wydzial ma juz umieszczenia w tym trybie w semestrze,
 * ktorego kalendarz nie jest w archiwum. Umieszczenia wskazuja bloki numerem — zmiana godzin
 * przesunelaby zajecia. Terminy niosa wlasne minuty, wiec archiwum zostaje poprawne.
 */
export async function gridLocked(facultyId: string, studyMode: StudyMode): Promise<boolean> {
  const placements = await prisma.placement.count({
    where: {
      facultyId,
      section: { cohort: { program: { studyMode } } },
      term: { calendars: { some: { facultyId, studyMode, status: { not: 'ARCHIVED' } } } },
    },
  });
  return placements > 0;
}
