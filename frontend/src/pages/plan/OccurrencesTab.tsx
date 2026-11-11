import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarDays, Inbox, List, Plus } from 'lucide-react';
import { toast } from 'sonner';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Combobox } from '@/components/Combobox';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { changeOccurrence, createManualOccurrence, deleteManualOccurrence, fetchOccurrences } from '@/api/plan';
import { fetchBuildings } from '@/api/buildings';
import { getErrorMessage, slotWarningsOf } from '@/lib/errors';
import { SlotWarnings } from '@/components/SlotWarnings';
import { CLASS_LABELS } from '@/lib/scheduleDisplay';
import { formatMinutes } from '@/lib/timeGrid';
import { formatDayMonth } from '@/lib/planHours';
import { occurrenceMarker } from '@/lib/occurrenceWeek';
import { REQUEST_KIND_LABELS } from '@/lib/requestLabels';
import type { CalendarPeriod, DayOfWeek, OccurrenceRow, PlanSection, TimeBlock } from '@/types';
import { OccurrencesWeek } from './OccurrencesWeek';

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
  periods,
  modeDays,
}: {
  termKey: string;
  cohortId: string;
  sections: PlanSection[];
  blocks: TimeBlock[];
  readOnly: boolean;
  /** Tygodnie albo zjazdy kalendarza rocznika — nawigacja widoku tygodnia. */
  periods: CalendarPeriod[];
  /** Dni zajec siatki godzin rocznika (kolumny siatki). */
  modeDays: DayOfWeek[];
}) {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ['occurrences', termKey, cohortId],
    queryFn: () => fetchOccurrences(termKey, cohortId),
  });
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<OccurrenceRow | null>(null);
  const [adding, setAdding] = useState(false);
  // Widok tygodnia (siatka jak wzorzec, z datami) albo lista wszystkich terminow semestru.
  const [view, setView] = useState<'week' | 'list'>('week');
  const [details, setDetails] = useState<OccurrenceRow | null>(null);
  const [removing, setRemoving] = useState<OccurrenceRow | null>(null);

  const refresh = async () => {
    setRemoving(null);
    setEditing(null);
    setAdding(false);
    setDetails(null);
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
        <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Widok terminow">
          <Button size="sm" variant={view === 'week' ? 'secondary' : 'ghost'} aria-pressed={view === 'week'} onClick={() => setView('week')}>
            <CalendarDays /> Tydzien
          </Button>
          <Button size="sm" variant={view === 'list' ? 'secondary' : 'ghost'} aria-pressed={view === 'list'} onClick={() => setView('list')}>
            <List /> Lista
          </Button>
        </div>
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Przedmiot albo grupa…" className="w-72" />
        {view === 'list' && <span className="text-sm text-muted-foreground">{rows.length} terminow</span>}
        {!readOnly && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setAdding(true)}>
            <Plus /> Termin reczny (odrobienie)
          </Button>
        )}
      </div>
      {view === 'week' && (
        <OccurrencesWeek periods={periods} modeDays={modeDays} blocks={blocks} occurrences={rows} onSelect={setDetails} />
      )}
      {view === 'list' && (
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
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRemoving(o)}>
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
      )}
      {details && (
        <Dialog open onOpenChange={(open) => !open && setDetails(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {CLASS_LABELS[details.classType]} · {details.subject}
              </DialogTitle>
              <DialogDescription>
                {WEEKDAY[new Date(`${details.date}T12:00:00Z`).getUTCDay()]} {formatDayMonth(details.date)}, {formatMinutes(details.startMinute)}–{formatMinutes(details.endMinute)}
                {occurrenceMarker(details) && ` · ${occurrenceMarker(details)}`}
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Grupa</dt>
              <dd>{details.group}</dd>
              <dt className="text-muted-foreground">Sala</dt>
              <dd>{details.room.label}</dd>
              <dt className="text-muted-foreground">Prowadzacy</dt>
              <dd>{details.instructor}</dd>
              {details.note && (
                <>
                  <dt className="text-muted-foreground">Uwaga</dt>
                  <dd>{details.note}</dd>
                </>
              )}
            </dl>
            {details.pendingRequest && <PendingRequestNote request={details.pendingRequest} termKey={termKey} />}
            {!readOnly && (
              <DialogFooter className="sm:justify-start">
                {details.status !== 'CANCELLED' && (
                  <>
                    <Button
                      onClick={() => {
                        setEditing(details);
                        setDetails(null);
                      }}
                    >
                      Przenies
                    </Button>
                    <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate({ id: details.id, action: 'CANCEL' })}>
                      Odwolaj
                    </Button>
                  </>
                )}
                {details.kind === 'DERIVED' && (details.changed || details.status === 'CANCELLED') && (
                  <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate({ id: details.id, action: 'RESTORE' })}>
                    Przywroc wg wzorca
                  </Button>
                )}
                {details.kind === 'MANUAL' && (
                  <Button variant="outline" className="text-destructive" onClick={() => {
                      setRemoving(details);
                      setDetails(null);
                    }}
                  >
                    Usun termin reczny
                  </Button>
                )}
              </DialogFooter>
            )}
          </DialogContent>
        </Dialog>
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Usunac termin reczny?"
        description={
          removing
            ? `${removing.subject} · ${removing.group}, ${formatDayMonth(removing.date)} ${formatMinutes(removing.startMinute)}–${formatMinutes(removing.endMinute)}. Terminu recznego nie da sie przywrocic — trzeba go dodac od nowa.`
            : ''
        }
        isPending={remove.isPending}
        onConfirm={() => remove.mutate(removing!.id)}
      />
      {editing && <MoveDialog termKey={termKey} occurrence={editing} blocks={blocks} onClose={() => setEditing(null)} onDone={refresh} />}
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

/** Ostrzezenie przy zmianie terminu, dla ktorego prowadzacy ma zgloszenie czekajace na decyzje. */
function PendingRequestNote({ request, termKey }: { request: NonNullable<OccurrenceRow['pendingRequest']>; termKey: string }) {
  return (
    <Alert>
      <Inbox />
      <AlertTitle>
        Zgloszenie prowadzacego ({request.instructor}): {REQUEST_KIND_LABELS[request.kind].toLowerCase()}
        {request.proposal && ` na ${request.proposal}`}
      </AlertTitle>
      <AlertDescription>
        <p>
          Zmiana wprost zamknie zgloszenie — jako zalatwione, gdy jest zgodna z prosba, inaczej jako nieaktualne — a prowadzacy dostanie
          powiadomienie.{' '}
          <Link to={`/requests/${termKey}`} className="font-medium underline underline-offset-4">
            Rozpatrz w „Zgloszeniach zmian”
          </Link>
        </p>
      </AlertDescription>
    </Alert>
  );
}

function MoveDialog({
  termKey,
  occurrence,
  blocks,
  onClose,
  onDone,
}: {
  termKey: string;
  occurrence: OccurrenceRow;
  blocks: TimeBlock[];
  onClose: () => void;
  onDone: () => void;
}) {
  const rooms = useRoomOptions();
  const length = occurrence.endOrder - occurrence.startOrder + 1;
  const [date, setDate] = useState(occurrence.date);
  const [start, setStart] = useState(occurrence.startOrder);
  const [roomId, setRoomId] = useState(occurrence.room.id ?? '');
  const [online, setOnline] = useState(occurrence.room.id === null);
  const [note, setNote] = useState(occurrence.note ?? '');
  // Ostrzezenia dotycza konkretnej daty i godzin — po ich zmianie trzeba je zobaczyc od nowa.
  const slotKey = `${date}|${start}`;
  const [warned, setWarned] = useState<{ key: string; warnings: string[] } | null>(null);
  const warnings = warned?.key === slotKey ? warned.warnings : null;
  const save = useMutation({
    mutationFn: () =>
      changeOccurrence(occurrence.id, {
        action: 'MODIFY',
        date,
        startOrder: start,
        endOrder: start + length - 1,
        ...(online ? { online: true } : { roomId, online: false }),
        note: note || undefined,
        confirmWarnings: warnings !== null,
      }),
    onSuccess: (r) => {
      toast.success(r.message);
      onDone();
    },
    onError: (e) => {
      const list = slotWarningsOf(e);
      if (list) setWarned({ key: slotKey, warnings: list });
      else toast.error(getErrorMessage(e));
    },
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
        {occurrence.pendingRequest && <PendingRequestNote request={occurrence.pendingRequest} termKey={termKey} />}
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
            {!online && <Combobox id="mv-room" options={rooms} value={roomId} onChange={setRoomId} placeholder="Sala" />}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={online} onCheckedChange={(v) => setOnline(v === true)} />
              Zajecia online (bez sali)
            </label>
          </Field>
          <Field className="col-span-2">
            <FieldLabel htmlFor="mv-note">Uwaga</FieldLabel>
            <Input id="mv-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        {warnings && <SlotWarnings warnings={warnings} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || (!online && !roomId)}>
            {save.isPending && <Spinner />}
            {warnings ? 'Zapisz mimo to' : 'Zapisz'}
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
  const [online, setOnline] = useState(false);
  const [note, setNote] = useState('Odrobienie');
  const section = sections.find((s) => s.id === sectionId);
  const slotKey = `${sectionId}|${date}|${start}|${length}`;
  const [warned, setWarned] = useState<{ key: string; warnings: string[] } | null>(null);
  const warnings = warned?.key === slotKey ? warned.warnings : null;
  const save = useMutation({
    mutationFn: () =>
      createManualOccurrence(termKey, {
        sectionId,
        date,
        startOrder: start,
        endOrder: start + length - 1,
        roomId: online ? null : roomId,
        online,
        instructorId: section?.instructors.find((i) => i.instructorId)?.instructorId ?? null,
        note,
        confirmWarnings: warnings !== null,
      }),
    onSuccess: (r) => {
      toast.success(r.message);
      onDone();
    },
    onError: (e) => {
      const list = slotWarningsOf(e);
      if (list) setWarned({ key: slotKey, warnings: list });
      else toast.error(getErrorMessage(e));
    },
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
            {!online && <Combobox id="mn-room" options={rooms} value={roomId} onChange={setRoomId} placeholder="Sala" />}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={online} onCheckedChange={(v) => setOnline(v === true)} />
              Zajecia online (bez sali)
            </label>
          </Field>
          <Field className="col-span-2">
            <FieldLabel htmlFor="mn-note">Uwaga</FieldLabel>
            <Input id="mn-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        {warnings && <SlotWarnings warnings={warnings} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => save.mutate()} disabled={!sectionId || !date || (!online && !roomId) || save.isPending}>
            {save.isPending && <Spinner />}
            {warnings ? 'Dodaj mimo to' : 'Dodaj'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
