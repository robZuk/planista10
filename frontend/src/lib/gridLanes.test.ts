import { describe, expect, it } from 'vitest';
import { assignLanes, type LaneItem } from './gridLanes';

const item = (id: string, startOrder: number, endOrder: number): LaneItem => ({ id, startOrder, endOrder });
const layout = (items: LaneItem[]) => Object.fromEntries(assignLanes(items));

describe('assignLanes', () => {
  it('pojedyncze zajecia i zajecia jedno po drugim maja pelna szerokosc', () => {
    expect(layout([item('a', 1, 2), item('b', 3, 4)])).toEqual({
      a: { lane: 0, span: 1, lanes: 1 },
      b: { lane: 0, span: 1, lanes: 1 },
    });
  });

  it('dwa rownolegle dziela kolumne na pol', () => {
    expect(layout([item('a', 1, 2), item('b', 1, 2)])).toEqual({
      a: { lane: 0, span: 1, lanes: 2 },
      b: { lane: 1, span: 1, lanes: 2 },
    });
  });

  it('caly klaster (nakladanie posrednie) ma wspolna liczbe torow', () => {
    // a nachodzi na b, b na c i d — a z c/d nie, ale sa w tym samym klastrze.
    const r = layout([item('a', 1, 2), item('b', 2, 5), item('c', 4, 5), item('d', 4, 5)]);
    expect(new Set(Object.values(r).map((p) => p.lanes))).toEqual(new Set([3]));
  });

  it('kafelek rozszerza sie na wolne tory obok', () => {
    // a i b rownolegle (2 tory), potem c sam -> pelna szerokosc mimo 2 torow w klastrze.
    const r = layout([item('a', 1, 2), item('b', 2, 3), item('c', 3, 4)]);
    expect(r.a).toEqual({ lane: 0, span: 1, lanes: 2 });
    expect(r.b).toEqual({ lane: 1, span: 1, lanes: 2 });
    // c trafia do toru 0 (a juz sie skonczylo), tor 1 zajmuje b w bloku 3 -> bez rozszerzenia.
    expect(r.c).toEqual({ lane: 0, span: 1, lanes: 2 });

    const wide = layout([item('w', 1, 4), item('x', 1, 1), item('y', 1, 1), item('z', 3, 4)]);
    // z w torze 1 (x skonczylo sie), tor 2 (y) wolny od bloku 2 -> z zajmuje tory 1-2.
    expect(wide.z).toEqual({ lane: 1, span: 2, lanes: 3 });
  });

  it('klastry sa niezalezne — po przerwie znow pelna szerokosc', () => {
    const r = layout([item('a', 1, 1), item('b', 1, 1), item('c', 1, 1), item('d', 2, 2)]);
    expect(r.d).toEqual({ lane: 0, span: 1, lanes: 1 });
  });

  it('kolejnosc wejscia nie zmienia ukladu', () => {
    const items = [item('b', 1, 2), item('a', 1, 2), item('c', 2, 3)];
    expect(layout(items)).toEqual(layout([...items].reverse()));
  });
});
