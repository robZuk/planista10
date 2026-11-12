import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarPlus, Info, Plus, Trash2, TriangleAlert, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { createTermCalendar, fetchCalendarUsage, previewTermCalendar, updateTermCalendar } from '@/api/terms';
import { fetchTimeGrids } from '@/api/timeGrids';
import { getErrorMessage } from '@/lib/errors';
import {
  CALENDAR_DAY_KIND_LABELS,
  CALENDAR_DAY_KINDS,
  CALENDAR_KIND_LABELS,
  STUDY_MODE_LABELS,
  WEEKDAY_LABELS,
  WEEKDAYS,
} from '@/lib/labels';
import type {
  AcademicTerm,
  CalendarBody,
  CalendarDayKind,
  CalendarKind,
  CalendarProposal,
  DayOfWeek,
  StudyMode,
  TermCalendar,
} from '@/types';
import { CalendarPreviewPanel } from './CalendarPreviewPanel';
import { addDaysKey, proposalNote, useDebouncedValue } from './calendarUtils';

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Wybierz date');

const schema = z
  .object({
    name: z.string().trim().min(1, 'Podaj nazwe wariantu').max(60),
    kind: z.enum(['WEEKLY', 'ZJAZD']),
    startDate: dateKey,
    endDate: dateKey,
    allFaculties: z.boolean(),
    breaks: z.array(
      z.object({ name: z.string().trim().min(1, 'Podaj nazwe'), startDate: dateKey, endDate: dateKey }),
    ),
    days: z.array(
      z.object({
        date: dateKey,
        kind: z.enum(['DAY_OFF', 'FOLLOWS_WEEKDAY', 'CLOSED_FROM']),
        name: z.string(),
        followsWeekday: z.string(),
        closedFromBlockOrder: z.string(),
      }),
    ),
    zjazdy: z.array(z.object({ startDate: dateKey, endDate: dateKey })),
  })
  .refine((v) => v.startDate <= v.endDate, { path: ['endDate'], message: 'Koniec przed poczatkiem' });

type FormValues = z.infer<typeof schema>;

/** Co edytujemy: nowy kalendarz (z propozycji) albo istniejacy. */
export type EditorTarget =
  | { mode: 'create'; facultyId: string; facultyName: string; studyMode: StudyMode; proposal: CalendarProposal }
  | { mode: 'edit'; calendar: TermCalendar };

function toFormValues(body: CalendarBody): FormValues {
  return {
    name: body.name,
    kind: body.kind,
    startDate: body.startDate,
    endDate: body.endDate,
    allFaculties: false,
    breaks: body.breaks.map((b) => ({ name: b.name, startDate: b.startDate, endDate: b.endDate })),
    days: body.days.map((d) => ({
      date: d.date,
      kind: d.kind,
      name: d.name ?? '',
      followsWeekday: d.followsWeekday ?? '',
      closedFromBlockOrder: d.closedFromBlockOrder ? String(d.closedFromBlockOrder) : '',
    })),
    zjazdy: body.zjazdy.map((z) => ({ startDate: z.startDate, endDate: z.endDate })),
  };
}

/** Formularz -> tresc kalendarza. Zjazdy numerujemy po dacie: zjazd nr 3 = trzeci zjazd. */
function toBody(values: FormValues): CalendarBody {
  return {
    name: values.name.trim(),
    kind: values.kind,
    startDate: values.startDate,
    endDate: values.endDate,
    breaks: values.breaks,
    days: values.days.map((d) => ({
      date: d.date,
      kind: d.kind,
      name: d.name.trim() || null,
      followsWeekday: d.kind === 'FOLLOWS_WEEKDAY' && d.followsWeekday ? (d.followsWeekday as DayOfWeek) : null,
      closedFromBlockOrder:
        d.kind === 'CLOSED_FROM' && d.closedFromBlockOrder ? Number(d.closedFromBlockOrder) : null,
    })),
    zjazdy: [...values.zjazdy]
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .map((z, i) => ({ number: i + 1, startDate: z.startDate, endDate: z.endDate })),
  };
}

interface Props {
  target: EditorTarget | null;
  term: AcademicTerm;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function CalendarEditorDialog({ target, term, isAdmin, onClose, onSaved }: Props) {
  const studyMode: StudyMode | null =
    target?.mode === 'create' ? target.studyMode : (target?.calendar.studyMode ?? null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues({ name: '', kind: 'WEEKLY', startDate: '', endDate: '', breaks: [], days: [], zjazdy: [] }),
  });
  const breaks = useFieldArray({ control: form.control, name: 'breaks' });
  const days = useFieldArray({ control: form.control, name: 'days' });
  const zjazdy = useFieldArray({ control: form.control, name: 'zjazdy' });

