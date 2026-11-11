import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Lock, Plus, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/PageHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Combobox } from '@/components/Combobox';
import {
  addProgramEntry,
  deleteProgramEntry,
  fetchProgramVersion,
  reorderProgramEntries,
  updateProgramEntry,
  updateProgramVersion,
} from '@/api/programs';
import { fetchSubjects } from '@/api/subjects';
import { getErrorMessage } from '@/lib/errors';
import { ASSESSMENT_TYPES, ASSESSMENT_TYPE_LABELS, DEGREE_LEVEL_LABELS, STUDY_MODE_LABELS } from '@/lib/labels';
import { SEMESTER_TYPE_LABELS, semesterTypeOf } from '@/lib/semester';
import { useAuthStore } from '@/store/authStore';
import type { AssessmentType, ProgramEntry } from '@/types';

/** Wartosc filtra/selecta oznaczajaca przedmiot wspolny dla kierunku. */
const COMMON = '__common__';
const ALL = '__all__';

const HOUR_FIELDS = [
  { key: 'hoursLecture', short: 'W', full: 'Wyklad' },
  { key: 'hoursExercise', short: 'C', full: 'Cwiczenia' },
  { key: 'hoursLab', short: 'L', full: 'Laboratorium' },
  { key: 'hoursProject', short: 'P', full: 'Projekt' },
  { key: 'hoursSeminar', short: 'S', full: 'Seminarium' },
] as const;

const entrySchema = z.object({
  subjectId: z.string().min(1, 'Wybierz przedmiot'),
  semester: z.number().int().min(1),
  specialization: z.string(),
  hoursLecture: z.number().int().min(0).max(1000),
  hoursExercise: z.number().int().min(0).max(1000),
  hoursLab: z.number().int().min(0).max(1000),
  hoursProject: z.number().int().min(0).max(1000),
  hoursSeminar: z.number().int().min(0).max(1000),
  ects: z.number().int().min(0).max(60),
  assessmentType: z.enum(ASSESSMENT_TYPES as [AssessmentType, ...AssessmentType[]]),
}).refine(
  // Bez godzin, ale z ECTS — dozwolone (praktyka, dyplom); bez godzin i bez ECTS nic nie wnosi.
  (v) => v.hoursLecture + v.hoursExercise + v.hoursLab + v.hoursProject + v.hoursSeminar > 0 || v.ects > 0,
  { path: ['ects'], message: 'Podaj godziny zajec albo punkty ECTS — pozycja bez nich nic nie wnosi do programu' },
);
type EntryValues = z.infer<typeof entrySchema>;

function totalHours(e: Pick<ProgramEntry, 'hoursLecture' | 'hoursExercise' | 'hoursLab' | 'hoursProject' | 'hoursSeminar'>) {
  return e.hoursLecture + e.hoursExercise + e.hoursLab + e.hoursProject + e.hoursSeminar;
}

/**
 * Wersja programu: przedmioty semestr po semestrze. Przedmiot jest wspolny dla calego
 * kierunku albo nalezy do specjalnosci. Zatwierdzona wersja jest zablokowana — zmiana
 * programu to nowa wersja (klon) albo swiadome cofniecie do projektu.
 */
