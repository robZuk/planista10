import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DegreeLevel } from '@/types';

/**
 * Filtry listy rocznikow wspolne dla "Rocznikow i grup" i "Ukladania planu": kierunek,
 * semestr programu i stopien. Zapamietywane (jak wydzial w [[facultyStore]] i tryb
 * w [[studyModeFilterStore]]), wiec przejscie miedzy stronami ich nie gubi.
 * Wyszukiwanie i "tylko bez kalendarza" zostaja lokalne na swojej stronie.
 */
export interface CohortFilterValues {
  fieldOfStudyId: string;
  semester: string;
  degreeLevel: DegreeLevel | 'all';
}

interface CohortFilterState extends CohortFilterValues {
  setCohortFilters: (values: Partial<CohortFilterValues>) => void;
  clearCohortFilters: () => void;
}

const EMPTY: CohortFilterValues = { fieldOfStudyId: 'all', semester: 'all', degreeLevel: 'all' };

export const useCohortFilterStore = create<CohortFilterState>()(
  persist(
    (set) => ({
      ...EMPTY,
      setCohortFilters: (values) => set(values),
      clearCohortFilters: () => set(EMPTY),
    }),
    { name: 'planista10-cohort-filters' },
  ),
);
