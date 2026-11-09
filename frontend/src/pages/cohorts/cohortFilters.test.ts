import { describe, expect, it } from 'vitest';
import {
  ALL_FACETS,
  cohortFacets,
  filterCohorts,
  hasFacetFilters,
  sanitizeFacets,
  type CohortFilters,
  type FilterableCohort,
} from './cohortFilters';

const cohort = (
  id: string,
  over: { semester?: number; mode?: 'FULL_TIME' | 'PART_TIME'; degree?: 'BACHELOR' | 'MASTER'; field?: string; calendar?: boolean },
): FilterableCohort & { id: string } => {
  const field = over.field ?? 'mibm';
  return {
    id,
    semester: over.semester ?? 1,
    calendar: over.calendar === false ? null : { id: 'k' },
    program: {
      code: `${field.toUpperCase()}-${over.mode === 'PART_TIME' ? 'N' : 'S'}1`,
      name: field === 'mibm' ? 'Mechanika i budowa maszyn' : 'Logistyka',
      studyMode: over.mode ?? 'FULL_TIME',
      degreeLevel: over.degree ?? 'BACHELOR',
      fieldOfStudy: {
        id: field,
        name: field === 'mibm' ? 'Mechanika i budowa maszyn' : 'Logistyka',
        shortName: field.toUpperCase(),
      },
    },
  };
};

const list = [
  cohort('a', { semester: 1 }),
  cohort('b', { semester: 3, mode: 'PART_TIME' }),
  cohort('c', { semester: 3, field: 'log', degree: 'MASTER', calendar: false }),
  cohort('d', { semester: 5, field: 'log' }),
];

const all: CohortFilters = { ...ALL_FACETS, search: '', withoutCalendar: false };
const ids = (f: Partial<CohortFilters>) => filterCohorts(list, { ...all, ...f }).map((c) => c.id);
const labels = { studyMode: (v: string) => v, degreeLevel: (v: string) => v };
const facets = (f: Partial<CohortFilters>) => cohortFacets(list, { ...all, ...f }, labels);
const opts = (o: { value: string; count: number }[]) => o.map((x) => `${x.value}:${x.count}`);

describe('filterCohorts', () => {
  it('bez filtrow zwraca wszystko w tej samej kolejnosci', () => {
    expect(ids({})).toEqual(['a', 'b', 'c', 'd']);
  });

  it('filtruje po trybie, kierunku, semestrze, stopniu i braku kalendarza', () => {
    expect(ids({ studyMode: 'PART_TIME' })).toEqual(['b']);
    expect(ids({ fieldOfStudyId: 'log' })).toEqual(['c', 'd']);
    expect(ids({ semester: '3' })).toEqual(['b', 'c']);
    expect(ids({ degreeLevel: 'MASTER' })).toEqual(['c']);
    expect(ids({ withoutCalendar: true })).toEqual(['c']);
  });

  it('laczy filtry (AND)', () => {
    expect(ids({ semester: '3', fieldOfStudyId: 'mibm' })).toEqual(['b']);
    expect(ids({ semester: '5', withoutCalendar: true })).toEqual([]);
  });

  it('szuka w kodzie i nazwie bez wielkosci liter i polskich znakow', () => {
    expect(ids({ search: 'mechanika' })).toEqual(['a', 'b']);
    expect(ids({ search: 'LOG-S1' })).toEqual(['c', 'd']);
    expect(ids({ search: '  maszyn ' })).toEqual(['a', 'b']);
    const zegluga = [cohort('z', { field: 'log' })].map((c) => ({ ...c, program: { ...c.program, name: 'Żegluga śródlądowa' } }));
    expect(filterCohorts(zegluga, { ...all, search: 'zegluga srodladowa' })).toHaveLength(1);
  });
});

describe('cohortFacets', () => {
  it('bez filtrow: wszystkie wartosci z liczba rocznikow, posortowane', () => {
    const f = facets({});
    expect(opts(f.fieldOfStudyId)).toEqual(['log:2', 'mibm:2']);
    expect(opts(f.semester)).toEqual(['1:1', '3:2', '5:1']);
    expect(opts(f.degreeLevel)).toEqual(['BACHELOR:3', 'MASTER:1']);
    expect(opts(f.studyMode)).toEqual(['FULL_TIME:3', 'PART_TIME:1']);
  });

  it('opcje fasety licza sie z pozostalych filtrow — bez kombinacji pustych', () => {
    // Niestacjonarne ma tylko MiBM sem. 3 I stopnia.
    const f = facets({ studyMode: 'PART_TIME' });
    expect(opts(f.fieldOfStudyId)).toEqual(['mibm:1']);
    expect(opts(f.semester)).toEqual(['3:1']);
    expect(opts(f.degreeLevel)).toEqual(['BACHELOR:1']);
    // Faseta nie zaweza samej siebie: przy wybranym trybie wciaz widac oba tryby.
    expect(opts(f.studyMode)).toEqual(['FULL_TIME:3', 'PART_TIME:1']);
  });

  it('biezacy wybor zostaje na liscie z liczba 0, gdy zeruje go wyszukiwanie', () => {
    const f = facets({ fieldOfStudyId: 'log', search: 'mechanika' });
    expect(opts(f.fieldOfStudyId)).toEqual(['log:0', 'mibm:2']);
    expect(f.fieldOfStudyId[0]!.label).toBe('Logistyka');
  });
});

describe('sanitizeFacets', () => {
  const facetsOnly = { ...ALL_FACETS };

  it('pasujacy wybor zostaje bez zmian (ta sama referencja)', () => {
    const f = { ...facetsOnly, fieldOfStudyId: 'log', semester: '3' };
    expect(sanitizeFacets(list, f)).toBe(f);
  });

  it('wartosc, ktorej nie ma wsrod rocznikow (inny wydzial / semestr), wraca na wszystkie', () => {
    expect(sanitizeFacets(list, { ...facetsOnly, fieldOfStudyId: 'inny-wydzial', semester: '3' })).toEqual({
      ...facetsOnly,
      semester: '3',
    });
  });

  it('kombinacja bez rocznikow czysci wszystkie fasety', () => {
    // Kazda wartosc istnieje osobno, ale razem nie daja rocznika.
    expect(sanitizeFacets(list, { ...facetsOnly, studyMode: 'PART_TIME', fieldOfStudyId: 'log' })).toEqual(ALL_FACETS);
  });

  it('pusta lista (ladowanie) nie rusza filtrow', () => {
    const f = { ...facetsOnly, semester: '7' };
    expect(sanitizeFacets([], f)).toBe(f);
  });

  it('hasFacetFilters', () => {
    expect(hasFacetFilters(ALL_FACETS)).toBe(false);
    expect(hasFacetFilters({ ...ALL_FACETS, degreeLevel: 'MASTER' })).toBe(true);
  });
});
