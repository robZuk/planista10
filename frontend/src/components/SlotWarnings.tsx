import { TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * Ostrzezenia o terminie poza zwyklym planem (swieto, dzien bez zajec, godziny poza oknem).
 * Zapis jest mozliwy, ale dopiero po swiadomym potwierdzeniu — przycisk dialogu zmienia
 * sie wtedy na „Zapisz mimo to”.
 */
export function SlotWarnings({ warnings }: { warnings: string[] }) {
  return (
    <Alert className="border-amber-500/50 text-amber-900 dark:text-amber-200 [&>svg]:text-amber-600">
      <TriangleAlert />
      <AlertTitle>Termin poza zwyklym planem rocznika</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-4">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <p>Jesli to celowe (np. zajecia przeniesione na dzien bez zajec), zapisz ponownie, zeby potwierdzic.</p>
      </AlertDescription>
    </Alert>
  );
}
