import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { ColumnDef } from '@tanstack/react-table';
import { FileDown, GraduationCap, Plus } from 'lucide-react';
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { PageHeader } from '@/components/PageHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable } from '@/components/data-table/DataTable';
import { RowActions } from '@/components/data-table/RowActions';
import { SortableHeader } from '@/components/data-table/SortableHeader';
import {
  createInstructor,
  deleteInstructor,
  fetchInstructors,
  updateInstructor,
  type InstructorInput,
} from '@/api/instructors';
import { fetchFaculties } from '@/api/faculties';
import { fetchDepartments } from '@/api/departments';
import { compareDepartments, departmentLabel } from '@/lib/departments';
import { getErrorMessage } from '@/lib/errors';
import { useAuthStore } from '@/store/authStore';
import { usePlanPdf } from '@/hooks/usePlanPdf';
import { PlanPdfDialog } from '@/components/PlanPdfDialog';
import type { Department, Instructor } from '@/types';

/** Radix Select nie przyjmuje pustego stringa jako wartosci — stad wartownicy. */
const NO_FACULTY = '__none__';
const NO_DEPARTMENT = '__none__';

const instructorSchema = z.object({
  firstName: z.string().min(2, 'Imie musi miec co najmniej 2 znaki'),
  lastName: z.string().min(2, 'Nazwisko musi miec co najmniej 2 znaki'),
  email: z.string().min(1, 'Podaj adres email').email('To nie wyglada na adres email'),
  title: z.string().optional(),
  facultyId: z.string().optional(),
  departmentId: z.string().optional(),
});

type InstructorValues = z.infer<typeof instructorSchema>;

const EMPTY_FORM: InstructorValues = {
  firstName: '',
  lastName: '',
  email: '',
  title: '',
  facultyId: NO_FACULTY,
  departmentId: NO_DEPARTMENT,
};

const COLUMN_LABELS = {
  title: 'Tytul',
  lastName: 'Nazwisko',
  firstName: 'Imie',
  email: 'E-mail',
  faculty: 'Wydzial',
  department: 'Katedra',
};

const inFaculty = (i: Instructor, faculty: string) =>
  faculty === 'all' || (faculty === NO_FACULTY ? !i.facultyId : i.facultyId === faculty);

/**
 * Katedry do filtra: te, ktore maja prowadzacych na liscie w wybranym wydziale (dane z listy
 * prowadzacych) — po wybraniu wydzialu bez katedr innych wydzialow.
 */
function departmentsOf(instructors: Instructor[] | undefined, faculty: string): Department[] {
  const byId = new Map<string, Department>();
  for (const i of instructors ?? []) if (i.department && inFaculty(i, faculty)) byId.set(i.department.id, i.department);
  return [...byId.values()].sort(compareDepartments);
}

