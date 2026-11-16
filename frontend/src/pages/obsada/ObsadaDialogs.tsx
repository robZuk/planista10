import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
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
import { carryInstructors, importSectionsCsv, setSectionInstructors, syncSections } from '@/api/sections';
import { useInstructorOptions } from '@/hooks/useInstructorOptions';
import { getErrorMessage } from '@/lib/errors';
import { plural } from '@/lib/setupSteps';
import { CLASS_FULL_LABELS } from '@/lib/scheduleDisplay';
import { draftRows, staffRowsProblem, toAssignments } from '@/lib/staffRows';
import { groupSyncProblems, splitArchivedProblems } from '@/lib/syncProblems';
import type { CarryRow, ClassSectionRow, SyncReport, SyncRow } from '@/types';
import { StaffRowsEditor } from './StaffRowsEditor';

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
            <span>
              → {'oldHours' in r && r.oldHours !== undefined ? 'obsada: ' : ''}
              {r.instructors.map((x) => `${x.name} ${x.hours} h`).join(', ')}
            </span>
          )}
        </li>
      ))}
      {rows.length > 200 && <li className="text-muted-foreground">… i {rows.length - 200} wiecej</li>}
    </ul>
  );
}

/**
 * Synchronizacja zajec z programem i grupami: najpierw podglad zmian, potem zapis. Otwierana
 * z komunikatu na stronie "Obsada" — dostaje policzony juz podglad (bez drugiego liczenia).
 */
