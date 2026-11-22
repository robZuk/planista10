import { describe, expect, it } from 'vitest';
import { indexGroups, type TreeGroup } from './groupTree';
import {
  abbreviateSubject,
  frameNotes,
  layoutDay,
  leafGroups,
  roman,
  rowLabel,
  sheetColumns,
  sheetDate,
  shortWord,
  subjectColor,
  trimRows,
  updatedStamp,
  type SheetCohortInput,
  type SheetDay,
  type SheetItem,
  type SheetRow,
} from './planSheet';
import { renderSheetPdf } from './planSheetPdf';

const g = (id: string, partitionKey: string, parentId: string | null, code: string | null, over: Partial<TreeGroup> = {}): TreeGroup => ({
  id,
  cohortId: 'c1',
  parentId,
  partitionKey,
  code,
  fromSemester: 1,
  toSemester: null,
  ...over,
});

// EDST z dwiema specjalnosciami: DUT (jedna grupa C) i ZEEW (C 1, C 2).
const specTree = [
  g('root', 'ROOT', null, null),
  g('zeew', 'SPEC', 'root', 'ZEEW', { specializationId: 's-zeew' }),
  g('dut', 'SPEC', 'root', 'DUT', { specializationId: 's-dut' }),
  g('z2', 'C', 'zeew', '2'),
  g('z1', 'C', 'zeew', '1'),
  g('d1', 'C', 'dut', '1'),
];
const cohort = (groups: TreeGroup[], over: Partial<SheetCohortInput> = {}): SheetCohortInput => ({
  id: groups[0]!.cohortId,
  band: 'EDST',
  fieldShort: 'EDST',
  semester: 1,
  index: indexGroups(groups),
  specShort: (id) => ({ 's-zeew': 'ZEEW', 's-dut': 'DUT' })[id ?? ''] ?? null,
  ...over,
});

describe('kolumny arkusza', () => {
  it('liscie w kolejnosci drzewa, kody sortowane naturalnie', () => {
    const tree = [g('root', 'ROOT', null, null), ...['10', '2', '3b', '1', '3a'].map((c) => g(`c${c}`, 'C', 'root', c))];
    expect(leafGroups('c1', indexGroups(tree), 1).map((l) => l.code)).toEqual(['1', '2', '3a', '3b', '10']);
  });

  it('stacjonarne: specjalnosc z jedna grupa — sam skrot, z kilkoma — "ZEEW 1"', () => {
    expect(sheetColumns([cohort(specTree)], 'FULL_TIME').map((c) => c.label)).toEqual(['DUT', 'ZEEW 1', 'ZEEW 2']);
  });

  it('niestacjonarne: "1 ZEEW", grupa rocznika bez specjalnosci "1 MiBM"', () => {
    expect(sheetColumns([cohort(specTree)], 'PART_TIME').map((c) => c.label)).toEqual(['DUT', '1 ZEEW', '2 ZEEW']);
    const mibm = [g('r', 'ROOT', null, null, { cohortId: 'c2' }), g('a', 'C', 'r', '1', { cohortId: 'c2' })];
    expect(sheetColumns([cohort(mibm, { fieldShort: 'MiBM' })], 'PART_TIME').map((c) => c.label)).toEqual(['1 MiBM']);
  });

  it('rocznik bez podgrup — jedna kolumna z nazwa kierunku', () => {
    expect(sheetColumns([cohort([g('root', 'ROOT', null, null)])], 'FULL_TIME').map((c) => c.label)).toEqual(['EDST']);
  });

  it('grupy nieaktywne w semestrze nie sa kolumnami', () => {
    const tree = [...specTree.slice(0, 3), g('d1', 'C', 'dut', '1', { fromSemester: 3 })];
    expect(sheetColumns([cohort(tree)], 'FULL_TIME').map((c) => c.label)).toEqual(['DUT', 'ZEEW']);
  });

  it('filtr grupy: tylko kolumny w jej linii', () => {
    expect(sheetColumns([cohort(specTree, { onlyGroupId: 'zeew' })], 'FULL_TIME').map((c) => c.key)).toEqual(['z1', 'z2']);
    expect(sheetColumns([cohort(specTree, { onlyGroupId: 'd1' })], 'FULL_TIME').map((c) => c.key)).toEqual(['d1']);
  });

  it('kolumna pokrywa lisc i jego przodkow', () => {
    const z1 = sheetColumns([cohort(specTree)], 'FULL_TIME')[1]!;
    expect([...z1.covers].sort()).toEqual(['root', 'z1', 'zeew']);
  });
});

