import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Ostatnio ogladany rocznik w "Ukladaniu planu" — powrot na strone otwiera ten sam rocznik
 * (o ile jest w semestrze i pasuje do filtrow), a nie pierwszy z listy.
 */
interface PlanCohortState {
  lastCohortId: string | null;
  setLastCohortId: (id: string) => void;
}

export const usePlanCohortStore = create<PlanCohortState>()(
  persist(
    (set) => ({
      lastCohortId: null,
      setLastCohortId: (lastCohortId) => set({ lastCohortId }),
    }),
    { name: 'planista10-plan-cohort' },
  ),
);
