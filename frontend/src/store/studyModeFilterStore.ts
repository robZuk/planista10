import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StudyMode } from '@/types';

/**
 * Globalny filtr trybu studiow (stacjonarne / niestacjonarne). 'all' = brak filtra.
 * Filtruje po stronie klienta — niezalezny od filtra wydzialu ([[facultyStore]]).
 */
export type StudyModeFilter = StudyMode | 'all';

interface StudyModeFilterState {
  studyMode: StudyModeFilter;
  setStudyMode: (studyMode: StudyModeFilter) => void;
}

export const useStudyModeFilterStore = create<StudyModeFilterState>()(
  persist(
    (set) => ({
      studyMode: 'all',
      setStudyMode: (studyMode) => set({ studyMode }),
    }),
    { name: 'planista9-study-mode-filter' },
  ),
);
