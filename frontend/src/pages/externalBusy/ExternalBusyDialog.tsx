import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarPlus, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Combobox, type ComboboxOption } from '@/components/Combobox';
import { createExternalBusy, updateExternalBusy, type ExternalBusy, type ExternalBusyInput } from '@/api/externalBusy';
import { fetchBuildings } from '@/api/buildings';
import { useInstructorOptions } from '@/hooks/useInstructorOptions';
import { getErrorMessage } from '@/lib/errors';
import { mergeDates, shortDate, todayKey, weeklyDates } from '@/lib/externalBusy';
import { WEEKDAY_LABELS, WEEKDAYS } from '@/lib/labels';
import { roomOptionsFor } from '@/lib/roomOptions';
import { formatMinutes } from '@/lib/timeGrid';
import type { DayOfWeek } from '@/types';

/** Combobox nie ma pustej wartosci — wartownik "bez prowadzacego / bez sali". */
const NONE = '__none__';
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const schema = z
  .object({
    source: z.string().trim().min(1, 'Podaj, kto zglosil (np. „WE – dziekanat”)').max(200),
    receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Podaj date zgloszenia'),
    instructorId: z.string(),
    roomId: z.string(),
    startTime: z.string().regex(TIME, 'Godzina GG:MM'),
    endTime: z.string().regex(TIME, 'Godzina GG:MM'),
    dates: z.array(z.string()).min(1, 'Dodaj co najmniej jedna date'),
    note: z.string().max(500),
  })
  .refine((v) => v.instructorId !== NONE || v.roomId !== NONE, { path: ['instructorId'], message: 'Wskaz prowadzacego albo sale (albo oba)' })
  .refine((v) => !TIME.test(v.startTime) || !TIME.test(v.endTime) || v.endTime > v.startTime, {
    path: ['endTime'],
    message: 'Koniec musi byc pozniej niz poczatek',
  });

type Values = z.infer<typeof schema>;

interface Props {
  termKey: string;
  entry: ExternalBusy | null;
  /** Zrodla juz wpisanych zgloszen — podpowiedzi pola "Kto zglosil". */
  sources: string[];
  onClose: () => void;
}

