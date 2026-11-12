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
import { fetchMakeups } from '@/api/requests';
import { fetchBuildings } from '@/api/buildings';
import { getErrorMessage, isNotFound, slotWarningsOf } from '@/lib/errors';
import { matchesAllWords } from '@/lib/searchMatch';
import { SlotWarnings } from '@/components/SlotWarnings';
import { CLASS_LABELS } from '@/lib/scheduleDisplay';
import { roomOptionsFor, roomTooSmallMessage, type RoomOption } from '@/lib/roomOptions';
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
  // Odwolanie idzie do prowadzacego (powiadomienie) — najpierw potwierdzenie z powodem.
  const [cancelling, setCancelling] = useState<OccurrenceRow | null>(null);

  const refresh = async () => {
    setRemoving(null);
    setCancelling(null);
    setEditing(null);
    setAdding(false);
    setDetails(null);
    await queryClient.invalidateQueries({ queryKey: ['occurrences'] });
    await queryClient.invalidateQueries({ queryKey: ['plan'] });
    // Odwolanie/odrobienie zmienia liste "Do odrobienia" (okno terminu recznego, Zgloszenia zmian).
    await queryClient.invalidateQueries({ queryKey: ['makeups'] });
  };
  // Termin zniknal w miedzyczasie (ponowne generowanie, usuniecie przez kogos innego).
  const termGone = () => {
    toast.info('Termin zniknal w miedzyczasie (np. terminy wygenerowano od nowa) — lista odswiezona');
    void refresh();
  };
  const act = useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: 'CANCEL' | 'RESTORE'; note?: string }) => changeOccurrence(id, { action, note }),
    onSuccess: async (r) => {
      toast.success(r.message);
      await refresh();
    },
    onError: (e) => (isNotFound(e) ? termGone() : toast.error(getErrorMessage(e))),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteManualOccurrence(id),
    onSuccess: async (r) => {
      toast.success(r.message);
      await refresh();
    },
    onError: (e) => (isNotFound(e) ? termGone() : toast.error(getErrorMessage(e))),
  });

  const rows = useMemo(() => {
    const q = filter.trim();
    return (data ?? []).filter((o) => !q || matchesAllWords(`${o.subject} ${o.group} ${o.instructor} ${o.room.label}`, q));
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
                    {o.makeupOf && (
                      <Badge variant="outline" className="ml-2">
                        odrobienie za {formatDayMonth(o.makeupOf)}
                      </Badge>
                    )}
                    {o.madeUpBy && (
                      <Badge variant="outline" className="ml-2">
                        odrobione {formatDayMonth(o.madeUpBy.date)}
                      </Badge>
                    )}
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
                            <Button variant="ghost" size="sm" onClick={() => setCancelling(o)}>
                              Odwolaj
                            </Button>
                          </>
                        )}
                        {o.kind === 'DERIVED' && o.placementId && (o.changed || o.status === 'CANCELLED') && !o.madeUpBy && (
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
              {details.makeupOf && (
                <>
                  <dt className="text-muted-foreground">Odrabia zajecia</dt>
                  <dd>z {formatDayMonth(details.makeupOf)}</dd>
                </>
              )}
              {details.madeUpBy && (
                <>
                  <dt className="text-muted-foreground">Odrobione</dt>
                  <dd>
                    {formatDayMonth(details.madeUpBy.date)}, {formatMinutes(details.madeUpBy.startMinute)}–{formatMinutes(details.madeUpBy.endMinute)} — zeby
                    przywrocic ten termin, najpierw usun albo odwolaj odrobienie
                  </dd>
                </>
              )}
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
                    <Button
                      variant="outline"
                      onClick={() => {
                        setCancelling(details);
                        setDetails(null);
                      }}
                    >
                      Odwolaj
                    </Button>
                  </>
                )}
                {details.kind === 'DERIVED' && details.placementId && (details.changed || details.status === 'CANCELLED') && !details.madeUpBy && (
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
      {cancelling && (
        <CancelDialog
          occurrence={cancelling}
          isPending={act.isPending}
          onClose={() => setCancelling(null)}
          onConfirm={(note) => act.mutate({ id: cancelling.id, action: 'CANCEL', note })}
        />
      )}
      {editing && (
        <MoveDialog
          termKey={termKey}
          occurrence={editing}
          section={sections.find((s) => s.id === editing.sectionId)}
          blocks={blocks}
          onClose={() => setEditing(null)}
          onDone={refresh}
        />
      )}
      {adding && (
        <ManualDialog termKey={termKey} sections={sections} blocks={blocks} onClose={() => setAdding(false)} onDone={refresh} />
      )}
    </div>
  );
}

/** Sale pasujace do formy zajec, za male dla grupy z dopiskiem (lib/roomOptions). */
function useRoomOptions(section: PlanSection | undefined) {
  const { data: buildings } = useQuery({ queryKey: ['buildings'], queryFn: fetchBuildings });
  return useMemo(() => roomOptionsFor(buildings ?? [], section?.classType, section?.group.size ?? 0), [buildings, section]);
}

