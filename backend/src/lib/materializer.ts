import type { DayOfWeek } from '@prisma/client';
import { expandDates, WEEKDAY_ENUM, type TeachingCalendar } from './teachingCalendar';
import { minutesOverlap, type GridTime } from './timeGrid';
import { weekdayOf, type IsoDate } from './isoDate';

/**
 * Wyliczanie terminow z umieszczen — czysta funkcja, wolana WYLACZNIE przez
 * "Generuj terminy" (podglad i zapis licza to samo). Nic tu nie dzieje sie samo.
 *
 * Dla kazdych zajec bierzemy daty wszystkich ich umieszczen (rytm + kalendarz rocznika),
 * sortujemy po dacie i wyczerpujemy godziny z programu: ostatni termin moze byc skrocony,
 * a kolejne pominiete ("nadmiar"). Terminy reczne (MANUAL) i zachowane terminy sprzed
 * daty "od kiedy" licza sie do godzin. Przeniesienia pojedynczych terminow (wyjatki
 * przypiete do pary umieszczenie+data) sa nakladane na wynik — przezywaja ponowne
 * generowanie. Wyjatek, ktorego data przestala istniec, trafia do raportu. Odwolan nie ma.
 * Termin kolidujacy (sala, prowadzacy, nakladajace sie grupy) jest pomijany i zgloszony.
 * Kolizje licza sie w MINUTACH: kazde zajecia maja siatke godzin swojego kalendarza, a sale
 * i prowadzacy sa wspolni dla wydzialow z roznymi siatkami.
 */

export interface MatPlacement {
  id: string;
  sectionId: string;
  dayOfWeek: DayOfWeek;
  startOrder: number;
  endOrder: number;
  /** null = zajecia online (bez sali). */
  roomId: string | null;
  instructorId: string | null;
  cycle: 'WEEK' | 'ZJAZD';
  pattern: 'ALL' | 'EVEN' | 'ODD' | 'LIST';
  numbers: number[];
  fromIndex: number | null;
  toIndex: number | null;
  jointKey: string | null;
}

export interface MatSection {
  id: string;
  hours: number;
  groupId: string;
  calendar: TeachingCalendar;
  /**
   * Bloki -> minuty wg siatki obowiazujacej w dniu tygodnia (siatka dnia albo podstawowa
   * wydzialu i trybu rocznika). Wydzial moze miec np. inne bloki w piatek niz w sobote.
   */
  gridOf: (day: DayOfWeek) => GridTime;
  /** Godziny juz zrealizowane poza generowaniem: terminy MANUAL i zachowane sprzed "od kiedy". */
  consumedHours: number;
  label: string;
}

/** Przeniesienie terminu z wzorca (data, godziny, sala, prowadzacy); pole puste = bez zmiany. */
export interface MatException {
  placementId: string;
  originalDate: IsoDate;
  newDate?: IsoDate | null;
  newStartOrder?: number | null;
  newEndOrder?: number | null;
  newRoomId?: string | null;
  /** true = termin przeniesiony na online (bez sali). */
  newOnline?: boolean | null;
  newInstructorId?: string | null;
}

/** Zajety slot (z innego zakresu albo wygenerowany wczesniej w tym przebiegu). */
export interface BusySlot {
  date: IsoDate;
  /** Rzeczywisty czas (minuty od polnocy) — porownywalny miedzy siatkami. */
  startMinute: number;
  endMinute: number;
  /** null = bez sali (zajecia online) — nie koliduje salowo. */
  roomId: string | null;
  instructorId: string | null;
  /** null = zajetosc zewnetrzna (lib/externalBusy) — bez grupy, koliduje tylko sala i prowadzacy. */
  groupId: string | null;
  jointKey: string | null;
  label: string;
}

/** Sprawdzany slot (termin, umieszczenie na dacie) — zawsze zajecia konkretnej grupy. */
export type CandidateSlot = Omit<BusySlot, 'label' | 'groupId'> & { groupId: string };

