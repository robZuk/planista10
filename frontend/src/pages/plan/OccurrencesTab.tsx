import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
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
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Combobox } from '@/components/Combobox';
import { changeOccurrence, createManualOccurrence, deleteManualOccurrence, fetchOccurrences } from '@/api/plan';
import { fetchBuildings } from '@/api/buildings';
import { getErrorMessage } from '@/lib/errors';
import { CLASS_LABELS } from '@/lib/scheduleDisplay';
import { formatMinutes } from '@/lib/timeGrid';
import type { OccurrenceRow, PlanSection, TimeBlock } from '@/types';

const WEEKDAY = ['nd', 'pn', 'wt', 'sr', 'cz', 'pt', 'sb'];

/**
 * Terminy rocznika (konkretne daty). Zmiany pojedynczych terminow sa zapisywane jako
 * poprawki i przezywaja ponowne "Generuj terminy". Terminy reczne (odrobienia) nie znikaja.
 */
export function OccurrencesTab({
  termKey,
  cohortId,
  sections,
  blocks,
  readOnly,
}: {
  termKey: string;
  cohortId: string;
  sections: PlanSection[];
  blocks: TimeBlock[];
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ['occurrences', termKey, cohortId],
    queryFn: () => fetchOccurrences(termKey, cohortId),
  });
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<OccurrenceRow | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = async () => {
    setEditing(null);
    setAdding(false);
    await queryClient.invalidateQueries({ queryKey: ['occurrences'] });
    await queryClient.invalidateQueries({ queryKey: ['plan'] });
  };
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'CANCEL' | 'RESTORE' }) => changeOccurrence(id, { action }),
    onSuccess: async (r) => {
      toast.success(r.message);
      await refresh();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteManualOccurrence(id),
    onSuccess: async (r) => {
      toast.success(r.message);
      await refresh();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (data ?? []).filter((o) => !q || o.subject.toLowerCase().includes(q) || o.group.toLowerCase().includes(q));
  }, [data, filter]);

  if (isPending) return <Skeleton className="h-64 w-full" />;
  if (!data || data.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Brak terminow. Uloz wzorzec i uzyj „Generuj terminy”.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Przedmiot albo grupa…" className="w-72" />
        <span className="text-sm text-muted-foreground">{rows.length} terminow</span>
        {!readOnly && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setAdding(true)}>
            <Plus /> Termin reczny (odrobienie)
          </Button>
        )}
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Godziny</TableHead>
              <TableHead>Zajecia</TableHead>
              <TableHead>Grupa</TableHead>
              <TableHead>Sala</TableHead>
              <TableHead>Prowadzacy</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((o) => (
              <TableRow key={o.id} className={o.status === 'CANCELLED' ? 'text-muted-foreground line-through' : undefined}>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {WEEKDAY[new Date(`${o.date}T12:00:00Z`).getUTCDay()]} {o.date}
                  {o.originalDate && o.originalDate !== o.date && (
                    <span className="ml-1 text-xs text-muted-foreground">(z {o.originalDate})</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {formatMinutes(o.startMinute)}–{formatMinutes(o.endMinute)}
                </TableCell>
                <TableCell>
                  {CLASS_LABELS[o.classType]} · {o.subject}
                  {o.kind === 'MANUAL' && <Badge className="ml-2">reczny</Badge>}
                  {o.changed && o.status !== 'CANCELLED' && (
                    <Badge variant="outline" className="ml-2">
                      zmieniony
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">{o.group}</TableCell>
                <TableCell className="whitespace-nowrap">{o.room.label}</TableCell>
                <TableCell>{o.instructor}</TableCell>
                <TableCell>
                  {!readOnly && (
                    <div className="flex justify-end gap-1 no-underline">
                      {o.status !== 'CANCELLED' && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => setEditing(o)}>
                            Przenies
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => act.mutate({ id: o.id, action: 'CANCEL' })}>
                            Odwolaj
                          </Button>
                        </>
                      )}
                      {o.kind === 'DERIVED' && (o.changed || o.status === 'CANCELLED') && (
                        <Button variant="ghost" size="sm" onClick={() => act.mutate({ id: o.id, action: 'RESTORE' })}>
                          Przywroc
                        </Button>
                      )}
                      {o.kind === 'MANUAL' && (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove.mutate(o.id)}>
                          Usun
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing && <MoveDialog occurrence={editing} blocks={blocks} onClose={() => setEditing(null)} onDone={refresh} />}
      {adding && (
        <ManualDialog termKey={termKey} sections={sections} blocks={blocks} onClose={() => setAdding(false)} onDone={refresh} />
      )}
    </div>
  );
}

function useRoomOptions() {
  const { data: buildings } = useQuery({ queryKey: ['buildings'], queryFn: fetchBuildings });
  return (buildings ?? []).flatMap((b) =>
    (b.rooms ?? []).map((r) => ({ value: r.id, label: `${r.number} — ${b.name} (${r.capacity})`, keywords: b.name })),
  );
}

function MoveDialog({
  occurrence,
  blocks,
  onClose,
  onDone,
}: {
  occurrence: OccurrenceRow;
  blocks: TimeBlock[];
  onClose: () => void;
  onDone: () => void;
}) {
  const rooms = useRoomOptions();
  const length = occurrence.endOrder - occurrence.startOrder + 1;
  const [date, setDate] = useState(occurrence.date);
  const [start, setStart] = useState(occurrence.startOrder);
  const [roomId, setRoomId] = useState(occurrence.room.id);
  const [note, setNote] = useState(occurrence.note ?? '');
  const save = useMutation({
    mutationFn: () =>
      changeOccurrence(occurrence.id, { action: 'MODIFY', date, startOrder: start, endOrder: start + length - 1, roomId, note: note || undefined }),
    onSuccess: (r) => {
      toast.success(r.message);
      onDone();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Przenies termin</DialogTitle>
          <DialogDescription>
            {occurrence.subject} · {occurrence.group}. Zmiana dotyczy tylko tego terminu i przetrwa ponowne generowanie.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="mv-date">Data</FieldLabel>
            <Input id="mv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="mv-start">Od</FieldLabel>
            <NativeSelect id="mv-start" value={start} onChange={(e) => setStart(Number(e.target.value))}>
              {blocks.map((b) => (
                <NativeSelectOption key={b.id} value={b.order}>
                  {b.startTime}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field className="col-span-2">
            <FieldLabel htmlFor="mv-room">Sala</FieldLabel>
            <Combobox id="mv-room" options={rooms} value={roomId} onChange={setRoomId} placeholder="Sala" />
          </Field>
          <Field className="col-span-2">
            <FieldLabel htmlFor="mv-note">Uwaga</FieldLabel>
            <Input id="mv-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Spinner />}
            Zapisz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManualDialog({
  termKey,
  sections,
  blocks,
  onClose,
  onDone,
}: {
  termKey: string;
  sections: PlanSection[];
  blocks: TimeBlock[];
  onClose: () => void;
  onDone: () => void;
}) {
  const rooms = useRoomOptions();
  const [sectionId, setSectionId] = useState('');
  const [date, setDate] = useState('');
  const [start, setStart] = useState(blocks[0]?.order ?? 1);
  const [length, setLength] = useState(2);
  const [roomId, setRoomId] = useState('');
  const [note, setNote] = useState('Odrobienie');
  const section = sections.find((s) => s.id === sectionId);
  const save = useMutation({
    mutationFn: () =>
      createManualOccurrence(termKey, {
        sectionId,
        date,
        startOrder: start,
        endOrder: start + length - 1,
        roomId,
        instructorId: section?.instructors.find((i) => i.instructorId)?.instructorId ?? null,
        note,
      }),
    onSuccess: (r) => {
      toast.success(r.message);
      onDone();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Termin reczny</DialogTitle>
          <DialogDescription>Odrobienie albo zajecia jednorazowe — licza sie do godzin i nie znikaja przy generowaniu.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field className="col-span-2">
            <FieldLabel htmlFor="mn-section">Zajecia</FieldLabel>
            <Combobox
              id="mn-section"
              options={sections.map((s) => ({ value: s.id, label: `${s.subject.name} (${CLASS_LABELS[s.classType]}) ${s.group.name}` }))}
              value={sectionId}
              onChange={setSectionId}
              placeholder="Wybierz zajecia"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="mn-date">Data</FieldLabel>
            <Input id="mn-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="mn-start">Od / dlugosc</FieldLabel>
            <div className="flex gap-2">
              <NativeSelect id="mn-start" value={start} onChange={(e) => setStart(Number(e.target.value))}>
                {blocks.map((b) => (
                  <NativeSelectOption key={b.id} value={b.order}>
                    {b.startTime}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect aria-label="Dlugosc" value={length} onChange={(e) => setLength(Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => (
                  <NativeSelectOption key={n} value={n}>
                    {n} h
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </Field>
          <Field className="col-span-2">
            <FieldLabel htmlFor="mn-room">Sala</FieldLabel>
            <Combobox id="mn-room" options={rooms} value={roomId} onChange={setRoomId} placeholder="Sala" />
          </Field>
          <Field className="col-span-2">
            <FieldLabel htmlFor="mn-note">Uwaga</FieldLabel>
            <Input id="mn-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => save.mutate()} disabled={!sectionId || !date || !roomId || save.isPending}>
            {save.isPending && <Spinner />}
            Dodaj
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
