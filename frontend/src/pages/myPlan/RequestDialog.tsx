import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/Combobox';
import { fetchBuildings } from '@/api/buildings';
import { roomOptionsFor, roomTooSmallMessage } from '@/lib/roomOptions';
import { createChangeRequest, fetchRequestOptions } from '@/api/requests';
import { getErrorMessage } from '@/lib/errors';
import { WEEKDAY_LABELS } from '@/lib/labels';
import { formatDate, REQUEST_KIND_LABELS } from '@/lib/requestLabels';
import type { ChangeRequestKind } from '@/types';

type RoomMode = 'same' | 'other' | 'online';

const KIND_HINT: Record<ChangeRequestKind, string> = {
  CANCEL: 'Dziekanat odwola zajecia; trafia one na Twoja liste do odrobienia.',
  MOVE: 'Zaproponuj nowy termin — dziekanat sprawdzi go i zatwierdzi albo zaproponuje inny.',
  MAKEUP: 'Zaproponuj termin odrobienia odwolanych zajec.',
};

/**
 * Zgloszenie prowadzacego do dziekanatu: odwolanie, przeniesienie albo odrobienie terminu.
 * Niczego nie zmienia w planie — zmiane wprowadza dziekanat po zatwierdzeniu. Proponowany
 * termin serwer sprawdza od razu (dzien zajec, siatka godzin, kolizje) i mowi, co jest nie tak.
 */
