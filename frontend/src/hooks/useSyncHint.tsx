import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/**
 * Komunikat po zmianie, ktora zmienia zajecia rocznika (tryb wykladow, grupy): sam zapis
 * nie rusza zajec ani planu — zmienia je dopiero zastosowanie zmian na stronie "Obsada"
 * (komunikat nad zakladkami z podgladem). Przycisk pod opisem (zwykly Button aplikacji, nie
 * domyslna akcja sonnera) prowadzi do "Obsady" biezacego semestru i zamyka komunikat.
 */
export function useSyncHint() {
  const navigate = useNavigate();
  /** `warning` (np. zajecia w planie poza nowym zakresem grupy) — ten sam komunikat jako ostrzezenie. */
  return (message: string, warning?: string | null) => {
    const id = (warning ? toast.warning : toast.success)(message, {
      description: (
        <div className="mt-1 space-y-2">
          {warning && <p>{warning}</p>}
          <p>Zajecia rocznika zmienia sie po zastosowaniu zmian na stronie „Obsada” (z podgladem).</p>
          <Button
            size="sm"
            onClick={() => {
              toast.dismiss(id);
              navigate('/obsada');
            }}
          >
            <RefreshCw />
            Pokaz zmiany w Obsadzie
          </Button>
        </div>
      ),
      duration: warning ? 20000 : 10000,
    });
  };
}