export interface PlannedOccurrence {
  sectionId: string;
  placementId: string;
  originalDate: IsoDate;
  date: IsoDate;
  startOrder: number;
  endOrder: number;
  startMinute: number;
  endMinute: number;
  roomId: string | null;
  instructorId: string | null;
  groupId: string;
  jointKey: string | null;
}

export interface MatConflict {
  date: IsoDate;
  section: string;
  /** GRID: godziny terminu (np. po recznej zmianie) nie istnieja w siatce kalendarza. */
  reason: 'ROOM' | 'INSTRUCTOR' | 'GROUP' | 'GRID';
  with: string;
}

export interface MatResult {
  occurrences: PlannedOccurrence[];
  conflicts: MatConflict[];
  /** Daty pominiete, bo godziny zajec juz sie wyczerpaly. */
  beyondHours: { section: string; date: IsoDate }[];
  /** Zajecia, ktorym po wszystkich datach wciaz brakuje godzin. */
  shortfalls: { section: string; missing: number }[];
  orphanExceptions: MatException[];
}

/** Pierwszy konflikt slotu z zajetymi (sala, prowadzacy, grupy), albo null. */
/** Wszystkie powody kolizji slotu z jedna zajetoscia (sala, prowadzacy, grupa — w tej kolejnosci). */
export function conflictReasons(
  slot: CandidateSlot,
  b: BusySlot,
  groupsOverlap: (a: string, b: string) => boolean,
): MatConflict['reason'][] {
  if (b.date !== slot.date || !minutesOverlap(slot.startMinute, slot.endMinute, b.startMinute, b.endMinute)) return [];
  if (slot.jointKey && slot.jointKey === b.jointKey) return [];
  const reasons: MatConflict['reason'][] = [];
  if (slot.roomId !== null && b.roomId === slot.roomId) reasons.push('ROOM');
  if (slot.instructorId && b.instructorId === slot.instructorId) reasons.push('INSTRUCTOR');
  if (b.groupId !== null && groupsOverlap(slot.groupId, b.groupId)) reasons.push('GROUP');
  return reasons;
}

export function findConflict(
  slot: CandidateSlot,
  busy: BusySlot[],
  groupsOverlap: (a: string, b: string) => boolean,
): { reason: MatConflict['reason']; with: string } | null {
  for (const b of busy) {
    const [reason] = conflictReasons(slot, b, groupsOverlap);
    if (reason) return { reason, with: b.label };
  }
  return null;
}

