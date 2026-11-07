import { describe, expect, it } from 'vitest';
import { groupTreeOptions, treeOptionLabel, visibleGroupIds } from './planGroupFilter';

// Drzewo: rocznik -> DUT (wyklad) -> C-A -> L-A1; DUT -> C-B; rocznik -> ZEEW (wyklad).
// Rocznik nie ma wlasnych zajec (wyklady osobno per specjalnosc) — wystepuje tylko jako przodek.
const R = { id: 'root', name: 'EDST-5' };
const D = { id: 'dut', name: 'DUT-5-W' };
const CA = { id: 'ca', name: 'DUT-5-C-A' };
const dut = { ...D, ancestors: [R] };
const ca = { ...CA, ancestors: [R, D] };
const cb = { id: 'cb', name: 'DUT-5-C-B', ancestors: [R, D] };
const la1 = { id: 'la1', name: 'DUT-5-L-A1', ancestors: [R, D, CA] };
const zeew = { id: 'zeew', name: 'ZEEW-5-W', ancestors: [R] };
const all = [la1, zeew, cb, dut, ca]; // celowo pomieszane

describe('visibleGroupIds', () => {
  it('bez filtra -> null (wszystko widoczne)', () => {
    expect(visibleGroupIds(all, 'all')).toBeNull();
  });

  it('grupa cwiczeniowa widzi siebie, wyklad specjalnosci i caly rocznik', () => {
    expect(visibleGroupIds(all, 'ca')).toEqual(new Set(['ca', 'dut', 'root']));
  });

  it('nie widzi rodzenstwa, podgrup ani innej specjalnosci', () => {
    const v = visibleGroupIds(all, 'ca')!;
    for (const id of ['cb', 'la1', 'zeew']) expect(v.has(id)).toBe(false);
  });

  it('grupa wykladowa specjalnosci widzi tylko siebie i rocznik', () => {
    expect(visibleGroupIds(all, 'dut')).toEqual(new Set(['dut', 'root']));
  });

  it('przodek bez wlasnych zajec (caly rocznik) widzi tylko siebie', () => {
    expect(visibleGroupIds(all, 'root')).toEqual(new Set(['root']));
  });

  it('nieznana grupa (np. po zmianie rocznika) -> brak filtra', () => {
    expect(visibleGroupIds(all, 'inna')).toBeNull();
  });
});

describe('groupTreeOptions', () => {
  it('kolejnosc drzewa z glebokoscia, razem z przodkiem bez zajec', () => {
    expect(groupTreeOptions(all).map((o) => [o.name, o.depth])).toEqual([
      ['EDST-5', 0],
      ['DUT-5-W', 1],
      ['DUT-5-C-A', 2],
      ['DUT-5-L-A1', 3],
      ['DUT-5-C-B', 2],
      ['ZEEW-5-W', 1],
    ]);
  });

  it('kazda grupa raz, nawet gdy wystepuje w wielu sciezkach', () => {
    const ids = groupTreeOptions(all).map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('treeOptionLabel', () => {
  it('korzen bez wciecia, glebsze poziomy z wcieciem i znacznikiem', () => {
    expect(treeOptionLabel({ id: 'r', name: 'EDST-5', depth: 0 })).toBe('EDST-5');
    expect(treeOptionLabel({ id: 'c', name: 'DUT-5-C-A', depth: 2 })).toBe('    └ DUT-5-C-A');
  });
});
