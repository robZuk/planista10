import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { ColumnDef } from '@tanstack/react-table';
import { Landmark, Users } from 'lucide-react';
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
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { MultiCombobox } from '@/components/MultiCombobox';
import { DataTable } from '@/components/data-table/DataTable';
import { RowActions } from '@/components/data-table/RowActions';
import { SortableHeader } from '@/components/data-table/SortableHeader';
import {
  createDepartment,
  deleteDepartment,
  fetchDepartments,
  setDepartmentInstructors,
  updateDepartment,
} from '@/api/departments';
import { fetchFaculties } from '@/api/faculties';
import { fetchInstructors } from '@/api/instructors';
import {
  compareDepartments,
  departmentLabel,
  instructorName,
  memberOptions,
  membershipChanges,
} from '@/lib/departments';
import { getErrorMessage } from '@/lib/errors';
import type { Department, Faculty } from '@/types';

/** Radix Select nie przyjmuje pustego stringa jako wartosci — stad wartownik. */
const NO_FACULTY = '__none__';

const departmentSchema = z.object({
  name: z.string().trim().min(3, 'Nazwa musi miec co najmniej 3 znaki'),
  shortName: z.string().trim().min(2, 'Skrot musi miec co najmniej 2 znaki').max(20, 'Skrot moze miec najwyzej 20 znakow'),
  facultyId: z.string(),
});

type DepartmentValues = z.infer<typeof departmentSchema>;

const COLUMN_LABELS = { label: 'Oznaczenie', name: 'Nazwa', faculty: 'Wydzial', instructors: 'Prowadzacy' };

interface Props {
  canEdit: boolean;
  /** Okno nowej katedry otwiera przycisk w naglowku strony. */
  creating: boolean;
  onCreatingChange: (open: boolean) => void;
}

/**
 * Katedry (zaklady, studia) — jednostki, ktore przysylaja obciazenia swoich prowadzacych.
 * Oznaczenie jak w zleceniach wydzialu (KEO-WE); jednostka miedzywydzialowa (SJO) bez wydzialu.
 */
