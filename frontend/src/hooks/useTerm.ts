import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { fetchTerms } from '@/api/terms';
import { termScopedItemFor } from '@/lib/navigation';
import { useTermStore } from '@/store/termStore';
import type { AcademicTerm } from '@/types';

export const TERMS_QUERY_KEY = ['terms'] as const;

export function useTerms() {
  return useQuery({ queryKey: TERMS_QUERY_KEY, queryFn: fetchTerms, staleTime: 60_000 });
}

/**
 * Semestr strony semestralnej (/calendar/:termKey). Gdy w adresie nie ma klucza albo
 * wskazuje nieistniejacy semestr, przekierowuje na ostatnio uzywany, a w drugiej
 * kolejnosci na semestr, ktory wydzial aktualnie planuje.
 */
export function useCurrentTerm(): { term: AcademicTerm | null; terms: AcademicTerm[]; isPending: boolean } {
  const { termKey } = useParams<{ termKey?: string }>();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { lastTermKey, setLastTermKey } = useTermStore();
  const { data, isPending } = useTerms();

  const terms = data?.terms ?? [];
  const term = terms.find((t) => t.key === termKey) ?? null;

  useEffect(() => {
    if (!data) return;
    const item = termScopedItemFor(pathname);
    if (term) {
      if (term.key !== lastTermKey) setLastTermKey(term.key);
      return;
    }
    const fallback =
      (lastTermKey && data.terms.some((t) => t.key === lastTermKey) ? lastTermKey : null) ??
      data.defaultKey ??
      data.terms[0]?.key ??
      null;
    if (item && fallback) navigate(`${item.to}/${fallback}`, { replace: true });
  }, [data, term, lastTermKey, pathname, navigate, setLastTermKey]);

  return { term, terms, isPending };
}
