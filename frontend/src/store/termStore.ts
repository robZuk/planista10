import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Ostatnio wybrany semestr. Zrodlem prawdy jest adres URL (/calendar/2026-L) —
 * magazyn tylko pamieta wybor, zeby wejscie na strone bez klucza otworzylo ten
 * sam semestr, a nie domyslny.
 */
interface TermState {
  lastTermKey: string | null;
  setLastTermKey: (key: string) => void;
}

export const useTermStore = create<TermState>()(
  persist(
    (set) => ({
      lastTermKey: null,
      setLastTermKey: (lastTermKey) => set({ lastTermKey }),
    }),
    { name: 'planista9-term' },
  ),
);
