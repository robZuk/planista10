import { describe, expect, it } from 'vitest';
import { displayName, groupsOverlap, indexGroups, isActiveIn, nextCodes, overlappingIds, type TreeGroup } from './groupTree';

const g = (id: string, parentId: string | null, partitionKey: string, code: string | null = null, extra: Partial<TreeGroup> = {}): TreeGroup => ({
  id,
  cohortId: 'k1',
  parentId,
  partitionKey,
  code,
  fromSemester: 1,
  toSemester: null,
  ...extra,
});

// Rocznik: ROOT -> SPEC DUT / SPEC ZEEW; DUT -> C-A, C-B, P-A; C-A -> L-A1, L-A2; C-B -> L-B1
const groups = [
  g('root', null, 'ROOT'),
  g('dut', 'root', 'SPEC', 'DUT', { specializationId: 's-dut' }),
  g('zeew', 'root', 'SPEC', 'ZEEW', { specializationId: 's-zeew' }),
  g('ca', 'dut', 'C', 'A'),
  g('cb', 'dut', 'C', 'B'),
  g('pa', 'dut', 'P', 'A'),
  g('la1', 'ca', 'L', 'A1'),
  g('la2', 'ca', 'L', 'A2'),
  g('lb1', 'cb', 'L', 'B1'),
  g('z-ca', 'zeew', 'C', 'A'),
];
const index = indexGroups(groups);

describe('groupsOverlap', () => {
  it('rozne grupy tego samego podzialu sa rozlaczne', () => {
    expect(groupsOverlap('ca', 'cb', index)).toBe(false);
    expect(groupsOverlap('la1', 'la2', index)).toBe(false);
  });

  it('podgrupy roznych grup sa rozlaczne (L-A1 vs C-B, L-A1 vs L-B1)', () => {
    expect(groupsOverlap('la1', 'cb', index)).toBe(false);
    expect(groupsOverlap('la1', 'lb1', index)).toBe(false);
  });

  it('przodek i potomek koliduja', () => {
    expect(groupsOverlap('ca', 'la1', index)).toBe(true);
    expect(groupsOverlap('root', 'lb1', index)).toBe(true);
    expect(groupsOverlap('dut', 'la2', index)).toBe(true);
  });

  it('projekt koliduje z laboratorium (inny podzial) — luka starego modelu', () => {
    expect(groupsOverlap('pa', 'la1', index)).toBe(true);
    expect(groupsOverlap('pa', 'cb', index)).toBe(true);
  });

  it('rozne specjalnosci sa rozlaczne, takze w glebi', () => {
    expect(groupsOverlap('dut', 'zeew', index)).toBe(false);
    expect(groupsOverlap('la1', 'z-ca', index)).toBe(false);
  });

  it('grupy roznych rocznikow nie koliduja', () => {
    const other = indexGroups([...groups, g('x', null, 'ROOT', null, { cohortId: 'k2' })]);
    expect(groupsOverlap('root', 'x', other)).toBe(false);
  });

  it('overlappingIds zbiera cala rodzine kolizji', () => {
    expect([...overlappingIds('la1', groups, index)].sort()).toEqual(['ca', 'dut', 'la1', 'pa', 'root'].sort());
  });
});

describe('nazwy i aktywnosc', () => {
  const ctx = { fieldShortName: 'EDST', specShortNames: new Map([['s-dut', 'DUT']]), partTime: false, semester: 3 };

  it('nazwa liczona z semestru i specjalnosci', () => {
    expect(displayName(index.get('la1')!, index, ctx)).toBe('DUT-3-L-A1');
    expect(displayName(index.get('dut')!, index, ctx)).toBe('DUT-3-W');
    expect(displayName(index.get('root')!, index, { ...ctx, partTime: true, semester: 1 })).toBe('EDST-SN-1-W');
  });

  it('zakres obowiazywania grupy', () => {
    expect(isActiveIn({ fromSemester: 3, toSemester: null }, 2)).toBe(false);
    expect(isActiveIn({ fromSemester: 1, toSemester: 4 }, 4)).toBe(true);
    expect(isActiveIn({ fromSemester: 1, toSemester: 4 }, 5)).toBe(false);
  });

  it('kolejne kody grup i podgrup', () => {
    expect(nextCodes(3, null, ['A'])).toEqual(['B', 'C', 'D']);
    expect(nextCodes(2, 'B', [])).toEqual(['B1', 'B2']);
  });
});
