import { describe, expect, it } from 'vitest';
import {
  slotsOutsideDays,
  formatMinutes,
  gridBreaks,
  gridTime,
  mapRangeByTime,
  minutesOverlap,
  numberBlocks,
  toMinutes,
  validateBlocks,
  dayWindowProblem,
  defaultGridDays,
  parseGridDays,
  type GridBlock,
} from './timeGrid';

// Siatka 45 min z przerwami: 08:00-08:45, 08:45-09:30 | przerwa 15 | 09:45-10:30, 10:30-11:15
const g45: GridBlock[] = [
  { order: 1, startTime: '08:00', endTime: '08:45' },
  { order: 2, startTime: '08:45', endTime: '09:30' },
  { order: 3, startTime: '09:45', endTime: '10:30' },
  { order: 4, startTime: '10:30', endTime: '11:15' },
];
// Siatka 60 min od 07:00
const g60: GridBlock[] = Array.from({ length: 13 }, (_, i) => ({
  order: i + 1,
  startTime: `${String(7 + i).padStart(2, '0')}:00`,
  endTime: `${String(8 + i).padStart(2, '0')}:00`,
}));

describe('minuty', () => {
  it('toMinutes / formatMinutes w obie strony', () => {
    expect(toMinutes('08:45')).toBe(525);
    expect(formatMinutes(525)).toBe('08:45');
    expect(formatMinutes(toMinutes('00:05'))).toBe('00:05');
  });

  it('przedzialy polotwarte: styk nie jest kolizja', () => {
    expect(minutesOverlap(540, 600, 600, 645)).toBe(false); // 9:00-10:00 vs 10:00-10:45
    expect(minutesOverlap(540, 600, 570, 615)).toBe(true); // 9:00-10:00 vs 9:30-10:15
  });
});

describe('gridTime', () => {
  it('zakres blokow -> minuty (ze startu pierwszego do konca ostatniego)', () => {
    expect(gridTime(g45).range(2, 3)).toEqual({ startMinute: 525, endMinute: 630 }); // 08:45-10:30, przez przerwe
    expect(gridTime(g60).range(3, 4)).toEqual({ startMinute: 540, endMinute: 660 });
  });

  it('blok spoza siatki albo odwrocony zakres -> null', () => {
    expect(gridTime(g45).range(4, 5)).toBeNull();
    expect(gridTime(g45).range(3, 2)).toBeNull();
  });

  it('kolizje miedzy siatkami w minutach', () => {
    const a = gridTime(g60).range(3, 3)!; // 09:00-10:00
    const b = gridTime(g45).range(3, 3)!; // 09:45-10:30
    const c = gridTime(g45).range(1, 1)!; // 08:00-08:45
    expect(minutesOverlap(a.startMinute, a.endMinute, b.startMinute, b.endMinute)).toBe(true);
    expect(minutesOverlap(a.startMinute, a.endMinute, c.startMinute, c.endMinute)).toBe(false);
  });

  it('jedna siatka: kolizja minut <=> kolizja numerow blokow', () => {
    const t = gridTime(g45);
    for (let a = 1; a <= 4; a++)
      for (let b = a; b <= 4; b++)
        for (let c = 1; c <= 4; c++)
          for (let d = c; d <= 4; d++) {
            const x = t.range(a, b)!;
            const y = t.range(c, d)!;
            expect(minutesOverlap(x.startMinute, x.endMinute, y.startMinute, y.endMinute)).toBe(a <= d && c <= b);
          }
  });
});

describe('validateBlocks', () => {
  it('poprawna siatka z przerwami', () => {
    expect(validateBlocks(g45)).toEqual([]);
  });

  it('zly format, odwrocony blok, nakladanie sie', () => {
    expect(validateBlocks([{ startTime: '8:00', endTime: '09:00' }])[0]).toMatch(/format/);
    expect(validateBlocks([{ startTime: '09:00', endTime: '08:00' }])[0]).toMatch(/przed startem/);
    expect(validateBlocks([{ startTime: '08:00', endTime: '09:00' }, { startTime: '08:30', endTime: '09:15' }])[0]).toMatch(/nachodza/);
    expect(validateBlocks([])[0]).toMatch(/co najmniej jeden/);
  });
});

describe('numberBlocks i przerwy', () => {
  it('numeracja wg godziny startu, niezaleznie od kolejnosci wejscia', () => {
    const n = numberBlocks([
      { startTime: '09:45', endTime: '10:30' },
      { startTime: '08:00', endTime: '08:45' },
    ]);
    expect(n.map((b) => [b.order, b.startTime])).toEqual([
      [1, '08:00'],
      [2, '09:45'],
    ]);
  });

  it('przerwy = odstepy miedzy blokami', () => {
    expect(gridBreaks(g45)).toEqual([{ afterOrder: 2, startMinute: 570, endMinute: 585, minutes: 15 }]);
    expect(gridBreaks(g60)).toEqual([]);
  });
});