  useEffect(() => {
    if (!target) return;
    form.reset(toFormValues(target.mode === 'create' ? target.proposal.calendar : target.calendar));
  }, [target, form]);

  // Godziny rektorskie wskazuja blok siatki wydzialu i trybu tego kalendarza.
  const { data: grids } = useQuery({ queryKey: ['time-grids'], queryFn: fetchTimeGrids });
  // Edycja kalendarza z wygenerowanymi terminami: zmiana dat oznaczy je jako nieaktualne.
  const editedId = target?.mode === 'edit' ? target.calendar.id : null;
  const { data: usage } = useQuery({
    queryKey: ['calendar-usage', editedId],
    queryFn: () => fetchCalendarUsage(editedId!),
    enabled: !!editedId,
  });
  const calendarFacultyId = target?.mode === 'create' ? target.facultyId : target?.calendar.facultyId;
  const timeBlocks = grids?.find((g) => g.faculty.id === calendarFacultyId && g.studyMode === studyMode)?.blocks;

  // Podglad na zywo: serwer liczy tygodnie zajec, swieta i problemy spojnosci.
  const watched = form.watch();
  const debounced = useDebouncedValue(JSON.stringify(watched), 400);
  const previewInput = useMemo(() => {
    const values = JSON.parse(debounced) as FormValues;
    if (!studyMode || !/^\d{4}-\d{2}-\d{2}$/.test(values.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(values.endDate)) {
      return null;
    }
    // Do podgladu bierzemy tylko kompletne wiersze — w trakcie wpisywania czesc jest pusta.
    const body = toBody({
      ...values,
      name: values.name || 'Podglad',
      breaks: values.breaks.filter((b) => b.startDate && b.endDate),
      days: values.days.filter((d) => d.date),
      zjazdy: values.zjazdy.filter((z) => z.startDate && z.endDate),
    });
    return { ...body, studyMode };
  }, [debounced, studyMode]);
  const { data: preview, isFetching: previewLoading } = useQuery({
    queryKey: ['calendar-preview', previewInput],
    queryFn: () => previewTermCalendar(previewInput!),
    enabled: !!target && !!previewInput,
    placeholderData: (previous) => previous,
  });

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues): Promise<{ message: string; warning?: string | null }> => {
      const body = toBody(values);
      if (target?.mode === 'edit') {
        const { warning } = await updateTermCalendar(target.calendar.id, body);
        return { message: 'Kalendarz zapisany', warning };
      }
      if (target?.mode !== 'create') return { message: '' };
      const result = await createTermCalendar(term.key, {
        ...body,
        studyMode: target.studyMode,
        ...(values.allFaculties ? { allFaculties: true } : { facultyId: target.facultyId }),
      });
      return { message: result.message };
    },
    onSuccess: ({ message, warning }) => {
      if (warning) toast.warning(message, { description: warning, duration: 12000 });
      else toast.success(message);
      onSaved();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  // Pomocnik: zjazdy co N tygodni od wskazanego piatku do konca semestru. Swiadoma
  // akcja planisty — wynik widac od razu na liscie i w podgladzie, mozna poprawic.
  const [firstFriday, setFirstFriday] = useState('');
  const [everyWeeks, setEveryWeeks] = useState('2');
  // replace: seria zastepuje cala liste (jak "Wstaw bloki" w siatce godzin); inaczej dopisuje.
  // Zmiana dotyczy tylko formularza — do bazy trafia dopiero po "Zapisz kalendarz".
  const addZjazdSeries = (replace: boolean) => {
    const end = form.getValues('endDate');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(firstFriday) || !end) {
      toast.error('Podaj date pierwszego zjazdu i koniec semestru');
      return;
    }
    const step = Number(everyWeeks) * 7;
    const series: { startDate: string; endDate: string }[] = [];
    for (let start = firstFriday; addDaysKey(start, 2) <= end && series.length < 30; start = addDaysKey(start, step)) {
      series.push({ startDate: start, endDate: addDaysKey(start, 2) });
    }
    if (replace) {
      zjazdy.replace(series);
      toast.info(`Lista zjazdow zastapiona seria (${series.length}) — zapisze sie po „Zapisz kalendarz”`);
    } else {
      zjazdy.append(series);
    }
  };

