import { api } from '@/lib/api';
import type { Occupancy } from '@/types';

const params = (week?: string | null) => ({ params: week ? { week } : {} });

/** Zajetosc sal calej uczelni w tygodniu `week` (dowolny dzien tygodnia; bez — biezacy albo pierwszy). */
export async function fetchRoomOccupancy(termKey: string, week?: string | null): Promise<Occupancy> {
  const res = await api.get(`/terms/${termKey}/room-occupancy`, params(week));
  return res.data.data;
}

/** Zajetosc prowadzacych calej uczelni w tygodniu `week` (jak zajetosc sal). */
export async function fetchInstructorOccupancy(termKey: string, week?: string | null): Promise<Occupancy> {
  const res = await api.get(`/terms/${termKey}/instructor-occupancy`, params(week));
  return res.data.data;
}
