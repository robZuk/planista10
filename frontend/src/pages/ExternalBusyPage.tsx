import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { CalendarX2, Plus, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageHeader } from '@/components/PageHeader';
import { DataTable } from '@/components/data-table/DataTable';
import { RowActions } from '@/components/data-table/RowActions';
import { SortableHeader } from '@/components/data-table/SortableHeader';
import { deleteExternalBusy, fetchExternalBusy, type ExternalBusy } from '@/api/externalBusy';
import { useCurrentTerm } from '@/hooks/useTerm';
import { getErrorMessage } from '@/lib/errors';
import { datesSummary, shortDate } from '@/lib/externalBusy';
import { formatMinutes } from '@/lib/timeGrid';
import { ExternalBusyDialog } from './externalBusy/ExternalBusyDialog';

const COLUMN_LABELS = { source: 'Zgloszenie', who: 'Prowadzacy / sala', time: 'Godziny', dates: 'Daty', clashes: 'Kolizje' };
const REASON: Record<string, string> = { INSTRUCTOR: 'prowadzacy', ROOM: 'sala' };

/**
 * Zajetosci zewnetrzne — zajecia prowadzacych i sal na innych wydzialach, zgloszone mailem.
 * Plan uklada sie tylko dla wlasnego wydzialu, ale prowadzacy i sale bywaja wspolne: wpisane
 * tu zajetosci licza sie do kolizji przy umieszczaniu zajec, w podpowiedzi wolnych godzin
 * i przy „Generuj terminy”. Wpis kolidujacy z juz ulozonym planem jest oznaczony — trzeba
 * przelozyc zajecia (zgloszenie innego wydzialu jest faktem, nie propozycja).
 */
