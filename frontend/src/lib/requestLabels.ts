import type { ChangeRequestKind, ChangeRequestStatus, MakeupRow } from '@/types';

/** Etykiety zgloszen zmian (UI bez polskich znakow, jak reszta aplikacji). */
export const REQUEST_KIND_LABELS: Record<ChangeRequestKind, string> = {
  CANCEL: 'Odwolanie',
  MOVE: 'Przeniesienie',
  MAKEUP: 'Odrobienie',
};

export const REQUEST_STATUS_LABELS: Record<ChangeRequestStatus, string> = {
  PENDING: 'czeka na dziekanat',
  APPROVED: 'zatwierdzone',
  REJECTED: 'odrzucone',
  WITHDRAWN: 'wycofane',
  SUPERSEDED: 'nieaktualne — plan zmieniony',
};

export const MAKEUP_STATE_LABELS: Record<MakeupRow['state'], string> = {
  TODO: 'do odrobienia',
  REQUESTED: 'termin zgloszony',
  MADE_UP: 'odrobione',
};

/** "2026-11-12" -> "12.11.2026" */
export function formatDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}

/** "przed chwila", "5 min temu", "3 godz. temu", "2 dni temu" — wiek powiadomienia. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'przed chwila';
  if (minutes < 60) return `${minutes} min temu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} godz. temu`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'wczoraj' : `${days} dni temu`;
}
