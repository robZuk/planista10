import { api } from '@/lib/api';
import type { TimeBlock } from '@/types';

/** Bloki pierwszej siatki stacjonarnej (tylko odczyt) — plan bierze siatke wydzialu rocznika. */
export async function fetchTimeBlocks(): Promise<TimeBlock[]> {
  const res = await api.get('/time-blocks');
  return res.data.data;
}

