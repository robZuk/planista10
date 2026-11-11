/**
 * Bilans godzin w Ukladaniu planu: kiedy zajecia sie koncza i czy rytm nie wyczerpuje
 * godzin wyraznie przed koncem semestru (np. 3 h tygodniowo przy 30 h -> koniec w listopadzie).
 * Daty jako tekst YYYY-MM-DD, arytmetyka w UTC.
 */

/** Ile dni przed koncem semestru uznajemy za "wyraznie wczesniej" (4 tygodnie). */
export const EARLY_END_DAYS = 28;

interface SectionHours {
  hours: number;
  plannedHours: number;
  endsOn: string | null;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "2026-11-18" -> "18.11" */
export function formatDayMonth(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

/**
 * Pelne godziny, a ostatni termin ponad EARLY_END_DAYS przed koncem semestru -> liczba
 * tygodni zapasu (zaokraglona w dol); inaczej null. Zajecia niedoplanowane nie sa
 * "wczesnym koncem" — te pokazuje lista Do zaplanowania.
 */
export function earlyEndWeeks(section: SectionHours, semesterEnd: string | null | undefined): number | null {
  if (!section.endsOn || !semesterEnd || section.plannedHours < section.hours) return null;
  const gap = daysBetween(section.endsOn, semesterEnd);
  return gap > EARLY_END_DAYS ? Math.floor(gap / 7) : null;
}

/** Najdluzszy blok proponowany w podpowiedzi wolnych godzin. */
export const MAX_SUGGESTED_LENGTH = 6;

/**
 * Domyslna dlugosc zajec (w blokach) dla podpowiedzi wolnych godzin i nowego umieszczenia:
 * brakujace godziny rozlozone na wszystkie tygodnie (albo zjazdy) semestru, w gore —
 * 15 h w 16 tygodniach -> 1 h, 30 h -> 2 h. Bez kalendarza: 2 h (jak dotad).
 */
export function suggestedLength(section: { hours: number; plannedHours: number }, periods: number): number {
  const missing = section.hours - section.plannedHours;
  const hours = missing > 0 ? missing : section.hours;
  if (hours <= 0) return 1;
  const perPeriod = periods > 0 ? Math.ceil(hours / periods) : 2;
  return Math.max(1, Math.min(perPeriod, hours, MAX_SUGGESTED_LENGTH));
}
