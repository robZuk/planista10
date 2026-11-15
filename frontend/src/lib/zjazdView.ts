import type { PlanPlacement } from '@/types';

/**
 * "Plan zjazdu" studiow niestacjonarnych: zawsze jeden konkretny zjazd (tydz. N). Ta sama regula
 * przynaleznosci do zjazdu co `inPeriod`/`expandDates` w backendzie: wzor (LIST/EVEN/ODD)
 * i zakres od-do lacznie.
 */
type ZjazdRule = Pick<PlanPlacement, 'cycle' | 'pattern' | 'numbers' | 'fromIndex' | 'toIndex'>;

/** Czy umieszczenie odbywa sie w zjezdzie o numerze `zjazd`. */
export function inZjazd(p: ZjazdRule, zjazd: number): boolean {
  if (p.cycle !== 'ZJAZD') return true;
  if (p.pattern === 'LIST' && !p.numbers.includes(zjazd)) return false;
  if (p.pattern === 'EVEN' && zjazd % 2 !== 0) return false;
  if (p.pattern === 'ODD' && zjazd % 2 !== 1) return false;
  if (p.fromIndex != null && zjazd < p.fromIndex) return false;
  if (p.toIndex != null && zjazd > p.toIndex) return false;
  return true;
}

/** Zjazdy (numery z kalendarza), w ktorych odbywa sie umieszczenie. */
export function zjazdyOf(p: ZjazdRule, zjazdy: number[]): number[] {
  return zjazdy.filter((z) => inZjazd(p, z));
}

/**
 * Zjazd otwierany w "Planie zjazdu": trwajacy albo najblizszy; po semestrze (i bez dat) pierwszy.
 * Daty jako "YYYY-MM-DD" — porownanie tekstowe wystarcza.
 */
export function defaultZjazd(zjazdy: { number: number; startDate: string; endDate: string }[], today: string): number | null {
  if (zjazdy.length === 0) return null;
  return (zjazdy.find((z) => z.endDate >= today) ?? zjazdy[0]!).number;
}

/**
 * Umieszczenia do skopiowania ze zjazdu `from` na `to`: z lista zjazdow, odbywajace sie w `from`,
 * a w `to` jeszcze nie (i ktorym dopisanie `to` cos da — zakres od-do go nie wyklucza).
 * "Kazdy zjazd" sie nie kopiuje: regula obejmuje juz wszystkie zjazdy z zakresu.
 */
export function copyCandidates<T extends ZjazdRule>(placements: T[], from: number, to: number): T[] {
  return placements.filter(
    (p) => p.cycle === 'ZJAZD' && p.pattern === 'LIST' && inZjazd(p, from) && !inZjazd(p, to) && inZjazd({ ...p, numbers: [...p.numbers, to] }, to),
  );
}
