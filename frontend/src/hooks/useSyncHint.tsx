import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/**
 * Komunikat po zmianie, ktora zmienia zajecia rocznika (tryb wykladow, grupy): sam zapis
 * nie rusza zajec ani planu — zmienia je dopiero "Synchronizuj zajecia" (z podgladem).
 * Przycisk pod opisem (zwykly Button aplikacji, nie domyslna akcja sonnera) prowadzi do
 * "Zajec i obsady" biezacego semestru i zamyka komunikat.
 */
export function useSyncHint() {
  const navigate = useNavigate();
  return (message: string) => {
    const id = toast.success(message, {
      description: (
        <div className="mt-1 space-y-2">
          <p>Zajecia rocznika zmienia sie dopiero po „Synchronizuj zajecia” (z podgladem zmian).</p>
          <Button
            size="sm"
            onClick={() => {
              toast.dismiss(id);
              navigate('/obsada');
            }}
          >
            <RefreshCw />
            Przejdz do synchronizacji
          </Button>
        </div>
      ),
      duration: 10000,
    });
  };
}
