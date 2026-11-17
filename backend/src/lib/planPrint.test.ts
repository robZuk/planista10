import { describe, expect, it } from 'vitest';
import { dateColumns, datesBetween, pdfFileName, printLanes, timeWindow, weekPatternLabel, weekdayColumns } from './planPrint';
import { renderPlanPdf } from './planPdf';

describe('weekPatternLabel', () => {
  const p = (over: object = {}) => ({ pattern: 'ALL', numbers: [], fromIndex: null, toIndex: null, ...over });
  it('co tydzien — bez opisu (domyslny rytm)', () => expect(weekPatternLabel(p())).toBe(''));
  it('parzyste / nieparzyste z zakresem', () => {
    expect(weekPatternLabel(p({ pattern: 'EVEN', fromIndex: 1, toIndex: 7 }))).toBe('tyg. parzyste 1–7');
    expect(weekPatternLabel(p({ pattern: 'ODD', fromIndex: 3 }))).toBe('tyg. nieparzyste 3–…');
  });
  it('wybrane tygodnie i zakres', () => {
    expect(weekPatternLabel(p({ pattern: 'LIST', numbers: [3, 5] }))).toBe('tyg. 3,5');
    expect(weekPatternLabel(p({ toIndex: 7 }))).toBe('tyg. 1–7');
  });
});

describe('kolumny', () => {
  it('dni tygodnia w kolejnosci, bez powtorzen', () => {
    expect(weekdayColumns(['FRIDAY', 'MONDAY', 'FRIDAY']).map((c) => c.label)).toEqual(['Poniedziałek', 'Piątek']);
  });
  it('daty z dniem tygodnia', () => {
    expect(dateColumns(['2027-03-07', '2027-03-06'])).toEqual([
      { key: '2027-03-06', label: 'Sobota', sublabel: '6.03' },
      { key: '2027-03-07', label: 'Niedziela', sublabel: '7.03' },
    ]);
  });
  it('dni zjazdu od–do', () => expect(datesBetween('2027-03-05', '2027-03-07')).toEqual(['2027-03-05', '2027-03-06', '2027-03-07']));
});

describe('timeWindow', () => {
  it('pelne godziny wokol zajec', () => {
    expect(timeWindow([{ startMinute: 7 * 60 + 30, endMinute: 9 * 60 }, { startMinute: 16 * 60 + 50, endMinute: 18 * 60 + 25 }])).toEqual({ start: 420, end: 1140 });
  });
  it('pusta strona — 8:00–16:00', () => expect(timeWindow([])).toEqual({ start: 480, end: 960 }));
});

describe('printLanes — tory zajec rownoleglych w minutach', () => {
  it('zajecia na styk nie dziela kolumny', () => {
    const lanes = printLanes([
      { id: 'a', startMinute: 480, endMinute: 570 },
      { id: 'b', startMinute: 570, endMinute: 660 },
    ]);
    expect(lanes.get('a')).toEqual({ lane: 0, span: 1, lanes: 1 });
    expect(lanes.get('b')).toEqual({ lane: 0, span: 1, lanes: 1 });
  });
  it('nakladajace sie — wspolna liczba torow, wolny tor obok rozszerza kafelek', () => {
    const lanes = printLanes([
      { id: 'long', startMinute: 480, endMinute: 660 },
      { id: 'x', startMinute: 480, endMinute: 540 },
      { id: 'y', startMinute: 600, endMinute: 660 },
      { id: 'z', startMinute: 480, endMinute: 540 },
    ]);
    expect(lanes.get('long')).toMatchObject({ lane: 0, lanes: 3 });
    expect(lanes.get('y')).toEqual({ lane: 1, span: 2, lanes: 3 });
  });
});

it('pdfFileName — bez polskich znakow i spacji', () => {
  expect(pdfFileName(['dr Rafał Łukasz Żak', '2026-Z'])).toBe('plan-dr-Rafal-Lukasz-Zak-2026-Z.pdf');
  expect(pdfFileName(['ŻA-2-W · semestr 2'])).toBe('plan-ZA-2-W-semestr-2.pdf');
});

it('renderPlanPdf — plik PDF z polskimi znakami i strona na kazda strone planu', async () => {
  const entry = { id: 'e1', column: 'MONDAY', startMinute: 480, endMinute: 570, classType: 'LECTURE', title: 'Wytrzymałość materiałów', lines: ['s. 114', 'MiBM-1-W · dr Żaneta Łęcka'] };
  const pdf = await renderPlanPdf({
    title: 'Test',
    termLabel: '2026/27 zimowy',
    pages: [
      { heading: 'MiBM-S1 · semestr 1', subheading: 'Plan tygodnia', columns: weekdayColumns(['MONDAY', 'TUESDAY']), entries: [entry] },
      { heading: 'Pusta', subheading: '', columns: weekdayColumns(['MONDAY']), entries: [], emptyText: 'Brak zajęć.' },
    ],
  });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(2);
});
