import { api } from '@/lib/api';
import type { GridDay, StudyMode, TimeGrid } from '@/types';

export async function fetchTimeGrids(): Promise<TimeGrid[]> {
  const res = await api.get('/time-grids');
  return res.data.data;
}

/** Bloki i/lub dni; bloki odrzucane (409), gdy w dniach siatki jest juz plan. */
export async function updateTimeGrid(
  id: string,
  input: { blocks?: { startTime: string; endTime: string }[]; days?: GridDay[] },
): Promise<{ data: TimeGrid; message: string }> {
  const res = await api.put(`/time-grids/${id}`, input);
  return res.data;
}

/** Siatka dnia: wlasne bloki dla wybranych dni (dni przechodza z siatki podstawowej). */
export async function createTimeGrid(input: {
  facultyId: string;
  studyMode: StudyMode;
  days: GridDay[];
  blocks: { startTime: string; endTime: string }[];
}): Promise<{ data: TimeGrid; message: string }> {
  const res = await api.post('/time-grids', input);
  return res.data;
}

/** Usuniecie siatki dnia — jej dni wracaja do siatki podstawowej. */
export async function deleteTimeGrid(id: string): Promise<{ message: string }> {
  const res = await api.delete(`/time-grids/${id}`);
  return res.data;
}