export default function InstructorsPage() {
  const queryClient = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === 'ADMIN';
  // Druk planu prowadzacego — planisci (semestr ostatnio uzywany albo planowany).
  const canPrint = role === 'ADMIN' || role === 'DEAN_OFFICE';
  const pdf = usePlanPdf();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Instructor | null>(null);
  const [deleting, setDeleting] = useState<Instructor | null>(null);
  const [facultyFilter, setFacultyFilter] = useState<string>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');

  const { data: instructors, isPending } = useQuery({
    queryKey: ['instructors'],
    queryFn: fetchInstructors,
  });
  const { data: faculties } = useQuery({ queryKey: ['faculties'], queryFn: fetchFaculties });
  // Pelna lista katedr (takze pustych) potrzebna tylko w formularzu admina.
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments, enabled: canEdit });
  const departmentOptions = useMemo(() => [...(departments ?? [])].sort(compareDepartments), [departments]);

  const departmentsInUse = useMemo(() => departmentsOf(instructors, facultyFilter), [instructors, facultyFilter]);

  const changeFaculty = (faculty: string) => {
    setFacultyFilter(faculty);
    // Katedra spoza nowego wydzialu dawalaby pusta liste — wracamy do wszystkich katedr.
    if (departmentFilter !== 'all' && departmentFilter !== NO_DEPARTMENT && !departmentsOf(instructors, faculty).some((d) => d.id === departmentFilter)) {
      setDepartmentFilter('all');
    }
  };

  // Filtry wydzialu i katedry dzialaja obok globalnej szukajki DataTable, wiec zawezamy dane wejsciowe.
  const visible = useMemo(
    () =>
      instructors?.filter(
        (i) =>
          inFaculty(i, facultyFilter) &&
          (departmentFilter === 'all' ||
            (departmentFilter === NO_DEPARTMENT ? !i.departmentId : i.departmentId === departmentFilter)),
      ),
    [instructors, facultyFilter, departmentFilter],
  );

  const form = useForm<InstructorValues>({
    resolver: zodResolver(instructorSchema),
    defaultValues: EMPTY_FORM,
  });
  // Katedra wydzialowa ustala wydzial prowadzacego (serwer robi to samo) — pole wydzialu jest wtedy zablokowane.
  const chosenDepartment = departments?.find((d) => d.id === form.watch('departmentId'));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['instructors'] });

  const saveMutation = useMutation({
    mutationFn: (values: InstructorValues) => {
      const payload: InstructorInput = {
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        title: values.title || undefined,
        // null (a nie undefined) — "Bez wydzialu"/"Bez katedry" ma odpiac, a nie zostawic jak bylo.
        facultyId: !values.facultyId || values.facultyId === NO_FACULTY ? null : values.facultyId,
        departmentId: !values.departmentId || values.departmentId === NO_DEPARTMENT ? null : values.departmentId,
      };
      return editing ? updateInstructor(editing.id, payload) : createInstructor(payload);
    },
    onSuccess: () => {
      toast.success(editing ? 'Dane prowadzacego zaktualizowane' : 'Prowadzacy dodany');
      setDialogOpen(false);
      void invalidate();
      // Liczba prowadzacych katedry (zakladka Katedry) tez sie zmienia.
      void queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteInstructor(id),
    onSuccess: () => {
      toast.success('Prowadzacy usuniety');
      setDeleting(null);
      void invalidate();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const openCreate = () => {
    setEditing(null);
    form.reset(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (instructor: Instructor) => {
    setEditing(instructor);
    form.reset({
      firstName: instructor.firstName,
      lastName: instructor.lastName,
      email: instructor.email,
      title: instructor.title ?? '',
      facultyId: instructor.facultyId ?? NO_FACULTY,
      departmentId: instructor.departmentId ?? NO_DEPARTMENT,
    });
    setDialogOpen(true);
  };

  const columns: ColumnDef<Instructor, unknown>[] = [
    {
      accessorKey: 'title',
      header: 'Tytul',
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.title ?? '—'}</span>
      ),
    },
    {
      accessorKey: 'lastName',
      header: ({ column }) => <SortableHeader column={column}>Nazwisko</SortableHeader>,
      cell: ({ row }) => <span className="font-medium">{row.original.lastName}</span>,
    },
    {
      accessorKey: 'firstName',
      header: ({ column }) => <SortableHeader column={column}>Imie</SortableHeader>,
    },
    {
      accessorKey: 'email',
      header: ({ column }) => <SortableHeader column={column}>E-mail</SortableHeader>,
      cell: ({ row }) => (
        <a href={`mailto:${row.original.email}`} className="text-primary hover:underline">
          {row.original.email}
        </a>
      ),
    },
    {
      id: 'faculty',
      // Wartosc do sortowania/wyszukiwania musi byc plaskim tekstem, nie obiektem.
      accessorFn: (row) => row.faculty?.shortName ?? '',
      header: 'Wydzial',
      cell: ({ row }) =>
        row.original.faculty ? (
          <Badge variant="secondary">{row.original.faculty.shortName}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'department',
      accessorFn: (row) => (row.department ? departmentLabel(row.department) : ''),
      header: ({ column }) => <SortableHeader column={column}>Katedra</SortableHeader>,
      cell: ({ row }) =>
        row.original.department ? (
          <Badge variant="outline" title={row.original.department.name}>
            {departmentLabel(row.original.department)}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    ...(canEdit || canPrint
      ? [
          {
            id: 'actions',
            enableHiding: false,
            size: 90,
            cell: ({ row }) => (
              <div className="flex justify-end gap-1">
                {canPrint && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    disabled={pdf.isPending}
                    aria-label={`Plan PDF: ${row.original.lastName}`}
                    title={`Plan zajec (PDF)${pdf.termLabel ? ` — semestr ${pdf.termLabel}` : ''}`}
                    onClick={() => pdf.open({ instructorId: row.original.id }, `${row.original.title ?? ''} ${row.original.firstName} ${row.original.lastName}`.trim())}
                  >
                    <FileDown />
                  </Button>
                )}
                {canEdit && (
                  <RowActions
                    onEdit={() => openEdit(row.original)}
                    onDelete={() => setDeleting(row.original)}
                  />
                )}
              </div>
            ),
          } satisfies ColumnDef<Instructor, unknown>,
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Prowadzacy"
        description="Kadra dydaktyczna z katedrami — przypisywana do zajec w „Obsadzie” (obciazenia z arkuszy katedr), a stamtad do umieszczen w planie."
        actions={
          canEdit && (
            <Button onClick={openCreate}>
              <Plus />
              Dodaj prowadzacego
            </Button>
          )
        }
      />

      <DataTable
        columns={columns}
        data={visible}
        isLoading={isPending}
        searchPlaceholder="Szukaj po nazwisku lub e-mailu…"
        columnLabels={COLUMN_LABELS}
        toolbar={
          <>
            <Select value={facultyFilter} onValueChange={changeFaculty}>
              <SelectTrigger className="w-48" aria-label="Wydzial">
                <SelectValue placeholder="Wydzial" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Wszystkie wydzialy</SelectItem>
                <SelectItem value={NO_FACULTY}>Ogolnouczelniani</SelectItem>
                {faculties?.map((faculty) => (
                  <SelectItem key={faculty.id} value={faculty.id}>
                    {faculty.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="w-44" aria-label="Katedra">
                <SelectValue placeholder="Katedra" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Wszystkie katedry</SelectItem>
                <SelectItem value={NO_DEPARTMENT}>Bez katedry</SelectItem>
                {departmentsInUse.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {departmentLabel(department)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        emptyState={
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GraduationCap />
              </EmptyMedia>
              <EmptyTitle>Brak prowadzacych</EmptyTitle>
              <EmptyDescription>
                Bez prowadzacych nie da sie ulozyc planu — dodaj pierwsza osobe.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edytuj prowadzacego' : 'Nowy prowadzacy'}</DialogTitle>
            <DialogDescription>
              E-mail musi byc unikalny — sluzy tez do powiazania z kontem uzytkownika.
            </DialogDescription>
          </DialogHeader>

          <form
            id="instructor-form"
            onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
            noValidate
          >
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="firstName">Imie</FieldLabel>
                  <Input
                    id="firstName"
                    aria-invalid={!!form.formState.errors.firstName}
                    {...form.register('firstName')}
                  />
                  <FieldError errors={[form.formState.errors.firstName]} />
                </Field>

                <Field>
                  <FieldLabel htmlFor="lastName">Nazwisko</FieldLabel>
                  <Input
                    id="lastName"
                    aria-invalid={!!form.formState.errors.lastName}
                    {...form.register('lastName')}
                  />
                  <FieldError errors={[form.formState.errors.lastName]} />
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="email">E-mail</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  placeholder="j.kowalski@umg.edu.pl"
                  aria-invalid={!!form.formState.errors.email}
                  {...form.register('email')}
                />
                <FieldError errors={[form.formState.errors.email]} />
              </Field>

              {/* Katedra przed wydzialem — katedra wydzialowa ustala wydzial (pole wydzialu jest wtedy zablokowane). */}
              <Field>
                <FieldLabel htmlFor="departmentId">Katedra (opcjonalnie)</FieldLabel>
                <Controller
                  control={form.control}
                  name="departmentId"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        const department = departments?.find((d) => d.id === value);
                        if (department?.facultyId) form.setValue('facultyId', department.facultyId);
                      }}
                    >
                      <SelectTrigger id="departmentId">
                        <SelectValue placeholder="Wybierz katedre" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_DEPARTMENT}>Bez katedry</SelectItem>
                        {departmentOptions.map((department) => (
                          <SelectItem key={department.id} value={department.id}>
                            {departmentLabel(department)} — {department.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldDescription>
                  Katedry zaklada sie w{' '}
                  <Link to="/faculties?widok=katedry" className="underline underline-offset-4">
                    Wydzialy i katedry
                  </Link>
                  .
                </FieldDescription>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="title">Tytul (opcjonalnie)</FieldLabel>
                  <Input id="title" placeholder="dr hab. inz." {...form.register('title')} />
                </Field>

                <Field>
                  <FieldLabel htmlFor="facultyId">Wydzial (opcjonalnie)</FieldLabel>
                  <Controller
                    control={form.control}
                    name="facultyId"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} disabled={!!chosenDepartment?.facultyId}>
                        <SelectTrigger id="facultyId">
                          <SelectValue placeholder="Wybierz wydzial" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_FACULTY}>Bez wydzialu</SelectItem>
                          {faculties?.map((faculty) => (
                            <SelectItem key={faculty.id} value={faculty.id}>
                              {faculty.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {chosenDepartment?.facultyId && <FieldDescription>Wydzial wynika z katedry.</FieldDescription>}
                </Field>
              </div>
            </FieldGroup>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Anuluj
            </Button>
            <Button type="submit" form="instructor-form" disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Spinner />}
              {editing ? 'Zapisz zmiany' : 'Dodaj'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Usunac ${deleting?.firstName ?? ''} ${deleting?.lastName ?? ''}?`}
        description={
          deleting?.user
            ? `Tej operacji nie da sie cofnac. Prowadzacy ma konto ${deleting.user.email} — po usunieciu konto zostanie bez powiazania i jego wlasciciel przestanie widziec swoj plan. Prowadzacy przypisany do zajec w planie nie zostanie usuniety.`
            : 'Tej operacji nie da sie cofnac. Prowadzacy przypisany do zajec w planie nie zostanie usuniety.'
        }
        isPending={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />
      <PlanPdfDialog preview={pdf.preview} onClose={pdf.close} />
    </>
  );
}
