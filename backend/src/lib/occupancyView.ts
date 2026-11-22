import { addDays, mondayOf, type IsoDate } from './isoDate';
import { mergeJoint } from './jointMerge';
import { semesterWeekOf } from './teachingCalendar';
import { minutesOverlap } from './timeGrid';

/**
 * Widoki zajetosci — strony „Zajetosc sal” i „Zajetosc prowadzacych”. Czyste funkcje bez bazy. Sloty
 * przychodza z tej samej zajetosci semestru, na ktorej licza sie kolizje (services/plan → termOccupancy):
 * plan wszystkich wydzialow rozpisany na daty kalendarzy rocznikow, terminy reczne i zajetosci zewnetrzne.
 * Widok sal i widok prowadzacych roznia sie tylko zasobem: po nim ida wiersze i po nim liczymy kolizje.
 */

export type OccupancyEntryKind = 'CLASS' | 'MANUAL' | 'EXTERNAL';

/** Zasob widoku: sala albo prowadzacy. */
export type OccupancyResource = 'room' | 'instructor';

/** Grupa zajec: "MBM-S1 s1 · MBM-1-C-A", jej rocznik i wydzial rocznika (link do planu rocznika). */
export interface OccupancyGroup {
  label: string;
  cohortId: string;
  facultyId: string;
}

/** Zajety slot z opisem (jedna grupa — zajecia laczone scala buildOccupancyEntries). */
export interface OccupancySlot {
  date: IsoDate;
  startMinute: number;
  endMinute: number;
  jointKey: string | null;
  /** null — bez sali: zajecia online albo zajetosc zewnetrzna samego prowadzacego. */
  roomId: string | null;
  /** "101 (Budynek C)"; null — bez sali. */
  room: string | null;
  instructorId: string | null;
  /** "dr inz. Jan Kowalski"; null — NN albo zajetosc zewnetrzna samej sali. */
  instructor: string | null;
  kind: OccupancyEntryKind;
  /** Nazwa przedmiotu; przy zajetosci zewnetrznej — kto zglosil. */
  title: string;
  classType: string | null;
  /** null — zajetosc zewnetrzna. */
  group: OccupancyGroup | null;
  facultyId: string | null;
  note: string | null;
}

/** Pozycja widoku: jedne zajecia sali albo prowadzacego (zajecia laczone — raz, z lista grup). */
export interface OccupancyEntry {
  id: string;
  roomId: string | null;
  room: string | null;
  instructorId: string | null;
  instructor: string | null;
  date: IsoDate;
  startMinute: number;
  endMinute: number;
  kind: OccupancyEntryKind;
  title: string;
  classType: string | null;
  /** Grupy zajec — kilka przy zajeciach laczonych; puste przy zajetosci zewnetrznej. */
  groups: OccupancyGroup[];
  facultyIds: string[];
  note: string | null;
  /** Zajecia laczone kilku grup (wspolny klucz). */
  joint: boolean;
  /**
   * W tym czasie zasob widoku (sale albo prowadzacego) zajmuje tez cos innego — kolizja do wyjasnienia
   * (np. wpis zajetosci zewnetrznej dopisany po ulozeniu planu).
   */
  conflict: boolean;
}

export interface TermWeek {
  /** Poniedzialek tygodnia. */
  monday: IsoDate;
  /** Numer tygodnia semestru („tydz. N”): tydzien 1 = tydzien pierwszego dnia zajec. */
  number: number;
}

const unique = (values: (string | null)[]): string[] =>
  [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, 'pl'));

const uniqueGroups = (groups: OccupancyGroup[]): OccupancyGroup[] =>
  [...new Map(groups.map((g) => [`${g.cohortId}|${g.label}`, g])).values()].sort((a, b) => a.label.localeCompare(b.label, 'pl'));

export const resourceIdOf = (s: Pick<OccupancySlot, 'roomId' | 'instructorId'>, resource: OccupancyResource): string | null =>
  resource === 'room' ? s.roomId : s.instructorId;

/**
 * Sloty -> pozycje widoku zasobu: tylko sloty z tym zasobem (widok sal bez zajec online, widok
 * prowadzacych bez NN), zajecia laczone (ten sam klucz, czas, sala i prowadzacy) raz z lista grup,
 * kolizje oznaczone (zasob w tym samym czasie zajmuje cos jeszcze), kolejnosc: zasob, dzien, godzina.
 * Zajecia o wspolnym kluczu, ktore sie nie scalaja (inny prowadzacy albo NN w jednej z grup, inna sala,
 * przesuniety czas), zostaja kolizja — choc sprawdzanie kolizji planu je przepuszcza, widok pokazuje
 * niespojnosc zajec laczonych. Id pozycji to jej miejsce na liscie — te same dane daja te same id.
 */
