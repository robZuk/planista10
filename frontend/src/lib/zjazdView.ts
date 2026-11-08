import type { PlanPlacement } from '@/types';

/**
 * Wzorzec zjazdu z podzialem na zjazdy: filtr "zjazd N" i "kopiuj zjazd" maja sens tylko,
 * gdy zjazdy roznia sie zajeciami (lista zjazdow albo zakres od-do). Ta sama regula co
 * `expandDates` w backendzie: wzor (LIST/EVEN/ODD) i zakres od-do lacznie.
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

/** Czy ktores umieszczenie nie odbywa sie we wszystkich zjazdach (czyli zjazdy sie roznia). */
export function zjazdyDiffer(placements: ZjazdRule[], zjazdy: number[]): boolean {
  return placements.some((p) => zjazdy.some((z) => !inZjazd(p, z)));
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
