import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Copy, History, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PageHeader } from '@/components/PageHeader';
import { FacultySelector } from '@/components/FacultySelector';
import { fetchTermCohorts } from '@/api/cohorts';
import { fetchAvailability, fetchPlan, updatePlacement } from '@/api/plan';
import { fetchTimeBlocks } from '@/api/timeBlocks';
import { useCurrentTerm } from '@/hooks/useTerm';
import { getErrorMessage } from '@/lib/errors';
import { groupTreeOptions, treeOptionLabel, visibleGroupIds } from '@/lib/planGroupFilter';
import { earlyEndWeeks, formatDayMonth } from '@/lib/planHours';
import { CLASS_FULL_LABELS, CLASS_LABELS } from '@/lib/scheduleDisplay';
import { useAuthStore } from '@/store/authStore';
import { useFacultyFilterStore } from '@/store/facultyStore';
import type { DayOfWeek, PlanPlacement, PlanSection } from '@/types';
import { WeekGrid, type GridItem } from './plan/WeekGrid';
import { PlacementDialog, type PlacementTarget } from './plan/PlacementDialog';
import { GenerateTermsDialog } from './plan/GenerateTermsDialog';
import { OccurrencesTab } from './plan/OccurrencesTab';
import { CarryPlanDialog } from './plan/CarryPlanDialog';

const FULL_DAYS: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
const PART_DAYS: DayOfWeek[] = ['FRIDAY', 'SATURDAY', 'SUNDAY'];

function patternLabel(p: PlanPlacement): string {
  const range = p.fromIndex || p.toIndex ? ` ${p.fromIndex ?? 1}–${p.toIndex ?? '…'}` : '';
  if (p.cycle === 'ZJAZD') return p.pattern === 'LIST' ? `zjazdy ${p.numbers.join(',')}` : `kazdy zjazd${range}`;
  if (p.pattern === 'EVEN') return `tyg. parzyste${range}`;
  if (p.pattern === 'ODD') return `tyg. nieparzyste${range}`;
  if (p.pattern === 'LIST') return `tyg. ${p.numbers.join(',')}`;
  return range ? `tyg.${range}` : 'co tydzien';
}

/**
 * Ukladanie planu rocznika — RECZNIE. Planista wybiera zajecia z panelu "do zaplanowania"
 * (siatka podswietla wolne/zajete godziny) i klika godzine, w ktorej je umiescic.
 * Terminy w kalendarzu powstaja dopiero po "Generuj terminy" (z podgladem).
 */
