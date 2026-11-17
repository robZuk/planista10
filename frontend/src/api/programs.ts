import { api } from '@/lib/api';
import type {
  AssessmentType,
  ClassType,
  DegreeLevel,
  Program,
  ProgramEntry,
  ProgramVersionDetail,
  ProgramVersionStatus,
  ProgramVersionSummary,
  SemesterType,
  StudyMode,
} from '@/types';

export async function fetchPrograms(facultyId?: string): Promise<Program[]> {
  const res = await api.get('/programs', { params: facultyId && facultyId !== 'all' ? { facultyId } : {} });
  return res.data.data;
}

export interface ProgramInput {
  code: string;
  name: string;
  fieldOfStudyId: string;
  degreeLevel: DegreeLevel;
  studyMode: StudyMode;
}

export async function createProgram(input: ProgramInput): Promise<Program> {
  const res = await api.post('/programs', input);
  return res.data.data;
}

export async function deleteProgram(id: string): Promise<void> {
  await api.delete(`/programs/${id}`);
}

export async function createProgramVersion(
  programId: string,
  input: { label: string; totalSemesters?: number; defaultStartType?: SemesterType; cloneFromVersionId?: string },
): Promise<{ data: ProgramVersionSummary; message: string }> {
  const res = await api.post(`/programs/${programId}/versions`, input);
  return res.data;
}

export async function fetchProgramVersion(id: string): Promise<ProgramVersionDetail> {
  const res = await api.get(`/program-versions/${id}`);
  return res.data.data;
}

export async function updateProgramVersion(
  id: string,
  input: { label?: string; status?: ProgramVersionStatus; totalSemesters?: number; defaultStartType?: SemesterType },
): Promise<{ message: string }> {
  const res = await api.put(`/program-versions/${id}`, input);
  return res.data;
}

export async function deleteProgramVersion(id: string): Promise<void> {
  await api.delete(`/program-versions/${id}`);
}

export interface ProgramEntryInput {
  subjectId: string;
  semester: number;
  specializationId: string | null;
  hoursLecture: number;
  hoursExercise: number;
  hoursLab: number;
  hoursProject: number;
  hoursSeminar: number;
  ects: number;
  assessmentType: AssessmentType;
}

export async function addProgramEntry(versionId: string, input: ProgramEntryInput): Promise<ProgramEntry> {
  const res = await api.post(`/program-versions/${versionId}/entries`, input);
  return res.data.data;
}

export async function updateProgramEntry(id: string, input: ProgramEntryInput): Promise<ProgramEntry> {
  const res = await api.put(`/program-entries/${id}`, input);
  return res.data.data;
}

export async function deleteProgramEntry(id: string): Promise<void> {
  await api.delete(`/program-entries/${id}`);
}

export async function reorderProgramEntries(versionId: string, ids: string[]): Promise<void> {
  await api.put(`/program-versions/${versionId}/order`, { ids });
}

/** Katedry form zajec przedmiotow programu (zlecenie wydzialu); departmentId null = bez katedry. */
export async function setEntryDepartments(
  items: { programEntryId: string; classType: ClassType; departmentId: string | null }[],
): Promise<{ message: string }> {
  const res = await api.put('/program-entries/departments', { items });
  return res.data;
}
