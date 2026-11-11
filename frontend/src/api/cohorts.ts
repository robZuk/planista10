import { api } from '@/lib/api';
import type { CohortDto, CohortGroup, CohortLectureMode, IntakeCandidate, TermCohort } from '@/types';

export async function fetchTermCohorts(
  termKey: string,
  facultyId?: string,
): Promise<{ cohorts: TermCohort[]; intakeCandidates: IntakeCandidate[]; startedProgramIds: string[] }> {
  const res = await api.get(`/terms/${termKey}/cohorts`, {
    params: facultyId && facultyId !== 'all' ? { facultyId } : {},
  });
  return {
    cohorts: res.data.data,
    intakeCandidates: res.data.intakeCandidates,
    startedProgramIds: res.data.startedProgramIds ?? [],
  };
}

export async function createCohort(input: {
  programId: string;
  startTermKey: string;
  programVersionId?: string;
  copyStructure?: boolean;
  rootSize?: number;
}): Promise<{ data: CohortDto; message: string }> {
  const res = await api.post('/cohorts', input);
  return res.data;
}

export async function updateCohort(
  id: string,
  input: { programVersionId?: string; lectureMode?: CohortLectureMode; name?: string | null },
): Promise<CohortDto> {
  const res = await api.put(`/cohorts/${id}`, input);
  return res.data.data;
}

export async function deleteCohort(id: string): Promise<void> {
  await api.delete(`/cohorts/${id}`);
}

export async function setCohortTerm(
  termKey: string,
  cohortId: string,
  input: { semester?: number | null; calendarId?: string | null },
): Promise<void> {
  await api.put(`/terms/${termKey}/cohorts/${cohortId}`, input);
}

export async function fetchCohortGroups(
  cohortId: string,
  semester: number,
): Promise<{ cohort: CohortDto; semester: number; groups: CohortGroup[] }> {
  const res = await api.get(`/cohorts/${cohortId}/groups`, { params: { semester } });
  return res.data.data;
}

export async function createCohortGroup(
  cohortId: string,
  input: {
    parentId: string;
    partitionKey: string;
    code?: string;
    specializationId?: string | null;
    size: number;
    fromSemester?: number;
    toSemester?: number | null;
  },
): Promise<void> {
  await api.post(`/cohorts/${cohortId}/groups`, input);
}

export async function createCohortGroupsBulk(
  cohortId: string,
  input: { parentIds: string[]; partitionKey: string; perParent: number; size: number; fromSemester?: number },
): Promise<{ message: string }> {
  const res = await api.post(`/cohorts/${cohortId}/groups/bulk`, input);
  return res.data;
}

export async function updateCohortGroup(
  id: string,
  input: { code?: string; size?: number; fromSemester?: number; toSemester?: number | null },
): Promise<void> {
  await api.put(`/cohort-groups/${id}`, input);
}

export async function deleteCohortGroup(id: string): Promise<void> {
  await api.delete(`/cohort-groups/${id}`);
}

export interface GroupOption {
  id: string;
  label: string;
  cohortId: string;
  leaf: boolean;
}

/** Grupy aktywnych rocznikow z nazwami na biezacy semestr (wybor grup studenta). */
export async function fetchGroupOptions(): Promise<GroupOption[]> {
  const res = await api.get('/cohort-groups/options');
  return res.data.data;
}
