import { describe, expect, it } from 'vitest';
import type { SyncProblem } from '@/types';
import { groupSyncProblems, splitArchivedProblems } from './syncProblems';

const zeew = { id: 's-zeew', shortName: 'ZEEW', name: 'Zarzadzanie Eksploatacja Elektrowni Wiatrowych' };
const dut = { id: 's-dut', shortName: 'DUT', name: 'Diagnostyka Urzadzen Technicznych' };

function problem(over: Partial<SyncProblem>): SyncProblem {
  return {
    cohort: 'EDST-N1 · nabor 2023/24 zimowy',
    cohortId: 'c2023',
    semester: 7,
    subject: 'Przedmiot',
    kind: 'MISSING_SPECIALIZATION_GROUP',
    specialization: zeew,
    programVersion: null,
    message: 'Rocznik nie ma grupy specjalnosci ZEEW',
    ...over,
  };
}

describe('groupSyncProblems', () => {
  it('skleja przedmioty tej samej specjalnosci w jednym roczniku', () => {
    const groups = groupSyncProblems([
      problem({ subject: 'Ubezpieczenia morskie' }),
      problem({ subject: 'Negocjacje w biznesie' }),
      problem({ subject: 'Ubezpieczenia morskie' }), // ten sam przedmiot, inna forma zajec
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ semester: 7, specialization: zeew, subjects: ['Ubezpieczenia morskie', 'Negocjacje w biznesie'] });
  });

  it('rozdziela rozne specjalnosci i rozne roczniki', () => {
    const groups = groupSyncProblems([
      problem({ subject: 'A' }),
      problem({ subject: 'B', specialization: dut }),
      problem({ subject: 'C', cohortId: 'c2024', cohort: 'EDST-N1 · nabor 2024/25 zimowy', semester: 5 }),
    ]);
    expect(groups.map((g) => [g.cohort, g.specialization?.shortName, g.subjects])).toEqual([
      ['EDST-N1 · nabor 2023/24 zimowy', 'ZEEW', ['A']],
      ['EDST-N1 · nabor 2023/24 zimowy', 'DUT', ['B']],
      ['EDST-N1 · nabor 2024/25 zimowy', 'ZEEW', ['C']],
    ]);
  });

  it('problem bez specjalnosci i bez przedmiotu zostaje osobna pozycja z pusta lista', () => {
    const groups = groupSyncProblems([
      problem({ kind: 'NO_ROOT_GROUP', specialization: null, subject: '', message: 'Rocznik nie ma grupy "caly rocznik"' }),
      problem({ subject: 'A' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ kind: 'NO_ROOT_GROUP', subjects: [] });
  });
});

describe('splitArchivedProblems', () => {
  it('roczniki z archiwum osobno, reszta problemow bez zmian', () => {
    const archived = problem({ kind: 'ARCHIVED_CALENDAR', specialization: null, cohort: 'MIBM-S1 · nabor 2024/25 zimowy', semester: 5, subject: '' });
    const other = problem({});
    const { archived: list, rest } = splitArchivedProblems([archived, other, archived]);
    expect(list).toEqual(['MIBM-S1 · nabor 2024/25 zimowy · sem. 5']);
    expect(rest).toEqual([other]);
  });
});
