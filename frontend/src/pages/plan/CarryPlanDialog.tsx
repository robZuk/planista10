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
import { Spinner } from '@/components/ui/spinner';
import { carryPlan } from '@/api/plan';
import { getErrorMessage } from '@/lib/errors';
import { CLASS_LABELS } from '@/lib/scheduleDisplay';
import type { CarryPlanReport, CarryPlanRow } from '@/types';

function Rows({ rows }: { rows: CarryPlanRow[] }) {
  return (
    <ul className="max-h-44 overflow-y-auto text-sm">
      {rows.map((r, i) => (
        <li key={i}>
          {CLASS_LABELS[r.classType]} · {r.subject} · {r.group}
          {r.problem && <span className="text-destructive"> — {r.problem}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * "Przenies plan z zeszlego roku" — tylko na zadanie planisty, dla wybranego rocznika,
 * zawsze najpierw podglad. Kolidujace umieszczenia nie sa zapisywane, tylko zgloszone.
 */
export function CarryPlanDialog({
  termKey,
  cohortId,
  cohortLabel,
  onClose,
  onDone,
}: {
  termKey: string;
  cohortId: string;
  cohortLabel: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [report, setReport] = useState<CarryPlanReport | null>(null);
  const preview = useMutation({
    mutationFn: () => carryPlan(termKey, { cohortIds: [cohortId], dryRun: true }),
    onSuccess: (r) => setReport(r.data),
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const apply = useMutation({
    mutationFn: () => carryPlan(termKey, { cohortIds: [cohortId], dryRun: false }),
    onSuccess: (r) => {
      toast.success(r.message);
      onDone();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  useEffect(() => {
    preview.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const source = report?.sources[0]?.source;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Przenies plan z zeszlego roku — {cohortLabel}</DialogTitle>
          <DialogDescription>
            Zrodlo: ten sam semestr programu poprzedniego rocznika, w ostatnim semestrze tego samego typu z planem. Dzien,
            godziny, sala i rytm przechodza; prowadzacy — z tegorocznej obsady. Zajecia z juz ulozonym planem sa pomijane.
            Podglad nie uwzglednia kolizji miedzy samymi przenoszonymi zajeciami — zapis sprawdza je po kolei.
          </DialogDescription>
        </DialogHeader>
        {!report ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : !source ? (
          <p className="text-sm text-muted-foreground">Brak planu do przeniesienia — w poprzednich latach ten semestr programu nie byl planowany.</p>
        ) : (
          <div className="max-h-[55vh] space-y-3 overflow-y-auto">
            <p className="text-sm">
              Zrodlo: <b>{source}</b> · do przeniesienia <b>{report.created.length}</b> · kolizje <b>{report.conflicts.length}</b> · bez
              odpowiednika <b>{report.unmatched.length}</b> · pominiete (maja plan) {report.skipped}
            </p>
            {report.created.length > 0 && (
              <section>
                <h4 className="font-medium">Zostana umieszczone</h4>
                <Rows rows={report.created} />
              </section>
            )}
            {report.conflicts.length > 0 && (
              <section>
                <h4 className="font-medium text-destructive">Kolizje — nie zostana przeniesione</h4>
                <Rows rows={report.conflicts} />
              </section>
            )}
            {report.unmatched.length > 0 && (
              <section>
                <h4 className="font-medium">Bez odpowiednika — do ulozenia recznie</h4>
                <Rows rows={report.unmatched} />
              </section>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => apply.mutate()} disabled={!report || report.created.length === 0 || apply.isPending}>
            {apply.isPending && <Spinner />}
            Przenies ({report?.created.length ?? 0})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
