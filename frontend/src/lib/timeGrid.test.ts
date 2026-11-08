import { describe, expect, it } from 'vitest';
import { blocksWord, breaksBetween, describeDays, describeGrid, gridLayout, formatMinutes, generateBlocks, toMinutes } from './timeGrid';

describe('generateBlocks', () => {
  it('45 min z przerwa 15 min co 2 bloki', () => {
    expect(generateBlocks({ start: '08:00', length: 45, count: 4, breakEvery: 2, breakMinutes: 15 })).toEqual([
      { startTime: '08:00', endTime: '08:45' },
      { startTime: '08:45', endTime: '09:30' },
      { startTime: '09:45', endTime: '10:30' },
      { startTime: '10:30', endTime: '11:15' },
    ]);
  });

  it('bez przerw i nie przekracza polnocy', () => {
    const b = generateBlocks({ start: '22:00', length: 60, count: 5, breakEvery: 0, breakMinutes: 0 });
    expect(b.map((x) => x.startTime)).toEqual(['22:00', '23:00']);
  });
});

describe('przerwy i opis', () => {
  const blocks = generateBlocks({ start: '08:00', length: 45, count: 4, breakEvery: 2, breakMinutes: 15 });

  it('przerwy = odstepy miedzy blokami', () => {
    expect(breaksBetween(blocks)).toEqual([{ afterIndex: 1, start: '09:30', end: '09:45', minutes: 15 }]);
  });

  it('opis siatki', () => {
    expect(describeGrid(blocks)).toBe('08:00-11:15 · 4 bloki po 45 min · przerwy: 1');
  });

  it('minuty w obie strony', () => {
    expect(formatMinutes(toMinutes('07:05'))).toBe('07:05');
  });
});

describe('blocksWord', () => {
  it('odmiana', () => {
    expect([1, 2, 4, 5, 12, 13, 22].map(blocksWord)).toEqual(['blok', 'bloki', 'bloki', 'blokow', 'blokow', 'blokow', 'bloki']);
  });
});

describe('gridLayout', () => {
  const g45 = generateBlocks({ start: '08:00', length: 45, count: 4, breakEvery: 2, breakMinutes: 15 }).map((b, i) => ({ ...b, order: i + 1 }));
  const g60 = generateBlocks({ start: '07:00', length: 60, count: 3, breakEvery: 0, breakMinutes: 0 }).map((b, i) => ({ ...b, order: i + 1 }));

  it('siatka 60 min: skala minimalna, bloki jeden pod drugim', () => {
    const l = gridLayout(g60, { minBlockPx: 66, minPxPerMinute: 68 / 60 });
    expect(l.rows.map((r) => [r.top, r.height])).toEqual([
      [0, 68],
      [68, 68],
      [136, 68],
    ]);
    expect(l.breaks).toEqual([]);
    expect(l.totalHeight).toBe(204);
  });

  it('siatka 45 min: najkrotszy blok ma min. wysokosc, przerwa ma swoj pas', () => {
    const l = gridLayout(g45, { minBlockPx: 66, minPxPerMinute: 68 / 60 });
    expect(l.rows[0]!.height).toBeGreaterThanOrEqual(66);
    expect(l.breaks).toHaveLength(1);
    expect(l.breaks[0]).toMatchObject({ minutes: 15, start: '09:30', end: '09:45', top: l.rows[1]!.top + l.rows[1]!.height });
    expect(l.rows[2]!.top).toBe(l.breaks[0]!.top + l.breaks[0]!.height);
  });

  it('zakres blokow obejmuje przerwe miedzy nimi; brak bloku -> null', () => {
    const l = gridLayout(g45, { minBlockPx: 66, minPxPerMinute: 68 / 60 });
    expect(l.span(2, 3)).toEqual({ top: l.rows[1]!.top, height: l.rows[2]!.top + l.rows[2]!.height - l.rows[1]!.top });
    expect(l.span(4, 5)).toBeNull();
  });
});

describe('describeDays', () => {
  it('dni z oknem godzin', () => {
    expect(
      describeDays([
        { day: 'THURSDAY', from: '16:00', to: null },
        { day: 'SATURDAY', from: null, to: null },
        { day: 'SUNDAY', from: '08:00', to: '18:00' },
      ]),
    ).toBe('czw od 16:00 · sob · nd od 08:00 do 18:00');
    expect(describeDays([])).toBe('brak dni zajec');
  });
});
