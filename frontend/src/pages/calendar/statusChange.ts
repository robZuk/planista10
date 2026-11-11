import type { CalendarStatus } from '@/types';
import { formatDayKey } from './calendarUtils';

/**
 * Zmiany statusu kalendarza, ktore wymagaja potwierdzenia, bo jednym kliknieciem psuja
 * dzialajacy plan:
 * - opublikowany -> w przygotowaniu: plan znika studentom i prowadzacym;
 * - archiwum przed koncem semestru: plan zamarza (bez przesuwania i odwolywania zajec).
 * Zwykla publikacja i archiwizacja po semestrze ida bez pytania.
 */
export interface StatusChangeWarning {
  title: string;
  /** Skutek zmiany (bez liczby rocznikow — te dokladamy z /usage). */
  effect: string;
  confirmLabel: string;
}

export function statusChangeWarning(
  calendar: { status: CalendarStatus; endDate: string },
  next: CalendarStatus,
  today: string,
): StatusChangeWarning | null {
  if (next === calendar.status) return null;
  if (calendar.status === 'PUBLISHED' && next === 'PLANNING') {
    return {
      title: 'Cofnac publikacje?',
      effect: 'Plan przestanie byc widoczny dla studentow i prowadzacych, dopoki nie opublikujesz go ponownie.',
      confirmLabel: 'Cofnij publikacje',
    };
  }
  if (next === 'ARCHIVED' && today <= calendar.endDate) {
    return {
      title: 'Przeniesc do archiwum w trakcie semestru?',
      effect:
        `Semestr trwa do ${formatDayKey(calendar.endDate, true)}. W archiwum plan jest tylko do odczytu — ` +
        'nie da sie przesunac ani odwolac zajec. Z archiwum przywroci go tylko administrator.',
      confirmLabel: 'Przenies do archiwum',
    };
  }
  return null;
}

/** Ile planu dotyczy zmiana: roczniki z planem na tym kalendarzu. */
export function usageNote(usage: { cohortsWithPlan: number; occurrences: number } | undefined, pending: boolean): string {
  if (pending || !usage) return 'Sprawdzam, ile rocznikow ma plan na tym kalendarzu...';
  if (usage.cohortsWithPlan === 0) return 'Zaden rocznik nie ma jeszcze planu na tym kalendarzu.';
  return `Dotyczy rocznikow z planem: ${usage.cohortsWithPlan} (terminow: ${usage.occurrences}).`;
}