  const kind = form.watch('kind');
  const title =
    target?.mode === 'edit'
      ? `${target.calendar.faculty.shortName} · ${STUDY_MODE_LABELS[target.calendar.studyMode]} · ${target.calendar.name}`
      : target?.mode === 'create'
        ? `Nowy kalendarz · ${target.facultyName} · ${STUDY_MODE_LABELS[target.studyMode]}`
        : '';

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Semestr {term.label}. Swieta ustawowe licza sie same — tu ustawiasz daty zajec, przerwy,
            dni wolne uczelni i zjazdy.
          </DialogDescription>
        </DialogHeader>

        {target?.mode === 'create' && (
          <Alert>
            <Info />
            <AlertTitle>{proposalNote(target.proposal, term.key).title}</AlertTitle>
            <AlertDescription>{proposalNote(target.proposal, term.key).description}</AlertDescription>
          </Alert>
        )}

        {usage && usage.occurrences > 0 && (
          <Alert>
            <TriangleAlert />
            <AlertTitle>Wedlug tego kalendarza sa juz wygenerowane terminy</AlertTitle>
            <AlertDescription>
              Terminy: {usage.occurrences}, roczniki z planem: {usage.cohortsWithPlan}. Zmiana dat,
              przerw, dni wolnych albo zjazdow oznaczy je jako nieaktualne — trzeba bedzie uzyc „Generuj terminy” w Ukladaniu planu. Sama
              zmiana nazwy niczego nie unieaktualnia.
            </AlertDescription>
          </Alert>
        )}