/** Dodawanie i edycja zajetosci zewnetrznej — okno montowane przy otwarciu (formularz od wartosci wpisu). */
export function ExternalBusyDialog({ termKey, entry, sources, onClose }: Props) {
  const queryClient = useQueryClient();
  const { options: instructorOptions } = useInstructorOptions(false);
  const { data: buildings } = useQuery({ queryKey: ['buildings'], queryFn: fetchBuildings });
  const roomOptions = useMemo<ComboboxOption[]>(
    () => [{ value: NONE, label: '— bez sali —' }, ...roomOptionsFor(buildings ?? [])],
    [buildings],
  );
  const instructorChoices = useMemo<ComboboxOption[]>(
    () => [{ value: NONE, label: '— bez prowadzacego —' }, ...instructorOptions],
    [instructorOptions],
  );

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      source: entry?.source ?? '',
      receivedOn: entry?.receivedOn ?? todayKey(),
      instructorId: entry?.instructor?.id ?? NONE,
      roomId: entry?.room?.id ?? NONE,
      startTime: entry ? formatMinutes(entry.startMinute) : '',
      endTime: entry ? formatMinutes(entry.endMinute) : '',
      dates: entry?.dates ?? [],
      note: entry?.note ?? '',
    },
  });
  const errors = form.formState.errors;

  const save = useMutation({
    mutationFn: (values: Values) => {
      const input: ExternalBusyInput = {
        source: values.source,
        receivedOn: values.receivedOn,
        instructorId: values.instructorId === NONE ? null : values.instructorId,
        roomId: values.roomId === NONE ? null : values.roomId,
        startTime: values.startTime,
        endTime: values.endTime,
        dates: values.dates,
        note: values.note.trim() || null,
      };
      return entry ? updateExternalBusy(entry.id, input) : createExternalBusy(termKey, input);
    },
    onSuccess: (result) => {
      // Kolizja z ulozonym planem nie blokuje zapisu (zajecia innego wydzialu sa faktem) — ostrzegamy.
      if (result.data.clashes.length > 0) toast.warning(result.message, { duration: 10_000 });
      else toast.success(result.message);
      void queryClient.invalidateQueries({ queryKey: ['external-busy', termKey] });
      // Zajetosc zmienia podpowiedz wolnych godzin i kolizje w ukladaniu planu.
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
      onClose();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{entry ? 'Edytuj zajetosc zewnetrzna' : 'Nowa zajetosc zewnetrzna'}</DialogTitle>
          <DialogDescription>
            Zajecia prowadzacego albo sali na innym wydziale — wg zgloszenia mailowego. Godziny podaj tak, jak w zgloszeniu
            (inne wydzialy maja inne siatki), a daty konkretnie.
          </DialogDescription>
        </DialogHeader>

        <form id="external-busy-form" onSubmit={form.handleSubmit((values) => save.mutate(values))} noValidate>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
              <Field>
                <FieldLabel htmlFor="eb-source">Kto zglosil</FieldLabel>
                <Input id="eb-source" list="eb-sources" placeholder="WE – dziekanat" aria-invalid={!!errors.source} {...form.register('source')} />
                <datalist id="eb-sources">
                  {sources.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <FieldError errors={[errors.source]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="eb-received">Stan na</FieldLabel>
                <Input id="eb-received" type="date" aria-invalid={!!errors.receivedOn} {...form.register('receivedOn')} />
                <FieldError errors={[errors.receivedOn]} />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="eb-instructor">Prowadzacy</FieldLabel>
                <Controller
                  control={form.control}
                  name="instructorId"
                  render={({ field }) => (
                    <Combobox
                      id="eb-instructor"
                      options={instructorChoices}
                      value={field.value}
                      onChange={field.onChange}
                      searchPlaceholder="Szukaj po nazwisku lub e-mailu…"
                      invalid={!!errors.instructorId}
                    />
                  )}
                />
                <FieldError errors={[errors.instructorId]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="eb-room">Sala</FieldLabel>
                <Controller
                  control={form.control}
                  name="roomId"
                  render={({ field }) => (
                    <Combobox id="eb-room" options={roomOptions} value={field.value} onChange={field.onChange} searchPlaceholder="Szukaj sali…" />
                  )}
                />
                <FieldDescription>Tylko gdy zajecia sa w sali, ktora planujecie.</FieldDescription>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:w-1/2">
              <Field>
                <FieldLabel htmlFor="eb-start">Od</FieldLabel>
                <Input id="eb-start" type="time" aria-invalid={!!errors.startTime} {...form.register('startTime')} />
                <FieldError errors={[errors.startTime]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="eb-end">Do</FieldLabel>
                <Input id="eb-end" type="time" aria-invalid={!!errors.endTime} {...form.register('endTime')} />
                <FieldError errors={[errors.endTime]} />
              </Field>
            </div>

            <Controller
              control={form.control}
              name="dates"
              render={({ field }) => <DatesEditor value={field.value} onChange={field.onChange} invalid={!!errors.dates} />}
            />
            <FieldError errors={[errors.dates]} />

            <Field>
              <FieldLabel htmlFor="eb-note">Uwagi</FieldLabel>
              <Input id="eb-note" placeholder="np. wyklad dla WE, sem. 3" {...form.register('note')} />
            </Field>
          </FieldGroup>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button type="submit" form="external-busy-form" disabled={save.isPending}>
            {save.isPending && <Spinner />}
            {entry ? 'Zapisz zmiany' : 'Dodaj'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Daty zajetosci: seria "dzien tygodnia od–do co 1/2 tygodnie" (stacjonarne) albo pojedyncze
 * daty (zjazdy innego wydzialu). Wybrane daty jako znaczniki do usuniecia.
 */
function DatesEditor({ value, onChange, invalid }: { value: string[]; onChange: (dates: string[]) => void; invalid: boolean }) {
  const [day, setDay] = useState<DayOfWeek>('MONDAY');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [every, setEvery] = useState('1');
  const [single, setSingle] = useState('');
  const series = weeklyDates(day, from, to, Number(every));

  return (
    <Field>
      <FieldLabel>Daty</FieldLabel>
      <div className="space-y-3 rounded-md border p-3" aria-invalid={invalid}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Dzien</span>
            <Select value={day} onValueChange={(v) => setDay(v as DayOfWeek)}>
              <SelectTrigger className="w-36" aria-label="Dzien tygodnia">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {WEEKDAY_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">od</span>
            <Input type="date" className="w-40" aria-label="Od dnia" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">do</span>
            <Input type="date" className="w-40" aria-label="Do dnia" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">co</span>
            <Select value={every} onValueChange={setEvery}>
              <SelectTrigger className="w-32" aria-label="Co ile tygodni">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">tydzien</SelectItem>
                <SelectItem value="2">2 tygodnie</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="secondary" disabled={series.length === 0} onClick={() => onChange(mergeDates(value, series))}>
            <CalendarPlus />
            Dodaj {series.length > 0 ? `(${series.length})` : ''}
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">pojedyncza data</span>
            <Input type="date" className="w-40" aria-label="Pojedyncza data" value={single} onChange={(e) => setSingle(e.target.value)} />
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={!single}
            onClick={() => {
              onChange(mergeDates(value, [single]));
              setSingle('');
            }}
          >
            <Plus />
            Dodaj date
          </Button>
          {value.length > 0 && (
            <Button type="button" variant="ghost" className="ml-auto" onClick={() => onChange([])}>
              Wyczysc ({value.length})
            </Button>
          )}
        </div>

        {value.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {value.map((d) => (
              <Badge key={d} variant="secondary" className="gap-1 pr-1 tabular-nums">
                {shortDate(d)}
                <button
                  type="button"
                  className="rounded-sm opacity-60 hover:opacity-100"
                  aria-label={`Usun date ${shortDate(d)}`}
                  onClick={() => onChange(value.filter((x) => x !== d))}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Brak dat — dodaj serie tygodniowa albo pojedyncze daty (np. dni zjazdow).</p>
        )}
      </div>
    </Field>
  );
}