const rows: SheetRow[] = [
  { label: '8', startMinute: 480, endMinute: 540 },
  { label: '9', startMinute: 540, endMinute: 600 },
  { label: '10', startMinute: 600, endMinute: 660 },
];
const item = (over: Partial<SheetItem>): SheetItem => ({
  id: 'i',
  cohortId: 'c1',
  groupId: 'root',
  startMinute: 480,
  endMinute: 600,
  subject: 'Matematyka',
  classType: 'LECTURE',
  room: 'A016',
  person: 'Kowalski',
  pattern: '',
  ...over,
});

describe('layoutDay', () => {
  const columns = sheetColumns([cohort(specTree)], 'FULL_TIME');

  it('wyklad rocznika scalony przez wszystkie kolumny, osobno w kazdym bloku', () => {
    const { spans, idle } = layoutDay(columns, rows, [item({})]);
    expect(spans.map((s) => [s.row, s.colFrom, s.colTo])).toEqual([
      [0, 0, 2],
      [1, 0, 2],
    ]);
    expect(idle).toEqual([false, false, false]);
  });

  it('cwiczenia grup obok siebie; rozne sale sie nie scalaja', () => {
    const { spans, idle } = layoutDay(columns, rows.slice(0, 1), [
      item({ id: 'a', groupId: 'z1', classType: 'EXERCISE', room: 'A1' }),
      item({ id: 'b', groupId: 'z2', classType: 'EXERCISE', room: 'A2' }),
    ]);
    expect(spans.map((s) => [s.colFrom, s.colTo, s.items[0]!.room])).toEqual([
      [1, 1, 'A1'],
      [2, 2, 'A2'],
    ]);
    expect(idle).toEqual([true, false, false]);
  });

  it('zajecia laczone dwoch rocznikow (ten sam wpis) scalaja sie przez granice', () => {
    const other = [g('r2', 'ROOT', null, null, { cohortId: 'c2' })];
    const cols = sheetColumns([cohort(specTree), cohort(other, { band: 'MiBM' })], 'FULL_TIME');
    const { spans } = layoutDay(cols, rows.slice(0, 1), [item({ id: 'a' }), item({ id: 'b', cohortId: 'c2', groupId: 'r2' })]);
    expect(spans.map((s) => [s.colFrom, s.colTo])).toEqual([[0, 3]]);
  });

  it('naprzemienne co 2 tyg.: ramka przez bloki, kolejne wiersze kolejne przedmioty (najpierw nieparzyste)', () => {
    const { spans, frames } = layoutDay(columns, rows, [
      item({ id: 'a', subject: 'Fizyka', pattern: 'tyg. nieparzyste' }),
      item({ id: 'b', subject: 'Chemia', pattern: 'tyg. parzyste' }),
    ]);
    expect(frames).toEqual([{ rowFrom: 0, rowTo: 1, colFrom: 0, colTo: 2 }]);
    expect(spans.map((s) => s.items.map((i) => i.subject))).toEqual([['Fizyka'], ['Chemia']]);
    expect(spans.every((s) => s.framed)).toBe(true);
  });

  it('jeden przedmiot przez pol semestru — ramka, ten sam wpis w obu wierszach', () => {
    const { spans, frames } = layoutDay(columns, rows, [item({ pattern: 'tyg. 1–8' })]);
    expect(frames).toHaveLength(1);
    expect(spans.map((s) => s.items[0]!.subject)).toEqual(['Matematyka', 'Matematyka']);
  });

  it('termin w minutach trafia w bloki, ktore przecina', () => {
    const { spans } = layoutDay(columns, rows, [item({ startMinute: 570, endMinute: 615 })]);
    expect(spans.map((s) => s.row)).toEqual([1, 2]);
  });
});

