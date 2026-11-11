import type { DegreeLevel, StudyMode } from '@/types';

/**
 * Filtry listy rocznikow (Roczniki i grupy, Ukladanie planu). Filtrujemy po stronie
 * klienta — lista rocznikow semestru jest juz pobrana w calosci.
 *
 * Filtry zawezaja sie nawzajem (fasety): opcje kazdego filtra licza sie z rocznikow
 * pasujacych do POZOSTALYCH filtrow, z liczba rocznikow. Nie da sie wiec wybrac
 * kombinacji bez wynikow. Gdy kombinacja przestanie pasowac z zewnatrz (inny wydzial,
 * inny semestr), sanitizeFilters ja czysci — zamiast ukrywac nieaktualny wybor.
 */

/** Pola rocznika potrzebne filtrom (podzbior TermCohort — latwo testowac). */
export interface FilterableCohort {
  semester: number;
  calendar: unknown | null;
  program: {
    code: string;
    name: string;
    studyMode: StudyMode;
    degreeLevel: DegreeLevel;
    fieldOfStudy: { id: string; name: string; shortName: string };
  };
}

/** Filtry fasetowe — wspolne dla stron z lista rocznikow. 'all' = brak filtra. */
export interface FacetFilters {
  studyMode: StudyMode | 'all';
  fieldOfStudyId: string;
  /** Numer semestru programu jako tekst albo 'all'. */
  semester: string;
  degreeLevel: DegreeLevel | 'all';
}

/** Filtry fasetowe + filtry tylko jednej strony (wyszukiwanie, brak kalendarza). */
export interface CohortFilters extends FacetFilters {
  search: string;
  withoutCalendar: boolean;
}

export const ALL_FACETS: FacetFilters = { studyMode: 'all', fieldOfStudyId: 'all', semester: 'all', degreeLevel: 'all' };

/** Male litery bez polskich znakow — wyszukiwanie "mechanika" znajduje "Mechanika". */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l');
}

export function filterCohorts<T extends FilterableCohort>(cohorts: T[], f: CohortFilters): T[] {
  const query = normalize(f.search.trim());
  return cohorts.filter((c) => {
    if (f.studyMode !== 'all' && c.program.studyMode !== f.studyMode) return false;
    if (f.fieldOfStudyId !== 'all' && c.program.fieldOfStudy.id !== f.fieldOfStudyId) return false;
    if (f.semester !== 'all' && String(c.semester) !== f.semester) return false;
    if (f.degreeLevel !== 'all' && c.program.degreeLevel !== f.degreeLevel) return false;
    if (f.withoutCalendar && c.calendar !== null) return false;
    if (query) {
      const haystack = normalize(
        [c.program.code, c.program.name, c.program.fieldOfStudy.name, c.program.fieldOfStudy.shortName].join(' '),
      );
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export interface FacetOption<V extends string> {
  value: V;
  label: string;
  count: number;
}

export interface CohortFacets {
  studyMode: FacetOption<StudyMode>[];
  fieldOfStudyId: FacetOption<string>[];
  semester: FacetOption<string>[];
  degreeLevel: FacetOption<DegreeLevel>[];
}

/**
 * Opcje filtrow: dla kazdej fasety roczniki pasujace do pozostalych filtrow, pogrupowane
 * wg wartosci tej fasety. Biezacy wybor jest zawsze na liscie (takze z liczba 0, np. gdy
 * zeruje go wyszukiwanie) — inaczej pole pokazaloby pusta wartosc.
 */
export function cohortFacets(
  cohorts: FilterableCohort[],
  f: CohortFilters,
  labels: { studyMode: (v: StudyMode) => string; degreeLevel: (v: DegreeLevel) => string },
): CohortFacets {
  const collator = new Intl.Collator('pl', { numeric: true });
  const facet = <V extends string>(
    key: keyof FacetFilters,
    valueOf: (c: FilterableCohort) => V,
    labelOf: (v: V, c: FilterableCohort | undefined) => string,
    sort: (a: FacetOption<V>, b: FacetOption<V>) => number,
  ): FacetOption<V>[] => {
    const counts = new Map<V, { count: number; sample: FilterableCohort }>();
    for (const c of filterCohorts(cohorts, { ...f, [key]: 'all' })) {
      const v = valueOf(c);
      const entry = counts.get(v);
      counts.set(v, { count: (entry?.count ?? 0) + 1, sample: entry?.sample ?? c });
    }
    const selected = f[key] as V | 'all';
    if (selected !== 'all' && !counts.has(selected)) {
      counts.set(selected, { count: 0, sample: cohorts.find((c) => valueOf(c) === selected)! });
    }
    return [...counts]
      .map(([value, { count, sample }]) => ({ value, label: labelOf(value, sample), count }))
      .sort(sort);
  };
  return {
    studyMode: facet('studyMode', (c) => c.program.studyMode, (v) => labels.studyMode(v), (a, b) => a.value.localeCompare(b.value)),
    fieldOfStudyId: facet(
      'fieldOfStudyId',
      (c) => c.program.fieldOfStudy.id,
      (v, c) => c?.program.fieldOfStudy.name ?? v,
      (a, b) => collator.compare(a.label, b.label),
    ),
    semester: facet('semester', (c) => String(c.semester), (v) => `semestr ${v}`, (a, b) => Number(a.value) - Number(b.value)),
    degreeLevel: facet('degreeLevel', (c) => c.program.degreeLevel, (v) => labels.degreeLevel(v), (a, b) => a.value.localeCompare(b.value)),
  };
}

/**
 * Czyszczenie wyboru, ktory przestal pasowac z zewnatrz (zmiana wydzialu, semestru, danych):
 * wartosc, ktorej nie ma wsrod rocznikow, wraca na 'all'; gdy mimo to kombinacja nie daje
 * zadnego rocznika, czyscimy wszystkie fasety. Wyszukiwanie i "bez kalendarza" nie biora
 * udzialu — pusty wynik wyszukiwania to swiadomy wybor, nie nieaktualny filtr.
 * Zwraca te same filtry (ta sama referencja), gdy nic nie trzeba zmieniac.
 */
export function sanitizeFacets(cohorts: FilterableCohort[], f: FacetFilters): FacetFilters {
  if (cohorts.length === 0) return f;
  const has = (pred: (c: FilterableCohort) => boolean) => cohorts.some(pred);
  const next: FacetFilters = {
    studyMode: f.studyMode === 'all' || has((c) => c.program.studyMode === f.studyMode) ? f.studyMode : 'all',
    fieldOfStudyId: f.fieldOfStudyId === 'all' || has((c) => c.program.fieldOfStudy.id === f.fieldOfStudyId) ? f.fieldOfStudyId : 'all',
    semester: f.semester === 'all' || has((c) => String(c.semester) === f.semester) ? f.semester : 'all',
    degreeLevel: f.degreeLevel === 'all' || has((c) => c.program.degreeLevel === f.degreeLevel) ? f.degreeLevel : 'all',
  };
  const result = filterCohorts(cohorts, { ...next, search: '', withoutCalendar: false }).length > 0 ? next : ALL_FACETS;
  const same = (Object.keys(f) as (keyof FacetFilters)[]).every((k) => f[k] === result[k]);
  return same ? f : result;
}

/** Czy ktoras faseta jest ustawiona. */
export function hasFacetFilters(f: FacetFilters): boolean {
  return f.studyMode !== 'all' || f.fieldOfStudyId !== 'all' || f.semester !== 'all' || f.degreeLevel !== 'all';
}
