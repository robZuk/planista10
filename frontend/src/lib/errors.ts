import axios from 'axios';

/** Wyciaga czytelny komunikat bledu z odpowiedzi API ({ error: string }). */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.error ?? 'Blad polaczenia z serwerem';
  }
  return 'Nieznany blad';
}

/**
 * Ostrzezenia o nowym miejscu terminu (swieto, dzien bez zajec, godziny poza oknem siatki),
 * ktore backend zwraca jako 409 `{ code: 'SLOT_WARNINGS', warnings }` — do potwierdzenia
 * i ponowienia z `confirmWarnings: true`. null = inny blad.
 */
export function slotWarningsOf(error: unknown): string[] | null {
  if (!axios.isAxiosError(error)) return null;
  const data = error.response?.data as { code?: string; warnings?: unknown } | undefined;
  return data?.code === 'SLOT_WARNINGS' && Array.isArray(data.warnings) ? data.warnings.map(String) : null;
}

/**
 * Rekord zniknal w miedzyczasie (404) — np. inny planista usunal umieszczenie albo terminy
 * wygenerowano od nowa. Okno nie ma czego zapisac: zamykamy je i odswiezamy widok.
 */
export function isNotFound(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 404;
}
