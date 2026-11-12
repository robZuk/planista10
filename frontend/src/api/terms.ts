import { api } from '@/lib/api';
import type {
  AcademicTerm,
  CalendarBody,
  CalendarPreview,
  CalendarProposal,
  CalendarStatus,
  SemesterType,
  StudyMode,
  TermCalendar,
} from '@/types';

export interface TermsResponse {
  terms: AcademicTerm[];
  /** Semestr, ktory wydzial aktualnie planuje (domyslny wybor przelacznika). */
  defaultKey: string | null;
}

export async function fetchTerms(): Promise<TermsResponse> {
  const res = await api.get('/terms');
  return { terms: res.data.data, defaultKey: res.data.defaultKey };
}

export async function createTerm(input: { startYear: number; type: SemesterType }): Promise<AcademicTerm> {
  const res = await api.post('/terms', input);
  return res.data.data;
}

export async function deleteTerm(key: string): Promise<void> {
  await api.delete(`/terms/${key}`);
}

export async function fetchTermCalendars(termKey: string, facultyId?: string): Promise<TermCalendar[]> {
  const res = await api.get(`/terms/${termKey}/calendars`, {
    params: facultyId && facultyId !== 'all' ? { facultyId } : {},
  });
  return res.data.data;
}

export async function fetchCalendarProposal(
  termKey: string,
  params: { facultyId?: string; studyMode: StudyMode; name: string },
): Promise<CalendarProposal> {
  const res = await api.get(`/terms/${termKey}/calendars/proposal`, { params });
  return res.data.data;
}

export async function createTermCalendar(
  termKey: string,
  input: CalendarBody & { studyMode: StudyMode; facultyId?: string; allFaculties?: boolean },
): Promise<{ data: TermCalendar[]; message: string }> {
  const res = await api.post(`/terms/${termKey}/calendars`, input);
  return res.data;
}

/** Zapis kalendarza; `warning` — np. umieszczenia na zjazdach, ktorych juz nie ma (zapis przeszedl). */
export async function updateTermCalendar(id: string, input: CalendarBody): Promise<{ calendar: TermCalendar; warning: string | null }> {
  const res = await api.put(`/term-calendars/${id}`, input);
  return { calendar: res.data.data, warning: res.data.warning ?? null };
}

export async function setTermCalendarStatus(id: string, status: CalendarStatus): Promise<TermCalendar> {
  const res = await api.put(`/term-calendars/${id}/status`, { status });
  return res.data.data;
}

/** Ile planu stoi na kalendarzu; deleteBlock = powod, dla ktorego nie mozna go usunac. */
export interface CalendarUsage {
  cohorts: number;
  cohortsWithPlan: number;
  placements: number;
  occurrences: number;
  deleteBlock: string | null;
}

export async function fetchCalendarUsage(id: string): Promise<CalendarUsage> {
  const res = await api.get(`/term-calendars/${id}/usage`);
  return res.data.data;
}

export async function deleteTermCalendar(id: string): Promise<void> {
  await api.delete(`/term-calendars/${id}`);
}

export async function previewTermCalendar(
  input: CalendarBody & { studyMode: StudyMode },
): Promise<CalendarPreview> {
  const res = await api.post('/term-calendars/preview', input);
  return res.data.data;
}
