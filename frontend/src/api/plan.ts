import { api } from '@/lib/api';
import type {
  CarryPlanReport,
  GenerateReport,
  MyPlanRow,
  OccurrenceRow,
  PlacementPayload,
  PlanView,
  SetupStatus,
} from '@/types';

export async function fetchPlan(termKey: string, cohortId: string): Promise<PlanView> {
  const res = await api.get(`/terms/${termKey}/plan`, { params: { cohortId } });
  return res.data.data;
}

export interface Availability {
  days: string[];
  /** dzien -> order bloku startowego -> powod zajetosci (null = wolne) */
  cells: Record<string, Record<number, string | null>>;
}

export async function fetchAvailability(
  termKey: string,
  params: { sectionId: string; length: number; cycle: 'WEEK' | 'ZJAZD'; numbers?: number[]; roomId?: string },
): Promise<Availability> {
  const res = await api.get(`/terms/${termKey}/plan/availability`, {
    params: { ...params, numbers: params.numbers?.join(',') || undefined },
  });
  return res.data.data;
}

export async function createPlacement(termKey: string, input: PlacementPayload): Promise<{ message: string }> {
  const res = await api.post(`/terms/${termKey}/placements`, input);
  return res.data;
}

export async function updatePlacement(id: string, input: Partial<PlacementPayload>): Promise<{ message: string }> {
  const res = await api.put(`/placements/${id}`, input);
  return res.data;
}

/**
 * "Plan zjazdu": zmiana zajec tylko w zjezdzie `zjazd` albo przeniesienie ich do zjazdu `toZjazd`
 * (backend rozdziela umieszczenie obejmujace kilka zjazdow).
 */
export async function splitPlacement(
  id: string,
  input: Pick<PlacementPayload, 'dayOfWeek' | 'startOrder' | 'endOrder' | 'roomId' | 'instructorId'> & { zjazd: number; toZjazd?: number },
): Promise<{ message: string }> {
  const res = await api.post(`/placements/${id}/split`, input);
  return res.data;
}

export async function deletePlacement(id: string): Promise<{ message: string }> {
  const res = await api.delete(`/placements/${id}`);
  return res.data;
}

export async function generateOccurrences(
  termKey: string,
  input: { cohortIds?: string[]; fromDate?: string | null; dryRun: boolean; facultyId?: string },
): Promise<{ data: GenerateReport; message: string }> {
  const res = await api.post(`/terms/${termKey}/generate`, input);
  return res.data;
}

export async function fetchOccurrences(termKey: string, cohortId: string): Promise<OccurrenceRow[]> {
  const res = await api.get(`/terms/${termKey}/occurrences`, { params: { cohortId } });
  return res.data.data;
}

export async function changeOccurrence(
  id: string,
  input: {
    action: 'MODIFY' | 'RESTORE';
    date?: string;
    startOrder?: number;
    endOrder?: number;
    roomId?: string;
    /** true = na online (bez sali); false + roomId = do sali. */
    online?: boolean;
    instructorId?: string | null;
    note?: string;
    /** Potwierdzenie ostrzezen o dniu/godzinach (lib/errors → slotWarningsOf). */
    confirmWarnings?: boolean;
  },
): Promise<{ message: string }> {
  const res = await api.put(`/occurrences/${id}`, input);
  return res.data;
}

export async function createManualOccurrence(
  termKey: string,
  input: {
    sectionId: string;
    date: string;
    startOrder: number;
    endOrder: number;
    roomId: string | null;
    online?: boolean;
    instructorId?: string | null;
    note?: string;
    confirmWarnings?: boolean;
  },
): Promise<{ message: string }> {
  const res = await api.post(`/terms/${termKey}/occurrences`, input);
  return res.data;
}

export async function deleteManualOccurrence(id: string): Promise<{ message: string }> {
  const res = await api.delete(`/occurrences/${id}`);
  return res.data;
}

export async function carryPlan(
  termKey: string,
  input: { cohortIds: string[]; dryRun: boolean; facultyId?: string },
): Promise<{ data: CarryPlanReport; message: string }> {
  const res = await api.post(`/terms/${termKey}/plan/carry`, input);
  return res.data;
}

export async function fetchSetup(termKey: string, facultyId?: string): Promise<SetupStatus> {
  const res = await api.get(`/terms/${termKey}/setup`, {
    params: facultyId && facultyId !== 'all' ? { facultyId } : {},
  });
  return res.data.data;
}

/** Plan osobisty tygodnia: terminy i dni wolne (data -> nazwa swieta/przerwy). */
/** Plan osobisty tygodnia; `range` — zakres semestru wg opublikowanych kalendarzy osoby (null = planu jeszcze nie ma). */
export async function fetchMyPlan(
  termKey: string,
  from: string,
  to: string,
): Promise<{ rows: MyPlanRow[]; daysOff: Record<string, string>; range: { start: string; end: string } | null }> {
  const res = await api.get(`/terms/${termKey}/my-plan`, { params: { from, to } });
  return { rows: res.data.data, daysOff: res.data.daysOff ?? {}, range: res.data.range ?? null };
}

/** Czyj plan drukujemy: rocznik (opcjonalnie grupa), prowadzacy albo sala. */
export type PlanPdfSubject = { cohortId: string; groupId?: string } | { instructorId: string } | { roomId: string };

/**
 * Druk planu (PDF z backendu, A4 poziomo) — plik i jego nazwa z naglowka Content-Disposition
 * (np. "plan-NAW-S2-semestr-2-2026-Z.pdf"). Okno podgladu pokazuje go i pozwala pobrac.
 */
export async function fetchPlanPdf(termKey: string, subject: PlanPdfSubject): Promise<{ blob: Blob; fileName: string }> {
  const res = await api.get(`/terms/${termKey}/plan/pdf`, { params: subject, responseType: 'blob' });
  const disposition = String(res.headers['content-disposition'] ?? '');
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `plan-${termKey}.pdf`;
  return { blob: res.data as Blob, fileName };
}
