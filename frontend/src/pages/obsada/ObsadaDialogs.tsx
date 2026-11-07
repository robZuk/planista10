import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Combobox } from '@/components/Combobox';
import { carryInstructors, importSectionsCsv, setSectionInstructors, syncSections } from '@/api/sections';
import { fetchInstructors } from '@/api/instructors';
import { getErrorMessage } from '@/lib/errors';
import { CLASS_FULL_LABELS } from '@/lib/scheduleDisplay';
import type { CarryRow, ClassSectionRow, SyncReport, SyncRow } from '@/types';

const NN = '__nn__';

function RowList({ rows, empty }: { rows: SyncRow[] | CarryRow[]; empty?: string }) {
  if (rows.length === 0) return empty ? <p className="text-sm text-muted-foreground">{empty}</p> : null;
  return (
    <ul className="max-h-48 space-y-0.5 overflow-y-auto text-sm">
      {rows.slice(0, 200).map((r, i) => (
        <li key={i} className="flex flex-wrap gap-x-2">
          <span className="text-muted-foreground">{r.cohort.split(' · ')[0]}</span>
          <span>{r.subject}</span>
          <span className="text-muted-foreground">
            {CLASS_FULL_LABELS[r.classType]} · {r.group} · {r.hours} h
          </span>
          {'oldHours' in r && r.oldHours !== undefined && <span>(bylo {r.oldHours} h)</span>}
          {'fallback' in r && r.fallback && <Badge variant="outline">podzial zastepczy</Badge>}
          {'instructors' in r && r.instructors && (
            <span>→ {r.instructors.map((x) => `${x.name} ${x.hours} h`).join(', ')}</span>
          )}
        </li>
      ))}
      {rows.length > 200 && <li className="text-muted-foreground">… i {rows.length - 200} wiecej</li>}
    </ul>
  );
}

