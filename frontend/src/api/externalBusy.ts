import { api } from '@/lib/api';

/** Kolizja zajetosci zewnetrznej z ulozonym planem (ta sama sala albo prowadzacy). */
export interface ExternalClash {
  date: string;
  reason: 'ROOM' | 'INSTRUCTOR';
  with: string;
}

/** Zajetosc zewnetrzna: zajecia innego wydzialu ze zgloszenia mailowego. */
export interface ExternalBusy {
  id: string;
  source: string;
  receivedOn: string;
  instructor: { id: string; name: string } | null;
  room: { id: string; label: string } | null;
  startMinute: number;
  endMinute: number;
  dates: string[];
  note: string | null;
  clashes: ExternalClash[];
}

export interface ExternalBusyInput {
  source: string;
  receivedOn: string;
  instructorId: string | null;
  roomId: string | null;
  /** GG:MM */
  startTime: string;
  endTime: string;
  dates: string[];
  note: string | null;
}

export async function fetchExternalBusy(termKey: string): Promise<ExternalBusy[]> {
  const res = await api.get(`/terms/${termKey}/external-busy`);
  return res.data.data;
}

export async function createExternalBusy(termKey: string, input: ExternalBusyInput): Promise<{ data: ExternalBusy; message: string }> {
  const res = await api.post(`/terms/${termKey}/external-busy`, input);
  return res.data;
}

export async function updateExternalBusy(id: string, input: ExternalBusyInput): Promise<{ data: ExternalBusy; message: string }> {
  const res = await api.put(`/external-busy/${id}`, input);
  return res.data;
}

export async function deleteExternalBusy(id: string): Promise<void> {
  await api.delete(`/external-busy/${id}`);
}
