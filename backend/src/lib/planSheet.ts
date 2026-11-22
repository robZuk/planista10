import { isActiveIn, pathFromRoot, ROOT, SPEC, type GroupIndex, type TreeGroup } from './groupTree';
import { minutesOverlap } from './timeGrid';
import type { IsoDate } from './isoDate';

/**
 * Arkusz planu dla studentow — uklad opublikowanych planow WM (Excel: sd_r1..r4 stacjonarne,
 * week niestacjonarne). Czyste funkcje bez bazy i pdfkit: sklada services/planPrint, rysuje
 * lib/planSheetPdf.
 *
 * Arkusz laczy kilka rocznikow: kolumny to najdrobniejsze grupy (liscie drzewa grup aktywne
 * w semestrze) pogrupowane pasmami (kierunek albo „N rok/S sem.”); wiersze to dni x bloki siatki
 * godzin. Zajecia grupy stoja w kolumnach jej lisci; sasiednie kolumny z tym samym wpisem
 * (wyklad, wspolny wyklad kierunkow) scalaja sie poziomo, a kazdy blok to osobny wiersz.
 * Zajecia nie co tydzien siedza w czerwonej ramce (opis rytmu w stopce).
 */

// ─── Kolumny ─────────────────────────────────────────────────

export type SheetMode = 'FULL_TIME' | 'PART_TIME';

export interface SheetCohortInput {
  id: string;
  /** Naglowek pasma kolumn: stacjonarne — skrot kierunku; niestacjonarne — "1 rok/1 sem.". */
  band: string;
  /** Skrot kierunku ("MiBM"). */
  fieldShort: string;
  semester: number;
  /** Grupy rocznika (moga byc tez innych rocznikow — liczy sie cohortId). */
  index: GroupIndex;
  /** Skrot specjalnosci grupy SPEC ("DUT"). */
  specShort: (specializationId: string | null | undefined) => string | null;
  /** Tylko kolumny w linii tej grupy (filtr grupy w „Ukladaniu planu”). */
  onlyGroupId?: string | null;
}

export interface SheetColumn {
  /** Id grupy-liscia. */
  key: string;
  cohortId: string;
  band: string;
  label: string;
  /** Grupy, ktorych zajecia stoja w tej kolumnie: lisc i jego przodkowie. */
  covers: Set<string>;
}

/** Porownanie naturalne kodow grup: 1, 2, 3a, 3b, 10. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'pl', { numeric: true, sensitivity: 'base' });
}

const partitionRank = (key: string) => (key === SPEC ? 0 : key === ROOT ? 1 : 2);

function compareGroups(a: TreeGroup, b: TreeGroup): number {
  return (
    partitionRank(a.partitionKey) - partitionRank(b.partitionKey) ||
    a.partitionKey.localeCompare(b.partitionKey) ||
    naturalCompare(a.code ?? '', b.code ?? '') ||
    a.id.localeCompare(b.id)
  );
}

/** Liscie drzewa grup rocznika aktywne w semestrze, w kolejnosci drzewa (specjalnosc, kod). */
export function leafGroups(cohortId: string, index: GroupIndex, semester: number): TreeGroup[] {
  const active = [...index.values()].filter((g) => g.cohortId === cohortId && isActiveIn(g, semester));
  const ids = new Set(active.map((g) => g.id));
  const children = new Map<string | null, TreeGroup[]>();
  for (const g of active) {
    const parent = g.parentId && ids.has(g.parentId) ? g.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), g]);
  }
  const out: TreeGroup[] = [];
  const visit = (g: TreeGroup, seen: Set<string>) => {
    if (seen.has(g.id)) return;
    seen.add(g.id);
    const kids = (children.get(g.id) ?? []).sort(compareGroups);
    if (kids.length === 0) out.push(g);
    for (const k of kids) visit(k, seen);
  };
  const seen = new Set<string>();
  for (const root of (children.get(null) ?? []).sort(compareGroups)) visit(root, seen);
  return out;
}

