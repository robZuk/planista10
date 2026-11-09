import { describe, expect, it } from 'vitest';
import { staleReasons } from './planStaleness';

describe('staleReasons', () => {
  it('umieszczenie usuniete po generowaniu: jego terminy wciaz w planie', () => {
    expect(staleReasons({ lastPlacementChange: 100, lastSectionChange: 90, generatedAt: 200, lastDeletion: 300 })).toEqual(['DELETED']);
  });

  it('terminy bez umieszczenia sprzed generowania (przeszlosc przy generowaniu od daty) nie unieaktualniaja', () => {
    expect(staleReasons({ lastPlacementChange: 100, lastSectionChange: 90, generatedAt: 200, lastDeletion: 150 })).toEqual([]);
  });

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

  it('kalendarz zmieniony po generowaniu -> CALENDAR; przed generowaniem albo bez generowania — nie', () => {
    expect(staleReasons({ lastPlacementChange: 1, lastSectionChange: 1, generatedAt: 5, lastCalendarChange: 6 })).toEqual(['CALENDAR']);
    expect(staleReasons({ lastPlacementChange: 1, lastSectionChange: 1, generatedAt: 5, lastCalendarChange: 4 })).toEqual([]);
    expect(staleReasons({ lastPlacementChange: 0, lastSectionChange: 0, generatedAt: 0, lastCalendarChange: 6 })).toEqual([]);
  });
});