export function materialize(input: {
  sections: MatSection[];
  placements: MatPlacement[];
  exceptions: MatException[];
  /** Zajete sloty spoza generowanego zakresu (inne wydzialy, terminy MANUAL, zajetosci zewnetrzne...). */
  busy: BusySlot[];
  groupsOverlap: (a: string, b: string) => boolean;
  /** Generuj tylko od tej daty (opublikowany semestr — przeszlosc zostaje). */
  fromDate?: IsoDate | null;
  /** Bez sprawdzania kolizji (np. do bilansu godzin w panelu "do zaplanowania"). */
  skipConflicts?: boolean;
}): MatResult {
  const result: MatResult = { occurrences: [], conflicts: [], beyondHours: [], shortfalls: [], orphanExceptions: [] };
  const exceptionByKey = new Map(input.exceptions.map((e) => [`${e.placementId}|${e.originalDate}`, e]));
  const usedExceptions = new Set<string>();
  // Zajetosc wg daty: kolizja jest zawsze na jednej dacie, wiec nowy termin porownujemy tylko
  // z terminami tego dnia (zamiast z cala uczelnia — inaczej koszt rosnie kwadratowo).
  const busyByDate = new Map<IsoDate, BusySlot[]>();
  const addBusy = (b: BusySlot) => {
    const list = busyByDate.get(b.date);
    if (list) list.push(b);
    else busyByDate.set(b.date, [b]);
  };
  for (const b of input.busy) addBusy(b);
  const bySection = new Map<string, MatPlacement[]>();
  for (const p of input.placements) bySection.set(p.sectionId, [...(bySection.get(p.sectionId) ?? []), p]);

  for (const section of input.sections) {
    const placements = bySection.get(section.id) ?? [];
    const candidates = placements
      .flatMap((p) =>
        expandDates(section.calendar, {
          dayOfWeek: p.dayOfWeek,
          cycle: p.cycle,
          pattern: p.pattern,
          numbers: p.numbers,
          fromIndex: p.fromIndex,
          toIndex: p.toIndex,
          startOrder: p.startOrder,
          endOrder: p.endOrder,
        }).map((d) => ({ date: d.date, placement: p })),
      )
      .filter((c) => !input.fromDate || c.date >= input.fromDate)
      .sort((a, b) => a.date.localeCompare(b.date) || a.placement.startOrder - b.placement.startOrder);

    let left = section.hours - section.consumedHours;
    for (const { date, placement } of candidates) {
      if (left <= 0) {
        result.beyondHours.push({ section: section.label, date });
        continue;
      }
      const length = Math.min(placement.endOrder - placement.startOrder + 1, left);
      const key = `${placement.id}|${date}`;
      const exception = exceptionByKey.get(key);
      if (exception) usedExceptions.add(key);

      const occ: PlannedOccurrence = {
        sectionId: section.id,
        placementId: placement.id,
        originalDate: date,
        date,
        startOrder: placement.startOrder,
        endOrder: placement.startOrder + length - 1,
        startMinute: 0,
        endMinute: 0,
        roomId: placement.roomId,
        instructorId: placement.instructorId,
        groupId: section.groupId,
        jointKey: placement.jointKey,
      };
      if (exception) {
        occ.date = exception.newDate ?? occ.date;
        occ.startOrder = exception.newStartOrder ?? occ.startOrder;
        occ.endOrder = exception.newEndOrder ?? occ.endOrder;
        occ.roomId = exception.newOnline ? null : (exception.newRoomId ?? occ.roomId);
        occ.instructorId = exception.newInstructorId === undefined ? occ.instructorId : exception.newInstructorId;
      }
      // Bloki wzorca liczymy wg siatki dnia umieszczenia (takze w dniu "zajecia wg planu innego dnia");
      // przeniesienie na inna date wskazuje bloki siatki dnia docelowego — jak okno przeniesienia.
      const blockDay = exception?.newDate ? WEEKDAY_ENUM[weekdayOf(exception.newDate)]! : placement.dayOfWeek;
      const time = section.gridOf(blockDay).range(occ.startOrder, occ.endOrder);
      if (!time) {
        result.conflicts.push({ date: occ.date, section: section.label, reason: 'GRID', with: 'godziny poza siatka kalendarza' });
        continue;
      }
      occ.startMinute = time.startMinute;
      occ.endMinute = time.endMinute;

      if (!input.skipConflicts) {
        const conflict = findConflict(occ, busyByDate.get(occ.date) ?? [], input.groupsOverlap);
        if (conflict) {
          // Termin kolidujacy pomijamy (nie zuzywa godzin) i zglaszamy planiscie.
          result.conflicts.push({ date: occ.date, section: section.label, ...conflict });
          continue;
        }
        addBusy({ ...occ, label: section.label });
      }
      left -= length;
      result.occurrences.push(occ);
    }
    if (left > 0 && placements.length > 0) result.shortfalls.push({ section: section.label, missing: left });
  }

  for (const e of input.exceptions) {
    const key = `${e.placementId}|${e.originalDate}`;
    if (!usedExceptions.has(key) && (!input.fromDate || e.originalDate >= input.fromDate)) {
      result.orphanExceptions.push(e);
    }
  }
  return result;
}