/**
 * Kolumny arkusza. Etykieta: stacjonarne — kod grupy ("3a"), pod specjalnoscia "ZEEW 1" albo sam
 * skrot specjalnosci, gdy ma jedna kolumne; niestacjonarne — "1 MiBM" / "1 ZEEW". Rocznik bez
 * podgrup to jedna kolumna z nazwa kierunku.
 */
export function sheetColumns(cohorts: SheetCohortInput[], mode: SheetMode): SheetColumn[] {
  const columns: SheetColumn[] = [];
  for (const c of cohorts) {
    let leaves = leafGroups(c.id, c.index, c.semester);
    const pathIds = (id: string) => pathFromRoot(id, c.index).map((g) => g.id);
    if (c.onlyGroupId) {
      const only = c.onlyGroupId;
      const onlyPath = pathIds(only);
      leaves = leaves.filter((l) => pathIds(l.id).includes(only) || onlyPath.includes(l.id));
    }
    for (const leaf of leaves) {
      const path = pathFromRoot(leaf.id, c.index);
      const spec = [...path].reverse().find((g) => g.partitionKey === SPEC);
      const specName = spec ? (c.specShort(spec.specializationId) ?? spec.code ?? c.fieldShort) : null;
      const code = leaf.code ?? '';
      let label: string;
      if (leaf.partitionKey === ROOT) label = c.fieldShort;
      else if (spec && leaf.id === spec.id) label = specName!;
      else if (spec) {
        const inSpec = leaves.filter((l) => pathIds(l.id).includes(spec.id)).length;
        label = inSpec === 1 ? specName! : mode === 'PART_TIME' ? `${code} ${specName}` : `${specName} ${code}`;
      } else label = mode === 'PART_TIME' ? `${code} ${c.fieldShort}` : code;
      columns.push({ key: leaf.id, cohortId: c.id, band: c.band, label, covers: new Set(path.map((g) => g.id)) });
    }
  }
  return columns;
}

// ─── Uklad dnia ──────────────────────────────────────────────

export interface SheetItem {
  id: string;
  cohortId: string;
  groupId: string;
  startMinute: number;
  endMinute: number;
  subject: string;
  classType: string;
  /** Numer sali ("A016"); pusty — zajecia on-line. */
  room: string;
  /** Nazwisko prowadzacego; puste — NN. */
  person: string;
  /** Rytm inny niz co tydzien ("tyg. nieparzyste 1–7"); pusty = co tydzien. */
  pattern: string;
}

export interface SheetRow {
  label: string;
  startMinute: number;
  endMinute: number;
}

/** Komorka (scalona poziomo) w jednym wierszu: kolumny colFrom..colTo wlacznie. */
export interface SheetSpan {
  row: number;
  colFrom: number;
  colTo: number;
  items: SheetItem[];
  framed: boolean;
}

/** Czerwona ramka zajec nie co tydzien: wiersze i kolumny wlacznie. */
export interface SheetFrame {
  rowFrom: number;
  rowTo: number;
  colFrom: number;
  colTo: number;
}

export interface SheetDayLayout {
  spans: SheetSpan[];
  frames: SheetFrame[];
  /** Kolumna bez zajec w tym dniu. */
  idle: boolean[];
}

/** Klucz tresci wpisu — rowne klucze scalaja sie (takze zajecia laczone roznych rocznikow). */
export const itemKey = (i: SheetItem) => [i.subject, i.classType, i.room, i.person, i.pattern].join('|');

const itemOrder = (a: SheetItem, b: SheetItem) =>
  a.startMinute - b.startMinute || a.pattern.localeCompare(b.pattern) || a.subject.localeCompare(b.subject) || a.id.localeCompare(b.id);

