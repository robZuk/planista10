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
import { plural } from '@/lib/setupSteps';
import type { CarryPlanReport, CarryPlanRow } from '@/types';

function Rows({ rows, showCohort }: { rows: CarryPlanRow[]; showCohort: boolean }) {
  return (
    <ul className="max-h-44 overflow-y-auto text-sm">
      {rows.map((r, i) => (
        <li key={i}>
          {showCohort && <span className="text-muted-foreground">{r.cohort} · </span>}
          {CLASS_LABELS[r.classType]} · {r.subject} · {r.group}
          {r.problem && <span className="text-destructive"> — {r.problem}</span>}
        </li>
      ))}
    </ul>
  );
}

type Scope = 'one' | 'all';

/**
 * "Przenies plan z zeszlego roku" — tylko na zadanie planisty, z podgladem. Zakres: wybrany
 * rocznik albo wszystkie roczniki z biezacych filtrow (nowy rok akademicki to kilkanascie-kilkadziesiat
 * rocznikow — bez tego trzeba by przeklikac kazdy osobno).
 */
export function CarryPlanDialog({
  termKey,
  cohortId,
  cohortLabel,
  filteredCohortIds,
  onClose,
  onDone,
}: {
  termKey: string;
  cohortId: string;
  cohortLabel: string;
  /** Roczniki widoczne przy biezacych filtrach (wydzial, tryb, kierunek...). */
  filteredCohortIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [scope, setScope] = useState<Scope>('one');
  const ids = scope === 'one' ? [cohortId] : filteredCohortIds;
  const [report, setReport] = useState<{ scope: Scope; data: CarryPlanReport } | null>(null);
  const preview = useMutation({
    mutationFn: (s: Scope) => carryPlan(termKey, { cohortIds: s === 'one' ? [cohortId] : filteredCohortIds, dryRun: true }),
    onSuccess: (r, s) => setReport({ scope: s, data: r.data }),
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const apply = useMutation({
    mutationFn: () => carryPlan(termKey, { cohortIds: ids, dryRun: false }),
    onSuccess: (r) => {
      toast.success(r.message);
      onDone();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  useEffect(() => {
    preview.mutate(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // Podglad innego zakresu niz wybrany (w trakcie przeliczania) nie jest pokazywany.
  const current = report?.scope === scope ? report.data : null;
  const many = scope === 'all';
  const withSource = current?.sources.filter((s) => s.source) ?? [];
  const withoutSource = (current?.sources.length ?? 0) - withSource.length;
  const sourceText = many
    ? `${plural(withSource.length, 'rocznik', 'roczniki', 'rocznikow')} z planem do przeniesienia` +
      (withoutSource > 0 ? `, ${plural(withoutSource, 'rocznik', 'roczniki', 'rocznikow')} bez zeszlorocznego planu` : '')
    : withSource[0]?.source;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Przenies plan z zeszlego roku</DialogTitle>
          <DialogDescription>
            Zrodlo: ten sam semestr programu poprzedniego rocznika, w ostatnim semestrze tego samego typu z planem. Dzien,
            godziny, sala i rytm przechodza; prowadzacy — z tegorocznej obsady. Zajecia z juz ulozonym planem sa pomijane.
            Podglad nie uwzglednia kolizji miedzy samymi przenoszonymi zajeciami — zapis sprawdza je po kolei.
          </DialogDescription>
        </DialogHeader>
        <div className="flex rounded-md border p-0.5 text-sm" role="group" aria-label="Zakres przeniesienia">
          <Button size="sm" variant={scope === 'one' ? 'secondary' : 'ghost'} aria-pressed={scope === 'one'} onClick={() => setScope('one')}>
            Ten rocznik ({cohortLabel})
          </Button>
          <Button
            size="sm"
            variant={scope === 'all' ? 'secondary' : 'ghost'}
            aria-pressed={scope === 'all'}
            onClick={() => setScope('all')}
            disabled={filteredCohortIds.length <= 1}
          >
            Wszystkie roczniki z filtrow ({filteredCohortIds.length})
          </Button>
        </div>
        {!current ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : withSource.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Brak planu do przeniesienia — w poprzednich latach {many ? 'te semestry programow nie byly planowane' : 'ten semestr programu nie byl planowany'}.
          </p>
        ) : (
          <div className="max-h-[55vh] space-y-3 overflow-y-auto">
            <p className="text-sm">
              Zrodlo: <b>{sourceText}</b> · do przeniesienia <b>{current.created.length}</b> · kolizje <b>{current.conflicts.length}</b> · bez
              odpowiednika <b>{current.unmatched.length}</b> · pominiete (maja plan) {current.skipped}
            </p>
            {current.created.length > 0 && (
              <section>
                <h4 className="font-medium">Zostana umieszczone</h4>
                <Rows rows={current.created} showCohort={many} />
              </section>
            )}
            {current.conflicts.length > 0 && (
              <section>
                <h4 className="font-medium text-destructive">Kolizje — nie zostana przeniesione</h4>
                <Rows rows={current.conflicts} showCohort={many} />
              </section>
            )}
            {current.unmatched.length > 0 && (
              <section>
                <h4 className="font-medium">Bez odpowiednika — do ulozenia recznie</h4>
                <Rows rows={current.unmatched} showCohort={many} />
              </section>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => apply.mutate()} disabled={!current || current.created.length === 0 || apply.isPending}>
            {apply.isPending && <Spinner />}
            Przenies ({current?.created.length ?? 0})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