export function RequestDialog({ occurrenceId, onClose }: { occurrenceId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: options, isPending, error } = useQuery({
    queryKey: ['request-options', occurrenceId],
    queryFn: () => fetchRequestOptions(occurrenceId),
  });
  const [kind, setKind] = useState<ChangeRequestKind | null>(null);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  const [start, setStart] = useState<number | null>(null);
  // Dlugosc = dlugosc terminu (bloki siatki); nie do zmiany w zgloszeniu.
  const [length, setLength] = useState(1);
  const [roomMode, setRoomMode] = useState<RoomMode>('same');
  const [roomId, setRoomId] = useState('');

  // Domyslne wartosci z terminu: pierwszy dozwolony rodzaj, te same godziny i dlugosc.
  useEffect(() => {
    if (!options) return;
    setKind((k) => k ?? options.kinds[0] ?? null);
    setStart((s) => s ?? options.occurrence.startOrder);
    setLength(options.occurrence.endOrder - options.occurrence.startOrder + 1);
    setRoomMode(options.occurrence.roomId ? 'same' : 'online');
  }, [options]);

  const needsSlot = kind === 'MOVE' || kind === 'MAKEUP';
  const { data: buildings } = useQuery({ queryKey: ['buildings'], queryFn: fetchBuildings, enabled: needsSlot && roomMode === 'other' });
  // Tylko sale pasujace do formy zajec; za male dla grupy — z dopiskiem (lib/roomOptions).
  const roomOptions = useMemo(
    () => roomOptionsFor(buildings ?? [], options?.occurrence.classType, options?.occurrence.groupSize ?? 0),
    [buildings, options],
  );
  const roomNote = roomTooSmallMessage(roomOptions.find((r) => r.value === roomId), options?.occurrence.groupSize ?? 0);

  const send = useMutation({
    mutationFn: () => {
      const o = options!.occurrence;
      const room =
        roomMode === 'online' ? { online: true } : { online: false, roomId: roomMode === 'same' ? o.roomId : roomId || null };
      return createChangeRequest(occurrenceId, {
        kind: kind!,
        reason: reason.trim(),
        ...(needsSlot ? { date, startOrder: start!, endOrder: start! + length - 1, ...room } : {}),
      });
    },
    onSuccess: (r) => {
      toast.success(r.message);
      for (const key of ['my-plan', 'requests', 'makeups', 'request-options']) void queryClient.invalidateQueries({ queryKey: [key] });
      onClose();
    },
    onError: (e) => toast.error(getErrorMessage(e), { duration: 10000 }),
  });

  const o = options?.occurrence;
  const blocks = options?.blocks ?? [];
  const lastOrder = blocks.length ? blocks[blocks.length - 1]!.order : 0;
  const canSend =
    !!kind &&
    reason.trim().length >= 3 &&
    (!needsSlot || (!!date && start !== null && start + length - 1 <= lastOrder && (roomMode !== 'other' || !!roomId)));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Zgloszenie do dziekanatu</DialogTitle>
          <DialogDescription>
            {o ? `${o.subject} (${o.classLabel}) · ${o.group} · ${formatDate(o.date)}` : error ? 'Zgloszenie niedostepne' : 'Wczytuje termin…'}
          </DialogDescription>
        </DialogHeader>

        {isPending && <Skeleton className="h-40 w-full" />}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{getErrorMessage(error)}</AlertDescription>
          </Alert>
        )}
        {options && options.kinds.length === 0 && (
          <Alert>
            <AlertDescription>{options.reason}</AlertDescription>
          </Alert>
        )}

        {options && options.kinds.length > 0 && (
          <div className="space-y-4">
            {options.kinds.length > 1 && (
              <div className="flex gap-2" role="group" aria-label="Rodzaj zgloszenia">
                {options.kinds.map((k) => (
                  <Button key={k} type="button" size="sm" variant={kind === k ? 'secondary' : 'outline'} aria-pressed={kind === k} onClick={() => setKind(k)}>
                    {REQUEST_KIND_LABELS[k]}
                  </Button>
                ))}
              </div>
            )}
            {kind && <p className="text-sm text-muted-foreground">{KIND_HINT[kind]}</p>}

            {needsSlot && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field className="sm:col-span-3">
                  <FieldLabel htmlFor="rq-date">Data</FieldLabel>
                  <Input id="rq-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Dni zajec: {options.days.map((d) => WEEKDAY_LABELS[d].toLowerCase()).join(', ')}.</p>
                </Field>
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor="rq-start">Od</FieldLabel>
                  <NativeSelect id="rq-start" value={start ?? ''} onChange={(e) => setStart(Number(e.target.value))}>
                    {blocks.map((b) => (
                      <NativeSelectOption key={b.order} value={b.order}>
                        {b.startTime}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="rq-len">Dlugosc</FieldLabel>
                  {/* Przeniesienie i odrobienie maja dlugosc oryginalu — krotszy termin gubilby godziny zajec. */}
                  <Input id="rq-len" value={`${length} h`} disabled title="Tyle, ile trwaja zajecia w planie" />
                </Field>
                <Field className="sm:col-span-3">
                  <FieldLabel htmlFor="rq-room">Sala</FieldLabel>
                  <NativeSelect id="rq-room" value={roomMode} onChange={(e) => setRoomMode(e.target.value as RoomMode)}>
                    {o?.roomId && <NativeSelectOption value="same">Ta sama sala</NativeSelectOption>}
                    <NativeSelectOption value="other">Inna sala</NativeSelectOption>
                    <NativeSelectOption value="online">Zajecia online (bez sali)</NativeSelectOption>
                  </NativeSelect>
                  {roomMode === 'other' && (
                    <>
                      <Combobox options={roomOptions} value={roomId} onChange={setRoomId} placeholder="Wybierz sale" searchPlaceholder="Numer, budynek…" />
                      {roomNote && <p className="text-xs text-amber-700 dark:text-amber-400">{roomNote}</p>}
                    </>
                  )}
                </Field>
              </div>
            )}

            <Field>
              <FieldLabel htmlFor="rq-reason">Powod</FieldLabel>
              <Textarea
                id="rq-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={kind === 'MAKEUP' ? 'np. odrobienie zajec odwolanych z powodu konferencji' : 'np. udzial w konferencji naukowej'}
                rows={3}
              />
            </Field>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          {options && options.kinds.length > 0 && (
            <Button onClick={() => send.mutate()} disabled={!canSend || send.isPending}>
              {send.isPending ? <Spinner /> : <Send />} Wyslij zgloszenie
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