/**
 * Uklad jednego dnia: komorki scalone poziomo i ramki. W ramce z kilkoma przedmiotami
 * naprzemiennymi (co 2 tyg.) kolejne wiersze pokazuja kolejne przedmioty — jak w oryginale
 * (pierwsza godzina jeden przedmiot, druga drugi, ramka z przekatnymi mowi, ze to na zmiane).
 */
export function layoutDay(columns: SheetColumn[], rows: SheetRow[], items: SheetItem[]): SheetDayLayout {
  const idle = columns.map(() => true);
  const spans: SheetSpan[] = [];
  rows.forEach((row, r) => {
    const cells = columns.map((col, c) => {
      const byKey = new Map<string, SheetItem>();
      for (const i of items) {
        if (i.cohortId !== col.cohortId || !col.covers.has(i.groupId)) continue;
        if (!minutesOverlap(i.startMinute, i.endMinute, row.startMinute, row.endMinute)) continue;
        if (!byKey.has(itemKey(i))) byKey.set(itemKey(i), i);
      }
      const list = [...byKey.values()].sort(itemOrder);
      if (list.length > 0) idle[c] = false;
      return { list, key: list.map(itemKey).sort().join('‖') };
    });
    let c = 0;
    while (c < cells.length) {
      const cell = cells[c]!;
      if (cell.list.length === 0) {
        c++;
        continue;
      }
      let to = c;
      while (to + 1 < cells.length && cells[to + 1]!.key === cell.key) to++;
      spans.push({ row: r, colFrom: c, colTo: to, items: cell.list, framed: cell.list.some((i) => i.pattern !== '') });
      c = to + 1;
    }
  });

  // Ramki: pionowe przebiegi tych samych komorek z zajeciami nie co tydzien.
  const frames: SheetFrame[] = [];
  const open = new Map<string, { frame: SheetFrame; spans: SheetSpan[] }>();
  const keyOf = (s: SheetSpan) => `${s.colFrom}:${s.colTo}:${s.items.map(itemKey).sort().join('‖')}`;
  const runs: SheetSpan[][] = [];
  for (const s of spans) {
    if (!s.framed) continue;
    const key = keyOf(s);
    const run = open.get(key);
    if (run && run.frame.rowTo === s.row - 1) {
      run.frame.rowTo = s.row;
      run.spans.push(s);
    } else {
      const fresh = { frame: { rowFrom: s.row, rowTo: s.row, colFrom: s.colFrom, colTo: s.colTo }, spans: [s] };
      open.set(key, fresh);
      frames.push(fresh.frame);
      runs.push(fresh.spans);
    }
  }
  for (const run of runs) {
    const distinct = run[0]!.items;
    if (distinct.length < 2 || distinct.length > run.length) continue;
    run.forEach((s, j) => {
      s.items = [distinct[Math.floor((j * distinct.length) / run.length)]!];
    });
  }
  return { spans, frames, idle };
}

/**
 * Wiersze dnia przyciete do zajec: od pierwszego do ostatniego zajetego bloku i jeden pusty
 * po nich (jak w arkuszu). Dzien bez zajec — wiersze zaczynajace sie w `fallback` [from, to)
 * (zakres reszty arkusza).
 */
export function trimRows(rows: SheetRow[], items: Pick<SheetItem, 'startMinute' | 'endMinute'>[], fallback?: { from: number; to: number }): SheetRow[] {
  const used = rows.flatMap((r, i) => (items.some((it) => minutesOverlap(it.startMinute, it.endMinute, r.startMinute, r.endMinute)) ? [i] : []));
  if (used.length === 0) {
    if (!fallback) return rows;
    return rows.filter((r) => r.startMinute >= fallback.from && r.startMinute < fallback.to);
  }
  return rows.slice(used[0], Math.min(rows.length, used[used.length - 1]! + 2));
}

// ─── Teksty ──────────────────────────────────────────────────

export const FORM_SHORT: Record<string, string> = { LECTURE: 'w.', EXERCISE: 'ćw.', LAB: 'lab.', PROJECT: 'proj.', SEMINAR: 'sem.' };

