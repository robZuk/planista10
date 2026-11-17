import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { downloadPlanPdf, type PlanPdfSubject } from '@/api/plan';
import { getErrorMessage } from '@/lib/errors';
import { useTermStore } from '@/store/termStore';
import { useTerms } from './useTerm';

/**
 * Pobranie druku planu (PDF). Bez semestru w argumencie — semestr ostatnio uzywany na stronach
 * semestralnych, a w drugiej kolejnosci ten, ktory wydzial planuje (strony bez semestru w adresie:
 * Prowadzacy, Budynki i sale). `termLabel` — do opisu akcji ("Plan PDF — 2026/27 zimowy").
 */
export function usePlanPdf(termKey?: string) {
  const lastTermKey = useTermStore((s) => s.lastTermKey);
  const { data } = useTerms();
  const terms = data?.terms ?? [];
  const key =
    termKey ??
    (lastTermKey && terms.some((t) => t.key === lastTermKey) ? lastTermKey : null) ??
    data?.defaultKey ??
    terms[0]?.key ??
    null;
  const term = terms.find((t) => t.key === key) ?? null;

  const download = useMutation({
    mutationFn: (subject: PlanPdfSubject) => downloadPlanPdf(key!, subject),
    onError: async (error) => {
      // Odpowiedz bledu przy responseType "blob" to Blob — wyciagamy z niego komunikat JSON.
      const data = (error as { response?: { data?: unknown } }).response?.data;
      if (data instanceof Blob) {
        try {
          toast.error((JSON.parse(await data.text()) as { error?: string }).error ?? 'Nie udalo sie przygotowac PDF');
          return;
        } catch {
          /* nie JSON — ogolny komunikat ponizej */
        }
      }
      toast.error(getErrorMessage(error));
    },
  });

  return {
    termKey: key,
    termLabel: term?.label ?? null,
    download: (subject: PlanPdfSubject) => key && download.mutate(subject),
    isPending: download.isPending,
  };
}
