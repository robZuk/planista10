import { addDays, mondayOf, type IsoDate } from './isoDate';
import { mergeJoint } from './jointMerge';
import { semesterWeekOf } from './teachingCalendar';
import { minutesOverlap } from './timeGrid';

/**
 * Zajetosc sal (strona „Zajetosc sal”) — czyste funkcje bez bazy. Sloty przychodza z tej samej
 * zajetosci semestru, na ktorej licza sie kolizje (services/plan → termOccupancy): plan wszystkich
 * wydzialow rozpisany na daty kalendarzy rocznikow, terminy reczne i zajetosci zewnetrzne.
 */

export type RoomEntryKind = 'CLASS' | 'MANUAL' | 'EXTERNAL';

/** Grupa zajec: "MBM-S1 s1 · MBM-1-C-A", jej rocznik i wydzial rocznika (link do planu rocznika). */
export interface RoomGroup {
  label: string;
  cohortId: string;
  facultyId: string;
}

/** Zajety slot sali z opisem (jedna grupa — zajecia laczone scala buildRoomEntries). */
export interface RoomSlot {
  roomId: string;
  date: IsoDate;
  startMinute: number;
  endMinute: number;
  jointKey: string | null;
  instructorId: string | null;
  kind: RoomEntryKind;
  /** Nazwa przedmiotu; przy zajetosci zewnetrznej — kto zglosil. */
  title: string;
  classType: string | null;
  /** null — zajetosc zewnetrzna. */
  group: RoomGroup | null;
  facultyId: string | null;
  /** "dr inz. Jan Kowalski"; null — NN albo zajetosc sali bez prowadzacego. */
  instructor: string | null;
  note: string | null;
}

/** Pozycja widoku: jedne zajecia w sali (zajecia laczone — raz, z lista grup). */
export interface RoomEntry {
  id: string;
  roomId: string;
  date: IsoDate;
  startMinute: number;
  endMinute: number;
  kind: RoomEntryKind;
  title: string;
  classType: string | null;
  /** Grupy zajec — kilka przy zajeciach laczonych; puste przy zajetosci zewnetrznej. */
  groups: RoomGroup[];
  facultyIds: string[];
  instructor: string | null;
  note: string | null;
  /** Zajecia laczone kilku grup (wspolny klucz). */
  joint: boolean;
  /** W tym czasie sale zajmuje tez cos innego — kolizja do wyjasnienia (np. wpis zajetosci zewnetrznej). */
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

const uniqueGroups = (groups: RoomGroup[]): RoomGroup[] =>
  [...new Map(groups.map((g) => [`${g.cohortId}|${g.label}`, g])).values()].sort((a, b) => a.label.localeCompare(b.label, 'pl'));

/**
 * Sloty -> pozycje widoku: zajecia laczone (ten sam klucz, czas, sala i prowadzacy) raz z lista
 * grup, kolizje oznaczone (sale w tym samym czasie zajmuje cos jeszcze), kolejnosc: sala, dzien,
 * godzina. Id pozycji to jej miejsce na liscie — te same dane daja te same id.
 */
export function buildRoomEntries(slots: RoomSlot[]): RoomEntry[] {
  const sorted = [...slots].sort(
    (a, b) =>
      a.roomId.localeCompare(b.roomId) ||
      a.date.localeCompare(b.date) ||
      a.startMinute - b.startMinute ||
      a.endMinute - b.endMinute ||
      a.title.localeCompare(b.title, 'pl') ||
      (a.group?.label ?? '').localeCompare(b.group?.label ?? '', 'pl'),
  );
  type Draft = Omit<RoomEntry, 'id' | 'conflict'> & { jointKey: string | null; instructorId: string | null };
  const drafts: Draft[] = sorted.map((s) => ({
    roomId: s.roomId,
    date: s.date,
    startMinute: s.startMinute,
    endMinute: s.endMinute,
    kind: s.kind,
    title: s.title,
    classType: s.classType,
    groups: s.group ? [s.group] : [],
    facultyIds: unique([s.facultyId]),
    instructor: s.instructor,
    note: s.note,
    joint: false,
    jointKey: s.jointKey,
    instructorId: s.instructorId,
  }));
  const merged = mergeJoint(drafts, (d) => d, (first, rest) => ({
    ...first,
    groups: uniqueGroups([first, ...rest].flatMap((d) => d.groups)),
    facultyIds: unique([first, ...rest].flatMap((d) => d.facultyIds)),
    joint: true,
  }));

  // Id = pozycja na posortowanej liscie (krotkie: tydzien uczelni to ok. 2 tys. pozycji).
  const entries: RoomEntry[] = merged.map((d, i) => ({
    id: String(i),
    roomId: d.roomId,
    date: d.date,
    startMinute: d.startMinute,
    endMinute: d.endMinute,
    kind: d.kind,
    title: d.title,
    classType: d.classType,
    groups: d.groups,
    facultyIds: d.facultyIds,
    instructor: d.instructor,
    note: d.note,
    joint: d.joint,
    conflict: false,
  }));

  // Kolizje: w obrebie sali i dnia (lista jest posortowana, wiec porownujemy tylko sasiadow w czasie).
  for (let i = 0; i < entries.length; i++) {
    const a = entries[i]!;
    for (let j = i + 1; j < entries.length; j++) {
      const b = entries[j]!;
      if (b.roomId !== a.roomId || b.date !== a.date || b.startMinute >= a.endMinute) break;
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
