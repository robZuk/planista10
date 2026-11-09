import { describe, expect, it } from 'vitest';
import { lockedEntryChanges, lockedEntryDeleteMessage, lockedEntryMessage } from './programEntryLock';

const current = { subjectId: 's1', specializationId: null, semester: 3 };

describe('lockedEntryChanges', () => {
  it('godziny, ECTS i zaliczenie nie zmieniaja tozsamosci', () => {
    expect(lockedEntryChanges(current, { ...current })).toEqual([]);
  });

  it('przedmiot, specjalnosc i semestr — kazde zgloszone', () => {
    expect(lockedEntryChanges(current, { subjectId: 's2', specializationId: 'dut', semester: 4 })).toEqual([
      'przedmiot',
      'specjalnosc',
      'semestr',
    ]);
  });

  it('specjalnosc: null i brak to to samo (przedmiot wspolny)', () => {
    expect(lockedEntryChanges({ ...current, specializationId: null }, { ...current, specializationId: undefined as unknown as null })).toEqual([]);
  });
});

describe('komunikaty', () => {
  it('liczba zajec i lista zmienianych pol', () => {
    expect(lockedEntryMessage(['przedmiot'], 1)).toMatch(/^Z tej pozycji powstaly juz zajecia \(1\) — nie zmienia sie: przedmiot/);
    expect(lockedEntryMessage(['semestr', 'specjalnosc'], 5)).toMatch(/zajecia \(5\) — nie zmienia sie: semestr, specjalnosc/);
    expect(lockedEntryDeleteMessage(2)).toMatch(/zajecia \(2\) — nie mozna jej usunac/);
  });
});
