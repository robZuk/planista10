import { formatMinutes } from './timeGrid';

/**
 * Zgloszenia zmian prowadzacego — czyste reguly: co wolno zglosic dla terminu, walidacja
 * propozycji i teksty powiadomien. Zgloszenie niczego nie zmienia w planie; zmiane wykonuje
 * dziekanat, zatwierdzajac je (services/changeRequests).
 */
export type RequestKind = 'CANCEL' | 'MOVE' | 'MAKEUP';

export interface RequestableState {
  status: 'SCHEDULED' | 'CANCELLED' | 'MAKEUP';
  /** Data terminu "YYYY-MM-DD". */
  date: string;
  /** Dzis "YYYY-MM-DD". */
  today: string;
  /** Zgloszenie tego terminu czekajace na dziekanat. */
  pending: boolean;
  /** Odwolany termin ma juz odrobienie — jego termin ("26.02 14:00–16:00"), inaczej null. */
  madeUp: string | null;
}

/** Rodzaje zgloszen dozwolone dla terminu; pusta lista z powodem, gdy nic nie wolno. */
export function requestableKinds(s: RequestableState): { kinds: RequestKind[]; reason: string | null } {
  if (s.pending) return { kinds: [], reason: 'Zgloszenie tego terminu czeka juz na dziekanat' };
  if (s.status === 'CANCELLED') {
    return s.madeUp ? { kinds: [], reason: `Zajecia sa juz odrobione (${s.madeUp})` } : { kinds: ['MAKEUP'], reason: null };
  }
  if (s.date < s.today) return { kinds: [], reason: 'Zajecia juz sie odbyly' };
  return { kinds: ['CANCEL', 'MOVE'], reason: null };
}

export interface RequestInput {
  kind: RequestKind;
  reason?: string;
  date?: string;
  startOrder?: number;
  endOrder?: number;
  roomId?: string | null;
  online?: boolean;
}

/** Problemy z trescia zgloszenia (pusta lista = poprawne). Kolizje sprawdza serwer osobno. */
export function validateRequestInput(input: RequestInput, today: string): string[] {
  const problems: string[] = [];
  if (!input.reason || input.reason.trim().length < 3) problems.push('Podaj powod (min. 3 znaki)');
  if (input.kind === 'MOVE' || input.kind === 'MAKEUP') {
    if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) problems.push('Podaj date');
    else if (input.date < today) problems.push('Nowy termin nie moze byc w przeszlosci');
    if (!Number.isInteger(input.startOrder) || !Number.isInteger(input.endOrder) || input.endOrder! < input.startOrder!) {
      problems.push('Podaj godziny');
    }
    if (!input.online && !input.roomId) problems.push('Wybierz sale albo zajecia online');
  }
  return problems;
}

/**
 * Przeniesienie i odrobienie maja dlugosc oryginalnego terminu (liczba blokow siatki = godzin
 * programu). Krotszy termin po cichu gubilby godziny zajec — plan liczy je z wzorca, nie z terminow.
 */
export function lengthProblem(kind: RequestKind, original: { startOrder: number; endOrder: number }, proposed: { startOrder: number; endOrder: number }): string | null {
  if (kind === 'CANCEL') return null;
  const want = original.endOrder - original.startOrder + 1;
  const got = proposed.endOrder - proposed.startOrder + 1;
  if (want === got) return null;
  return `${kind === 'MOVE' ? 'Przeniesienie' : 'Odrobienie'} trwa tyle co zajecia w planie (${want} h), a nie ${got} h`;
}

export const KIND_LABEL: Record<RequestKind, string> = {
  CANCEL: 'odwolanie',
  MOVE: 'przeniesienie',
  MAKEUP: 'odrobienie',
};

/** "12.11 11:00–12:00" */
export function slotLabel(date: string, startMinute: number, endMinute: number): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)} ${formatMinutes(startMinute)}–${formatMinutes(endMinute)}`;
}

/** Opis zajec w powiadomieniu: "Matematyka I, II (cwiczenia), DUT-1-C-A, 12.11 11:00–12:00". */
export function classLabel(c: { subject: string; classLabel: string; group: string; date: string; startMinute: number; endMinute: number }): string {
  return `${c.subject} (${c.classLabel}), ${c.group}, ${slotLabel(c.date, c.startMinute, c.endMinute)}`;
}

/** Powod, dla ktorego kalendarz rocznika nie ma zajec danego dnia (DayInfo z lib/teachingCalendar). */
export type DayReason = 'OUT_OF_RANGE' | 'HOLIDAY' | 'BREAK' | 'DAY_OFF' | 'NOT_MODE_DAY' | 'NO_ZJAZD';

/**
 * Data proponowana przez prowadzacego (przeniesienie, odrobienie) musi byc dniem zajec rocznika:
 * w semestrze, nie w swieto/przerwe/dzien wolny, a na studiach zjazdowych — w zjezdzie.
 * Dni tygodnia i okno godzin wydzialu sprawdza osobno timeGrid.dayWindowProblem.
 */
export function proposalDateProblem(info: { teaching: boolean; reason: DayReason | null; label: string | null }): string | null {
  if (info.teaching) return null;
  switch (info.reason) {
    case 'OUT_OF_RANGE':
      return 'Data poza semestrem';
    case 'HOLIDAY':
    case 'BREAK':
    case 'DAY_OFF':
      return `Tego dnia nie ma zajec: ${info.label ?? 'dzien wolny'}`;
    case 'NO_ZJAZD':
      return 'Na studiach zjazdowych proponuj dzien zjazdu';
    default:
      return 'Rocznik nie ma zajec w ten dzien tygodnia';
  }
}

/** Bezposrednia zmiana terminu przez planiste (Ukladanie planu → Terminy). */
export interface DirectChange {
  action: 'CANCEL' | 'MODIFY' | 'RESTORE' | 'MAKEUP';
  /** MODIFY / MAKEUP: termin po zmianie. */
  date?: string;
  startOrder?: number;
  endOrder?: number;
}

/**
 * Co zrobic z czekajacym zgloszeniem, gdy planista zmienil termin wprost: jesli zrobil dokladnie
 * to, o co prosil prowadzacy (odwolal prosbe o odwolanie, przeniosl na proponowany termin, dodal
 * odrobienie w proponowanym terminie) — zgloszenie jest zalatwione (APPROVED); w kazdym innym
 * przypadku jest nieaktualne (SUPERSEDED), bo plan zmieniono inaczej, niz prosil.
 */
export function resolveOnDirectChange(
  request: { kind: RequestKind; newDate: string | null; newStartOrder: number | null; newEndOrder: number | null },
  change: DirectChange,
): 'APPROVED' | 'SUPERSEDED' {
  const sameSlot = change.date === request.newDate && change.startOrder === request.newStartOrder && change.endOrder === request.newEndOrder;
  if (request.kind === 'CANCEL' && change.action === 'CANCEL') return 'APPROVED';
  if (request.kind === 'MOVE' && change.action === 'MODIFY' && sameSlot) return 'APPROVED';
  if (request.kind === 'MAKEUP' && change.action === 'MAKEUP' && sameSlot) return 'APPROVED';
  return 'SUPERSEDED';
}
