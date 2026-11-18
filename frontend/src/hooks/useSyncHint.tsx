import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { appliedText, pendingText } from '@/lib/autoSync';
import type { AutoSyncSummary } from '@/types';

/**
 * Komunikat po zmianie, ktora zmienia zajecia rocznika (nabor, grupy, tryb wykladow). Zmiany
 * dodajace (nowe zajecia, godziny zajec bez planu) zapisaly sie same — tytul mowi ile
 * (`sync`). Usuniecia, osierocenia i godziny zajec w planie czekaja na podglad na stronie
 * "Obsada": wtedy opis o tym mowi, a przycisk (zwykly Button aplikacji, nie domyslna akcja
 * sonnera) prowadzi do "Obsady" biezacego semestru i zamyka komunikat.
 */
export function useSyncHint() {
  const navigate = useNavigate();
  /** `warning` (np. zajecia w planie poza nowym zakresem grupy) — ten sam komunikat jako ostrzezenie. */
  return (message: string, opts: { warning?: string | null; sync?: AutoSyncSummary } = {}) => {
    const { warning, sync } = opts;
    const applied = appliedText(sync);
    const pending = pendingText(sync);
    const title = applied ? `${message}; ${applied}` : message;
    const show = warning ? toast.warning : toast.success;
    if (!warning && !pending) {
      show(title);
      return;
    }
    const id = show(title, {
      description: (
        <div className="mt-1 space-y-2">
          {warning && <p>{warning}</p>}
          {pending && (
            <>
              <p>{pending}</p>
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
            </>
          )}
        </div>
      ),
      duration: warning || pending ? 20000 : 10000,
    });
  };
}
