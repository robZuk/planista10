import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Globalny filtr wydzialu (dla admina) — programy, roczniki, obsada, plan, kalendarz.
 * 'all' = brak filtra. Dziekanat zawsze pracuje na swoim wydziale (wymusza to backend).
 */
interface FacultyFilterState {
  facultyId: string;
  setFacultyId: (facultyId: string) => void;
}

export const useFacultyFilterStore = create<FacultyFilterState>()(
  persist(
    (set) => ({
      facultyId: 'all',
      setFacultyId: (facultyId) => set({ facultyId }),
    }),
    { name: 'planista9-faculty-filter' },
  ),
);
