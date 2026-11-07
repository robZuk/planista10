/**
 * Daty w planie porownujemy ZAWSZE po tekscie "YYYY-MM-DD", nigdy po obiekcie Date.
 * Backend zapisuje daty jako polnoc UTC, a przegladarka jest w strefie lokalnej —
 * konwersja tam i z powrotem potrafi przesunac termin o dzien.
 */

/** "2026-10-05T00:00:00.000Z" -> "2026-10-05" */
export function toDateKey(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(
    value.getDate(),
  ).padStart(2, '0')}`;
}

export function formatDateLong(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
}
