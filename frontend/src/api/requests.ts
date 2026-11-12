import { api } from '@/lib/api';
import type { ChangeRequestKind, ChangeRequestRow, ChangeRequestStatus, MakeupRow, RequestOptions } from '@/types';

/** Zgloszenia zmian prowadzacych (odwolanie, przeniesienie, odrobienie) i decyzje dziekanatu. */

export async function fetchRequests(termKey: string, opts: { status?: ChangeRequestStatus; facultyId?: string | null } = {}): Promise<ChangeRequestRow[]> {
  const params: Record<string, string> = {};
  if (opts.status) params.status = opts.status;
  if (opts.facultyId && opts.facultyId !== 'all') params.facultyId = opts.facultyId;
  const res = await api.get(`/terms/${termKey}/requests`, { params });
  return res.data.data;
}

export async function fetchMakeups(termKey: string, facultyId?: string | null): Promise<MakeupRow[]> {
  const res = await api.get(`/terms/${termKey}/makeups`, { params: facultyId && facultyId !== 'all' ? { facultyId } : {} });
  return res.data.data;
}

export async function fetchRequestOptions(occurrenceId: string): Promise<RequestOptions> {
  const res = await api.get(`/occurrences/${occurrenceId}/request-options`);
  return res.data.data;
}

export interface RequestInput {
  kind: ChangeRequestKind;
  reason: string;
  date?: string;
  startOrder?: number;
  endOrder?: number;
  roomId?: string | null;
  online?: boolean;
}

export async function createChangeRequest(occurrenceId: string, input: RequestInput): Promise<{ message: string }> {
  const res = await api.post(`/occurrences/${occurrenceId}/requests`, input);
  return res.data;
}

export async function approveChangeRequest(id: string, note: string, confirmWarnings = false): Promise<{ message: string }> {
  const res = await api.post(`/change-requests/${id}/approve`, { note, confirmWarnings });
  return res.data;
}

export async function rejectChangeRequest(id: string, note: string): Promise<{ message: string }> {
  const res = await api.post(`/change-requests/${id}/reject`, { note });
  return res.data;
}

export async function withdrawChangeRequest(id: string): Promise<{ message: string }> {
  const res = await api.post(`/change-requests/${id}/withdraw`);
  return res.data;
}

export interface PendingRequests {
  pending: number;
  /** Gdzie czekaja: semestr i wydzial (do podpowiedzi na stronie zgloszen). */
  groups: { termKey: string; termLabel: string; facultyId: string; faculty: string; count: number }[];
}

/** Zgloszenia czekajace na decyzje w zakresie planisty (admin: uczelnia, dziekanat: wydzial). */
export async function fetchPendingRequests(): Promise<PendingRequests> {
  const res = await api.get('/change-requests/pending-count');
  return res.data.data;
}
