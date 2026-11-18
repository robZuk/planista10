import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FilePlus2, GraduationCap, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  createProgram,
  createProgramVersion,
  deleteProgram,
  deleteProgramVersion,
  fetchPrograms,
  updateProgram,
  updateProgramVersion,
} from '@/api/programs';
import { fetchFieldsOfStudy } from '@/api/fieldsOfStudy';
import { getErrorMessage } from '@/lib/errors';
import {
  DEGREE_LEVEL_LABELS,
  DEGREE_LEVELS,
  SEMESTER_TYPE_LABELS,
  SEMESTER_TYPES,
  STUDY_MODE_LABELS,
  STUDY_MODES,
} from '@/lib/labels';
import { useAuthStore } from '@/store/authStore';
import { useFacultyFilterStore } from '@/store/facultyStore';
import { useStudyModeFilterStore } from '@/store/studyModeFilterStore';
import type { DegreeLevel, Program, ProgramVersionSummary, SemesterType, StudyMode } from '@/types';

type VersionDialog = { program: Program; source: ProgramVersionSummary | null } | null;

/** Powod, dla ktorego wersji nie mozna usunac (null — mozna); ten sam warunek sprawdza serwer. */
function versionDeleteBlock(version: ProgramVersionSummary): string | null {
  if (version.status === 'APPROVED') return 'Zatwierdzonej wersji nie usuwa sie — cofnij ja najpierw do projektu';
  if (version._count.cohorts > 0) return 'Wersja jest uzywana przez roczniki — nie mozna jej usunac';
  return null;
}

/**
 * Programy studiow bez przelacznika roku: wersja programu obowiazuje wiele rocznikow.
 * Zmiana programu = nowa wersja sklonowana z poprzedniej (przedmioty kopiowane 1:1,
 * potem edycja i zatwierdzenie).
 */
