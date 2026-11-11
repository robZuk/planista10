import type { DayBlockReason } from './teachingCalendar';

/**
 * Ocena nowego miejsca terminu zmienianego wprost przez planiste (przeniesienie, termin
 * reczny, zatwierdzenie zgloszenia z poprawka). Data poza semestrem blokuje — takiego
 * terminu nie pokaze zaden widok semestru. Swieto, przerwa, dzien poza zjazdami albo
 * godziny poza oknem dnia sa dozwolone (np. odrobienie w sobote), ale dopiero po
 * swiadomym potwierdzeniu ostrzezen.
 */
export interface SlotAssessment {
  blocking: string | null;
  warnings: string[];
}

export function assessSlot(
  day: { teaching: boolean; reason: DayBlockReason | null; label: string | null },
  windowProblem: string | null,
): SlotAssessment {
  if (!day.teaching && day.reason === 'OUT_OF_RANGE') return { blocking: 'Data poza semestrem', warnings: [] };
  const warnings: string[] = [];
  if (!day.teaching) {
    switch (day.reason) {
      case 'HOLIDAY':
      case 'BREAK':
      case 'DAY_OFF':
        warnings.push(`Dzien wolny: ${day.label ?? 'bez zajec'}`);
        break;
      case 'NO_ZJAZD':
        warnings.push('Dzien poza zjazdami rocznika');
        break;
      default:
        warnings.push('Rocznik nie ma zajec w ten dzien tygodnia');
    }
  }
  // "Siatka nie przewiduje zajec w dniu: ..." mowi samo za siebie; okno godzin ("piatek: zajecia od 16:00") dostaje kontekst.
  if (windowProblem) warnings.push(windowProblem.startsWith('Siatka') ? windowProblem : `Poza godzinami zajec — ${windowProblem}`);
  return { blocking: null, warnings };
}

/** Kod bledu 409, na ktory front odpowiada oknem potwierdzenia i ponowieniem z `confirmWarnings`. */
export const SLOT_WARNINGS_CODE = 'SLOT_WARNINGS';