export default function ExternalBusyPage() {
  const queryClient = useQueryClient();
  const { term } = useCurrentTerm();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ExternalBusy | null>(null);
  const [deleting, setDeleting] = useState<ExternalBusy | null>(null);
  const [clashesOf, setClashesOf] = useState<ExternalBusy | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['external-busy', term?.key],
    queryFn: () => fetchExternalBusy(term!.key),
    enabled: !!term,
  });
  const sources = useMemo(() => [...new Set((data ?? []).map((e) => e.source))].sort(), [data]);
  const clashing = (data ?? []).filter((e) => e.clashes.length > 0);

  const remove = useMutation({
    mutationFn: (id: string) => deleteExternalBusy(id),
    onSuccess: () => {
      toast.success('Zajetosc zewnetrzna usunieta');
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ['external-busy', term?.key] });
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const columns: ColumnDef<ExternalBusy, unknown>[] = [
    {
      id: 'source',
      accessorFn: (row) => row.source,
      header: ({ column }) => <SortableHeader column={column}>Zgloszenie</SortableHeader>,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.source}</div>
          <div className="text-xs text-muted-foreground">stan na {shortDate(row.original.receivedOn)}</div>
        </div>
      ),
    },
    {
      id: 'who',
      accessorFn: (row) => [row.instructor?.name, row.room?.label, row.note].filter(Boolean).join(' '),
      header: 'Prowadzacy / sala',
      cell: ({ row }) => (
        <div>
          {row.original.instructor && <div>{row.original.instructor.name}</div>}
          {row.original.room && <div className={row.original.instructor ? 'text-xs text-muted-foreground' : ''}>sala {row.original.room.label}</div>}
          {row.original.note && <div className="text-xs text-muted-foreground">{row.original.note}</div>}
        </div>
      ),
    },
    {
      id: 'time',
      accessorFn: (row) => row.startMinute,
      header: ({ column }) => <SortableHeader column={column}>Godziny</SortableHeader>,
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatMinutes(row.original.startMinute)}–{formatMinutes(row.original.endMinute)}
        </span>
      ),
    },
    {
      id: 'dates',
      accessorFn: (row) => row.dates[0] ?? '',
      header: ({ column }) => <SortableHeader column={column}>Daty</SortableHeader>,
      cell: ({ row }) => (
        <span className="tabular-nums" title={row.original.dates.map(shortDate).join(', ')}>
          {datesSummary(row.original.dates)}
        </span>
      ),
    },
    {
      id: 'clashes',
      accessorFn: (row) => row.clashes.length,
      header: ({ column }) => <SortableHeader column={column}>Kolizje</SortableHeader>,
      cell: ({ row }) =>
        row.original.clashes.length > 0 ? (
          <button type="button" onClick={() => setClashesOf(row.original)} title="Pokaz kolidujace zajecia planu">
            <Badge variant="destructive" className="cursor-pointer tabular-nums">
              {row.original.clashes.length}
            </Badge>
          </button>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'actions',
      enableHiding: false,
      size: 60,
      cell: ({ row }) => (
        <div className="text-right">
          <RowActions onEdit={() => setEditing(row.original)} onDelete={() => setDeleting(row.original)} />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Zajetosci zewnetrzne"
        description="Zajecia prowadzacych i sal na innych wydzialach (ze zgloszen mailowych) — licza sie do kolizji przy ukladaniu planu i generowaniu terminow."
        actions={
          <Button onClick={() => setCreating(true)} disabled={!term}>
            <Plus />
            Dodaj zajetosc
          </Button>
        }
      />

      {clashing.length > 0 && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Zajetosci kolidujace z ulozonym planem: {clashing.length}</AlertTitle>
          <AlertDescription>
            Zgloszenie innego wydzialu przyszlo po ulozeniu planu. Przeloz kolidujace zajecia w „Ukladaniu planu” (kliknij
            liczbe kolizji, zeby zobaczyc ktore) albo popraw wpis, jesli zgloszenie sie zmienilo.
          </AlertDescription>
        </Alert>
      )}

      <DataTable
        columns={columns}
        data={term ? data : undefined}
        isLoading={!term || isPending}
        searchPlaceholder="Szukaj po zgloszeniu, prowadzacym, sali…"
        columnLabels={COLUMN_LABELS}
        pageSize={25}
        emptyState={
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarX2 />
              </EmptyMedia>
              <EmptyTitle>Brak zajetosci zewnetrznych</EmptyTitle>
              <EmptyDescription>
                Gdy inny wydzial zglosi zajecia waszego prowadzacego albo w waszej sali, wpisz je tutaj — plan nie postawi
                wtedy zajec w tym samym czasie.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />

      {term && (creating || editing) && (
        <ExternalBusyDialog
          key={editing?.id ?? 'new'}
          termKey={term.key}
          entry={editing}
          sources={sources}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {clashesOf && (
        <Dialog open onOpenChange={(open) => !open && setClashesOf(null)}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Kolizje z ulozonym planem</DialogTitle>
              <DialogDescription>
                {clashesOf.source}: {[clashesOf.instructor?.name, clashesOf.room && `sala ${clashesOf.room.label}`].filter(Boolean).join(', ')},{' '}
                {formatMinutes(clashesOf.startMinute)}–{formatMinutes(clashesOf.endMinute)}. Te zajecia trzeba przelozyc.
              </DialogDescription>
            </DialogHeader>
            <ul className="max-h-96 space-y-1 overflow-y-auto text-sm">
              {clashesOf.clashes.map((c) => (
                <li key={`${c.date}|${c.with}`} className="flex gap-3">
                  <span className="w-12 shrink-0 tabular-nums text-muted-foreground">{shortDate(c.date)}</span>
                  <span className="w-20 shrink-0 text-muted-foreground">{REASON[c.reason]}</span>
                  <span>{c.with}</span>
                </li>
              ))}
            </ul>
          </DialogContent>
        </Dialog>
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Usunac zajetosc zewnetrzna?"
        description={
          deleting
            ? `${deleting.source}: ${[deleting.instructor?.name, deleting.room && `sala ${deleting.room.label}`].filter(Boolean).join(', ')}, ${datesSummary(deleting.dates)}. Plan przestanie uwzgledniac te zajecia przy kolizjach.`
            : ''
        }
        isPending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}
