import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FilePlus2, GraduationCap, Plus, Trash2 } from 'lucide-react';
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
import { Field, FieldLabel } from '@/components/ui/field';
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
} from '@/api/programs';
import { fetchFieldsOfStudy } from '@/api/fieldsOfStudy';
import { getErrorMessage } from '@/lib/errors';
import { DEGREE_LEVEL_LABELS, DEGREE_LEVELS, STUDY_MODE_LABELS, STUDY_MODES } from '@/lib/labels';
import { useAuthStore } from '@/store/authStore';
import { useFacultyFilterStore } from '@/store/facultyStore';
import { useStudyModeFilterStore } from '@/store/studyModeFilterStore';
import type { DegreeLevel, Program, ProgramVersionSummary, StudyMode } from '@/types';

type VersionDialog = { program: Program; source: ProgramVersionSummary | null } | null;

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

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['programs'] });

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
                {editable && program.versions.length === 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive hover:text-destructive"
                    aria-label="Usun program"
                    onClick={() => setDeletingProgram(program)}
                  >
                    <Trash2 />
                  </Button>
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
                        <TableHead className="w-56" />
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
                              {editable && version.status === 'DRAFT' && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 text-destructive hover:text-destructive"
                                  aria-label="Usun wersje"
                                  onClick={() => setDeletingVersion(version)}
                                >
                                  <Trash2 />
                                </Button>
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
