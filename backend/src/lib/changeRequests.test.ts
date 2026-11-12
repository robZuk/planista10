import { describe, expect, it } from 'vitest';
import { classLabel, proposalDateProblem, requestableKinds, resolveOnDirectChange, validateRequestInput, lengthProblem } from './changeRequests';
import { occurrenceKey, parseOccurrenceKey } from './occurrenceKey';

const today = '2026-11-09';
const state = (over: Partial<Parameters<typeof requestableKinds>[0]> = {}) => ({
  status: 'SCHEDULED' as const,
  date: '2026-11-12',
  today,
  pending: false,
  madeUp: null,
  ...over,
});

describe('requestableKinds', () => {
  it('przyszly termin: odwolanie albo przeniesienie', () => {
    expect(requestableKinds(state())).toEqual({ kinds: ['CANCEL', 'MOVE'], reason: null });
  });

  it('termin, ktory sie odbyl — nic', () => {
    expect(requestableKinds(state({ date: '2026-11-05' })).kinds).toEqual([]);
  });

  it('odwolany: tylko odrobienie, chyba ze juz odrobiony', () => {
    expect(requestableKinds(state({ status: 'CANCELLED', date: '2026-11-05' })).kinds).toEqual(['MAKEUP']);
    expect(requestableKinds(state({ status: 'CANCELLED', madeUp: '26.02 14:00–16:00' })).reason).toBe('Zajecia sa juz odrobione (26.02 14:00–16:00)');
  });

  it('zgloszenie w toku blokuje kolejne', () => {
    expect(requestableKinds(state({ pending: true })).reason).toMatch(/czeka/);
  });
});

describe('validateRequestInput', () => {
  it('odwolanie wymaga tylko powodu', () => {
    expect(validateRequestInput({ kind: 'CANCEL', reason: 'Konferencja' }, today)).toEqual([]);
    expect(validateRequestInput({ kind: 'CANCEL', reason: ' ' }, today)).toEqual(['Podaj powod (min. 3 znaki)']);
  });

  it('przeniesienie: data nie z przeszlosci, godziny, sala albo online', () => {
    expect(validateRequestInput({ kind: 'MOVE', reason: 'Wyjazd', date: '2026-11-20', startOrder: 3, endOrder: 4, roomId: 'r1' }, today)).toEqual([]);
    expect(validateRequestInput({ kind: 'MAKEUP', reason: 'Odrobienie', date: '2026-11-20', startOrder: 3, endOrder: 4, online: true }, today)).toEqual([]);
    expect(validateRequestInput({ kind: 'MOVE', reason: 'Wyjazd', date: '2026-11-01', startOrder: 4, endOrder: 3 }, today)).toEqual([
      'Nowy termin nie moze byc w przeszlosci',
      'Podaj godziny',
      'Wybierz sale albo zajecia online',
    ]);
  });
});

describe('occurrenceKey', () => {
  it('termin z wzorca: umieszczenie + data z wzorca; reczny: id', () => {
    expect(occurrenceKey({ id: 'o1', kind: 'DERIVED', placementId: 'p1', originalDate: '2026-11-12' })).toBe('p:p1|2026-11-12');
    expect(occurrenceKey({ id: 'o2', kind: 'MANUAL', placementId: null, originalDate: null })).toBe('o:o2');
    expect(parseOccurrenceKey('p:p1|2026-11-12')).toEqual({ placementId: 'p1', originalDate: '2026-11-12' });
    expect(parseOccurrenceKey('o:o2')).toEqual({ occurrenceId: 'o2' });
    expect(parseOccurrenceKey('x')).toBeNull();
  });
});

describe('classLabel', () => {
  it('opis do powiadomienia', () => {
    expect(classLabel({ subject: 'Matematyka', classLabel: 'cwiczenia', group: 'DUT-1-C-A', date: '2026-11-12', startMinute: 660, endMinute: 720 })).toBe(
      'Matematyka (cwiczenia), DUT-1-C-A, 12.11 11:00–12:00',
    );
  });
});

describe('proposalDateProblem', () => {
  it('dzien zajec — bez uwag; swieto, przerwa, poza semestrem, poza zjazdem — z powodem', () => {
    expect(proposalDateProblem({ teaching: true, reason: null, label: null })).toBeNull();
    expect(proposalDateProblem({ teaching: false, reason: 'HOLIDAY', label: 'Narodowe Swieto Niepodleglosci' })).toBe(
      'Tego dnia nie ma zajec: Narodowe Swieto Niepodleglosci',
    );
    expect(proposalDateProblem({ teaching: false, reason: 'OUT_OF_RANGE', label: null })).toBe('Data poza semestrem');
    expect(proposalDateProblem({ teaching: false, reason: 'NO_ZJAZD', label: null })).toMatch(/zjazdu/);
    expect(proposalDateProblem({ teaching: false, reason: 'NOT_MODE_DAY', label: null })).toMatch(/dzien tygodnia/);
  });
});

describe('resolveOnDirectChange', () => {
  const move = { kind: 'MOVE' as const, newDate: '2026-12-09', newStartOrder: 3, newEndOrder: 4 };
  const cancel = { kind: 'CANCEL' as const, newDate: null, newStartOrder: null, newEndOrder: null };

  it('planista zrobil to, o co proszono — zgloszenie zalatwione', () => {
    expect(resolveOnDirectChange(cancel, { action: 'CANCEL' })).toBe('APPROVED');
    expect(resolveOnDirectChange(move, { action: 'MODIFY', date: '2026-12-09', startOrder: 3, endOrder: 4 })).toBe('APPROVED');
    expect(resolveOnDirectChange({ ...move, kind: 'MAKEUP' }, { action: 'MAKEUP', date: '2026-12-09', startOrder: 3, endOrder: 4 })).toBe('APPROVED');
  });

  it('inna zmiana — zgloszenie nieaktualne', () => {
    expect(resolveOnDirectChange(move, { action: 'MODIFY', date: '2026-12-10', startOrder: 3, endOrder: 4 })).toBe('SUPERSEDED');
    expect(resolveOnDirectChange(move, { action: 'CANCEL' })).toBe('SUPERSEDED');
    expect(resolveOnDirectChange(cancel, { action: 'MODIFY', date: '2026-12-10', startOrder: 1, endOrder: 2 })).toBe('SUPERSEDED');
    expect(resolveOnDirectChange({ ...move, kind: 'MAKEUP' }, { action: 'RESTORE' })).toBe('SUPERSEDED');
  });
});

describe('lengthProblem', () => {
  const twoHours = { startOrder: 3, endOrder: 4 };
  it('przeniesienie i odrobienie o tej samej dlugosci — ok (inne godziny dozwolone)', () => {
    expect(lengthProblem('MOVE', twoHours, { startOrder: 7, endOrder: 8 })).toBeNull();
    expect(lengthProblem('MAKEUP', twoHours, { startOrder: 1, endOrder: 2 })).toBeNull();
  });
  it('krotszy albo dluzszy termin — blad z dlugoscia oryginalu', () => {
    expect(lengthProblem('MOVE', twoHours, { startOrder: 9, endOrder: 9 })).toBe('Przeniesienie trwa tyle co zajecia w planie (2 h), a nie 1 h');
    expect(lengthProblem('MAKEUP', twoHours, { startOrder: 1, endOrder: 3 })).toBe('Odrobienie trwa tyle co zajecia w planie (2 h), a nie 3 h');
  });
  it('odwolanie nie ma dlugosci', () => {
    expect(lengthProblem('CANCEL', twoHours, { startOrder: 1, endOrder: 1 })).toBeNull();
  });
});