describe('trimRows', () => {
  const grid: SheetRow[] = [7, 8, 9, 10, 11, 12].map((h) => ({ label: String(h), startMinute: h * 60, endMinute: h * 60 + 60 }));
  it('od pierwszego do ostatniego zajetego bloku i jeden pusty', () => {
    expect(trimRows(grid, [{ startMinute: 480, endMinute: 600 }]).map((r) => r.label)).toEqual(['8', '9', '10']);
  });
  it('dzien bez zajec — zakres reszty arkusza', () => {
    expect(trimRows(grid, [], { from: 540, to: 660 }).map((r) => r.label)).toEqual(['9', '10']);
  });
});

describe('skroty nazw', () => {
  const max = (n: number) => (t: string) => t.length <= n;
  it('bez numeracji, gdy sie miesci', () => {
    expect(abbreviateSubject('Matematyka I, II', max(30))).toBe('Matematyka');
    expect(abbreviateSubject('Wychowanie fizyczne I-IV', max(30))).toBe('Wychowanie fizyczne');
  });
  it('najdluzsze slowa najpierw, potem ciasno', () => {
    expect(abbreviateSubject('Podstawy konstrukcji maszyn I, II', max(20))).toBe('Podst.konstr.maszyn');
    expect(abbreviateSubject('Podstawy konstrukcji maszyn', max(14))).toBe('Pod.kon.masz.');
  });
  it('shortWord', () => {
    expect(shortWord('Podstawy')).toBe('Podst.');
    expect(shortWord('Fizyka')).toBe('Fizyka');
    expect(shortWord('Maszyn', true)).toBe('Masz.');
    expect(shortWord('I,II')).toBe('I,II');
  });
});

describe('teksty i kolory', () => {
  it('kolor przedmiotu staly', () => expect(subjectColor('Fizyka')).toBe(subjectColor('Fizyka')));
  it('etykiety', () => {
    expect(rowLabel(420, 'FULL_TIME')).toBe('7');
    expect(rowLabel(435, 'FULL_TIME')).toBe('7:15');
    expect(rowLabel(530, 'PART_TIME')).toBe('8:50');
    expect(sheetDate('2026-10-03')).toBe('3 paź');
    expect(roman(3)).toBe('III');
    expect(updatedStamp(new Date(2026, 10, 10, 14, 51))).toBe('10-11-26 14:51');
  });
});

describe('frameNotes i PDF', () => {
  const columns = sheetColumns([cohort(specTree)], 'FULL_TIME');
  const day = (items: SheetItem[], greyIdle = false): SheetDay => ({ key: 'MONDAY', label: 'Pn', rows, greyIdle, layout: layoutDay(columns, rows, items) });

  it('przypisy: przedmiot, forma, kolumny, rytm', () => {
    const notes = frameNotes(columns, [day([item({ groupId: 'zeew', subject: 'Fizyka', pattern: 'tyg. nieparzyste' })])]);
    expect(notes[1]).toBe('Fizyka w. (ZEEW 1, ZEEW 2): tyg. nieparzyste');
    expect(frameNotes(columns, [day([item({})])])).toEqual([]);
  });

  it.each(['FULL_TIME', 'PART_TIME'] as const)('rysuje arkusz (%s)', async (mode) => {
    const items = [item({}), item({ id: 'x', groupId: 'z1', subject: 'Podstawy konstrukcji maszyn I, II', pattern: 'tyg. parzyste' })];
    const days = [day(items, mode === 'PART_TIME'), { key: '2026-10-04', label: 'Niedz.', sublabel: '4 paź', week: 'tydz: 1', rows: [], closed: 'Wszystkich Świętych', greyIdle: true, layout: layoutDay(columns, [], []) }];
    const pdf = await renderSheetPdf({ title: 'Arkusz', updated: '10-11-26 14:51', termLabel: '2026/27 zimowy', mode, headLabels: ['specjalność', 'grupa'], columns, days, notes: frameNotes(columns, days) });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