        <form
          id="calendar-editor"
          onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
          className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]"
        >
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="cal-name">Nazwa wariantu</FieldLabel>
                <Input id="cal-name" {...form.register('name')} />
                <FieldError errors={[form.formState.errors.name]} />
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="cal-kind">Rytm zajec</FieldLabel>
                <NativeSelect id="cal-kind" {...form.register('kind')}>
                  {(Object.keys(CALENDAR_KIND_LABELS) as CalendarKind[]).map((k) => (
                    <NativeSelectOption key={k} value={k}>
                      {CALENDAR_KIND_LABELS[k]}
                      {k === 'ZJAZD' ? ' (zajecia tylko na zjazdach)' : ' (co tydzien)'}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="cal-start">Pierwszy dzien zajec</FieldLabel>
                <Input id="cal-start" type="date" {...form.register('startDate')} />
                <FieldError errors={[form.formState.errors.startDate]} />
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="cal-end">Ostatni dzien zajec</FieldLabel>
                <Input id="cal-end" type="date" {...form.register('endDate')} />
                <FieldError errors={[form.formState.errors.endDate]} />
              </Field>
            </div>

            {isAdmin && target?.mode === 'create' && (
              <Controller
                control={form.control}
                name="allFaculties"
                render={({ field }) => (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
                    Zaloz ten sam kalendarz dla wszystkich wydzialow (wydzialy, ktore juz go maja, zostana pominiete)
                  </label>
                )}
              />
            )}

            <Separator />

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Przerwy</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => breaks.append({ name: 'Przerwa', startDate: '', endDate: '' })}
                >
                  <Plus /> Dodaj przerwe
                </Button>
              </div>
              {breaks.fields.length === 0 && (
                <p className="text-sm text-muted-foreground">Brak przerw (np. swiatecznej, wielkanocnej).</p>
              )}
              {breaks.fields.map((field, index) => (
                <div key={field.id} className="grid grid-cols-[1fr_9.5rem_9.5rem_auto] items-start gap-2">
                  <Input aria-label="Nazwa przerwy" {...form.register(`breaks.${index}.name`)} />
                  <Input aria-label="Od" type="date" {...form.register(`breaks.${index}.startDate`)} />
                  <Input aria-label="Do" type="date" {...form.register(`breaks.${index}.endDate`)} />
                  <Button type="button" variant="ghost" size="icon" aria-label="Usun przerwe" onClick={() => breaks.remove(index)}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </section>

            <Separator />

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Wyjatki dni</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    days.append({ date: '', kind: 'DAY_OFF', name: '', followsWeekday: '', closedFromBlockOrder: '' })
                  }
                >
                  <Plus /> Dodaj dzien
                </Button>
              </div>
              {days.fields.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Dni rektorskie, zamiany dni (np. piatek wg planu poniedzialku), godziny rektorskie.
                </p>
              )}
              {days.fields.map((field, index) => {
                const dayKind = form.watch(`days.${index}.kind`) as CalendarDayKind;
                return (
                  <div key={field.id} className="grid grid-cols-[9.5rem_1fr_1fr_auto] items-start gap-2">
                    <Input aria-label="Data" type="date" {...form.register(`days.${index}.date`)} />
                    <NativeSelect aria-label="Rodzaj" {...form.register(`days.${index}.kind`)}>
                      {CALENDAR_DAY_KINDS.map((k) => (
                        <NativeSelectOption key={k} value={k}>
                          {CALENDAR_DAY_KIND_LABELS[k]}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    {dayKind === 'FOLLOWS_WEEKDAY' ? (
                      <NativeSelect aria-label="Plan dnia" {...form.register(`days.${index}.followsWeekday`)}>
                        <NativeSelectOption value="">— wg planu dnia —</NativeSelectOption>
                        {WEEKDAYS.map((d) => (
                          <NativeSelectOption key={d} value={d}>
                            {WEEKDAY_LABELS[d]}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    ) : dayKind === 'CLOSED_FROM' ? (
                      <NativeSelect aria-label="Od bloku" {...form.register(`days.${index}.closedFromBlockOrder`)}>
                        <NativeSelectOption value="">— odwolane od godziny —</NativeSelectOption>
                        {timeBlocks?.map((b) => (
                          <NativeSelectOption key={b.id} value={String(b.order)}>
                            od {b.startTime}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    ) : (
                      <Input aria-label="Opis" placeholder="np. Dzien rektorski" {...form.register(`days.${index}.name`)} />
                    )}
                    <Button type="button" variant="ghost" size="icon" aria-label="Usun dzien" onClick={() => days.remove(index)}>
                      <Trash2 />
                    </Button>
                  </div>
                );
              })}
            </section>

            {kind === 'ZJAZD' && (
              <>
                <Separator />
                <section className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-medium">Zjazdy ({zjazdy.fields.length})</h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => zjazdy.append({ startDate: '', endDate: '' })}
                    >
                      <Plus /> Dodaj zjazd
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3">
                    <Field className="w-40">
                      <FieldLabel htmlFor="zj-first">Pierwszy zjazd (piatek)</FieldLabel>
                      <Input id="zj-first" type="date" value={firstFriday} onChange={(e) => setFirstFriday(e.target.value)} />
                    </Field>
                    <Field className="w-36">
                      <FieldLabel htmlFor="zj-every">Co ile tygodni</FieldLabel>
                      <NativeSelect id="zj-every" value={everyWeeks} onChange={(e) => setEveryWeeks(e.target.value)}>
                        <NativeSelectOption value="1">co tydzien</NativeSelectOption>
                        <NativeSelectOption value="2">co 2 tygodnie</NativeSelectOption>
                        <NativeSelectOption value="3">co 3 tygodnie</NativeSelectOption>
                      </NativeSelect>
                    </Field>
                    <Button type="button" variant="secondary" size="sm" onClick={() => addZjazdSeries(false)}>
                      <CalendarPlus /> Dopisz serie do konca semestru
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      title="Usuwa obecne zjazdy z listy i wstawia serie od pierwszego zjazdu do konca semestru"
                      onClick={() => addZjazdSeries(true)}
                    >
                      <RefreshCw /> Zastap liste seria
                    </Button>
                  </div>
                  {zjazdy.fields.map((field, index) => (
                    <div key={field.id} className="grid grid-cols-[3rem_9.5rem_9.5rem_auto] items-center gap-2">
                      <span className="text-sm text-muted-foreground tabular-nums">nr {index + 1}</span>
                      <Input aria-label="Od" type="date" {...form.register(`zjazdy.${index}.startDate`)} />
                      <Input aria-label="Do" type="date" {...form.register(`zjazdy.${index}.endDate`)} />
                      <Button type="button" variant="ghost" size="icon" aria-label="Usun zjazd" onClick={() => zjazdy.remove(index)}>
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Zjazdy numerujemy wg dat przy zapisie — zjazd nr 3 to trzeci zjazd w semestrze.
                  </p>
                </section>
              </>
            )}
          </div>

          <aside className="space-y-3">
            {preview && preview.problems.length > 0 && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>Do poprawy przed zapisem</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {preview.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <CalendarPreviewPanel preview={preview ?? null} kind={kind} loading={previewLoading} />
          </aside>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button
            type="submit"
            form="calendar-editor"
            // Problemy z podgladu (np. nachodzace zjazdy) i tak odrzuci serwer — od razu blokujemy zapis.
            disabled={saveMutation.isPending || (preview?.problems.length ?? 0) > 0}
            title={(preview?.problems.length ?? 0) > 0 ? 'Popraw problemy wskazane w podgladzie' : undefined}
          >
            {saveMutation.isPending && <Spinner />}
            Zapisz kalendarz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