const VOWEL = /[aąeęioóuyAĄEĘIOÓUY]/;

const DIGRAPHS = new Set(['sz', 'cz', 'rz', 'ch', 'dz']);

/**
 * Skrot slowa z kropka. Zwykly: rdzen do samogloski po co najmniej 4 literach ("Podstawy" ->
 * "Podst.", "Maszyn" -> "Masz."); ciasny: pierwsza sylaba ze spolgloska ("Pod.", "Kon.", "Masz.").
 * Slowo, ktore by sie nie skrocilo, zostaje.
 */
export function shortWord(word: string, tight = false): string {
  if (word.length <= 4 || !/^\p{L}+$/u.test(word)) return word;
  let cut = -1;
  if (!tight) {
    for (let i = 4; i < word.length && cut < 0; i++) if (VOWEL.test(word[i]!)) cut = i;
  } else {
    let v = 1;
    while (v < word.length && !(VOWEL.test(word[v]!) && !VOWEL.test(word[v - 1]!))) v++;
    const j = v + 1;
    if (j < word.length && !VOWEL.test(word[j]!)) cut = j + (DIGRAPHS.has(word.slice(j, j + 2).toLowerCase()) ? 2 : 1);
  }
  return cut > 0 && cut + 1 < word.length ? `${word.slice(0, cut)}.` : word;
}

/** Numeracja przedmiotu ("I,", "II", "I-IV", "III,IV") — na arkuszu pomijana. */
const NUMERAL = /^[IVX]+([,-][IVX]+)*,?$/;

/** Slowa po skrocie z kropka laczymy bez spacji: "Podst.Konst.Masz.". */
function joinWords(words: string[]): string {
  return words.reduce((acc, w) => (acc === '' ? w : acc.endsWith('.') ? acc + w : `${acc} ${w}`), '');
}

/**
 * Nazwa przedmiotu na arkusz — jak w arkuszach WM bez numeracji ("Matematyka I, II" -> "Matematyka");
 * gdy sie nie miesci, skracane kolejno najdluzsze slowa ("Podstawy Konstrukcji Maszyn" ->
 * "Podst.Konst.Masz."), na koniec krocej ("Pod.Kon.Masz."). Skroty liczone, nie zapisywane.
 */
export function abbreviateSubject(name: string, fits: (text: string) => boolean): string {
  const all = name.split(/\s+/).filter(Boolean);
  const named = all.filter((w) => !NUMERAL.test(w));
  const words = named.length > 0 ? named : all;
  const current = [...words];
  if (fits(joinWords(current))) return joinWords(current);
  const shorten = (tight: boolean): string | null => {
    const order = words.map((_, i) => i).sort((a, b) => words[b]!.length - words[a]!.length || a - b);
    for (const i of order) {
      const short = shortWord(words[i]!, tight);
      if (short.length >= current[i]!.length) continue;
      current[i] = short;
      if (fits(joinWords(current))) return joinWords(current);
    }
    return null;
  };
  return shorten(false) ?? shorten(true) ?? joinWords(current);
}

/** Pastele jak w arkuszach WM; ten sam przedmiot — ten sam kolor na kazdym arkuszu. */
export const SUBJECT_COLORS = [
  '#fce4d6',
  '#ddebf7',
  '#ffe699',
  '#e2efda',
  '#f8cbad',
  '#b4c6e7',
  '#fff2cc',
  '#c6e0b4',
  '#ffccff',
  '#d9d9d9',
  '#bdd7ee',
  '#f4b084',
  '#a9d08e',
  '#e4dfec',
  '#ccffcc',
  '#ffd966',
  '#9bc2e6',
  '#ededed',
];

