import { describe, expect, it } from 'vitest';
import type { SyncProblem, SyncReport, SyncRow } from '@/types';
import { syncChanges, syncNotice } from './syncNotice';

const row = (subject: string): SyncRow => ({ cohort: 'MiBM-N1 · nabor 2026/27', subject, classType: 'LECTURE', group: 'W', hours: 15 });
const rows = (n: number) => Array.from({ length: n }, (_, i) => row(`P${i}`));
const problem = (kind: SyncProblem['kind'], cohortId = 'c1'): SyncProblem => ({
  cohort: `Rocznik ${cohortId}`,
  cohortId,
  semester: 1,
  subject: 'Przedmiot',
  kind,
  specialization: kind === 'MISSING_SPECIALIZATION_GROUP' ? { id: 's1', shortName: 'DUT', name: 'Diagnostyka' } : null,
  programVersion: kind === 'DRAFT_PROGRAM_VERSION' ? { id: 'v1', label: 'od naboru 2026/27' } : null,
  message: 'opis',
});
const report = (over: Partial<SyncReport> = {}): SyncReport => ({
  created: [],
  hoursChanged: [],
  reactivated: [],
  orphaned: [],
  deleted: [],
  unchanged: 900,
  problems: [],
  ...over,
});

describe('syncNotice', () => {
  it('zajecia zgodne z programem i grupami — bez komunikatu (archiwum to tylko informacja)', () => {
    expect(syncNotice(report(), 920)).toBeNull();
    expect(syncNotice(report({ problems: [problem('ARCHIVED_CALENDAR')] }), 920)).toBeNull();
  });

  it('nowy semestr bez zajec: utworz zajecia', () => {
    expect(syncNotice(report({ created: rows(920), unchanged: 0 }), 0)).toEqual({
      kind: 'create',
      title: 'Utworz zajecia semestru',
      description: '920 zajec z programow i grup rocznikow',
      action: 'Pokaz i utworz',
    });
  });

  it('zmiany programu lub grup: tylko niezerowe rodzaje zmian i sprawy do wyjasnienia', () => {
    const notice = syncNotice(
      report({ created: rows(12), hoursChanged: rows(3), orphaned: rows(2), problems: [problem('DRAFT_PROGRAM_VERSION'), problem('DRAFT_PROGRAM_VERSION')] }),
      920,
    );
    expect(notice?.kind).toBe('changes');
    expect(notice?.description).toBe('do dodania: 12 · zmiana godzin: 3 · osierocone: 2 · do wyjasnienia: 1 (wersja programu w projekcie)');
    expect(notice?.action).toBe('Pokaz i zastosuj (17)');
  });

  it('same sprawy do wyjasnienia — spokojny komunikat bez zmian do zastosowania', () => {
    const notice = syncNotice(report({ problems: [problem('MISSING_SPECIALIZATION_GROUP', 'c1'), problem('DRAFT_PROGRAM_VERSION', 'c2')] }), 920);
    expect(notice?.kind).toBe('problems');
    expect(notice?.description).toBe('2 sprawy: brak grupy specjalnosci, wersja programu w projekcie — przedmioty tych rocznikow nie maja zajec');
  });

  it('liczba zmian obejmuje wszystkie rodzaje', () => {
    expect(syncChanges(report({ created: rows(1), hoursChanged: rows(1), reactivated: rows(1), orphaned: rows(1), deleted: rows(1) }))).toBe(5);
  });
});