export default function DepartmentsTab({ canEdit, creating, onCreatingChange }: Props) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);
  const [members, setMembers] = useState<Department | null>(null);
  const [facultyFilter, setFacultyFilter] = useState<string>('all');

  const { data: departments, isPending } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments });
  const { data: faculties } = useQuery({ queryKey: ['faculties'], queryFn: fetchFaculties });

  // Kolejnosc wydzialami (miedzywydzialowe na koncu); filtr wydzialu obok szukajki tabeli.
  const visible = useMemo(() => {
    if (!departments) return undefined;
    const sorted = [...departments].sort(compareDepartments);
    if (facultyFilter === 'all') return sorted;
    return sorted.filter((d) => (facultyFilter === NO_FACULTY ? !d.facultyId : d.facultyId === facultyFilter));
  }, [departments, facultyFilter]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDepartment(id),
    onSuccess: () => {
      toast.success(`Katedra ${deleting ? departmentLabel(deleting) : ''} usunieta`);
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ['departments'] });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const columns: ColumnDef<Department, unknown>[] = [
    {
      id: 'label',
      // Wartosc do sortowania/wyszukiwania musi byc plaskim tekstem, nie obiektem.
      accessorFn: (row) => departmentLabel(row),
      header: ({ column }) => <SortableHeader column={column}>Oznaczenie</SortableHeader>,
      cell: ({ row }) => <Badge variant="secondary">{departmentLabel(row.original)}</Badge>,
    },
    {
      accessorKey: 'name',
      header: ({ column }) => <SortableHeader column={column}>Nazwa</SortableHeader>,
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      id: 'faculty',
      accessorFn: (row) => row.faculty?.name ?? 'miedzywydzialowa',
      header: 'Wydzial',
      cell: ({ row }) =>
        row.original.faculty ? row.original.faculty.name : <span className="text-muted-foreground">miedzywydzialowa</span>,
    },
    {
      id: 'instructors',
      accessorFn: (row) => row._count?.instructors ?? 0,
      header: ({ column }) => <SortableHeader column={column}>Prowadzacy</SortableHeader>,
      cell: ({ row }) => {
        const count = row.original._count?.instructors ?? 0;
        return canEdit ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 tabular-nums"
            title="Pokaz i zmien sklad katedry"
            onClick={() => setMembers(row.original)}
          >
            {count}
          </Button>
        ) : (
          <span className="tabular-nums">{count}</span>
        );
      },
    },
    ...(canEdit
      ? [
          {
            id: 'actions',
            enableHiding: false,
            size: 60,
            cell: ({ row }) => (
              <div className="text-right">
                <RowActions onEdit={() => setEditing(row.original)} onDelete={() => setDeleting(row.original)}>
                  <DropdownMenuItem onSelect={() => setMembers(row.original)}>
                    <Users />
                    Sklad katedry
                  </DropdownMenuItem>
                </RowActions>
              </div>
            ),
          } satisfies ColumnDef<Department, unknown>,
        ]
      : []),
  ];

  const closeDialog = () => {
    onCreatingChange(false);
    setEditing(null);
  };

  return (
    <>
      <DataTable
        columns={columns}
        data={visible}
        isLoading={isPending}
        searchPlaceholder="Szukaj katedry…"
        columnLabels={COLUMN_LABELS}
        pageSize={25}
        toolbar={
          <Select value={facultyFilter} onValueChange={setFacultyFilter}>
            <SelectTrigger className="w-56" aria-label="Wydzial">
              <SelectValue placeholder="Wydzial" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Wszystkie wydzialy</SelectItem>
              <SelectItem value={NO_FACULTY}>Miedzywydzialowe</SelectItem>
              {faculties?.map((faculty) => (
                <SelectItem key={faculty.id} value={faculty.id}>
                  {faculty.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        emptyState={
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Landmark />
              </EmptyMedia>
              <EmptyTitle>Brak katedr</EmptyTitle>
              <EmptyDescription>
                Katedry przysylaja obciazenia swoich prowadzacych. Dodaj pierwsza — np. KEO na Wydziale Elektrycznym
                albo SJO jako jednostke miedzywydzialowa.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />

      {(creating || editing) && (
        <DepartmentDialog key={editing?.id ?? 'new'} department={editing} faculties={faculties} onClose={closeDialog} />
      )}
      {members && <MembersDialog department={members} onClose={() => setMembers(null)} />}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Usunac katedre ${deleting ? departmentLabel(deleting) : ''}?`}
        description="Tej operacji nie da sie cofnac. Katedra z prowadzacymi nie zostanie usunieta — najpierw zmien jej sklad."
        isPending={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />
    </>
  );
}

/** Dodawanie i edycja katedry — okno montowane przy otwarciu, wiec formularz startuje od wartosci katedry. */
function DepartmentDialog({
  department,
  faculties,
  onClose,
}: {
  department: Department | null;
  faculties: Faculty[] | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<DepartmentValues>({
    resolver: zodResolver(departmentSchema),
    defaultValues: {
      name: department?.name ?? '',
      shortName: department?.shortName ?? '',
      facultyId: department?.facultyId ?? NO_FACULTY,
    },
  });

  const save = useMutation({
    mutationFn: (values: DepartmentValues) => {
      const input = {
        name: values.name,
        shortName: values.shortName,
        facultyId: values.facultyId === NO_FACULTY ? null : values.facultyId,
      };
      return department ? updateDepartment(department.id, input) : createDepartment(input);
    },
    onSuccess: (saved) => {
      toast.success(department ? `Katedra ${departmentLabel(saved)} zaktualizowana` : `Katedra ${departmentLabel(saved)} dodana`);
      void queryClient.invalidateQueries({ queryKey: ['departments'] });
      // Zmiana wydzialu katedry przenosi jej prowadzacych — lista prowadzacych tez sie zmienia.
      void queryClient.invalidateQueries({ queryKey: ['instructors'] });
      onClose();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const facultyId = form.watch('facultyId');
  const memberCount = department?._count?.instructors ?? 0;
  const movesInstructors = !!department && memberCount > 0 && facultyId !== NO_FACULTY && facultyId !== department.facultyId;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{department ? `Edytuj katedre ${departmentLabel(department)}` : 'Nowa katedra'}</DialogTitle>
          <DialogDescription>
            Skrot z wydzialem tworzy oznaczenie jak w zleceniach wydzialu, np. KEO-WE. Jednostka bez wydzialu (SJO,
            prowadzacy zewnetrzni) ma sam skrot.
          </DialogDescription>
        </DialogHeader>

        <form id="department-form" onSubmit={form.handleSubmit((values) => save.mutate(values))} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="department-name">Nazwa</FieldLabel>
              <Input
                id="department-name"
                placeholder="Katedra Elektroenergetyki Okretowej"
                aria-invalid={!!form.formState.errors.name}
                {...form.register('name')}
              />
              <FieldError errors={[form.formState.errors.name]} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="department-short">Skrot</FieldLabel>
                <Input
                  id="department-short"
                  placeholder="KEO"
                  aria-invalid={!!form.formState.errors.shortName}
                  {...form.register('shortName')}
                />
                <FieldError errors={[form.formState.errors.shortName]} />
              </Field>

              <Field>
                <FieldLabel htmlFor="department-faculty">Wydzial</FieldLabel>
                <Controller
                  control={form.control}
                  name="facultyId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="department-faculty">
                        <SelectValue placeholder="Wybierz wydzial" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_FACULTY}>Miedzywydzialowa (bez wydzialu)</SelectItem>
                        {faculties?.map((faculty) => (
                          <SelectItem key={faculty.id} value={faculty.id}>
                            {faculty.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>
            {movesInstructors && (
              <FieldDescription>
                Prowadzacy tej katedry ({memberCount}) przejda razem z nia na nowy wydzial.
              </FieldDescription>
            )}
          </FieldGroup>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button type="submit" form="department-form" disabled={save.isPending}>
            {save.isPending && <Spinner />}
            {department ? 'Zapisz zmiany' : 'Dodaj'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Sklad katedry: wybor jej prowadzacych z calej uczelni. Przed zapisem widac, kto przejdzie
 * z innej katedry, komu zmieni sie wydzial i kto zostanie bez katedry.
 */
function MembersDialog({ department, onClose }: { department: Department; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: instructors } = useQuery({ queryKey: ['instructors'], queryFn: fetchInstructors });
  // Dopoki planista nic nie zmienil, wybor to obecny sklad (po wczytaniu listy prowadzacych).
  const [picked, setPicked] = useState<string[] | null>(null);
  const current = useMemo(
    () => (instructors ?? []).filter((i) => i.departmentId === department.id).map((i) => i.id),
    [instructors, department.id],
  );
  const selected = picked ?? current;
  const options = useMemo(() => memberOptions(instructors ?? [], department.id), [instructors, department.id]);
  const changes = membershipChanges(instructors ?? [], department, selected);
  const names = (list: typeof changes.moving) => list.map(instructorName).join(', ');

  const save = useMutation({
    mutationFn: () => setDepartmentInstructors(department.id, selected),
    onSuccess: (result) => {
      toast.success(result.message);
      void queryClient.invalidateQueries({ queryKey: ['departments'] });
      void queryClient.invalidateQueries({ queryKey: ['instructors'] });
      onClose();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Sklad katedry {departmentLabel(department)}</DialogTitle>
          <DialogDescription>
            {department.name}.{' '}
            {department.faculty
              ? `Prowadzacy katedry naleza do wydzialu ${department.faculty.shortName}.`
              : 'Jednostka miedzywydzialowa — wydzial prowadzacych sie nie zmienia.'}
          </DialogDescription>
        </DialogHeader>

        {instructors ? (
          <MultiCombobox
            options={options}
            value={selected}
            onChange={setPicked}
            placeholder="Wybierz prowadzacych"
            searchPlaceholder="Szukaj po nazwisku lub e-mailu…"
            emptyText="Nie ma takiego prowadzacego."
          />
        ) : (
          <Skeleton className="h-9 w-full" />
        )}

        {(changes.moving.length > 0 || changes.facultyChanging.length > 0 || changes.leaving.length > 0) && (
          <ul className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
            {changes.moving.length > 0 && (
              <li>
                <span className="font-medium">Przejda z innej katedry:</span>{' '}
                {changes.moving
                  .map((i) => `${instructorName(i)}${i.department ? ` (${departmentLabel(i.department)})` : ''}`)
                  .join(', ')}
              </li>
            )}
            {changes.facultyChanging.length > 0 && department.faculty && (
              <li>
                <span className="font-medium">Zmieni sie wydzial na {department.faculty.shortName}:</span>{' '}
                {names(changes.facultyChanging)}
              </li>
            )}
            {changes.leaving.length > 0 && (
              <li>
                <span className="font-medium">Zostana bez katedry:</span> {names(changes.leaving)}
              </li>
            )}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => save.mutate()} disabled={!instructors || save.isPending}>
            {save.isPending && <Spinner />}
            Zapisz sklad ({selected.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
