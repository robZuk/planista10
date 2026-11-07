import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { generateOccurrences } from '@/api/plan';
import { getErrorMessage } from '@/lib/errors';
import type { GenerateReport } from '@/types';

const REASON: Record<string, string> = { ROOM: 'sala', INSTRUCTOR: 'prowadzacy', GROUP: 'grupa' };

/**
 * "Generuj terminy" — jedyne miejsce, gdzie powstaja terminy z wzorca. Najpierw podglad
 * (co dojdzie, zniknie, zmieni sie; kolizje; braki godzin; wyjatki bez daty), potem zapis.
 * Reczne poprawki terminow i terminy reczne zostaja.
 */
export function GenerateTermsDialog({
  termKey,
  cohortId,
  cohortLabel,
  published,
  onClose,
  onDone,
}: {
  termKey: string;
  cohortId: string;
  cohortLabel: string;
  published: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fromDate, setFromDate] = useState(published ? new Date().toISOString().slice(0, 10) : '');
  const [report, setReport] = useState<GenerateReport | null>(null);
  const preview = useMutation({
    mutationFn: () => generateOccurrences(termKey, { cohortIds: [cohortId], fromDate: fromDate || null, dryRun: true }),
    onSuccess: (r) => setReport(r.data),
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const apply = useMutation({
    mutationFn: () => generateOccurrences(termKey, { cohortIds: [cohortId], fromDate: fromDate || null, dryRun: false }),
    onSuccess: (r) => {
      toast.success(r.message);
      onDone();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  useEffect(() => {
    preview.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Generuj terminy — {cohortLabel}</DialogTitle>
          <DialogDescription>
            Terminy powstaja z umieszczen we wzorcu i kalendarza rocznika, do wyczerpania godzin. Reczne poprawki
            pojedynczych terminow i terminy reczne zostaja.
          </DialogDescription>
        </DialogHeader>
        <Field className="w-56">
          <FieldLabel htmlFor="gen-from">Generuj od dnia (puste = caly semestr)</FieldLabel>
          <Input id="gen-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </Field>
        {published && (
          <p className="text-sm text-amber-600">Kalendarz jest opublikowany — domyslnie zmieniamy tylko terminy od dzis.</p>
        )}
        {!report || preview.isPending ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <div className="max-h-[55vh] space-y-3 overflow-y-auto text-sm">
            <p>
              Terminow: <b>{report.total}</b> · nowe <b>{report.added}</b> · zmienione <b>{report.changed}</b> · znikna{' '}
              <b>{report.removed}</b> · bez zmian {report.unchanged}
            </p>
            {report.calendarsMissing.length > 0 && (
              <p className="text-destructive">Brak kalendarza: {report.calendarsMissing.join(', ')}</p>
            )}
            {report.conflicts.length > 0 && (
              <section>
                <h4 className="font-medium text-destructive">Kolizje — terminy pominiete ({report.conflicts.length})</h4>
                <ul className="max-h-40 overflow-y-auto">
                  {report.conflicts.map((c, i) => (
                    <li key={i}>
                      {c.date} · {c.section} — {REASON[c.reason] ?? c.reason}: {c.with}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {report.shortfalls.length > 0 && (
              <section>
                <h4 className="font-medium">Brakuje godzin ({report.shortfalls.length})</h4>
                <ul className="max-h-32 overflow-y-auto">
                  {report.shortfalls.map((s, i) => (
                    <li key={i}>
                      {s.section}: brakuje {s.missing} h
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {report.orphanExceptions.length > 0 && (
              <section>
                <h4 className="font-medium">Poprawki terminow bez daty we wzorcu ({report.orphanExceptions.length})</h4>
                <p className="text-muted-foreground">Wzorzec sie zmienil i ta data juz z niego nie wynika — poprawka nie zostanie zastosowana.</p>
                <ul className="max-h-32 overflow-y-auto">
                  {report.orphanExceptions.map((e, i) => (
                    <li key={i}>
                      {e.date} · {e.section} ({e.action === 'CANCEL' ? 'odwolanie' : 'przeniesienie'})
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {report.beyondHours > 0 && (
              <p className="text-muted-foreground">
                {report.beyondHours} dat pominieto, bo godziny zajec juz sie wyczerpaly (zajecia koncza sie wczesniej).
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => apply.mutate()} disabled={!report || preview.isPending || apply.isPending}>
            {apply.isPending && <Spinner />}
            Generuj ({report?.total ?? 0} terminow)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
