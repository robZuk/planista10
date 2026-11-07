import { describe, expect, it } from 'vitest';
import { staleReasons } from './planStaleness';

describe('staleReasons', () => {
  it('nic nie zmienione od generowania -> aktualne', () => {
    expect(staleReasons({ lastPlacementChange: 100, lastSectionChange: 90, generatedAt: 200 })).toEqual([]);
  });

  it('umieszczenie zmienione po generowaniu -> PLACEMENTS', () => {
    expect(staleReasons({ lastPlacementChange: 300, lastSectionChange: 90, generatedAt: 200 })).toEqual(['PLACEMENTS']);
  });

  it('godziny zajec zmienione po generowaniu (synchronizacja) -> SECTIONS', () => {
    expect(staleReasons({ lastPlacementChange: 100, lastSectionChange: 300, generatedAt: 200 })).toEqual(['SECTIONS']);
  });

  it('oba powody naraz', () => {
    expect(staleReasons({ lastPlacementChange: 300, lastSectionChange: 300, generatedAt: 200 })).toEqual(['PLACEMENTS', 'SECTIONS']);
  });

  it('nigdy nie generowano: sa umieszczenia -> PLACEMENTS, zmiana zajec sama nie wystarcza', () => {
    expect(staleReasons({ lastPlacementChange: 100, lastSectionChange: 300, generatedAt: 0 })).toEqual(['PLACEMENTS']);
  });

  it('brak umieszczen i generowania -> aktualne', () => {
    expect(staleReasons({ lastPlacementChange: 0, lastSectionChange: 0, generatedAt: 0 })).toEqual([]);
  });
});
