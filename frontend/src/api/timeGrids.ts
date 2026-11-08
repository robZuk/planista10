import { api } from '@/lib/api';
import type { GridDay, TimeGrid } from '@/types';

export async function fetchTimeGrids(): Promise<TimeGrid[]> {
  const res = await api.get('/time-grids');
  return res.data.data;
}

/** Bloki i/lub dni; bloki odrzucane (409), gdy wydzial ma juz plan w tym trybie. */
export async function updateTimeGrid(
  id: string,
  input: { blocks?: { startTime: string; endTime: string }[]; days?: GridDay[] },
): Promise<{ data: TimeGrid; message: string }> {
  const res = await api.put(`/time-grids/${id}`, input);
  return res.data;
}