export default function PlanPage() {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const isAdmin = me?.role === 'ADMIN';
  const facultyFilter = useFacultyFilterStore((s) => s.facultyId);
  const facultyParam = isAdmin ? facultyFilter : (me?.facultyId ?? undefined);
  const { term } = useCurrentTerm();

  const [cohortId, setCohortId] = useState('');
  const [selected, setSelected] = useState<PlanSection | null>(null);
  const [target, setTarget] = useState<PlacementTarget | null>(null);
  const [zjazd, setZjazd] = useState<number | null>(null);
  const [groupFilter, setGroupFilter] = useState('all');
  const [generating, setGenerating] = useState(false);
  const [carrying, setCarrying] = useState(false);
  const [copyTo, setCopyTo] = useState('');

  const { data: cohortsData } = useQuery({
    queryKey: ['term-cohorts', term?.key, facultyParam],
    queryFn: () => fetchTermCohorts(term!.key, facultyParam),
    enabled: !!term,
  });
  const cohorts = useMemo(() => cohortsData?.cohorts ?? [], [cohortsData]);
  useEffect(() => {
    if (cohorts.length > 0 && !cohorts.some((c) => c.id === cohortId)) setCohortId(cohorts[0]!.id);
  }, [cohorts, cohortId]);

  const { data: blocks } = useQuery({ queryKey: ['time-blocks'], queryFn: fetchTimeBlocks });
  const { data: plan, isPending } = useQuery({
    queryKey: ['plan', term?.key, cohortId],
    queryFn: () => fetchPlan(term!.key, cohortId),
    enabled: !!term && !!cohortId,
  });

  const zjazdCalendar = plan?.calendar?.kind === 'ZJAZD';
  const days = plan?.cohort.studyMode === 'PART_TIME' ? PART_DAYS : FULL_DAYS;
  // Zablokowany na stale (archiwum / brak uprawnien) — akcji nie pokazujemy wcale.
  const locked = plan?.calendar?.status === 'ARCHIVED' || !(isAdmin || me?.role === 'DEAN_OFFICE');
  // Brak kalendarza da sie naprawic — akcje widoczne, ale wylaczone (uklad naglowka nie skacze).
  const noCalendar = !!plan && !plan.calendar;
  const readOnly = locked || !plan?.calendar;

  // Podpowiedz dostepnosci dla wybranych zajec (grupa + prowadzacy z obsady).
  const { data: availability } = useQuery({
    queryKey: ['availability', term?.key, selected?.id, zjazd],
    queryFn: () =>
      fetchAvailability(term!.key, {
        sectionId: selected!.id,
        length: Math.min(2, selected!.hours),
        cycle: zjazdCalendar ? 'ZJAZD' : 'WEEK',
        numbers: zjazd ? [zjazd] : undefined,
      }),
    enabled: !!term && !!selected && !readOnly,
  });

  const refresh = async () => {
    setTarget(null);
    await queryClient.invalidateQueries({ queryKey: ['plan'] });
    await queryClient.invalidateQueries({ queryKey: ['availability'] });
    await queryClient.invalidateQueries({ queryKey: ['occurrences'] });
  };

  const sections = useMemo(() => plan?.sections ?? [], [plan]);
  const groups = useMemo(() => groupTreeOptions(sections.map((s) => s.group)), [sections]);
  // Filtr grupy: wybrana grupa i jej przodkowie — ta sama regula dla siatki i listy.
  const visibleGroups = useMemo(() => visibleGroupIds(sections.map((s) => s.group), groupFilter), [sections, groupFilter]);
  const inView = (s: PlanSection) => !visibleGroups || visibleGroups.has(s.group.id);
  const backlog = sections.filter((s) => s.status === 'ACTIVE' && s.plannedHours < s.hours && inView(s));
  // Pelne godziny, ale rytm konczy zajecia wyraznie przed koncem semestru — latwo to przeoczyc.
  const earlyEnds = sections
    .filter((s) => s.status === 'ACTIVE' && inView(s))
    .map((s) => ({ section: s, weeks: earlyEndWeeks(s, plan?.calendar?.endDate) }))
    .filter((e): e is { section: PlanSection; weeks: number } => e.weeks !== null);

  const visiblePlacement = (p: PlanPlacement) =>
    !zjazd || p.cycle !== 'ZJAZD' || p.pattern === 'ALL' || p.numbers.includes(zjazd);

  const items: GridItem[] = sections.flatMap((s) =>
    s.placements.filter(visiblePlacement).map((p) => ({
      id: p.id,
      dayOfWeek: p.dayOfWeek,
      startOrder: p.startOrder,
      endOrder: p.endOrder,
      classType: s.classType,
      title: s.subject.name,
      lines: [s.group.name, p.room.label, `${p.instructor?.name ?? 'NN'} · ${patternLabel(p)}`],
      muted: !inView(s),
    })),
  );
  const placementOwner = new Map(sections.flatMap((s) => s.placements.map((p) => [p.id, { section: s, placement: p }] as const)));

  // Kopiowanie zjazdu k -> m: swiadoma akcja planisty, dopisuje numer m do umieszczen z zjazdu k.
  const copyZjazd = useMutation({
    mutationFn: async () => {
      const to = Number(copyTo);
      const list = sections.flatMap((s) => s.placements).filter((p) => p.cycle === 'ZJAZD' && p.pattern === 'LIST' && p.numbers.includes(zjazd!) && !p.numbers.includes(to));
      const errors: string[] = [];
      for (const p of list) {
        try {
          await updatePlacement(p.id, { numbers: [...p.numbers, to].sort((a, b) => a - b) });
        } catch (e) {
          errors.push(getErrorMessage(e));
        }
      }
      return { done: list.length - errors.length, errors };
    },
    onSuccess: async ({ done, errors }) => {
      if (errors.length) toast.error(`Skopiowano ${done}, bledy: ${errors.length} — ${errors[0]}`, { duration: 10000 });
      else toast.success(`Skopiowano ${done} zajec na zjazd ${copyTo}`);
      await refresh();
    },
  });

  const cohort = cohorts.find((c) => c.id === cohortId);

  return (
    <>
      <PageHeader
        title="Ukladanie planu"
        description={term ? `Semestr ${term.label}. Zajecia umieszczasz recznie; terminy powstaja po „Generuj terminy”.` : 'Wybierz semestr w naglowku.'}
        actions={
          <>
            {isAdmin && <FacultySelector />}
            <NativeSelect value={cohortId} onChange={(e) => { setCohortId(e.target.value); setSelected(null); setZjazd(null); setGroupFilter('all'); }} className="w-72" aria-label="Rocznik">
              {cohorts.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.program.code} · semestr {c.semester} (nabor {c.startTermLabel})
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {plan && !locked && (
              <Tooltip open={noCalendar ? undefined : false}>
                <TooltipTrigger asChild>
                  {/* span: wylaczony przycisk nie emituje zdarzen, a podpowiedz ma sie pokazac */}
                  <span tabIndex={noCalendar ? 0 : -1} className="inline-flex gap-2">
                    <Button variant="outline" disabled={noCalendar} onClick={() => setCarrying(true)}>
                      <History /> Przenies plan z zeszlego roku
                    </Button>
                    <Button
                      disabled={noCalendar}
                      onClick={() => setGenerating(true)}
                      variant={plan.stale ? 'default' : 'outline'}
                    >
                      <CalendarCheck /> Generuj terminy
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Najpierw zaloz kalendarz dla tego rocznika</TooltipContent>
              </Tooltip>
            )}
          </>
        }
      />

      {cohortsData && cohorts.length === 0 && (
        <p className="text-sm text-muted-foreground">W tym semestrze nie ma rocznikow — sprawdz Roczniki i grupy.</p>
      )}
      {isPending && cohortId && <Skeleton className="h-96 w-full" />}

      {cohort && (
        // Tylko informacja: zajecia rocznika wynikaja z tej wersji programu (zmiana wersji — poza tym widokiem).
        <p className="text-sm text-muted-foreground">
          Program {cohort.program.code}:{' '}
          <Link to={`/curriculum/program/${cohort.programVersion.id}`} className="font-medium text-foreground underline-offset-4 hover:underline">
            {cohort.programVersion.label}
          </Link>
          {cohort.programVersion.status === 'DRAFT' ? (
            <Badge variant="outline" className="ml-2">projekt</Badge>
          ) : (
            <Badge variant="secondary" className="ml-2">zatwierdzona</Badge>
          )}
        </p>
      )}
      {plan && !plan.calendar && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Rocznik nie ma kalendarza w tym semestrze</AlertTitle>
          <AlertDescription>
            <p>
              Zaloz kalendarz w{' '}
              {term ? (
                <Link to={`/calendar/${term.key}`} className="font-medium underline underline-offset-4">
                  „Kalendarz semestru”
                </Link>
              ) : (
                '„Kalendarz semestru”'
              )}{' '}
              — bez niego nie da sie policzyc terminow.
            </p>
          </AlertDescription>
        </Alert>
      )}
      {plan?.stale && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>Kalendarz nieaktualny</AlertTitle>
          <AlertDescription>
            {plan.staleReasons.includes('PLACEMENTS') && plan.staleReasons.includes('SECTIONS')
              ? 'Wzorzec i godziny zajec zmienily sie po ostatnim generowaniu.'
              : plan.staleReasons.includes('SECTIONS')
                ? 'Godziny zajec zmienily sie po ostatnim generowaniu (synchronizacja z programem).'
                : 'Wzorzec zmienil sie po ostatnim generowaniu.'}{' '}
            Terminy w kalendarzu sa jeszcze stare — uzyj „Generuj terminy”, gdy skonczysz zmiany.
          </AlertDescription>
        </Alert>
      )}

      {plan && blocks && term && (
        <Tabs defaultValue="pattern">
          <TabsList>
            <TabsTrigger value="pattern">Wzorzec {zjazdCalendar ? 'zjazdu' : 'tygodnia'}</TabsTrigger>
            <TabsTrigger value="occurrences">Terminy ({plan.generatedOccurrences})</TabsTrigger>
          </TabsList>

          <TabsContent value="pattern" className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                className="w-56"
                aria-label="Filtr grupy"
                title="Zajecia, na ktore chodzi wybrana grupa: ona sama i grupy nadrzedne (wyklad, caly rocznik)"
              >
                <NativeSelectOption value="all">Wszystkie grupy</NativeSelectOption>
                {groups.map((g) => (
                  <NativeSelectOption key={g.id} value={g.id}>
                    {treeOptionLabel(g)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {zjazdCalendar && (
                <div className="flex flex-wrap items-center gap-1">
                  <Button size="sm" variant={zjazd === null ? 'default' : 'outline'} onClick={() => setZjazd(null)}>
                    Wszystkie zjazdy
                  </Button>
                  {plan.calendar!.zjazdy.map((z) => (
                    <Button key={z.number} size="sm" variant={zjazd === z.number ? 'default' : 'outline'} className="w-10" title={`${z.startDate} – ${z.endDate}`} onClick={() => setZjazd(z.number)}>
                      {z.number}
                    </Button>
                  ))}
                  {zjazd !== null && !readOnly && (
                    <span className="ml-2 flex items-center gap-1 text-sm">
                      <Copy className="size-4" /> kopiuj zjazd {zjazd} na
                      <NativeSelect value={copyTo} onChange={(e) => setCopyTo(e.target.value)} className="w-20" aria-label="Zjazd docelowy">
                        <NativeSelectOption value="">—</NativeSelectOption>
                        {plan.calendar!.zjazdy.filter((z) => z.number !== zjazd).map((z) => (
                          <NativeSelectOption key={z.number} value={z.number}>
                            {z.number}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      <Button size="sm" variant="secondary" disabled={!copyTo || copyZjazd.isPending} onClick={() => copyZjazd.mutate()}>
                        Kopiuj
                      </Button>
                    </span>
                  )}
                </div>
              )}
              {selected && (
                <Badge variant="secondary" className="gap-1">
                  Umieszczasz: {selected.subject.name} ({CLASS_LABELS[selected.classType]}) {selected.group.name} — kliknij godzine
                  <button type="button" aria-label="Anuluj wybor" onClick={() => setSelected(null)}>
                    <X className="size-3" />
                  </button>
                </Badge>
              )}
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
              <WeekGrid
                days={days}
                blocks={blocks}
                items={items}
                availability={selected ? availability?.cells : null}
                onCellClick={
                  readOnly || !selected
                    ? undefined
                    : (day, order) => setTarget({ section: selected, placement: null, day, startOrder: order, zjazd })
                }
                onItemClick={(id) => {
                  const owner = placementOwner.get(id);
                  if (owner && !readOnly) {
                    setTarget({ section: owner.section, placement: owner.placement, day: owner.placement.dayOfWeek, startOrder: owner.placement.startOrder, zjazd });
                  }
                }}
              />

              <aside className="space-y-2">
                <h3 className="font-medium">
                  Do zaplanowania <span className="text-muted-foreground">({backlog.length})</span>
                </h3>
                <p className="text-xs text-muted-foreground">
                  Wybierz zajecia, a siatka pokaze wolne (zielone) i zajete (czerwone) godziny dla grupy i prowadzacego.
                </p>
                <ul className="max-h-[70vh] space-y-1 overflow-y-auto">
                  {backlog.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => setSelected(selected?.id === s.id ? null : s)}
                        className={`w-full rounded-md border px-2 py-1.5 text-left text-sm hover:bg-muted ${selected?.id === s.id ? 'border-primary bg-primary/5' : ''}`}
                      >
                        <div className="font-medium">
                          {CLASS_LABELS[s.classType]} · {s.subject.name}
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{s.group.name}</span>
                          <span className="tabular-nums">
                            {s.plannedHours}/{s.hours} h
                          </span>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {s.instructors.length ? s.instructors.map((i) => i.name).join(', ') : 'brak obsady (NN)'}
                        </div>
                      </button>
                    </li>
                  ))}
                  {backlog.length === 0 &&
                    (sections.some((s) => s.status === 'ACTIVE') ? (
                      <li className="text-sm text-muted-foreground">
                        {visibleGroups ? 'Wszystkie godziny tej grupy zaplanowane.' : 'Wszystkie godziny zaplanowane.'}
                      </li>
                    ) : (
                      // Pusta lista bez zajec to nie "wszystko zaplanowane" — zajecia powstaja z synchronizacji.
                      <li className="text-sm text-muted-foreground">
                        Rocznik nie ma zajec w tym semestrze — uruchom „Synchronizuj zajecia” na stronie{' '}
                        <Link to={`/obsada/${term.key}`} className="font-medium text-foreground underline underline-offset-4">
                          Zajecia i obsada
                        </Link>
                        .
                      </li>
                    ))}
                </ul>
                {earlyEnds.length > 0 && (
                  <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
                    <div className="font-medium text-amber-700 dark:text-amber-400">
                      Koncza sie wczesnie ({earlyEnds.length})
                    </div>
                    <ul className="space-y-0.5">
                      {earlyEnds.map(({ section: s, weeks }) => (
                        <li key={s.id}>
                          {CLASS_LABELS[s.classType]} · {s.subject.name} · {s.group.name} — ostatnie zajecia{' '}
                          {formatDayMonth(s.endsOn!)}, {weeks} tyg. przed koncem semestru
                        </li>
                      ))}
                    </ul>
                    <p className="text-muted-foreground">
                      Rytm wyczerpuje godziny wczesniej. Jesli to niezamierzone, zmniejsz liczbe umieszczen albo ustaw
                      „Od/Do tygodnia”.
                    </p>
                  </div>
                )}
                {sections.some((s) => s.plannedHours > s.hours) && (
                  <p className="text-xs text-amber-600">
                    Nadmiar: {sections.filter((s) => s.plannedHours > s.hours).map((s) => `${s.subject.name} (${CLASS_FULL_LABELS[s.classType]}) ${s.group.name}`).join('; ')}
                  </p>
                )}
              </aside>
            </div>
          </TabsContent>

          <TabsContent value="occurrences" className="mt-3">
            <OccurrencesTab termKey={term.key} cohortId={cohortId} sections={sections} blocks={blocks} readOnly={readOnly} />
          </TabsContent>
        </Tabs>
      )}

      {target && plan && blocks && term && (
        <PlacementDialog
          termKey={term.key}
          plan={plan}
          days={days}
          blocks={blocks}
          target={target}
          onClose={() => setTarget(null)}
          onSaved={async () => {
            setSelected(null);
            await refresh();
          }}
          onObsadaSaved={async () => {
            // Okno umieszczenia zostaje otwarte — odswiezamy tylko dane (plan bierze prowadzacych z obsady).
            await queryClient.invalidateQueries({ queryKey: ['plan'] });
            await queryClient.invalidateQueries({ queryKey: ['availability'] });
            await queryClient.invalidateQueries({ queryKey: ['sections'] });
            await queryClient.invalidateQueries({ queryKey: ['workload'] });
          }}
        />
      )}
      {carrying && term && cohort && (
        <CarryPlanDialog
          termKey={term.key}
          cohortId={cohortId}
          cohortLabel={`${cohort.program.code} · semestr ${cohort.semester}`}
          onClose={() => setCarrying(false)}
          onDone={async () => {
            setCarrying(false);
            await refresh();
          }}
        />
      )}
      {generating && term && plan && cohort && (
        <GenerateTermsDialog
          termKey={term.key}
          cohortId={cohortId}
          cohortLabel={`${cohort.program.code} · semestr ${cohort.semester}`}
          published={plan.calendar?.status === 'PUBLISHED'}
          onClose={() => setGenerating(false)}
          onDone={async () => {
            setGenerating(false);
            await refresh();
          }}
        />
      )}
    </>
  );
}
