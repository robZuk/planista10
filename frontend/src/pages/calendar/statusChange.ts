import type { CalendarStatus } from '@/types';
import { formatDayKey } from './calendarUtils';

/**
 * Zmiany statusu kalendarza, ktore wymagaja potwierdzenia:
 * - publikacja: terminy rocznikow przeliczaja sie jeszcze raz i trafiaja do studentow i prowadzacych,
 *   a dalsze zmiany wzorca wejda do terminow dopiero po „Generuj terminy” (podglad: ile rocznikow);
 * - opublikowany -> w przygotowaniu: plan znika studentom i prowadzacym;
 * - archiwum przed koncem semestru: plan zamarza (bez przesuwania zajec).
 * Archiwizacja po semestrze i powrot z archiwum ida bez pytania.
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
  if (calendar.status === 'PLANNING' && next === 'PUBLISHED') {
    return {
      title: 'Opublikowac plan?',
      effect:
        'Terminy rocznikow tego kalendarza przelicza sie jeszcze raz i zobacza je studenci i prowadzacy („Moj plan”). ' +
        'Potem zmiany wzorca wejda do terminow dopiero po „Generuj terminy”.',
      confirmLabel: 'Opublikuj',
    };
  }
  if (calendar.status === 'PUBLISHED' && next === 'PLANNING') {
    return {
      title: 'Cofnac publikacje?',
      effect:
        'Plan przestanie byc widoczny dla studentow i prowadzacych, dopoki nie opublikujesz go ponownie. ' +
        'Terminy znow beda sie przeliczac same po kazdej zmianie planu.',
      confirmLabel: 'Cofnij publikacje',
    };
  }
  if (next === 'ARCHIVED' && today <= calendar.endDate) {
    return {
      title: 'Przeniesc do archiwum w trakcie semestru?',
      effect:
        `Semestr trwa do ${formatDayKey(calendar.endDate, true)}. W archiwum plan jest tylko do odczytu — ` +
        'nie da sie przesunac zajec. Z archiwum przywroci go tylko administrator.',
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
