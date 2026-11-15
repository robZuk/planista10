import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Clock, Lock, Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageHeader } from '@/components/PageHeader';
import { createTimeGrid, deleteTimeGrid, fetchTimeGrids, updateTimeGrid } from '@/api/timeGrids';
import { getErrorMessage } from '@/lib/errors';
import { STUDY_MODE_LABELS, WEEKDAY_LABELS } from '@/lib/labels';
import { breaksBetween, describeDays, describeGrid, formatMinutes, generateBlocks, toMinutes, type BlockTimes, blockProblems } from '@/lib/timeGrid';
import type { DayOfWeek, GridDay, StudyMode, TimeGrid } from '@/types';

const WEEK: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const MODES: StudyMode[] = ['FULL_TIME', 'PART_TIME'];

/** Os blokow z przerwami: 08:00-08:45 · 08:50-09:35 · [przerwa 30 min] · ... */
function GridTimeline({ blocks }: { blocks: BlockTimes[] }) {
  const breaks = new Map(breaksBetween(blocks).map((b) => [b.afterIndex, b]));
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs tabular-nums">
      {blocks.map((b, i) => (
        <span key={`${b.startTime}-${i}`} className="contents">
          <span className="rounded-md border bg-muted/50 px-1.5 py-0.5">
            {b.startTime}-{b.endTime}
          </span>
          {breaks.has(i) && breaks.get(i)!.minutes >= 10 && (
            <span className="rounded-md border border-dashed border-amber-500/50 px-1.5 py-0.5 text-amber-700 dark:text-amber-400">
              przerwa {breaks.get(i)!.minutes} min
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

/** Co edytujemy: istniejaca siatke albo nowa siatke dnia. `takenDays` — dni innych siatek (do wyboru wylaczone). */
type EditorTarget =
  | { mode: 'edit'; grid: TimeGrid; takenDays: DayOfWeek[] }
  | { mode: 'create'; faculty: TimeGrid['faculty']; studyMode: StudyMode; base: TimeGrid; takenDays: DayOfWeek[] };

const daysOf = (grids: TimeGrid[]) => grids.flatMap((g) => g.days.map((d) => d.day));

/**
 * Siatki godzin wydzialow: kazdy wydzial ma siatke stacjonarna i niestacjonarna — bloki
 * (dowolny start i dlugosc, 1 blok = 1 godzina programu; przerwy to odstepy) oraz dni zajec
 * z oknem godzin. Siatka dnia daje wlasne bloki wybranym dniom (np. piatek niestacjonarnych od
 * 16:00, gdy sobota ma inne godziny). Bloki blokuja sie, gdy w dniach siatki jest juz plan
 * biezacego semestru.
 */
export default function TimeGridsPage() {
  const queryClient = useQueryClient();
  const { data: grids, isPending } = useQuery({ queryKey: ['time-grids'], queryFn: fetchTimeGrids });
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [removing, setRemoving] = useState<TimeGrid | null>(null);

  const faculties = [...new Map((grids ?? []).map((g) => [g.faculty.id, g.faculty])).values()];
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['time-grids'] });
    await queryClient.invalidateQueries({ queryKey: ['plan'] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => deleteTimeGrid(id),
    onSuccess: async (r) => {
      toast.success(r.message);
      setRemoving(null);
      await refresh();
    },
    onError: (e) => toast.error(getErrorMessage(e), { duration: 10000 }),
  });

  return (
    <>
      <PageHeader
        title="Siatki godzin"
        description="Godziny zajec wydzialow: siatka stacjonarna i niestacjonarna — bloki, przerwy oraz dni zajec z oknem godzin. Siatka dnia daje wybranym dniom wlasne bloki."
      />
      {isPending && <Skeleton className="h-40 w-full" />}
      {grids?.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Clock />
            </EmptyMedia>
            <EmptyTitle>Brak siatek godzin</EmptyTitle>
            <EmptyDescription>Siatki powstaja razem z wydzialem.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <div className="space-y-6">
        {faculties.map((faculty) => (
          <section key={faculty.id} className="space-y-2">
            <h2 className="font-heading text-lg font-semibold">
              {faculty.name} <span className="text-muted-foreground">({faculty.shortName})</span>
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {MODES.map((mode) => {
                const family = grids!.filter((g) => g.faculty.id === faculty.id && g.studyMode === mode);
                const base = family.find((g) => g.base);
                if (!base) return null;
                return (
                  <div key={mode} className="space-y-2">
                    {family.map((grid) => (
                      <Card key={grid.id} className={grid.base ? undefined : 'border-dashed'}>
                        <CardHeader>
                          <CardTitle className="flex flex-wrap items-center gap-2">
                            {STUDY_MODE_LABELS[mode]}
                            {!grid.base && <span className="font-normal text-muted-foreground">· siatka dnia</span>}
                            {grid.base && family.length > 1 && <span className="font-normal text-muted-foreground">· podstawowa</span>}
                            {grid.locked && (
                              <Badge variant="secondary" title="W dniach tej siatki jest plan biezacego semestru">
                                <Lock /> plan w semestrze
                              </Badge>
                            )}
                          </CardTitle>
                          <CardDescription>
                            {describeGrid(grid.blocks)}
                            <br />
                            Dni: {describeDays(grid.days)}
                          </CardDescription>
                          <CardAction className="flex flex-wrap gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEditing({ mode: 'edit', grid, takenDays: daysOf(family.filter((g) => g.id !== grid.id)) })}
                            >
                              <Pencil /> Edytuj
                            </Button>
                            {grid.base ? (
                              <Button
                                variant="outline"
                                size="sm"
                                title="Wlasne bloki dla wybranych dni, np. piatek od 16:00"
                                onClick={() =>
                                  setEditing({ mode: 'create', faculty, studyMode: mode, base: grid, takenDays: daysOf(family.filter((g) => !g.base)) })
                                }
                              >
                                <CalendarPlus /> Siatka dnia
                              </Button>
                            ) : (
                              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRemoving(grid)}>
                                <Trash2 /> Usun
                              </Button>
                            )}
                          </CardAction>
                        </CardHeader>
                        <CardContent>
                          <GridTimeline blocks={grid.blocks} />
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {editing && (
        <GridEditor
          target={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Usunac siatke dnia?"
        description={
          removing
            ? `${removing.faculty.shortName} · ${STUDY_MODE_LABELS[removing.studyMode]}: dni ${describeDays(removing.days)} wroca do siatki podstawowej i jej blokow.`
            : ''
        }
        confirmLabel="Usun siatke dnia"
        isPending={remove.isPending}
        onConfirm={() => remove.mutate(removing!.id)}
      />
    </>
  );
}

function GridEditor({ target, onClose, onSaved }: { target: EditorTarget; onClose: () => void; onSaved: () => Promise<void> }) {
  const grid = target.mode === 'edit' ? target.grid : null;
  const locked = grid?.locked ?? false;
  const [blocks, setBlocks] = useState<BlockTimes[]>((grid?.blocks ?? []).map((b) => ({ startTime: b.startTime, endTime: b.endTime })));
  const [days, setDays] = useState<Record<string, { on: boolean; from: string; to: string }>>(() =>
    Object.fromEntries(
      WEEK.map((day) => {
        const d = grid?.days.find((x) => x.day === day);
        return [day, { on: !!d, from: d?.from ?? '', to: d?.to ?? '' }];
      }),
    ),
  );
  const [gen, setGen] = useState({ start: target.mode === 'create' ? '16:00' : '08:00', length: '45', count: target.mode === 'create' ? '4' : '12', breakEvery: '1', breakMinutes: '5' });

  const sorted = [...blocks].filter((b) => b.startTime && b.endTime).sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  const problems = locked ? [] : blockProblems(sorted);
  const dayList: GridDay[] = WEEK.filter((d) => days[d]!.on).map((day) => ({ day, from: days[day]!.from || null, to: days[day]!.to || null }));
  // Nowa siatka dnia: dzien przejmuje okno godzin z siatki podstawowej (np. piatek od 16:00).
  const toggleDay = (day: DayOfWeek, on: boolean) => {
    const fromBase = target.mode === 'create' && on ? target.base.days.find((d) => d.day === day) : undefined;
    setDays({ ...days, [day]: fromBase ? { on, from: fromBase.from ?? '', to: fromBase.to ?? '' } : { ...days[day]!, on } });
  };

  const save = useMutation({
    mutationFn: () =>
      target.mode === 'create'
        ? createTimeGrid({ facultyId: target.faculty.id, studyMode: target.studyMode, days: dayList, blocks: sorted })
        : updateTimeGrid(target.grid.id, { days: dayList, ...(locked ? {} : { blocks: sorted }) }),
    onSuccess: async (r) => {
      toast.success(r.message);
      await onSaved();
    },
    onError: (e) => toast.error(getErrorMessage(e), { duration: 10000 }),
  });

  const setBlock = (i: number, patch: Partial<BlockTimes>) => setBlocks(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const addBlock = () => {
    const last = sorted[sorted.length - 1];
    const length = last ? toMinutes(last.endTime) - toMinutes(last.startTime) : 45;
    const start = last ? toMinutes(last.endTime) : 8 * 60;
    if (start + length > 24 * 60) return;
    setBlocks([...blocks, { startTime: formatMinutes(start), endTime: formatMinutes(start + length) }]);
  };

  const faculty = target.mode === 'edit' ? target.grid.faculty : target.faculty;
  const studyMode = target.mode === 'edit' ? target.grid.studyMode : target.studyMode;
  const title =
    target.mode === 'create'
      ? `Nowa siatka dnia: ${faculty.shortName} · ${STUDY_MODE_LABELS[studyMode]}`
      : `Siatka godzin: ${faculty.shortName} · ${STUDY_MODE_LABELS[studyMode]}${target.grid.base ? '' : ' · siatka dnia'}`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {target.mode === 'create'
              ? 'Wlasne bloki dla wybranych dni (np. piatek od 16:00, gdy sobota ma inne godziny). Zaznaczone dni przechodza z siatki podstawowej — zaklada sie ja przed ukladaniem planu w tych dniach.'
              : 'Kazdy blok to jedna godzina programu, niezaleznie od dlugosci. Przerwy to odstepy miedzy blokami.'}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1">
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Dni zajec i okno godzin</h3>
            <div className="space-y-1">
              {WEEK.map((day) => {
                const taken = target.takenDays.includes(day);
                return (
                  <div key={day} className="flex flex-wrap items-center gap-2">
                    <label className="flex w-36 items-center gap-2 text-sm">
                      <Checkbox checked={days[day]!.on} disabled={taken} onCheckedChange={(v) => toggleDay(day, v === true)} />
                      {WEEKDAY_LABELS[day]}
                    </label>
                    {taken ? (
                      <span className="text-xs text-muted-foreground">w innej siatce tego trybu</span>
                    ) : (
                      <>
                        <span className="text-xs text-muted-foreground">od</span>
                        <Input
                          type="time"
                          className="w-32"
                          disabled={!days[day]!.on}
                          value={days[day]!.from}
                          aria-label={`${WEEKDAY_LABELS[day]} od`}
                          onChange={(e) => setDays({ ...days, [day]: { ...days[day]!, from: e.target.value } })}
                        />
                        <span className="text-xs text-muted-foreground">do</span>
                        <Input
                          type="time"
                          className="w-32"
                          disabled={!days[day]!.on}
                          value={days[day]!.to}
                          aria-label={`${WEEKDAY_LABELS[day]} do`}
                          onChange={(e) => setDays({ ...days, [day]: { ...days[day]!, to: e.target.value } })}
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Puste pole = bez ograniczenia. Np. niestacjonarne: czwartek i piatek od 16:00.</p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-medium">Bloki ({sorted.length})</h3>
            {locked ? (
              <Alert>
                <Lock />
                <AlertTitle>Bloki zablokowane — w dniach tej siatki jest plan biezacego semestru</AlertTitle>
                <AlertDescription>
                  Zmiana godzin przesunelaby juz umieszczone zajecia. Dni i okno godzin mozna zmieniac. Bloki da sie zmienic,
                  gdy biezace semestry nie maja jeszcze umieszczen w tych dniach (np. przed planowaniem kolejnego semestru).
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Wand2 className="size-4" /> Generator
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {(
                    [
                      ['start', 'Start', 'time'],
                      ['length', 'Blok (min)', 'number'],
                      ['count', 'Liczba blokow', 'number'],
                      ['breakEvery', 'Przerwa co (bloki)', 'number'],
                      ['breakMinutes', 'Przerwa (min)', 'number'],
                    ] as const
                  ).map(([key, label, type]) => (
                    <Field key={key}>
                      <FieldLabel htmlFor={`gen-${key}`} className="text-xs">
                        {label}
                      </FieldLabel>
                      <Input id={`gen-${key}`} type={type} min={0} value={gen[key]} onChange={(e) => setGen({ ...gen, [key]: e.target.value })} />
                    </Field>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setBlocks(
                      generateBlocks({
                        start: gen.start,
                        length: Number(gen.length) || 45,
                        count: Number(gen.count) || 1,
                        breakEvery: Number(gen.breakEvery) || 0,
                        breakMinutes: Number(gen.breakMinutes) || 0,
                      }),
                    )
                  }
                >
                  Wstaw bloki (zastepuje liste)
                </Button>
              </div>
            )}
            <div className="space-y-1">
              {blocks.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-6 text-right text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                  <Input type="time" className="w-32" disabled={locked} value={b.startTime} aria-label="Poczatek" onChange={(e) => setBlock(i, { startTime: e.target.value })} />
                  <span className="text-muted-foreground">–</span>
                  <Input type="time" className="w-32" disabled={locked} value={b.endTime} aria-label="Koniec" onChange={(e) => setBlock(i, { endTime: e.target.value })} />
                  {!locked && (
                    <Button variant="ghost" size="icon" aria-label="Usun blok" onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              ))}
              {!locked && (
                <Button variant="outline" size="sm" onClick={addBlock}>
                  <Plus /> Dodaj blok
                </Button>
              )}
            </div>
          </section>

          <section className="space-y-1">
            <h3 className="text-sm font-medium">Podglad</h3>
            <p className="text-xs text-muted-foreground">
              {describeGrid(sorted)} · dni: {describeDays(dayList)}
            </p>
            <GridTimeline blocks={sorted} />
            {problems.length > 0 && (
              <ul className="text-sm text-destructive">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={sorted.length === 0 || dayList.length === 0 || problems.length > 0 || save.isPending}
            title={problems.length > 0 ? 'Popraw bloki wskazane w podgladzie' : undefined}
          >
            {save.isPending && <Spinner />}
            {target.mode === 'create' ? 'Zaloz siatke dnia' : 'Zapisz'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
