import type { Prisma, StudyMode } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import {
  blockLabel,
  defaultGridDays,
  gridSet,
  gridTime,
  parseGridDays,
  slotsOutsideDays,
  type DayGrid,
  type GridDay,
  type GridSet,
  type GridTime,
  type WeekdayName,
} from '../lib/timeGrid';

/**
 * Siatki godzin wydzialow: kazdy wydzial ma siatke stacjonarna i niestacjonarna (podstawowe)
 * i opcjonalnie siatki dnia — wlasne bloki dla wybranych dni (np. piatek niestacjonarnych).
 * Siatki rocznika = zestaw siatek wydzialu jego kierunku dla trybu studiow programu; bloki
 * obowiazujace w danym dniu daje `forDay`.
 */

export interface FacultyGrid extends DayGrid {
  id: string;
  facultyId: string;
  studyMode: StudyMode;
  blocks: { id: string; order: number; startTime: string; endTime: string; label: string }[];
}

/** Siatki jednego wydzialu i trybu: podstawowa + siatki dnia (rozlaczne dni). */
export type FacultyGrids = GridSet<FacultyGrid> & { facultyId: string; studyMode: StudyMode };

const key = (facultyId: string, studyMode: StudyMode) => `${facultyId}|${studyMode}`;

type GridRow = Prisma.TimeGridGetPayload<{ include: { blocks: true } }>;

function toFacultyGrid(g: GridRow): FacultyGrid {
  const blocks = [...g.blocks].sort((a, b) => a.order - b.order);
  return { id: g.id, facultyId: g.facultyId, studyMode: g.studyMode, base: g.base, days: parseGridDays(g.days), time: gridTime(blocks), blocks };
}

/** Wiersze siatek jednego wydzialu i trybu -> zestaw (podstawowa pierwsza, siatki dnia wg dat zalozenia). */
export function toFacultyGrids(rows: GridRow[]): FacultyGrids {
  const sorted = [...rows].sort((a, b) => Number(b.base) - Number(a.base) || a.createdAt.getTime() - b.createdAt.getTime());
  return { ...gridSet(sorted.map(toFacultyGrid)), facultyId: sorted[0]!.facultyId, studyMode: sorted[0]!.studyMode };
}

/** Wszystkie siatki (wydzialy x 2 tryby, plus siatki dnia) — jeden odczyt na zadanie. */
export async function loadGrids(): Promise<Map<string, FacultyGrids>> {
  const rows = await prisma.timeGrid.findMany({ include: { blocks: true } });
  const byKey = new Map<string, GridRow[]>();
  for (const row of rows) {
    const k = key(row.facultyId, row.studyMode);
    byKey.set(k, [...(byKey.get(k) ?? []), row]);
  }
  return new Map([...byKey].map(([k, list]) => [k, toFacultyGrids(list)]));
}

/** Siatki wydzialu i trybu; brak siatki to blad konfiguracji (zaklada ja migracja / nowy wydzial). */
export async function gridFor(facultyId: string, studyMode: StudyMode): Promise<FacultyGrids> {
  const rows = await prisma.timeGrid.findMany({ where: { facultyId, studyMode }, include: { blocks: true } });
  if (rows.length === 0) throw new AppError(409, 'Wydzial nie ma siatki godzin dla tego trybu studiow — ustaw ja w "Siatki godzin"');
  return toFacultyGrids(rows);
}

/** Siatki z mapy wczytanej przez loadGrids (dla rocznika: wydzial kierunku + tryb programu). */
export function pickGrid(grids: Map<string, FacultyGrids>, facultyId: string, studyMode: StudyMode): FacultyGrids | undefined {
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

/** Dane do utworzenia obu siatek podstawowych nowego wydzialu (zagniezdzony create). */
export function defaultGridsCreate() {
  return (['FULL_TIME', 'PART_TIME'] as const).map((studyMode) => ({
    studyMode,
    base: true,
    days: defaultGridDays(studyMode) as unknown as Prisma.InputJsonValue,
    blocks: { create: defaultBlocks() },
  }));
}

/** Umieszczenia wydzialu w danym trybie w semestrach, ktore nie sa w archiwum (plan "zywy"); opcjonalnie w wybranych dniach. */
const livePlacements = (facultyId: string, studyMode: StudyMode, days?: WeekdayName[]) => ({
  facultyId,
  ...(days ? { dayOfWeek: { in: days } } : {}),
  section: { cohort: { program: { studyMode } } },
  term: { calendars: { some: { facultyId, studyMode, status: { not: 'ARCHIVED' as const } } } },
});

/**
 * Liczba "zywych" umieszczen wydzialu i trybu w wybranych dniach. Umieszczenia wskazuja bloki
 * numerem — zmiana blokow obowiazujacych w tych dniach przesunelaby zajecia, wiec takie zmiany
 * sa zablokowane. Terminy niosa wlasne minuty, wiec archiwum zostaje poprawne.
 */
export async function placementsOnDays(facultyId: string, studyMode: StudyMode, days: WeekdayName[]): Promise<number> {
  if (days.length === 0) return 0;
  return prisma.placement.count({ where: livePlacements(facultyId, studyMode, days) });
}

/**
 * Nowe dni/okna siatek nie moga wyrzucic poza siatke juz ulozonych zajec — inaczej
 * znikalyby z widoku planu (kolumny dni biora sie z siatek). Zwraca problemy do komunikatu.
 * `days` — suma dni zestawu po zmianie, `timeOf` — bloki obowiazujace w dniu umieszczenia.
 */
export async function placementsOutsideDays(
  facultyId: string,
  studyMode: StudyMode,
  days: GridDay[],
  timeOf: (day: WeekdayName) => GridTime,
): Promise<ReturnType<typeof slotsOutsideDays>> {
  const placements = await prisma.placement.findMany({
    where: livePlacements(facultyId, studyMode),
    select: { dayOfWeek: true, startOrder: true, endOrder: true, section: { select: { cohortId: true } } },
  });
  return slotsOutsideDays(
    placements.map((p) => ({ dayOfWeek: p.dayOfWeek, startOrder: p.startOrder, endOrder: p.endOrder, cohortId: p.section.cohortId })),
    days,
    timeOf,
  );
}
