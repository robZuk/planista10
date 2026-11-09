import { useEffect, useMemo } from 'react';
import { DEGREE_LEVEL_LABELS, STUDY_MODE_LABELS } from '@/lib/labels';
import { useCohortFilterStore } from '@/store/cohortFilterStore';
import { useStudyModeFilterStore } from '@/store/studyModeFilterStore';
import {
  cohortFacets,
  filterCohorts,
  hasFacetFilters,
  sanitizeFacets,
  type CohortFacets,
  type CohortFilters,
  type FacetFilters,
  type FilterableCohort,
} from './cohortFilters';

export interface CohortFiltersState<T> {
  filters: CohortFilters;
  /** Roczniki pasujace do wszystkich filtrow. */
  visible: T[];
  facets: CohortFacets;
  /** Czy ustawiony jest ktorys filtr fasetowy (bez wyszukiwania strony). */
  facetsActive: boolean;
  setFacet: <K extends keyof FacetFilters>(key: K, value: FacetFilters[K]) => void;
  clearFacets: () => void;
}

/**
 * Filtry rocznikow wspolne dla stron z lista rocznikow: tryb (globalny, jak na stronie
 * Programy), kierunek, semestr i stopien (wspolne dla Rocznikow i Planu). Pilnuje, zeby
 * nieaktualny wybor (po zmianie wydzialu albo semestru) byl naprawde czyszczony.
 */
export function useCohortFilters<T extends FilterableCohort>(
  cohorts: T[],
  local: { search?: string; withoutCalendar?: boolean } = {},
): CohortFiltersState<T> {
  const studyMode = useStudyModeFilterStore((s) => s.studyMode);
  const setStudyMode = useStudyModeFilterStore((s) => s.setStudyMode);
  const fieldOfStudyId = useCohortFilterStore((s) => s.fieldOfStudyId);
  const semester = useCohortFilterStore((s) => s.semester);
  const degreeLevel = useCohortFilterStore((s) => s.degreeLevel);
  const setCohortFilters = useCohortFilterStore((s) => s.setCohortFilters);
  const clearCohortFilters = useCohortFilterStore((s) => s.clearCohortFilters);

  const search = local.search ?? '';
  const withoutCalendar = local.withoutCalendar ?? false;
  const filters = useMemo<CohortFilters>(
    () => ({ studyMode, fieldOfStudyId, semester, degreeLevel, search, withoutCalendar }),
    [studyMode, fieldOfStudyId, semester, degreeLevel, search, withoutCalendar],
  );

  // Wybor, ktory przestal pasowac z zewnatrz, czyscimy w stanie — nie tylko w widoku.
  useEffect(() => {
    const current: FacetFilters = { studyMode, fieldOfStudyId, semester, degreeLevel };
    const next = sanitizeFacets(cohorts, current);
    if (next === current) return;
    if (next.studyMode !== studyMode) setStudyMode(next.studyMode);
    setCohortFilters({ fieldOfStudyId: next.fieldOfStudyId, semester: next.semester, degreeLevel: next.degreeLevel });
  }, [cohorts, studyMode, fieldOfStudyId, semester, degreeLevel, setStudyMode, setCohortFilters]);

  const visible = useMemo(() => filterCohorts(cohorts, filters), [cohorts, filters]);
  const facets = useMemo(
    () =>
      cohortFacets(cohorts, filters, {
        studyMode: (v) => STUDY_MODE_LABELS[v],
        degreeLevel: (v) => DEGREE_LEVEL_LABELS[v],
      }),
    [cohorts, filters],
  );

  return {
    filters,
    visible,
    facets,
    facetsActive: hasFacetFilters(filters),
    setFacet: (key, value) => {
      if (key === 'studyMode') setStudyMode(value as FacetFilters['studyMode']);
      else setCohortFilters({ [key]: value });
    },
    clearFacets: () => {
      clearCohortFilters();
      setStudyMode('all');
    },
  };
}
