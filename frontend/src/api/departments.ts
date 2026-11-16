import { api } from '@/lib/api';
import type { Department } from '@/types';

export interface DepartmentInput {
  name: string;
  shortName: string;
  /** null = jednostka miedzywydzialowa (SJO, prowadzacy zewnetrzni). */
  facultyId: string | null;
}

export async function fetchDepartments(): Promise<Department[]> {
  const res = await api.get('/departments');
  return res.data.data;
}

export async function createDepartment(input: DepartmentInput): Promise<Department> {
  const res = await api.post('/departments', input);
  return res.data.data;
}

export async function updateDepartment(id: string, input: DepartmentInput): Promise<Department> {
  const res = await api.put(`/departments/${id}`, input);
  return res.data.data;
}

export async function deleteDepartment(id: string): Promise<void> {
  await api.delete(`/departments/${id}`);
}

/** Sklad katedry — pelna lista jej prowadzacych; pozostali traca te katedre. */
export async function setDepartmentInstructors(id: string, instructorIds: string[]): Promise<{ message: string }> {
  const res = await api.put(`/departments/${id}/instructors`, { instructorIds });
  return res.data;
}
