import { describe, expect, it } from 'vitest';
import { diffOccurrences, type DerivedRow, type ExistingRow } from './occurrenceDiff';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Termin z wzorca umieszczenia pl1 (pon. 10:15–12:00, sala r1). */
const planned = (originalDate: string, extra: Partial<DerivedRow> = {}): DerivedRow => ({
  termId: 't1',
  facultyId: 'wm',
  sectionId: 's1',
  placementId: 'pl1',
  originalDate: d(originalDate),
  date: d(originalDate),
  startOrder: 4,
  endOrder: 5,
  startMinute: 615,
  endMinute: 720,
  roomId: 'r1',
  instructorId: 'i1',
  groupId: 'g1',
  kind: 'DERIVED',
  status: 'SCHEDULED',
  jointKey: null,
  note: null,
  ...extra,
});
/** Ten sam termin juz zapisany w bazie (z id). */
const existing = (id: string, originalDate: string, extra: Partial<ExistingRow> = {}): ExistingRow => {
  const { kind: _kind, ...row } = planned(originalDate);
  return { ...row, id, ...extra };
};

describe('diffOccurrences — terminy zachowuja id miedzy generowaniami', () => {
  it('bez zmian we wzorcu: nic do zapisu, te same wiersze', () => {
    const diff = diffOccurrences([existing('o1', '2027-03-01'), existing('o2', '2027-03-08')], [planned('2027-03-01'), planned('2027-03-08')]);
    expect(diff).toMatchObject({ toCreate: [], toUpdate: [], toDelete: [], added: 0, changed: 0, unchanged: 2 });
  });

  it('zmiana sali we wzorcu: aktualizacja w miejscu (to samo id), nie usuniecie i nowy wiersz', () => {
    const diff = diffOccurrences([existing('o1', '2027-03-01')], [planned('2027-03-01', { roomId: 'r2' })]);
    expect(diff.toUpdate).toEqual([{ id: 'o1', data: planned('2027-03-01', { roomId: 'r2' }) }]);
    expect(diff).toMatchObject({ toCreate: [], toDelete: [], changed: 1 });
  });

  it('przeniesienie wyjatkiem: ta sama data z wzorca -> ten sam wiersz z nowa data', () => {
    const moved = planned('2027-03-01', { date: d('2027-03-04') });
    const diff = diffOccurrences([existing('o1', '2027-03-01')], [moved]);
    expect(diff.toUpdate).toEqual([{ id: 'o1', data: moved }]);
    expect(diff.changed).toBe(1);
  });

  it('nowa data we wzorcu -> nowy wiersz; data, ktorej juz nie ma -> usuniecie', () => {
    const diff = diffOccurrences([existing('o1', '2027-03-01'), existing('o2', '2027-03-08')], [planned('2027-03-01'), planned('2027-03-15')]);
    expect(diff.toCreate).toEqual([planned('2027-03-15')]);
    expect(diff.toDelete).toEqual(['o2']);
    expect(diff).toMatchObject({ added: 1, unchanged: 1 });
  });

  it('zmiana niewidoczna w planie (klucz zajec laczonych, uwaga) — zapis bez liczenia jako "zmienione"', () => {
    const diff = diffOccurrences([existing('o1', '2027-03-01')], [planned('2027-03-01', { jointKey: 'J1', note: 'Powod' })]);
    expect(diff.toUpdate).toHaveLength(1);
    expect(diff).toMatchObject({ changed: 0, unchanged: 1 });
  });

  it('terminy usunietych umieszczen (placementId = null) ida do usuniecia, nawet z ta sama data', () => {
    const diff = diffOccurrences([existing('o9', '2027-03-01', { placementId: null })], [planned('2027-03-01')]);
    expect(diff.toDelete).toEqual(['o9']);
    expect(diff.toCreate).toHaveLength(1);
  });

  it('dubel klucza w bazie: jeden wiersz zostaje, nadmiarowy jest usuwany', () => {
    const diff = diffOccurrences([existing('o1', '2027-03-01'), existing('o1bis', '2027-03-01')], [planned('2027-03-01')]);
    expect(diff.toDelete).toEqual(['o1bis']);
    expect(diff).toMatchObject({ toCreate: [], toUpdate: [], unchanged: 1 });
  });
});
