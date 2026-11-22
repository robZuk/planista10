import { api } from '@/lib/api';
import type { RoomOccupancy } from '@/types';

/** Zajetosc sal calej uczelni w tygodniu `week` (dowolny dzien tygodnia; bez — biezacy albo pierwszy). */
export async function fetchRoomOccupancy(termKey: string, week?: string | null): Promise<RoomOccupancy> {
  const res = await api.get(`/terms/${termKey}/room-occupancy`, { params: week ? { week } : {} });
  return res.data.data;
}
