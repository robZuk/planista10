import type { MakeupRow } from '@/types';

/** Stan odwolanych zajec na liscie "Do odrobienia" (UI bez polskich znakow, jak reszta aplikacji). */
export const MAKEUP_STATE_LABELS: Record<MakeupRow['state'], string> = {
  TODO: 'do odrobienia',
  MADE_UP: 'odrobione',
};

/** "2026-11-12" -> "12.11.2026" */
export function formatDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}