export function buildOccupancyEntries(slots: OccupancySlot[], resource: OccupancyResource): OccupancyEntry[] {
  const keyOf = (s: Pick<OccupancySlot, 'roomId' | 'instructorId'>) => resourceIdOf(s, resource) ?? '';
  const sorted = slots
    .filter((s) => resourceIdOf(s, resource) !== null)
    .sort(
      (a, b) =>
        keyOf(a).localeCompare(keyOf(b)) ||
        a.date.localeCompare(b.date) ||
        a.startMinute - b.startMinute ||
        a.endMinute - b.endMinute ||
        a.title.localeCompare(b.title, 'pl') ||
        (a.group?.label ?? '').localeCompare(b.group?.label ?? '', 'pl'),
    );
  type Draft = Omit<OccupancyEntry, 'id' | 'conflict'> & { jointKey: string | null };
  const drafts: Draft[] = sorted.map((s) => ({
    roomId: s.roomId,
    room: s.room,
    instructorId: s.instructorId,
    instructor: s.instructor,
    date: s.date,
    startMinute: s.startMinute,
    endMinute: s.endMinute,
    kind: s.kind,
    title: s.title,
    classType: s.classType,
    groups: s.group ? [s.group] : [],
    facultyIds: unique([s.facultyId]),
    note: s.note,
    joint: false,
    jointKey: s.jointKey,
  }));
  const merged = mergeJoint(drafts, (d) => d, (first, rest) => ({
    ...first,
    groups: uniqueGroups([first, ...rest].flatMap((d) => d.groups)),
    facultyIds: unique([first, ...rest].flatMap((d) => d.facultyIds)),
    joint: true,
  }));

  // Id = pozycja na posortowanej liscie (krotkie: tydzien uczelni to ok. 2 tys. pozycji).
  const entries: OccupancyEntry[] = merged.map(({ jointKey: _jointKey, ...d }, i) => ({ id: String(i), ...d, conflict: false }));

  // Kolizje: w obrebie zasobu i dnia (lista jest posortowana, wiec porownujemy tylko sasiadow w czasie).
  for (let i = 0; i < entries.length; i++) {
    const a = entries[i]!;
    for (let j = i + 1; j < entries.length; j++) {
      const b = entries[j]!;
      if (keyOf(b) !== keyOf(a) || b.date !== a.date || b.startMinute >= a.endMinute) break;
      if (minutesOverlap(a.startMinute, a.endMinute, b.startMinute, b.endMinute)) {
        a.conflict = true;
        b.conflict = true;
      }
    }
  }
  return entries;
}

/**
 * Tygodnie semestru do przegladania: od tygodnia najwczesniejszego poczatku do tygodnia
 * najpozniejszego konca zakresow (kalendarze wydzialow, daty zajetosci zewnetrznych). Numer liczony
 * od `anchor` (najwczesniejszy pierwszy dzien zajec), jak „tydz.” w planach zjazdow.
 */
export function termWeeks(ranges: { start: IsoDate; end: IsoDate }[], anchor?: IsoDate): TermWeek[] {
  if (ranges.length === 0) return [];
  const start = ranges.reduce((min, r) => (r.start < min ? r.start : min), ranges[0]!.start);
  const end = ranges.reduce((max, r) => (r.end > max ? r.end : max), ranges[0]!.end);
  const from = anchor ?? start;
  const weeks: TermWeek[] = [];
  for (let monday = mondayOf(start); monday <= end; monday = addDays(monday, 7)) {
    weeks.push({ monday, number: semesterWeekOf(monday, from) });
  }
  return weeks;
}

/**
 * Pokazywany tydzien: wskazany (dowolna data -> jej poniedzialek), inaczej biezacy, gdy jest w
 * semestrze, a poza semestrem — pierwszy. null — semestr bez tygodni (brak kalendarzy).
 */
export function pickWeek(weeks: TermWeek[], requested: IsoDate | null, today: IsoDate): IsoDate | null {
  if (requested) return mondayOf(requested);
  if (weeks.length === 0) return null;
  const current = mondayOf(today);
  return weeks.some((w) => w.monday === current) ? current : weeks[0]!.monday;
}