export default function ProgramsTab() {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const facultyId = useFacultyFilterStore((s) => s.facultyId);
  const studyMode = useStudyModeFilterStore((s) => s.studyMode);
  const isAdmin = me?.role === 'ADMIN';
  const canEditProgram = (program: Program) =>
    isAdmin || (me?.role === 'DEAN_OFFICE' && program.fieldOfStudy.facultyId === me.facultyId);
  const canCreate = isAdmin || (me?.role === 'DEAN_OFFICE' && !!me.facultyId);

  const { data: programs, isPending } = useQuery({
    queryKey: ['programs', facultyId],
    queryFn: () => fetchPrograms(facultyId),
  });
  const visiblePrograms = programs?.filter((p) => studyMode === 'all' || p.studyMode === studyMode);

  const [versionDialog, setVersionDialog] = useState<VersionDialog>(null);
  const [label, setLabel] = useState('');
  const [semesters, setSemesters] = useState('7');
  const [programDialog, setProgramDialog] = useState(false);
  const [deletingVersion, setDeletingVersion] = useState<ProgramVersionSummary | null>(null);
  const [deletingProgram, setDeletingProgram] = useState<Program | null>(null);
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);
  const [editingVersion, setEditingVersion] = useState<ProgramVersionSummary | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['programs'] });
  // Kod i nazwa programu, etykieta i semestry wersji sa tez na stronie wersji i w nazwach rocznikow.
  const invalidateAfterEdit = async () => {
    for (const key of ['programs', 'program-version', 'term-cohorts']) await queryClient.invalidateQueries({ queryKey: [key] });
  };

  const versionMutation = useMutation({
    mutationFn: () => {
      const { program, source } = versionDialog!;
      return createProgramVersion(program.id, {
        label: label.trim(),
        ...(source ? { cloneFromVersionId: source.id } : { totalSemesters: Number(semesters) }),
      });
    },
    onSuccess: async (result) => {
      toast.success(result.message);
      setVersionDialog(null);
      await invalidate();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const deleteVersionMutation = useMutation({
    mutationFn: (id: string) => deleteProgramVersion(id),
    onSuccess: async () => {
      toast.success('Wersja usunieta');
      setDeletingVersion(null);
      await invalidate();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const deleteProgramMutation = useMutation({
    mutationFn: (id: string) => deleteProgram(id),
    onSuccess: async () => {
      toast.success('Program usuniety');
      setDeletingProgram(null);
      await invalidate();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const openVersionDialog = (program: Program, source: ProgramVersionSummary | null) => {
    setLabel(source ? `${source.label} (zmiany)` : `Wersja ${program.versions.length + 1}`);
    setSemesters(String(source?.totalSemesters ?? program.versions.at(-1)?.totalSemesters ?? 7));
    setVersionDialog({ program, source });
  };

  if (isPending) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          <Button onClick={() => setProgramDialog(true)}>
            <Plus />
            Nowy program
          </Button>
        </div>
      )}

      {programs?.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GraduationCap />
            </EmptyMedia>
            <EmptyTitle>Brak programow</EmptyTitle>
            <EmptyDescription>Program to kierunek + poziom + tryb studiow; przedmioty sa w jego wersjach.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {!!programs?.length && visiblePrograms?.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GraduationCap />
            </EmptyMedia>
            <EmptyTitle>Brak programow w tym trybie</EmptyTitle>
            <EmptyDescription>Zmien filtr trybu studiow, zeby zobaczyc pozostale programy.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {visiblePrograms?.map((program) => {
        const editable = canEditProgram(program);
        return (
          <Card key={program.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {program.name}
                <Badge variant="outline">{program.code}</Badge>
              </CardTitle>
              <CardDescription>
                {program.fieldOfStudy.faculty.shortName} · {STUDY_MODE_LABELS[program.studyMode]} ·{' '}
                {DEGREE_LEVEL_LABELS[program.degreeLevel]}
              </CardDescription>
              <CardAction className="flex gap-1">
                {editable && (
                  <Button variant="outline" size="sm" onClick={() => openVersionDialog(program, null)}>
                    <FilePlus2 />
                    Pusta wersja
                  </Button>
                )}
                {editable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    title="Edytuj program: kod i nazwa"
                    aria-label={`Edytuj program ${program.code}`}
                    onClick={() => setEditingProgram(program)}
                  >
                    <Pencil />
                  </Button>
                )}
                {editable && (
                  // span: wylaczony przycisk nie pokazuje dymka, a powod ma byc widoczny
                  <span title={program.versions.length > 0 ? 'Program ma wersje — usun je najpierw' : 'Usun program'}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      aria-label={`Usun program ${program.code}`}
                      disabled={program.versions.length > 0}
                      onClick={() => setDeletingProgram(program)}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                )}
              </CardAction>
            </CardHeader>
            <CardContent>
              {program.versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Program nie ma jeszcze wersji.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Wersja</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Semestrow</TableHead>
                        <TableHead className="text-right">Przedmiotow</TableHead>
                        <TableHead>Na podstawie</TableHead>
                        <TableHead className="w-64" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {program.versions.map((version) => (
                        <TableRow key={version.id}>
                          <TableCell className="font-medium">
                            <Link className="hover:underline" to={`/curriculum/program/${version.id}`}>
                              {version.label}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Badge variant={version.status === 'APPROVED' ? 'secondary' : 'default'}>
                              {version.status === 'APPROVED' ? 'Zatwierdzona' : 'Projekt'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{version.totalSemesters}</TableCell>
                          <TableCell className="text-right tabular-nums">{version._count.entries}</TableCell>
                          <TableCell className="text-muted-foreground">{version.clonedFrom?.label ?? '—'}</TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="sm" asChild>
                                <Link to={`/curriculum/program/${version.id}`}>Otworz</Link>
                              </Button>
                              {editable && (
                                <Button variant="ghost" size="sm" onClick={() => openVersionDialog(program, version)}>
                                  <Copy />
                                  Nowa wersja z tej
                                </Button>
                              )}
                              {editable && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8"
                                  title="Edytuj wersje: etykieta, liczba semestrow, semestr startu"
                                  aria-label={`Edytuj wersje ${version.label}`}
                                  onClick={() => setEditingVersion(version)}
                                >
                                  <Pencil />
                                </Button>
                              )}
                              {editable && (
                                <span title={versionDeleteBlock(version) ?? 'Usun wersje'}>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 text-destructive hover:text-destructive"
                                    aria-label={`Usun wersje ${version.label}`}
                                    disabled={!!versionDeleteBlock(version)}
                                    onClick={() => setDeletingVersion(version)}
                                  >
                                    <Trash2 />
                                  </Button>
                                </span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={!!versionDialog} onOpenChange={(open) => !open && setVersionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {versionDialog?.source ? `Nowa wersja na podstawie "${versionDialog.source.label}"` : 'Nowa pusta wersja'}
            </DialogTitle>
            <DialogDescription>
              {versionDialog?.source
                ? 'Przedmioty zostana skopiowane 1:1. Nowa wersja startuje jako projekt — po zmianach zatwierdz ja.'
                : 'Wersja bez przedmiotow — dodasz je semestr po semestrze.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Field>
              <FieldLabel htmlFor="version-label">Etykieta</FieldLabel>
              <Input
                id="version-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="np. od naboru 2027/28"
              />
            </Field>
            {!versionDialog?.source && (
              <Field>
                <FieldLabel htmlFor="version-semesters">Liczba semestrow</FieldLabel>
                <Input
                  id="version-semesters"
                  type="number"
                  min={1}
                  max={14}
                  value={semesters}
                  onChange={(e) => setSemesters(e.target.value)}
                />
              </Field>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVersionDialog(null)}>
              Anuluj
            </Button>
            <Button onClick={() => versionMutation.mutate()} disabled={!label.trim() || versionMutation.isPending}>
              {versionMutation.isPending && <Spinner />}
              Utworz wersje
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {programDialog && (
        <NewProgramDialog
          onClose={() => setProgramDialog(false)}
          onCreated={async () => {
            setProgramDialog(false);
            await invalidate();
          }}
        />
      )}
      {editingProgram && (
        <EditProgramDialog
          program={editingProgram}
          onClose={() => setEditingProgram(null)}
          onSaved={async () => {
            setEditingProgram(null);
            await invalidateAfterEdit();
          }}
        />
      )}
      {editingVersion && (
        <EditVersionDialog
          version={editingVersion}
          onClose={() => setEditingVersion(null)}
          onSaved={async () => {
            setEditingVersion(null);
            await invalidateAfterEdit();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deletingVersion}
        onOpenChange={(open) => !open && setDeletingVersion(null)}
        title={`Usunac wersje "${deletingVersion?.label ?? ''}"?`}
        description="Wersja zniknie razem z przedmiotami. Tej operacji nie da sie cofnac."
        isPending={deleteVersionMutation.isPending}
        onConfirm={() => deletingVersion && deleteVersionMutation.mutate(deletingVersion.id)}
      />
      <ConfirmDialog
        open={!!deletingProgram}
        onOpenChange={(open) => !open && setDeletingProgram(null)}
        title={`Usunac program "${deletingProgram?.name ?? ''}"?`}
        description="Program nie ma wersji, wiec nic poza nim nie zniknie."
        isPending={deleteProgramMutation.isPending}
        onConfirm={() => deletingProgram && deleteProgramMutation.mutate(deletingProgram.id)}
      />
    </div>
  );
}

function NewProgramDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const me = useAuthStore((s) => s.user);
  const { data: fields } = useQuery({ queryKey: ['fields-of-study'], queryFn: () => fetchFieldsOfStudy() });
  const ownFields = (fields ?? []).filter((f) => me?.role === 'ADMIN' || f.facultyId === me?.facultyId);

  const [fieldId, setFieldId] = useState('');
  const [degree, setDegree] = useState<DegreeLevel>('BACHELOR');
  const [mode, setMode] = useState<StudyMode>('FULL_TIME');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const field = ownFields.find((f) => f.id === fieldId);
  const suggestedCode = field
    ? `${field.shortName}-${mode === 'FULL_TIME' ? 'S' : 'N'}${degree === 'BACHELOR' ? '1' : '2'}`
    : '';
  const suggestedName = field
    ? `${field.name} (${STUDY_MODE_LABELS[mode].toLowerCase()}, ${degree === 'BACHELOR' ? 'I stopnia' : 'II stopnia'})`
    : '';

  const mutation = useMutation({
    mutationFn: () =>
      createProgram({
        fieldOfStudyId: fieldId,
        degreeLevel: degree,
        studyMode: mode,
        code: code.trim() || suggestedCode,
        name: name.trim() || suggestedName,
      }),
    onSuccess: () => {
      toast.success('Program utworzony');
      onCreated();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nowy program studiow</DialogTitle>
          <DialogDescription>Kierunek + poziom + tryb. Przedmioty dodasz w wersjach programu.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field>
            <FieldLabel htmlFor="program-field">Kierunek</FieldLabel>
            <NativeSelect id="program-field" value={fieldId} onChange={(e) => setFieldId(e.target.value)}>
              <NativeSelectOption value="">— wybierz —</NativeSelectOption>
              {ownFields.map((f) => (
                <NativeSelectOption key={f.id} value={f.id}>
                  {f.name} ({f.shortName})
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="program-degree">Poziom</FieldLabel>
              <NativeSelect id="program-degree" value={degree} onChange={(e) => setDegree(e.target.value as DegreeLevel)}>
                {DEGREE_LEVELS.map((d) => (
                  <NativeSelectOption key={d} value={d}>
                    {DEGREE_LEVEL_LABELS[d]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="program-mode">Tryb</FieldLabel>
              <NativeSelect id="program-mode" value={mode} onChange={(e) => setMode(e.target.value as StudyMode)}>
                {STUDY_MODES.map((m) => (
                  <NativeSelectOption key={m} value={m}>
                    {STUDY_MODE_LABELS[m]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="program-code">Kod</FieldLabel>
            <Input id="program-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder={suggestedCode} />
          </Field>
          <Field>
            <FieldLabel htmlFor="program-name">Nazwa</FieldLabel>
            <Input id="program-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={suggestedName} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!fieldId || mutation.isPending}>
            {mutation.isPending && <Spinner />}
            Utworz program
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Kod i nazwa programu. Kierunek, poziom i tryb sa stale — od nich zaleza roczniki, kalendarze i zajecia. */
function EditProgramDialog({ program, onClose, onSaved }: { program: Program; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(program.code);
  const [name, setName] = useState(program.name);

  const mutation = useMutation({
    mutationFn: () => updateProgram(program.id, { code: code.trim(), name: name.trim() }),
    onSuccess: () => {
      toast.success('Program zapisany');
      onSaved();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edytuj program {program.code}</DialogTitle>
          <DialogDescription>
            {program.fieldOfStudy.name} · {STUDY_MODE_LABELS[program.studyMode]} · {DEGREE_LEVEL_LABELS[program.degreeLevel]}.
            Kierunku, poziomu i trybu sie nie zmienia — inny tryb albo poziom to nowy program.
          </DialogDescription>
        </DialogHeader>
        <form
          id="edit-program-form"
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Field>
            <FieldLabel htmlFor="edit-program-code">Kod</FieldLabel>
            <Input id="edit-program-code" value={code} maxLength={30} onChange={(e) => setCode(e.target.value)} />
            <FieldDescription>Kod jest w nazwach rocznikow, np. „{code.trim() || program.code} · nabor 2026/27 zimowy”.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-program-name">Nazwa</FieldLabel>
            <Input id="edit-program-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button type="submit" form="edit-program-form" disabled={!code.trim() || !name.trim() || mutation.isPending}>
            {mutation.isPending && <Spinner />}
            Zapisz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Etykieta, liczba semestrow i semestr startu naboru. Liczbe semestrow zmienia sie tylko w projekcie
 * (jak przedmioty); skrocenie wymaga wczesniej usuniecia przedmiotow z dalszych semestrow.
 */
function EditVersionDialog({
  version,
  onClose,
  onSaved,
}: {
  version: ProgramVersionSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const approved = version.status === 'APPROVED';
  const [label, setLabel] = useState(version.label);
  const [semesters, setSemesters] = useState(String(version.totalSemesters));
  const [startType, setStartType] = useState<SemesterType>(version.defaultStartType);

  const mutation = useMutation({
    mutationFn: () =>
      updateProgramVersion(version.id, {
        label: label.trim(),
        defaultStartType: startType,
        // Tylko zmieniona — zatwierdzona wersja ma ja stala.
        ...(Number(semesters) !== version.totalSemesters ? { totalSemesters: Number(semesters) } : {}),
      }),
    onSuccess: (result) => {
      toast.success(result.message);
      onSaved();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edytuj wersje „{version.label}”</DialogTitle>
          <DialogDescription>
            {approved
              ? 'Wersja zatwierdzona: etykiete i semestr startu mozna zmienic, liczbe semestrow — tylko w projekcie.'
              : 'Wersja w projekcie. Przedmioty zmieniasz na stronie wersji („Otworz”).'}
          </DialogDescription>
        </DialogHeader>
        <form
          id="edit-version-form"
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Field>
            <FieldLabel htmlFor="edit-version-label">Etykieta</FieldLabel>
            <Input id="edit-version-label" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field data-disabled={approved || undefined}>
              <FieldLabel htmlFor="edit-version-semesters">Liczba semestrow</FieldLabel>
              <Input
                id="edit-version-semesters"
                type="number"
                min={1}
                max={14}
                disabled={approved}
                value={semesters}
                onChange={(e) => setSemesters(e.target.value)}
              />
              <FieldDescription>
                {approved ? 'Cofnij wersje do projektu, zeby ja zmienic' : 'Skrocenie: najpierw usun przedmioty z dalszych semestrow'}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-version-start">Nabor startuje</FieldLabel>
              <NativeSelect
                id="edit-version-start"
                value={startType}
                onChange={(e) => setStartType(e.target.value as SemesterType)}
              >
                {SEMESTER_TYPES.map((t) => (
                  <NativeSelectOption key={t} value={t}>
                    {SEMESTER_TYPE_LABELS[t]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription>Podpowiedz „Nowy nabor” w Rocznikach</FieldDescription>
            </Field>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button type="submit" form="edit-version-form" disabled={!label.trim() || semesters === '' || mutation.isPending}>
            {mutation.isPending && <Spinner />}
            Zapisz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
