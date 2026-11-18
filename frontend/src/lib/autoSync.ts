import type { AutoSyncSummary } from '@/types';
import { plural } from '@/lib/setupSteps';

/**
 * Zajecia zmienione samoczynnie po zapisie naboru, grup, wersji programu albo kalendarza.
 * Zmiany dodajace (nowe zajecia, przywrocone, godziny zajec bez planu) zapisuja sie same;
 * usuniecia, osierocenia i godziny zajec w planie czekaja na podglad na stronie "Obsada".
 */

/** Dopisek do komunikatu: "zajecia semestru: +4, poprawione 1" (pusty, gdy nic sie nie zmienilo). */
export function appliedText(sync: AutoSyncSummary | undefined): string | null {
  if (!sync) return null;
  const fixed = sync.reactivated + sync.hoursChanged;
  if (sync.created + fixed === 0) return null;
  return `zajecia semestru: +${sync.created}${fixed > 0 ? `, poprawione ${fixed}` : ''}`;
}

/** Zdanie o zmianach czekajacych na decyzje planisty (null — nic nie czeka). */
export function pendingText(sync: AutoSyncSummary | undefined): string | null {
  if (!sync || sync.pending === 0) return null;
  return `${plural(sync.pending, 'zmiana zajec czeka', 'zmiany zajec czekaja', 'zmian zajec czeka')} na Twoja decyzje (usuniecia, osierocenia albo godziny zajec w planie) — zastosujesz je na stronie „Obsada” z podgladem.`;
}
