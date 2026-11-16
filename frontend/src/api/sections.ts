import { api } from '@/lib/api';
import type { CarryRow, ClassSectionRow, SectionsSummary, SyncReport, WorkloadPerson } from '@/types';

export interface StaffAssignmentInput {
  /** null = NN (wakat). */
  instructorId: string | null;
  hours: number;
}

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
): Promise<{ data: { matched: CarryRow[]; unmatched: CarryRow[]; sourceSections: number }; message: string }> {
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

export async function fetchWorkload(termKey: string, facultyId?: string): Promise<WorkloadPerson[]> {
  const res = await api.get(`/terms/${termKey}/workload`, { params: facultyParams(facultyId) });
  return res.data.data;
}

/** Obsada wielu zajec naraz (np. wszystkie grupy przedmiotu) — wszystko albo nic. */
export async function replaceStaff(
  termKey: string,
  changes: { sectionId: string; assignments: StaffAssignmentInput[] }[],
): Promise<{ message: string }> {
  const res = await api.put(`/terms/${termKey}/staff`, { changes });
  return res.data;
}

/** Godziny jednej osoby w wybranych zajeciach (0 = bez niej); obsada innych zostaje, NN ustepuje. */
export async function setPersonStaff(
  termKey: string,
  instructorId: string,
  items: { sectionId: string; hours: number }[],
): Promise<{ message: string }> {
  const res = await api.put(`/terms/${termKey}/instructors/${instructorId}/staff`, { items });
  return res.data;
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