export function SyncDialog({
  termKey,
  facultyId,
  initialReport,
  onClose,
  onDone,
}: {
  termKey: string;
  facultyId?: string;
  initialReport?: SyncReport;
  onClose: () => void;
  onDone: () => void;
}) {
  const [report, setReport] = useState<SyncReport | null>(initialReport ?? null);
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
  // Podglad liczymy od razu po otwarciu — chyba ze strona juz go policzyla.
  useEffect(() => {
    if (!initialReport) preview.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { archived: archivedCohorts, rest: otherProblems } = splitArchivedProblems(report?.problems ?? []);
  const problemGroups = groupSyncProblems(otherProblems);
  const changes = report
    ? report.created.length + report.hoursChanged.length + report.reactivated.length + report.orphaned.length + report.deleted.length
    : 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Synchronizacja zajec z programem i grupami</DialogTitle>
          <DialogDescription>
            Zajecia wynikaja z programu rocznika i jego grup. Zbedne zajecia z obsada albo umieszczone w planie nie
            znikaja — zostaja oznaczone jako osierocone do Twojej decyzji.
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
                <h4 className="font-medium">Do usuniecia (bez obsady i planu)</h4>
                <RowList rows={report.deleted} />
              </section>
            )}
            {report.orphaned.length > 0 && (
              <section>
                <h4 className="font-medium">Osierocone (maja obsade lub sa w planie)</h4>
                <RowList rows={report.orphaned} />
              </section>
            )}
            {archivedCohorts.length > 0 && (
              <section className="space-y-1 text-sm">
                <h4 className="font-medium">Pominiete — kalendarz w archiwum ({archivedCohorts.length})</h4>
                <p className="text-muted-foreground">
                  Zajecia tych rocznikow to zapis tego, co sie odbylo — synchronizacja ich nie zmienia:{' '}
                  {archivedCohorts.join('; ')}.
                </p>
              </section>
            )}
            {problemGroups.length > 0 && (
              <section className="space-y-2">
                <h4 className="font-medium text-destructive">Do wyjasnienia ({problemGroups.length})</h4>
                <ul className="max-h-60 space-y-2 overflow-y-auto text-sm">
                  {problemGroups.map((g) => (
                    <li key={g.key} className="space-y-1 rounded-md border border-destructive/30 p-2">
                      <div>
                        <span className="font-medium">
                          {g.cohort} · sem. {g.semester}
                        </span>
                        {': '}
                        {g.kind === 'MISSING_SPECIALIZATION_GROUP' && g.specialization ? (
                          <>
                            brak grupy specjalnosci <b>{g.specialization.shortName}</b>{' '}
                            <span className="text-muted-foreground">({g.specialization.name})</span>
                          </>
                        ) : (
                          g.message
                        )}
                      </div>
                      {g.subjects.length > 0 && (
                        <div className="text-muted-foreground">
                          Pominiete przedmioty ({g.subjects.length}): {g.subjects.join(', ')}
                        </div>
                      )}
                      {g.kind === 'DRAFT_PROGRAM_VERSION' && g.programVersion && (
                        <div className="text-xs text-muted-foreground">
                          Plan uklada sie tylko z zatwierdzonego programu. Zatwierdz{' '}
                          <Link
                            to={`/curriculum/program/${g.programVersion.id}`}
                            className="font-medium text-foreground underline underline-offset-4"
                          >
                            {g.programVersion.label}
                          </Link>{' '}
                          — potem zmiany zajec tego rocznika pojawia sie w komunikacie na stronie Obsada. Dotychczasowe
                          zajecia zostaja bez zmian.
                        </div>
                      )}
                      {g.kind === 'MISSING_SPECIALIZATION_GROUP' && g.specialization && (
                        <div className="text-xs text-muted-foreground">
                          Jesli w tym naborze nikt nie realizuje {g.specialization.shortName}, mozesz to zignorowac. W
                          przeciwnym razie dodaj grupe {g.specialization.shortName} w{' '}
                          <Link to={`/cohorts/${termKey}`} className="font-medium text-foreground underline underline-offset-4">
                            Rocznikach
                          </Link>{' '}
                          — jej zajecia pojawia sie potem w komunikacie na stronie Obsada.
                        </div>
                      )}
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
  const [report, setReport] = useState<{ matched: CarryRow[]; unmatched: CarryRow[]; sourceSections: number } | null>(null);
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
            {report.sourceSections === 0 && report.unmatched.length > 0 && (
              // Nie "nic nie pasuje", tylko "nie ma z czego przenosic" — np. pierwszy taki semestr w systemie.
              <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                We wczesniejszych semestrach tego typu ({termKey.endsWith('-L') ? 'letnich' : 'zimowych'}) nie ma zajec
                z obsada dla tych programow — nie ma z czego przeniesc. Obsadz zajecia recznie albo wczytaj CSV od katedr.
              </p>
            )}
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

/** Pola zajec potrzebne do edycji obsady — pasuje wiersz Zajec i obsady i zajecia z planu. */
export interface AssignableSection {
  id: string;
  hours: number;
  classType: ClassSectionRow['classType'];
  subject: { name: string };
  group: { name: string };
  instructors: { instructorId: string | null; hours: number }[];
}

/** Edycja obsady jednych zajec: prowadzacy (albo NN) i godziny, z podzialem na kilku. */
export function AssignmentDialog({
  section,
  onClose,
  onDone,
}: {
  section: AssignableSection;
  onClose: () => void;
  onDone: () => void;
}) {
  const { options } = useInstructorOptions(true);
  const [rows, setRows] = useState(() => draftRows(section));
  const rowProblem = staffRowsProblem(rows, section.hours);

  const save = useMutation({
    mutationFn: () => setSectionInstructors(section.id, toAssignments(rows)),
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
        <StaffRowsEditor rows={rows} onChange={setRows} sectionHours={section.hours} options={options} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !!rowProblem}>
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
              Do wczytania: <b>{plural(result.applied, 'zajecia', 'zajecia', 'zajec')}</b>
            </p>
            {result.errors.length > 0 && (
              <p className="text-muted-foreground">
                Zajecia z blednymi wierszami sa pominiete w calosci — ich obsada zostaje bez zmian. Popraw plik i wczytaj ponownie.
              </p>
            )}
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
            {result && result.errors.length > 0 ? `Wczytaj poprawne (${result.applied})` : 'Wczytaj'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