/** Synchronizacja zajec z programem i grupami: najpierw podglad zmian, potem zapis. */
export function SyncDialog({
  termKey,
  facultyId,
  onClose,
  onDone,
}: {
  termKey: string;
  facultyId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [report, setReport] = useState<SyncReport | null>(null);
  const preview = useMutation({
    mutationFn: () => syncSections(termKey, { facultyId, dryRun: true }),
    onSuccess: (r) => setReport(r.data),
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const apply = useMutation({
    mutationFn: () => syncSections(termKey, { facultyId, dryRun: false }),
    onSuccess: (r) => {
      toast.success(r.message);
      onDone();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  // Podglad liczymy od razu po otwarciu.
  useEffect(() => {
    preview.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changes = report
    ? report.created.length + report.hoursChanged.length + report.reactivated.length + report.orphaned.length + report.deleted.length
    : 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Synchronizacja zajec z programem i grupami</DialogTitle>
          <DialogDescription>
            Zajecia wynikaja z programu rocznika i jego grup. Zbedne zajecia z obsada nie znikaja — zostaja oznaczone
            jako osierocone do Twojej decyzji.
          </DialogDescription>
        </DialogHeader>
        {!report ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto">
            <p className="text-sm">
              Bez zmian: <b>{report.unchanged}</b> · do dodania: <b>{report.created.length}</b> · zmiana godzin:{' '}
              <b>{report.hoursChanged.length}</b> · do usuniecia: <b>{report.deleted.length}</b> · osierocone:{' '}
              <b>{report.orphaned.length}</b>
            </p>
            {report.created.length > 0 && (
              <section>
                <h4 className="font-medium">Nowe zajecia</h4>
                <RowList rows={report.created} />
              </section>
            )}
            {report.hoursChanged.length > 0 && (
              <section>
                <h4 className="font-medium">Zmiana godzin</h4>
                <RowList rows={report.hoursChanged} />
              </section>
            )}
            {report.deleted.length > 0 && (
              <section>
                <h4 className="font-medium">Do usuniecia (bez obsady)</h4>
                <RowList rows={report.deleted} />
              </section>
            )}
            {report.orphaned.length > 0 && (
              <section>
                <h4 className="font-medium">Osierocone (maja obsade)</h4>
                <RowList rows={report.orphaned} />
              </section>
            )}
            {report.problems.length > 0 && (
              <section>
                <h4 className="font-medium text-destructive">Do wyjasnienia ({report.problems.length})</h4>
                <ul className="max-h-40 overflow-y-auto text-sm">
                  {report.problems.map((p, i) => (
                    <li key={i}>
                      <span className="text-muted-foreground">{p.cohort.split(' · ')[0]}</span> {p.subject}: {p.message}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Zamknij
          </Button>
          <Button onClick={() => apply.mutate()} disabled={!report || changes === 0 || apply.isPending}>
            {apply.isPending && <Spinner />}
            Zastosuj zmiany ({changes})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Uzupelnienie obsady z poprzedniego roku: podglad dopasowan, potem zapis. */
export function CarryDialog({
  termKey,
  facultyId,
  onClose,
  onDone,
}: {
  termKey: string;
  facultyId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [report, setReport] = useState<{ matched: CarryRow[]; unmatched: CarryRow[] } | null>(null);
  const preview = useMutation({
    mutationFn: () => carryInstructors(termKey, { facultyId, dryRun: true }),
    onSuccess: (r) => setReport(r.data),
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const apply = useMutation({
    mutationFn: () => carryInstructors(termKey, { facultyId, dryRun: false }),
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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Obsada z poprzedniego roku</DialogTitle>
          <DialogDescription>
            Dla zajec bez obsady szukamy tych samych zajec poprzedniego rocznika tego programu (ten sam przedmiot, forma
            i grupa) w ostatnim semestrze tego samego typu. Istniejaca obsada nie jest zmieniana.
          </DialogDescription>
        </DialogHeader>
        {!report ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto">
            <section>
              <h4 className="font-medium">Do uzupelnienia ({report.matched.length})</h4>
              <RowList rows={report.matched} empty="Brak dopasowan." />
            </section>
            <section>
              <h4 className="font-medium">Bez odpowiednika — do obsadzenia recznie ({report.unmatched.length})</h4>
              <RowList rows={report.unmatched} />
            </section>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Zamknij
          </Button>
          <Button onClick={() => apply.mutate()} disabled={!report || report.matched.length === 0 || apply.isPending}>
            {apply.isPending && <Spinner />}
            Uzupelnij obsade ({report?.matched.length ?? 0})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Edycja obsady jednych zajec: prowadzacy (albo NN) i godziny, z podzialem na kilku. */
export function AssignmentDialog({
  section,
  onClose,
  onDone,
}: {
  section: ClassSectionRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: instructors } = useQuery({ queryKey: ['instructors'], queryFn: fetchInstructors });
  const [rows, setRows] = useState(
    section.instructors.length > 0
      ? section.instructors.map((i) => ({ instructorId: i.instructorId ?? NN, hours: String(i.hours) }))
      : [{ instructorId: '', hours: String(section.hours) }],
  );
  const total = rows.reduce((s, r) => s + (Number(r.hours) || 0), 0);
  const options = [
    { value: NN, label: 'NN (wakat)' },
    ...(instructors ?? []).map((i) => ({
      value: i.id,
      label: `${i.title ?? ''} ${i.firstName} ${i.lastName}`.trim(),
      keywords: i.email,
    })),
  ];

  const save = useMutation({
    mutationFn: () =>
      setSectionInstructors(
        section.id,
        rows
          .filter((r) => r.instructorId)
          .map((r) => ({ instructorId: r.instructorId === NN ? null : r.instructorId, hours: Number(r.hours) })),
      ),
    onSuccess: (r) => {
      toast.success(r.message);
      onDone();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{section.subject.name}</DialogTitle>
          <DialogDescription>
            {CLASS_FULL_LABELS[section.classType]} · {section.group.name} · {section.hours} h. Godziny mozna podzielic
            miedzy kilku prowadzacych.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_6rem_auto] items-center gap-2">
              <Combobox
                options={options}
                value={row.instructorId}
                onChange={(value) => setRows(rows.map((r, i) => (i === index ? { ...r, instructorId: value } : r)))}
                placeholder="Wybierz prowadzacego"
                searchPlaceholder="Szukaj po nazwisku lub e-mailu…"
              />
              <Input
                type="number"
                min={1}
                value={row.hours}
                aria-label="Godziny"
                className="text-right tabular-nums"
                onChange={(e) => setRows(rows.map((r, i) => (i === index ? { ...r, hours: e.target.value } : r)))}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Usun"
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRows([...rows, { instructorId: '', hours: String(Math.max(0, section.hours - total)) }])}
            >
              <Plus /> Podziel godziny
            </Button>
            <span className={`text-sm tabular-nums ${total > section.hours ? 'text-destructive' : 'text-muted-foreground'}`}>
              {total} / {section.hours} h
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || total > section.hours}>
            {save.isPending && <Spinner />}
            Zapisz obsade
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Import obsady z pliku CSV (format eksportu): podglad bledow, potem zapis. */
export function ImportDialog({
  termKey,
  facultyId,
  onClose,
  onDone,
}: {
  termKey: string;
  facultyId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [csv, setCsv] = useState<string | null>(null);
  const [result, setResult] = useState<{ applied: number; errors: string[] } | null>(null);
  const preview = useMutation({
    mutationFn: (text: string) => importSectionsCsv(termKey, { csv: text, dryRun: true, facultyId }),
    onSuccess: (r) => setResult(r.data),
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const apply = useMutation({
    mutationFn: () => importSectionsCsv(termKey, { csv: csv!, dryRun: false, facultyId }),
    onSuccess: (r) => {
      toast.success(r.message);
      onDone();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import obsady z CSV</DialogTitle>
          <DialogDescription>
            Plik w formacie eksportu (kolumny oddzielone srednikiem). Obsada zajec z pliku zastapi dotychczasowa;
            prowadzacy po adresie e-mail, „NN” = wakat.
          </DialogDescription>
        </DialogHeader>
        <Input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const text = await file.text();
            setCsv(text);
            preview.mutate(text);
          }}
        />
        {preview.isPending && <Spinner />}
        {result && (
          <div className="space-y-2 text-sm">
            <p>
              Do wczytania: <b>{result.applied}</b> zajec
            </p>
            {result.errors.length > 0 && (
              <ul className="max-h-40 overflow-y-auto text-destructive">
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => apply.mutate()} disabled={!result || result.applied === 0 || apply.isPending}>
            {apply.isPending && <Spinner />}
            Wczytaj
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
