import type { CalendarPeriod, DayOfWeek, OccurrenceRow, PeriodDay } from '@/types';
import { formatDayMonth } from './planHours';
import { REQUEST_KIND_LABELS } from './requestLabels';

/**
 * Widok tygodnia w "Terminach": terminy jednego tygodnia (albo zjazdu) na siatce dni x godzin,
 * jak wzorzec — ale z datami, swietami i zmianami pojedynczych terminow.
 */

/** Okres na start: ten, w ktorym jest dzisiaj; inaczej pierwszy z terminami; inaczej pierwszy. */
export function initialPeriodIndex(periods: CalendarPeriod[], today: string, occurrenceDates: string[]): number {
  const current = periods.findIndex((p) => p.from <= today && today <= p.to);
  if (current >= 0) return current;
  const first = [...occurrenceDates].sort()[0];
  const withTerms = first ? periods.findIndex((p) => p.from <= first && first <= p.to) : -1;
  return withTerms >= 0 ? withTerms : 0;
}

/** Terminy, ktore wypadaja w okresie. */
export function occurrencesIn(period: CalendarPeriod, occurrences: OccurrenceRow[]): OccurrenceRow[] {
  return occurrences.filter((o) => period.from <= o.date && o.date <= period.to);
}

/**
 * Kolumny siatki: dni trybu studiow z kalendarza (pn-pt albo dni zjazdu) i kazdy inny dzien,
 * na ktory przypada termin (np. odrobienie w sobote). Kolejnosc jak w okresie.
 */
export function periodColumns(period: CalendarPeriod, modeDays: DayOfWeek[], occurrences: OccurrenceRow[]): PeriodDay[] {
  const used = new Set(occurrencesIn(period, occurrences).map((o) => o.date));
  return period.days.filter((d) => modeDays.includes(d.dayOfWeek) || d.teaching || used.has(d.date));
}

const DAY_NAME: Record<DayOfWeek, string> = {
  MONDAY: 'poniedzialek',
  TUESDAY: 'wtorek',
  WEDNESDAY: 'sroda',
  THURSDAY: 'czwartek',
  FRIDAY: 'piatek',
  SATURDAY: 'sobota',
  SUNDAY: 'niedziela',
};

/** Opis dnia pod naglowkiem: swieto/przerwa, zamiana dnia albo godziny rektorskie. */
export function dayNote(day: PeriodDay): string | null {
  if (!day.teaching) return day.label;
  if (day.followsWeekday) return `zajecia wg planu: ${DAY_NAME[day.followsWeekday]}`;
  if (day.closedFromBlockOrder !== null) return day.label ?? 'godziny rektorskie';
  return day.label;
}

/** Oznaczenie terminu na karcie: odwolany, przeniesiony (skad), reczny. */
export function occurrenceMarker(o: OccurrenceRow): string | undefined {
  // Zgloszenie prowadzacego czeka na decyzje — planista ma to widziec, zanim zmieni termin wprost.
  if (o.pendingRequest) return `zgloszenie: ${REQUEST_KIND_LABELS[o.pendingRequest.kind].toLowerCase()}`;
  if (o.status === 'CANCELLED') return o.madeUpBy ? `odwolany, odrobiony ${formatDayMonth(o.madeUpBy.date)}` : 'odwolany';
  if (o.kind === 'MANUAL') return o.makeupOf ? `odrobienie za ${formatDayMonth(o.makeupOf)}` : 'reczny';
  if (o.originalDate && o.originalDate !== o.date) return `przeniesiony z ${formatDayMonth(o.originalDate)}`;
  if (o.changed) return 'zmieniony';
  return undefined;
}

/** Etykieta okresu z zakresem dat: "Tydzien 5 · 03.11–09.11". */
export function periodLabel(period: CalendarPeriod): string {
  return `${period.label} · ${formatDayMonth(period.from)}–${formatDayMonth(period.to)}`;
}
