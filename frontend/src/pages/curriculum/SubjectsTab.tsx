import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { ColumnDef } from '@tanstack/react-table';
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react';
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
import { Spinner } from '@/components/ui/spinner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable } from '@/components/data-table/DataTable';
import { SortableHeader } from '@/components/data-table/SortableHeader';
import { createSubject, deleteSubject, fetchSubjects, updateSubject } from '@/api/subjects';
import { getErrorMessage } from '@/lib/errors';
import { useAuthStore } from '@/store/authStore';
import type { Subject } from '@/types';

const subjectSchema = z.object({
  name: z.string().min(3, 'Nazwa musi miec co najmniej 3 znaki'),
  code: z.string().optional(),
});

type SubjectValues = z.infer<typeof subjectSchema>;

const COLUMN_LABELS = { name: 'Nazwa', code: 'Kod', usage: 'Programy' };

/** Slownik przedmiotow wspolny dla calej uczelni — ten sam przedmiot bywa w wielu programach. */
export default function SubjectsTab() {
  const queryClient = useQueryClient();
  const canEdit = useAuthStore((s) => s.user?.role) === 'ADMIN';

  const [dialogOpen, setDialogOpen] = useState(false);
  // null = nowy przedmiot; inaczej edycja nazwy/kodu istniejacego.
  const [editing, setEditing] = useState<Subject | null>(null);
  const [deleting, setDeleting] = useState<Subject | null>(null);

  const { data, isPending } = useQuery({ queryKey: ['subjects'], queryFn: () => fetchSubjects() });

  const form = useForm<SubjectValues>({
    resolver: zodResolver(subjectSchema),
    defaultValues: { name: '', code: '' },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['subjects'] });

  const saveMutation = useMutation({
    mutationFn: (values: SubjectValues) => {
      const input = { name: values.name, code: values.code ?? '' };
      return editing ? updateSubject(editing.id, input) : createSubject(input);
    },
    onSuccess: () => {
      toast.success(editing ? 'Przedmiot zaktualizowany' : 'Przedmiot dodany');
      setDialogOpen(false);
      void invalidate();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const openDialog = (subject: Subject | null) => {
    setEditing(subject);
    form.reset({ name: subject?.name ?? '', code: subject?.code ?? '' });
    setDialogOpen(true);
  };
  const editingUsage = editing?._count?.programEntries ?? 0;

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSubject(id),
    onSuccess: () => {
      toast.success('Przedmiot usuniety');
      setDeleting(null);
      void invalidate();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const columns: ColumnDef<Subject, unknown>[] = [
    {
      accessorKey: 'name',
      header: ({ column }) => <SortableHeader column={column}>Nazwa</SortableHeader>,
      enableHiding: false,
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: 'code',
      header: ({ column }) => <SortableHeader column={column}>Kod</SortableHeader>,
      cell: ({ row }) =>
        row.original.code ? (
          <Badge variant="secondary">{row.original.code}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'usage',
      accessorFn: (s) => s._count?.programEntries ?? 0,
      header: ({ column }) => <SortableHeader column={column}>Programy</SortableHeader>,
      cell: ({ row }) => {
        const n = row.original._count?.programEntries ?? 0;
        return n > 0 ? <span className="tabular-nums">{n}</span> : <span className="text-muted-foreground">nieuzywany</span>;
      },
    },
    ...(canEdit
      ? [
          {
            id: 'actions',
            enableHiding: false,
            size: 90,
            cell: ({ row }) => (
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Edytuj przedmiot ${row.original.name}`}
                  onClick={() => openDialog(row.original)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:text-destructive"
                  aria-label={`Usun przedmiot ${row.original.name}`}
                  disabled={(row.original._count?.programEntries ?? 0) > 0}
                  title={(row.original._count?.programEntries ?? 0) > 0 ? 'Przedmiot jest w programach studiow — nie mozna go usunac' : undefined}
                  onClick={() => setDeleting(row.original)}
                >
                  <Trash2 />
                </Button>
              </div>
            ),
          } satisfies ColumnDef<Subject, unknown>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={() => openDialog(null)}>
            <Plus />
            Dodaj przedmiot
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={data}
        isLoading={isPending}
        searchPlaceholder="Szukaj przedmiotu…"
        columnLabels={COLUMN_LABELS}
        pageSize={15}
        emptyState={
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookOpen />
              </EmptyMedia>
              <EmptyTitle>Brak przedmiotow</EmptyTitle>
              <EmptyDescription>
                Przedmioty sa wspolne dla calej uczelni — dodane raz, wchodza do dowolnego programu studiow.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edytuj przedmiot' : 'Nowy przedmiot'}</DialogTitle>
            <DialogDescription>
              {editing
                ? editingUsage > 0
                  ? `Zmiana obejmie wszystkie programy studiow z tym przedmiotem (wpisy: ${editingUsage}) i ich plany.`
                  : 'Przedmiot nie jest jeszcze w zadnym programie studiow.'
                : 'Godziny i punkty ECTS ustawia sie osobno w kazdym programie studiow — tutaj tylko nazwa i kod.'}
            </DialogDescription>
          </DialogHeader>

          <form
            id="subject-form"
            onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
            noValidate
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="subjectName">Nazwa</FieldLabel>
                <Input
                  id="subjectName"
                  placeholder="Podstawy programowania"
                  aria-invalid={!!form.formState.errors.name}
                  {...form.register('name')}
                />
                <FieldError errors={[form.formState.errors.name]} />
              </Field>

              <Field>
                <FieldLabel htmlFor="subjectCode">Kod (opcjonalnie)</FieldLabel>
                <Input id="subjectCode" placeholder="INF-101" {...form.register('code')} />
                <FieldDescription>Uzywany w zestawieniach i przy wyszukiwaniu.</FieldDescription>
              </Field>
            </FieldGroup>
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Anuluj
            </Button>
            <Button type="submit" form="subject-form" disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Spinner />}
              {editing ? 'Zapisz' : 'Dodaj'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Usunac przedmiot ${deleting?.name ?? ''}?`}
        description="Przedmiot zniknie ze slownika. Usunac mozna tylko przedmiot, ktorego nie ma w zadnym programie studiow."
        isPending={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />
    </div>
  );
}
