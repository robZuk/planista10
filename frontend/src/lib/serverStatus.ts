import axios from 'axios';
import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Serwer niedostepny = brak odpowiedzi (siec, wylaczony backend) albo 502/503/504 z proxy
 * bez naszej koperty bledu ({ error }). Zwykle bledy aplikacji (400/409, 500 z komunikatem)
 * obsluguja strony — to nie jest "brak polaczenia".
 */
export function isServerUnavailable(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const res = error.response;
  if (!res) return true;
  const hasAppError = typeof (res.data as { error?: unknown } | undefined)?.error === 'string';
  return res.status >= 500 && !hasAppError;
}

const TOAST_ID = 'server-unavailable';
const RETRY_MS = 10_000;

/**
 * Jeden komunikat "Brak polaczenia z serwerem" zamiast pustych stron i zer, ktore wygladaja jak
 * prawdziwe dane. Dopoki serwer nie odpowiada, co 10 s ponawiamy aktywne zapytania; pierwsza
 * udana odpowiedz zamyka komunikat i odswieza dane.
 */
export function createServerWatch(getClient: () => QueryClient) {
  let down = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const retry = () => void getClient().refetchQueries({ type: 'active' });

  return {
    onError(error: unknown) {
      if (!isServerUnavailable(error) || down) return;
      down = true;
      toast.error('Brak polaczenia z serwerem', {
        id: TOAST_ID,
        description: 'Dane na stronie moga byc puste albo nieaktualne. Ponawiamy co 10 s.',
        duration: Infinity,
        action: { label: 'Sprobuj ponownie', onClick: retry },
      });
      timer = setInterval(retry, RETRY_MS);
    },
    onSuccess() {
      if (!down) return;
      down = false;
      if (timer) clearInterval(timer);
      timer = null;
      toast.dismiss(TOAST_ID);
      toast.success('Polaczenie z serwerem przywrocone');
      // Strony, ktore pobraly sie z bledem (puste listy, zera), dostaja swieze dane.
      void getClient().invalidateQueries();
    },
  };
}