export default function ProgramVersionPage() {
  const { versionId = '' } = useParams();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [specFilter, setSpecFilter] = useState(ALL);
  const [dialog, setDialog] = useState<{ semester: number; entry: ProgramEntry | null } | null>(null);
  const entryLocked = !!dialog?.entry && dialog.entry._count.sections > 0;
  const [deleting, setDeleting] = useState<ProgramEntry | null>(null);
  const [confirmRevert, setConfirmRevert] = useState(false);

  const queryKey = ['program-version', versionId];
  const { data, isPending, isError, error } = useQuery({
    queryKey,
    queryFn: () => fetchProgramVersion(versionId),
    enabled: !!versionId,
  });
  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => fetchSubjects() });

  const form = useForm<EntryValues>({ resolver: zodResolver(entrySchema) });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.invalidateQueries({ queryKey: ['programs'] });
  };

  const saveMutation = useMutation({
    mutationFn: (values: EntryValues) => {
      // Pozycja z zajeciami: przedmiot, semestr i specjalnosc zostaja jak byly (pola sa wylaczone).
      const kept = dialog?.entry && dialog.entry._count.sections > 0 ? dialog.entry : null;
      const input = {
        subjectId: kept ? kept.subjectId : values.subjectId,
        semester: kept ? kept.semester : values.semester,
        specializationId: kept ? kept.specializationId : values.specialization === COMMON ? null : values.specialization,
        hoursLecture: values.hoursLecture,
        hoursExercise: values.hoursExercise,
        hoursLab: values.hoursLab,
        hoursProject: values.hoursProject,
        hoursSeminar: values.hoursSeminar,
        ects: values.ects,
        assessmentType: values.assessmentType,
      };
      return dialog?.entry ? updateProgramEntry(dialog.entry.id, input) : addProgramEntry(versionId, input);
    },
    onSuccess: async () => {
      toast.success(dialog?.entry ? 'Pozycja zapisana' : 'Przedmiot dodany');
      setDialog(null);
      await invalidate();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProgramEntry(id),
    onSuccess: async () => {
      toast.success('Przedmiot usuniety z programu');
      setDeleting(null);
      await invalidate();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const statusMutation = useMutation({
    mutationFn: (status: 'DRAFT' | 'APPROVED') => updateProgramVersion(versionId, { status }),
    onSuccess: async (result) => {
      toast.success(result.message);
      setConfirmRevert(false);
      await invalidate();
      // Status wersji blokuje/odblokowuje plan rocznikow — odswiez widoki, ktore go pokazuja.
      for (const key of ['plan', 'term-cohorts', 'setup']) await queryClient.invalidateQueries({ queryKey: [key] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const moveMutation = useMutation({
    mutationFn: ({ ids }: { ids: string[] }) => reorderProgramEntries(versionId, ids),
    onSuccess: invalidate,
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (isError) {
    return (
      <>
        <PageHeader title="Program studiow" />
        <p className="text-sm text-destructive">{getErrorMessage(error)}</p>
        <Button variant="outline" asChild className="w-fit">
          <Link to="/curriculum">
            <ArrowLeft />
            Wroc do programow
          </Link>
        </Button>
      </>
    );
  }

  const { version, semesters, outOfRange } = data;
  const program = version.program;
  const specializations = program.fieldOfStudy.specializations;
  const isApproved = version.status === 'APPROVED';
  const canManage =
    me?.role === 'ADMIN' || (me?.role === 'DEAN_OFFICE' && me.facultyId === program.fieldOfStudy.facultyId);
  const canEdit = canManage && !isApproved;

  const visible = (entry: ProgramEntry) =>
    specFilter === ALL ||
    (specFilter === COMMON ? entry.specializationId === null : entry.specializationId === null || entry.specializationId === specFilter);

  // Student realizuje jedna specjalnosc — suma przedmiotow wszystkich specjalnosci (np. 238 ECTS
  // zamiast 180) myli. Przy "Wszystkie" ECTS liczymy osobno dla kazdej sciezki (wspolne + specjalnosc).
  const sumEcts = (entries: ProgramEntry[]) => entries.reduce((sum, e) => sum + e.ects, 0);
  const pathEcts = (entries: ProgramEntry[], specId: string) =>
    sumEcts(entries.filter((e) => e.specializationId === null || e.specializationId === specId));
  const perPath = specializations.length > 0 && specFilter === ALL;
  const ectsLabel = (entries: ProgramEntry[]) =>
    perPath
      ? `${specializations.map((sp) => `${sp.shortName} ${pathEcts(entries, sp.id)}`).join(' · ')} ECTS`
      : `${sumEcts(entries.filter(visible))} ECTS`;
  const allEntries = semesters.flatMap((s) => s.entries);
  const totalLabel =
    specializations.length === 0
      ? `${sumEcts(allEntries)} ECTS lacznie`
      : perPath
        ? `ECTS na sciezke: ${ectsLabel(allEntries).replace(/ ECTS$/, '')}`
        : specFilter === COMMON
          ? `${sumEcts(allEntries.filter(visible))} ECTS wspolnych`
          : `${sumEcts(allEntries.filter(visible))} ECTS sciezki ${specializations.find((sp) => sp.id === specFilter)?.shortName ?? ''}`;

  const openDialog = (semester: number, entry: ProgramEntry | null) => {
    form.reset({
      subjectId: entry?.subjectId ?? '',
      semester: entry?.semester ?? semester,
      specialization: entry ? (entry.specializationId ?? COMMON) : specFilter === ALL ? COMMON : specFilter,
      hoursLecture: entry?.hoursLecture ?? 0,
      hoursExercise: entry?.hoursExercise ?? 0,
      hoursLab: entry?.hoursLab ?? 0,
      hoursProject: entry?.hoursProject ?? 0,
      hoursSeminar: entry?.hoursSeminar ?? 0,
      ects: entry?.ects ?? 0,
      assessmentType: entry?.assessmentType ?? 'CREDIT',
    });
    setDialog({ semester, entry });
  };

  /** Przesuniecie w gore/dol w obrebie semestru (kolejnosc = lp. z siatki). */
  const move = (entries: ProgramEntry[], index: number, delta: number) => {
    const ids = entries.map((e) => e.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    moveMutation.mutate({ ids });
  };

  const subjectOptions = (subjects ?? []).map((s) => ({ value: s.id, label: s.name, keywords: s.code ?? '' }));

  return (
    <>
      <PageHeader
        title={program.name}
        description={[
          `${program.code} · ${version.label}`,
          STUDY_MODE_LABELS[program.studyMode],
          DEGREE_LEVEL_LABELS[program.degreeLevel],
          version.clonedFrom ? `na podstawie: ${version.clonedFrom.label}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="secondary"
              className="tabular-nums"
              title={perPath ? 'Kazda sciezka to przedmioty wspolne kierunku i jednej specjalnosci' : undefined}
            >
              {totalLabel}
            </Badge>
            <Badge variant={isApproved ? 'secondary' : 'default'}>{isApproved ? 'Zatwierdzona' : 'Projekt'}</Badge>
            {canManage &&
              (isApproved ? (
                <Button
                  variant="outline"
                  // Z wersji korzystaja roczniki -> najpierw ostrzezenie (ich plan sie zablokuje).
                  onClick={() => (version.cohorts.length > 0 ? setConfirmRevert(true) : statusMutation.mutate('DRAFT'))}
                  disabled={statusMutation.isPending}
                >
                  <Undo2 />
                  Cofnij do projektu
                </Button>
              ) : (
                <Button onClick={() => statusMutation.mutate('APPROVED')} disabled={statusMutation.isPending}>
                  <CheckCircle2 />
                  Zatwierdz wersje
                </Button>
              ))}
            <Button variant="outline" asChild>
              <Link to="/curriculum">
                <ArrowLeft />
                Programy
              </Link>
            </Button>
          </div>
        }
      />

      {isApproved && canManage && (
        <Alert>
          <Lock />
          <AlertTitle>Wersja zatwierdzona — przedmioty sa zablokowane</AlertTitle>
          <AlertDescription>
            Zmiana programu dla kolejnych naborow: na liscie programow uzyj „Nowa wersja z tej”. Poprawka bledu w tej
            wersji: „Cofnij do projektu”, popraw i zatwierdz ponownie.
          </AlertDescription>
        </Alert>
      )}

      {specializations.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Pokaz:</span>
          <NativeSelect value={specFilter} onChange={(e) => setSpecFilter(e.target.value)} className="w-80" aria-label="Specjalnosc">
            <NativeSelectOption value={ALL}>Wszystkie przedmioty</NativeSelectOption>
            <NativeSelectOption value={COMMON}>Tylko wspolne dla kierunku</NativeSelectOption>
            {specializations.map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>
                Program specjalnosci {s.shortName} (wspolne + {s.shortName})
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}

      {outOfRange.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>Przedmioty poza zakresem semestrow</AlertTitle>
          <AlertDescription>{outOfRange.map((e) => `${e.subject.name} (sem. ${e.semester})`).join(', ')}</AlertDescription>
        </Alert>
      )}

      <Accordion type="multiple" defaultValue={['1']} className="w-full">
        {semesters.map((semester) => {
          const entries = semester.entries.filter(visible);
          const type = semesterTypeOf(version.defaultStartType, semester.semester);
          return (
            <AccordionItem key={semester.semester} value={String(semester.semester)}>
              <AccordionTrigger className="hover:no-underline">
                <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 pr-2 text-left">
                  <span className="font-medium">Semestr {semester.semester}</span>
                  <Badge variant={type === 'WINTER' ? 'secondary' : 'outline'}>{SEMESTER_TYPE_LABELS[type]}</Badge>
                  <span className="ml-auto flex items-center gap-3 text-sm font-normal text-muted-foreground tabular-nums">
                    <span>{entries.length} przedm.</span>
                    <span>{entries.reduce((sum, e) => sum + totalHours(e), 0)} godz.</span>
                    <span title={perPath ? 'ECTS sciezki: przedmioty wspolne i danej specjalnosci' : undefined}>
                      {ectsLabel(semester.entries)}
                    </span>
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                {canEdit && (
                  <Button size="sm" onClick={() => openDialog(semester.semester, null)}>
                    <Plus />
                    Dodaj przedmiot
                  </Button>
                )}
                {entries.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                    Brak przedmiotow{specFilter !== ALL ? ' w tym widoku' : ''}.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">Lp.</TableHead>
                          <TableHead>Przedmiot</TableHead>
                          <TableHead>Dla</TableHead>
                          {HOUR_FIELDS.map((f) => (
                            <TableHead key={f.key} className="w-12 text-right">
                              <span className="cursor-help" title={f.full}>
                                {f.short}
                              </span>
                            </TableHead>
                          ))}
                          <TableHead className="w-16 text-right">Razem</TableHead>
                          <TableHead className="w-16 text-right">ECTS</TableHead>
                          <TableHead>Zaliczenie</TableHead>
                          {canEdit && <TableHead className="w-40" />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entries.map((entry, index) => (
                          <TableRow key={entry.id}>
                            <TableCell className="text-muted-foreground tabular-nums">{index + 1}</TableCell>
                            <TableCell className="font-medium">
                              {entry.subject.name}
                              {entry.subject.code && (
                                <span className="ml-2 text-xs text-muted-foreground">{entry.subject.code}</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {entry.specialization ? (
                                <Badge variant="outline">{entry.specialization.shortName}</Badge>
                              ) : (
                                <span className="text-sm text-muted-foreground">wspolny</span>
                              )}
                            </TableCell>
                            {HOUR_FIELDS.map((f) => (
                              <TableCell
                                key={f.key}
                                className={`text-right tabular-nums ${entry[f.key] === 0 ? 'text-muted-foreground/40' : ''}`}
                              >
                                {entry[f.key]}
                              </TableCell>
                            ))}
                            <TableCell className="text-right font-medium tabular-nums">{totalHours(entry)}</TableCell>
                            <TableCell className="text-right tabular-nums">{entry.ects}</TableCell>
                            <TableCell>
                              <Badge variant={entry.assessmentType === 'EXAM' ? 'default' : 'outline'}>
                                {ASSESSMENT_TYPE_LABELS[entry.assessmentType]}
                              </Badge>
                            </TableCell>
                            {canEdit && (
                              <TableCell>
                                <div className="flex justify-end gap-1">
                                  {specFilter === ALL && (
                                    <>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-8"
                                        aria-label="W gore"
                                        disabled={index === 0 || moveMutation.isPending}
                                        onClick={() => move(entries, index, -1)}
                                      >
                                        <ArrowUp />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-8"
                                        aria-label="W dol"
                                        disabled={index === entries.length - 1 || moveMutation.isPending}
                                        onClick={() => move(entries, index, 1)}
                                      >
                                        <ArrowDown />
                                      </Button>
                                    </>
                                  )}
                                  <Button variant="ghost" size="sm" onClick={() => openDialog(semester.semester, entry)}>
                                    Edytuj
                                  </Button>
                                  {/* span: wylaczony przycisk nie pokazuje dymka, a powod ma byc widoczny */}
                                  <span
                                    title={
                                      entry._count.sections > 0
                                        ? `Z tej pozycji powstaly juz zajecia (${entry._count.sections}) — nie mozna jej usunac`
                                        : undefined
                                    }
                                  >
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-8 text-destructive hover:text-destructive"
                                      aria-label={`Usun ${entry.subject.name}`}
                                      disabled={entry._count.sections > 0}
                                      onClick={() => setDeleting(entry)}
                                    >
                                      <Trash2 />
                                    </Button>
                                  </span>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      <Dialog open={!!dialog} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {dialog?.entry ? `Edytuj: ${dialog.entry.subject.name}` : `Dodaj przedmiot — semestr ${dialog?.semester}`}
            </DialogTitle>
            <DialogDescription>
              Godziny lacznie na caly semestr, osobno dla kazdej formy zajec.
              {entryLocked &&
                ` Z tej pozycji powstaly juz zajecia (${dialog!.entry!._count.sections}) — przedmiot, semestr i specjalnosc sa zablokowane; inna zmiane zrob w nowej wersji programu (klon). Zmiana godzin obejmie zajecia po „Synchronizuj zajecia”.`}
            </DialogDescription>
          </DialogHeader>
          <form id="program-entry-form" onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))} noValidate>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="subjectId">Przedmiot</FieldLabel>
                <Controller
                  control={form.control}
                  name="subjectId"
                  render={({ field }) => (
                    <Combobox
                      id="subjectId"
                      options={subjectOptions}
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Wybierz przedmiot"
                      searchPlaceholder="Szukaj po nazwie lub kodzie…"
                      invalid={!!form.formState.errors.subjectId}
                      disabled={entryLocked}
                    />
                  )}
                />
                <FieldError errors={[form.formState.errors.subjectId]} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="semester">Semestr</FieldLabel>
                  <NativeSelect id="semester" disabled={entryLocked} {...form.register('semester', { valueAsNumber: true })}>
                    {semesters.map((s) => (
                      <NativeSelectOption key={s.semester} value={s.semester}>
                        Semestr {s.semester}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="specialization">Dla kogo</FieldLabel>
                  <NativeSelect id="specialization" disabled={entryLocked} {...form.register('specialization')}>
                    <NativeSelectOption value={COMMON}>Wspolny dla kierunku</NativeSelectOption>
                    {specializations.map((s) => (
                      <NativeSelectOption key={s.id} value={s.id}>
                        Specjalnosc {s.shortName}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {HOUR_FIELDS.map((f) => (
                  <Field key={f.key}>
                    <FieldLabel htmlFor={f.key}>{f.short}</FieldLabel>
                    <Input
                      id={f.key}
                      type="number"
                      min={0}
                      className="text-right tabular-nums"
                      aria-label={f.full}
                      {...form.register(f.key, { valueAsNumber: true })}
                    />
                  </Field>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="ects">Punkty ECTS</FieldLabel>
                  <Input id="ects" type="number" min={0} {...form.register('ects', { valueAsNumber: true })} />
                  <FieldError errors={[form.formState.errors.ects]} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="assessmentType">Forma zaliczenia</FieldLabel>
                  <NativeSelect id="assessmentType" {...form.register('assessmentType')}>
                    {ASSESSMENT_TYPES.map((t) => (
                      <NativeSelectOption key={t} value={t}>
                        {ASSESSMENT_TYPE_LABELS[t]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Anuluj
            </Button>
            <Button type="submit" form="program-entry-form" disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Spinner />}
              {dialog?.entry ? 'Zapisz zmiany' : 'Dodaj'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmRevert}
        onOpenChange={setConfirmRevert}
        title={`Cofnac ${version.label} do projektu?`}
        description={`Roczniki korzystajace z tej wersji (${version.cohorts.length}): ${version.cohorts
          .map((c) => c.label)
          .join(', ')}. Do ponownego zatwierdzenia ich plan bedzie tylko do odczytu, a synchronizacja zajec je pominie. Umieszczenia i terminy zostaja.`}
        confirmLabel="Cofnij do projektu"
        isPending={statusMutation.isPending}
        onConfirm={() => statusMutation.mutate('DRAFT')}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Usunac ${deleting?.subject.name ?? ''} z programu?`}
        description="Pozycja zniknie z tej wersji programu. Inne wersje sie nie zmienia."
        isPending={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />
    </>
  );
}
