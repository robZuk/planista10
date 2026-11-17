import { useCallback, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchPlanPdf, type PlanPdfSubject } from '@/api/plan';
import { getErrorMessage } from '@/lib/errors';
import { useTermStore } from '@/store/termStore';
import { useTerms } from './useTerm';

/** Otwarty podglad: adres pliku w przegladarce (blob:), nazwa do pobrania i tytul okna. */
export interface PlanPdfPreview {
  url: string;
  fileName: string;
  title: string;
}

/**
 * Druk planu (PDF) w oknie podgladu aplikacji: `open` pobiera plik z backendu i pokazuje go
 * w oknie (`PlanPdfDialog`), skad mozna go pobrac albo wydrukowac. Bez semestru w argumencie —
 * semestr ostatnio uzywany na stronach semestralnych, a w drugiej kolejnosci ten, ktory wydzial
 * planuje (strony bez semestru w adresie: Prowadzacy, Budynki i sale).
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
  const [preview, setPreview] = useState<PlanPdfPreview | null>(null);

  // Adres blob: zajmuje pamiec do zwolnienia — przy zamknieciu podgladu i opuszczeniu strony.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);

  const load = useMutation({
    mutationFn: ({ subject }: { subject: PlanPdfSubject; title: string }) => fetchPlanPdf(key!, subject),
    onSuccess: ({ blob, fileName }, { title }) => setPreview({ url: URL.createObjectURL(blob), fileName, title }),
    onError: async (error) => {
      // Odpowiedz bledu przy responseType "blob" to Blob — wyciagamy z niego komunikat JSON.
      const body = (error as { response?: { data?: unknown } }).response?.data;
      if (body instanceof Blob) {
        try {
          toast.error((JSON.parse(await body.text()) as { error?: string }).error ?? 'Nie udalo sie przygotowac PDF');
          return;
        } catch {
          /* nie JSON — ogolny komunikat ponizej */
        }
      }
      toast.error(getErrorMessage(error));
    },
  });
  const { mutate } = load;

  const open = useCallback(
    (subject: PlanPdfSubject, title: string) => {
      if (key) mutate({ subject, title: term ? `${title} — semestr ${term.label}` : title });
    },
    [key, mutate, term],
  );

  return {
    termKey: key,
    termLabel: term?.label ?? null,
    open,
    isPending: load.isPending,
    preview,
    close: () => setPreview(null),
  };
}
