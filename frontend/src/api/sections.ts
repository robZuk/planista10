import { api } from '@/lib/api';
import type { CarryRow, ClassSectionRow, SectionsSummary, SyncReport, WorkloadRow } from '@/types';

const facultyParams = (facultyId?: string) => (facultyId && facultyId !== 'all' ? { facultyId } : {});

export async function fetchSections(
  termKey: string,
  facultyId?: string,
): Promise<{ rows: ClassSectionRow[]; summary: SectionsSummary }> {
  const res = await api.get(`/terms/${termKey}/sections`, { params: facultyParams(facultyId) });
  return { rows: res.data.data, summary: res.data.summary };
}

export async function syncSections(
  termKey: string,
  input: { facultyId?: string; dryRun: boolean },
): Promise<{ data: SyncReport; message: string }> {
  const res = await api.post(`/terms/${termKey}/sections/sync`, { ...input, ...facultyParams(input.facultyId) });
  return res.data;
}

export async function carryInstructors(
  termKey: string,
  input: { facultyId?: string; dryRun: boolean },
): Promise<{ data: { matched: CarryRow[]; unmatched: CarryRow[] }; message: string }> {
  const res = await api.post(`/terms/${termKey}/sections/carry`, { ...input, ...facultyParams(input.facultyId) });
  return res.data;
}

export async function setSectionInstructors(
  sectionId: string,
  assignments: { instructorId: string | null; hours: number }[],
): Promise<{ message: string }> {
  const res = await api.put(`/sections/${sectionId}/instructors`, { assignments });
  return res.data;
}

export async function fetchWorkload(termKey: string, facultyId?: string): Promise<WorkloadRow[]> {
  const res = await api.get(`/terms/${termKey}/workload`, { params: facultyParams(facultyId) });
  return res.data.data;
}

/** Pobranie CSV przez klienta z tokenem i zapis jako plik. */
export async function downloadSectionsCsv(termKey: string, facultyId?: string): Promise<void> {
  const res = await api.get(`/terms/${termKey}/sections/export.csv`, {
    params: facultyParams(facultyId),
    responseType: 'blob',
  });
  const url = URL.createObjectURL(res.data as Blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `obsada-${termKey}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function importSectionsCsv(
  termKey: string,
  input: { csv: string; dryRun: boolean; facultyId?: string },
): Promise<{ data: { applied: number; errors: string[] }; message: string }> {
  const res = await api.post(`/terms/${termKey}/sections/import`, { ...input, ...facultyParams(input.facultyId) });
  return res.data;
}
