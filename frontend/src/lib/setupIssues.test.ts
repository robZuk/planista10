import { describe, expect, it } from 'vitest';
import { setupIssues, sortSetupCohorts } from './setupIssues';

const ready: Parameters<typeof setupIssues>[0] = {
  calendar: { name: 'Podstawowy', status: 'PUBLISHED' },
  groups: 10,
  programVersion: { id: 'v', label: 'od naboru 2025/26', status: 'APPROVED' },
  sections: 42,
  vacancies: 0,
  placedSections: 42,
  occurrences: 669,
  stale: false,
};
const cohort = (code: string, semester: number, over: Partial<typeof ready> = {}) => ({ code, semester, ...ready, ...over });
const issues = (over: Partial<typeof ready>) => [...setupIssues({ ...ready, ...over })].sort();

describe('setupIssues', () => {
  it('gotowy rocznik nie ma brakow', () => {
    expect(issues({})).toEqual([]);
  });

  it('wykrywa braki kazdego kroku', () => {
    expect(issues({ calendar: null })).toEqual(['NO_CALENDAR']);
    expect(issues({ groups: 0 })).toEqual(['NO_GROUPS']);
    expect(issues({ programVersion: { ...ready.programVersion, status: 'DRAFT' } })).toEqual(['DRAFT_VERSION']);
    expect(issues({ vacancies: 2 })).toEqual(['VACANCIES']);
    expect(issues({ placedSections: 40 })).toEqual(['UNPLACED']);
    expect(issues({ stale: true })).toEqual(['STALE']);
  });

  it('brak zajec to NO_SECTIONS, nie "nieumieszczone"; brak terminow tylko gdy jest plan', () => {
    expect(issues({ sections: 0, placedSections: 0, occurrences: 0 })).toEqual(['NO_SECTIONS']);
    expect(issues({ occurrences: 0 })).toEqual(['NO_OCCURRENCES']);
    expect(issues({ placedSections: 0, occurrences: 0 })).toEqual(['UNPLACED']);
  });
});

describe('sortSetupCohorts', () => {
  it('roczniki z brakami na gorze (wiecej brakow wyzej), reszta wg kodu i semestru', () => {
    const sorted = sortSetupCohorts([
      cohort('MIBM-S1', 3),
      cohort('MIBM-S1', 1),
      cohort('EDST-N1', 3, { placedSections: 29 }),
      cohort('EDST-S1', 1, { stale: true, vacancies: 1 }),
      cohort('EDST-N1', 1),
      cohort('MIBM-S2', 10),
      cohort('MIBM-S2', 2),
    ]);
    expect(sorted.map((c) => `${c.code} s${c.semester}`)).toEqual([
      'EDST-S1 s1',
      'EDST-N1 s3',
      'EDST-N1 s1',
      'MIBM-S1 s1',
      'MIBM-S1 s3',
      'MIBM-S2 s2',
      'MIBM-S2 s10',
    ]);
  });
});