export function subjectColor(subject: string): string {
  let h = 5381;
  for (const ch of subject) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0;
  return SUBJECT_COLORS[h % SUBJECT_COLORS.length]!;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
export const roman = (n: number) => ROMAN[n] ?? String(n);

export const DAY_SHORT: Record<string, string> = {
  MONDAY: 'Pn',
  TUESDAY: 'Wt',
  WEDNESDAY: 'Śr',
  THURSDAY: 'Cz',
  FRIDAY: 'Pt',
  SATURDAY: 'So',
  SUNDAY: 'Nd',
};

export const DAY_SHEET: Record<string, string> = {
  MONDAY: 'Poniedz.',
  TUESDAY: 'Wtorek',
  WEDNESDAY: 'Środa',
  THURSDAY: 'Czwartek',
  FRIDAY: 'Piątek',
  SATURDAY: 'Sobota',
  SUNDAY: 'Niedz.',
};

const MONTH_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

/** "2026-10-03" -> "3 paź" */
export function sheetDate(date: IsoDate): string {
  const [, month, day] = date.split('-');
  return `${Number(day)} ${MONTH_SHORT[Number(month) - 1]}`;
}

/** Etykieta wiersza: stacjonarne pelna godzina bez minut ("7"), inaczej "8:50". */
export function rowLabel(startMinute: number, mode: SheetMode): string {
  const h = Math.floor(startMinute / 60);
  const m = startMinute % 60;
  if (mode === 'FULL_TIME' && m === 0) return String(h);
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** "uaktualnienie" jak w arkuszu: "10-11-26 14:51" (czas lokalny serwera). */
export function updatedStamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(date.getDate())}-${p(date.getMonth() + 1)}-${p(date.getFullYear() % 100)} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

// ─── Dokument ────────────────────────────────────────────────

export interface SheetDay {
  key: string;
  /** "Pn" (stacjonarne) albo "Sobota". */
  label: string;
  /** "3 paź". */
  sublabel?: string;
  /** "tydz: 1". */
  week?: string;
  rows: SheetRow[];
  /** Dzien bez zajec calego arkusza (swieto, przerwa) — pasek z opisem zamiast wierszy. */
  closed?: string;
  /** Kolumny bez zajec szare (niestacjonarne). */
  greyIdle: boolean;
  layout: SheetDayLayout;
}

export interface SheetDocument {
  title: string;
  /** "10-11-26 14:51". */
  updated: string;
  termLabel: string;
  mode: SheetMode;
  /** Opisy lewego naglowka: pasmo i grupa ("specjalność" / "grupa"). */
  headLabels: [string, string];
  columns: SheetColumn[];
  days: SheetDay[];
  notes: string[];
}

/** Przypisy ramek: przedmiot, forma, kolumny i rytm. */
export function frameNotes(columns: SheetColumn[], days: SheetDay[]): string[] {
  const byKey = new Map<string, { item: SheetItem; labels: string[] }>();
  for (const day of days) {
    for (const s of day.layout.spans) {
      if (!s.framed) continue;
      for (const item of s.items) {
        if (!item.pattern) continue;
        const key = `${item.subject}|${item.classType}|${item.pattern}`;
        const entry = byKey.get(key) ?? { item, labels: [] };
        for (let c = s.colFrom; c <= s.colTo; c++) {
          const label = columns[c]!.label;
          if (!entry.labels.includes(label)) entry.labels.push(label);
        }
        byKey.set(key, entry);
      }
    }
  }
  if (byKey.size === 0) return [];
  const lines = [...byKey.values()]
    .sort((a, b) => a.item.subject.localeCompare(b.item.subject) || a.item.pattern.localeCompare(b.item.pattern))
    .map(({ item, labels }) => {
      const where = labels.length > 6 ? `${labels.slice(0, 6).join(', ')}…` : labels.join(', ');
      return `${item.subject} ${FORM_SHORT[item.classType] ?? ''} (${where}): ${item.pattern}`;
    });
  return ['Zajęcia w czerwonych ramkach z przekątnymi odbywają się na zmianę co 2 tyg. albo tylko przez część semestru:', ...lines];
}