function RoomSizeNote({ rooms, roomId, section }: { rooms: RoomOption[]; roomId: string; section: PlanSection | undefined }) {
  const message = roomTooSmallMessage(rooms.find((r) => r.value === roomId), section?.group.size ?? 0);
  return message ? <p className="text-xs text-amber-700 dark:text-amber-400">{message}</p> : null;
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
  section,
  blocks,
  onClose,
  onDone,
}: {
  termKey: string;
  occurrence: OccurrenceRow;
  section: PlanSection | undefined;
  blocks: TimeBlock[];
  onClose: () => void;
  onDone: () => void;
}) {
  const rooms = useRoomOptions(section);
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
      else if (isNotFound(e)) {
        toast.info('Termin zniknal w miedzyczasie (np. terminy wygenerowano od nowa) — lista odswiezona');
        onDone();
      } else toast.error(getErrorMessage(e));
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
            {!online && <RoomSizeNote rooms={rooms} roomId={roomId} section={section} />}
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
  const [sectionId, setSectionId] = useState('');
  const [date, setDate] = useState('');
  const [start, setStart] = useState(blocks[0]?.order ?? 1);
  const [length, setLength] = useState(2);
  const [roomId, setRoomId] = useState('');
  const [online, setOnline] = useState(false);
  // null = nie ruszana: domyslna wynika z wyboru odrabianych zajec (jak notatka odrobienia ze zgloszenia).
  const [note, setNote] = useState<string | null>(null);
  const section = sections.find((s) => s.id === sectionId);
  const rooms = useRoomOptions(section);
  // Odwolane, jeszcze nieodrobione terminy tych zajec — odrobienie wskazuje, ktory odrabia
  // (inaczej zostaje na liscie "Do odrobienia" na zawsze). Domyslnie pierwszy z nich.
  const { data: makeups } = useQuery({ queryKey: ['makeups', termKey, 'manual'], queryFn: () => fetchMakeups(termKey) });
  const toMakeUp = (makeups ?? []).filter((m) => m.sectionId === sectionId && m.state === 'TODO');
  const [makeupChoice, setMakeupChoice] = useState<{ sectionId: string; key: string } | null>(null);
  const makeupKey = makeupChoice?.sectionId === sectionId ? makeupChoice.key : (toMakeUp[0]?.key ?? '');
  const madeUp = toMakeUp.find((m) => m.key === makeupKey);
  const noteValue = note ?? (madeUp ? `Odrobienie zajec z ${formatDayMonth(madeUp.date)} ${madeUp.time}` : 'Zajecia dodatkowe');
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
        // Odrobienie: prowadzacy z odwolanych zajec (dobiera serwer); zajecia dodatkowe — pierwszy z obsady.
        ...(makeupKey ? { makeupOfKey: makeupKey } : { instructorId: section?.instructors.find((i) => i.instructorId)?.instructorId ?? null }),
        note: noteValue.trim() || undefined,
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
          {toMakeUp.length > 0 && (
            <Field className="col-span-2">
              <FieldLabel htmlFor="mn-makeup">Odrabia zajecia z</FieldLabel>
              <NativeSelect
                id="mn-makeup"
                value={makeupKey}
                onChange={(e) => {
                  setMakeupChoice({ sectionId, key: e.target.value });
                  const row = toMakeUp.find((m) => m.key === e.target.value);
                  if (row) setLength(Math.min(4, row.hours));
                }}
              >
                {toMakeUp.map((m) => (
                  <NativeSelectOption key={m.key} value={m.key}>
                    {m.date} {m.time} (odwolane{m.note ? `: ${m.note}` : ''})
                  </NativeSelectOption>
                ))}
                <NativeSelectOption value="">— nic, to zajecia dodatkowe</NativeSelectOption>
              </NativeSelect>
            </Field>
          )}
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
            {!online && <RoomSizeNote rooms={rooms} roomId={roomId} section={section} />}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={online} onCheckedChange={(v) => setOnline(v === true)} />
              Zajecia online (bez sali)
            </label>
          </Field>
          <Field className="col-span-2">
            <FieldLabel htmlFor="mn-note">Uwaga</FieldLabel>
            <Input id="mn-note" value={noteValue} onChange={(e) => setNote(e.target.value)} />
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

/** Potwierdzenie odwolania terminu z powodem — prowadzacy dostaje go w powiadomieniu. */
function CancelDialog({
  occurrence,
  isPending,
  onClose,
  onConfirm,
}: {
  occurrence: OccurrenceRow;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (note: string | undefined) => void;
}) {
  const [note, setNote] = useState('');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Odwolac zajecia?</DialogTitle>
          <DialogDescription>
            {CLASS_LABELS[occurrence.classType]} · {occurrence.subject} · {occurrence.group}, {formatDayMonth(occurrence.date)}{' '}
            {formatMinutes(occurrence.startMinute)}–{formatMinutes(occurrence.endMinute)}. Zajecia trafia na liste do odrobienia, a prowadzacy — gdy
            plan jest opublikowany — dostanie powiadomienie z powodem.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="cn-note">Powod (opcjonalnie)</FieldLabel>
          <Input id="cn-note" value={note} placeholder="np. choroba prowadzacego" onChange={(e) => setNote(e.target.value)} autoFocus />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Anuluj
          </Button>
          <Button variant="destructive" disabled={isPending} onClick={() => onConfirm(note.trim() || undefined)}>
            {isPending && <Spinner />}
            Odwolaj zajecia
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