describe('dni zajec siatki', () => {
  const wnNst = [
    { day: 'THURSDAY', from: '16:00', to: null },
    { day: 'FRIDAY', from: '16:00', to: null },
    { day: 'SATURDAY', from: null, to: null },
    { day: 'SUNDAY', from: null, to: '18:00' },
  ] as const;

  it('dzien spoza siatki -> problem z lista dni', () => {
    expect(dayWindowProblem([...wnNst], 'MONDAY', 600, 690)).toMatch(/poniedzialek.*czwartek, piatek, sobota, niedziela/);
  });

  it('okno godzin: czwartek od 16:00, niedziela do 18:00', () => {
    expect(dayWindowProblem([...wnNst], 'THURSDAY', 15 * 60, 16 * 60 + 30)).toBe('czwartek: zajecia od 16:00');
    expect(dayWindowProblem([...wnNst], 'THURSDAY', 16 * 60, 16 * 60 + 45)).toBeNull();
    expect(dayWindowProblem([...wnNst], 'SUNDAY', 17 * 60, 18 * 60 + 30)).toBe('niedziela: zajecia do 18:00');
    expect(dayWindowProblem([...wnNst], 'SATURDAY', 8 * 60, 21 * 60)).toBeNull();
  });

  it('domyslne dni = dotychczasowa regula', () => {
    expect(defaultGridDays('FULL_TIME').map((d) => d.day)).toEqual(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']);
    expect(defaultGridDays('PART_TIME')).toEqual([
      { day: 'FRIDAY', from: '15:00', to: null },
      { day: 'SATURDAY', from: null, to: null },
      { day: 'SUNDAY', from: null, to: null },
    ]);
  });

  it('parseGridDays: kolejnosc tygodnia, bledne wpisy pominiete', () => {
    expect(
      parseGridDays([
        { day: 'SUNDAY', from: null, to: null },
        { day: 'MONDAY', from: '8:00', to: null }, // zly format
        { day: 'THURSDAY', from: '16:00', to: null },
        'x',
      ]).map((d) => d.day),
    ).toEqual(['THURSDAY', 'SUNDAY']);
  });
});

describe('mapRangeByTime (zajecia laczone miedzy siatkami)', () => {
  it('ta sama godzina startu i konca -> numery blokow w drugiej siatce', () => {
    // siatka 60 min, bloki 3-4 = 09:00-11:00 -> siatka z blokami od 08:00 na pozycjach 2-3
    const target: GridBlock[] = [
      { order: 1, startTime: '08:00', endTime: '09:00' },
      { order: 2, startTime: '09:00', endTime: '10:00' },
      { order: 3, startTime: '10:00', endTime: '11:00' },
    ];
    expect(mapRangeByTime(gridTime(g60), gridTime(target), 3, 4)).toEqual({ startOrder: 2, endOrder: 3 });
  });

  it('godziny nie istnieja w drugiej siatce -> null', () => {
    expect(mapRangeByTime(gridTime(g60), gridTime(g45), 3, 3)).toBeNull(); // 09:00-10:00 vs siatka 45 min
    expect(mapRangeByTime(gridTime(g60), gridTime(g45), 99, 99)).toBeNull();
  });
});

describe('slotsOutsideDays', () => {
  const time = gridTime([
    { order: 1, startTime: '08:00', endTime: '09:00' },
    { order: 2, startTime: '16:00', endTime: '17:00' },
  ]);
  const slot = (dayOfWeek: 'THURSDAY' | 'FRIDAY', order: number, cohortId: string) => ({ dayOfWeek, startOrder: order, endOrder: order, cohortId });

  it('wszystko w siatce — pusto', () => {
    expect(slotsOutsideDays([slot('FRIDAY', 1, 'c1')], [{ day: 'FRIDAY', from: null, to: null }], time)).toEqual([]);
  });

  it('usuniety dzien i zawezone okno — grupy z liczba umieszczen i rocznikow', () => {
    const days = [{ day: 'THURSDAY' as const, from: '16:00', to: null }];
    const result = slotsOutsideDays([slot('FRIDAY', 1, 'c1'), slot('FRIDAY', 2, 'c1'), slot('THURSDAY', 1, 'c2'), slot('THURSDAY', 2, 'c2')], days, time);
    expect(result).toEqual([
      { problem: 'Siatka nie przewiduje zajec w dniu: piatek (dni: czwartek)', placements: 2, cohorts: 1 },
      { problem: 'czwartek: zajecia od 16:00', placements: 1, cohorts: 1 },
    ]);
  });
});
