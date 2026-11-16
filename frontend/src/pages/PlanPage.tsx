import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, ChevronRight, Copy, FilterX, History, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/PageHeader';
import { FacultySelector } from '@/components/FacultySelector';
import { fetchTermCohorts } from '@/api/cohorts';
import { fetchAvailability, fetchPlan, updatePlacement } from '@/api/plan';
import { useCurrentTerm } from '@/hooks/useTerm';
import { usePlanCohortStore } from '@/store/planCohortStore';
import { getErrorMessage } from '@/lib/errors';
import { groupTreeOptions, treeOptionLabel, visibleGroupIds } from '@/lib/planGroupFilter';
import { earlyEndWeeks, formatDayMonth, MAX_SUGGESTED_LENGTH, suggestedLength } from '@/lib/planHours';
import { CLASS_FULL_LABELS, CLASS_LABELS } from '@/lib/scheduleDisplay';
import { blocksForDay, describeDays } from '@/lib/timeGrid';
import { formatRange } from './calendar/calendarUtils';
import { staleMessage } from '@/lib/planStaleness';
import { issueRows, placementWarning, planDays } from '@/lib/planIssues';
import { copyCandidates, defaultZjazd, inZjazd } from '@/lib/zjazdView';
import { toDateKey } from '@/lib/scheduleDates';
import { useAuthStore } from '@/store/authStore';
import { useFacultyFilterStore } from '@/store/facultyStore';
import { WEEKDAY_LABELS } from '@/lib/labels';
import type { DayOfWeek, PlanPlacement, PlanSection } from '@/types';
import { WeekGrid, type GridItem } from './plan/WeekGrid';
import { CohortFacetFilters } from './cohorts/CohortFacetFilters';
import { useCohortFilters } from './cohorts/useCohortFilters';
import { PlacementDialog, type PlacementTarget } from './plan/PlacementDialog';
import { GenerateTermsDialog } from './plan/GenerateTermsDialog';
import { OccurrencesTab } from './plan/OccurrencesTab';
import { CarryPlanDialog } from './plan/CarryPlanDialog';
import { plural } from '@/lib/setupSteps';


/** Rytm umieszczenia; zjazdy jak w arkuszu planu — „tydz. N” (`weekOf`: numer zjazdu -> tydzien semestru). */
function patternLabel(p: PlanPlacement, weekOf: (zjazd: number) => number | string = (n) => n): string {
  const range = p.fromIndex || p.toIndex ? ` ${p.fromIndex ?? 1}–${p.toIndex ?? '…'}` : '';
  if (p.cycle === 'ZJAZD') {
    if (p.pattern === 'LIST') return `tydz. ${p.numbers.map(weekOf).join(',')}`;
    return p.fromIndex || p.toIndex ? `kazdy zjazd tydz. ${weekOf(p.fromIndex ?? 1)}–${p.toIndex ? weekOf(p.toIndex) : '…'}` : 'kazdy zjazd';
  }
  if (p.pattern === 'EVEN') return `tyg. parzyste${range}`;
  if (p.pattern === 'ODD') return `tyg. nieparzyste${range}`;
  if (p.pattern === 'LIST') return `tyg. ${p.numbers.join(',')}`;
  return range ? `tyg.${range}` : 'co tydzien';
}

/**
 * Ukladanie planu rocznika — RECZNIE. Planista wybiera zajecia z panelu "do zaplanowania"
 * (siatka podswietla wolne/zajete godziny) i klika godzine, w ktorej je umiescic.
 * Terminy (konkretne daty) powstaja dopiero po "Generuj terminy" (z podgladem).
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
  const [viewing, setViewing] = useState<{ section: PlanSection; placement: PlanPlacement } | null>(null);
  // Po zamknieciu okna (umieszczenie / podglad) fokus wraca tam, skad je otwarto — kafelek albo
  // komorka siatki; inaczej uzytkownik klawiatury laduje na poczatku strony.
  const returnFocus = useRef<HTMLElement | null>(null);
  const dialogOpen = !!target || !!viewing;
  useEffect(() => {
    if (dialogOpen) return;
    const el = returnFocus.current;
    returnFocus.current = null;
    if (el?.isConnected) requestAnimationFrame(() => el.focus());
  }, [dialogOpen]);
  const rememberFocus = () => {
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) returnFocus.current = document.activeElement;
  };
  const [zjazdChoice, setZjazd] = useState<number | null>(null);
  const [groupFilter, setGroupFilter] = useState('all');
  // Przy filtrze grupy zajecia innych grup sa domyslnie ukryte — kafelki wybranej grupy maja wtedy pelna szerokosc.
  const [showOtherGroups, setShowOtherGroups] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [carrying, setCarrying] = useState(false);
  const [copyTo, setCopyTo] = useState('');

  const { data: cohortsData, isPending: cohortsPending } = useQuery({
    queryKey: ['term-cohorts', term?.key, facultyParam],
    queryFn: () => fetchTermCohorts(term!.key, facultyParam),
    enabled: !!term,
  });
  const allCohorts = useMemo(() => cohortsData?.cohorts ?? [], [cohortsData]);

  // Filtry rocznikow wspolne z "Rocznikami i grupami" (tryb globalny, reszta zapamietana).
  const cohortFilter = useCohortFilters(allCohorts);
  const cohorts = cohortFilter.visible;
  const cohortIds = cohorts.map((c) => c.id).join(',');
  // Wybrany rocznik wypadl z filtra (albo wejscie na strone) -> ostatnio ogladany, jesli pasuje,
  // inaczej pierwszy pasujacy; nic nie pasuje -> brak wyboru.
  const { lastCohortId, setLastCohortId } = usePlanCohortStore();
  useEffect(() => {
    if (cohortId) setLastCohortId(cohortId);
  }, [cohortId, setLastCohortId]);
  useEffect(() => {
    const ids = cohortIds ? cohortIds.split(',') : [];
    if (!ids.includes(cohortId)) {
      setCohortId(lastCohortId && ids.includes(lastCohortId) ? lastCohortId : (ids[0] ?? ''));
      setSelected(null);
      setZjazd(null);
      setGroupFilter('all');
    }
    // lastCohortId celowo poza zaleznosciami: czytamy go tylko przy wyborze, zapis nie ma wywolywac efektu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cohortIds, cohortId]);

  // Wejscie z linku (np. "Przygotowanie semestru"): /plan/2026-Z?cohort=<id> wybiera ten rocznik.
  // Gdy filtry rocznikow go ukrywaja, czyscimy je — inaczej link otworzylby inny rocznik.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedCohort = searchParams.get('cohort');
  const { clearFacets } = cohortFilter;
  useEffect(() => {
    if (!requestedCohort || allCohorts.length === 0) return;
    if (allCohorts.some((c) => c.id === requestedCohort)) {
      if (!cohortIds.split(',').includes(requestedCohort)) clearFacets();
      setCohortId(requestedCohort);
      setSelected(null);
      setZjazd(null);
      setGroupFilter('all');
    }
    setSearchParams(
      (params) => {
        params.delete('cohort');
        return params;
      },
      { replace: true },
    );
  }, [requestedCohort, allCohorts, cohortIds, clearFacets, setSearchParams]);

  const { data: plan, isPending } = useQuery({
    queryKey: ['plan', term?.key, cohortId],
    queryFn: () => fetchPlan(term!.key, cohortId),
    enabled: !!term && !!cohortId,
  });

  const zjazdCalendar = plan?.calendar?.kind === 'ZJAZD';
  // "Plan zjazdu" (niestacjonarne): zawsze konkretny zjazd — wybrany albo trwajacy/najblizszy. Plan
  // niestacjonarnych rozni sie z weekendu na weekend (bloki przedmiotow na wybranych zjazdach),
  // wiec nie nakladamy wszystkich zjazdow naraz; nowe zajecia trafiaja tylko do ogladanego zjazdu.
  const zjazdy = useMemo(() => (plan?.calendar?.kind === 'ZJAZD' ? plan.calendar.zjazdy : []), [plan]);
  const zjazd = zjazdCalendar
    ? zjazdChoice !== null && zjazdy.some((z) => z.number === zjazdChoice)
      ? zjazdChoice
      : defaultZjazd(zjazdy, toDateKey(new Date()))
    : null;
  // Dni ogladanego zjazdu z kalendarza rocznika: daty w naglowkach, dni poza zjazdem i wolne wyszarzone.
  const zjazdPeriod = zjazd !== null ? plan?.calendar?.periods.find((p) => p.index === zjazd) : undefined;
  const zjazdDays = useMemo(() => new Map((zjazdPeriod?.days ?? []).map((d) => [d.dayOfWeek, d])), [zjazdPeriod]);
  // Bloki i dni zajec z siatek godzin wydzialu i trybu rocznika (np. niestacjonarne: czw-nd). `blocks` —
  // siatka podstawowa (os czasu), `blocksOf` — bloki dnia (siatka dnia, np. piatek od 16:00, albo podstawowa).
  const blocks = plan ? (plan.timeGrid.grids.find((g) => g.base) ?? plan.timeGrid.grids[0])?.blocks : undefined;
  const blocksOf = useCallback((day: DayOfWeek) => (plan ? blocksForDay(plan.timeGrid, day) : []), [plan]);
  // Plus dni, na ktore juz cos umieszczono — zajecia spoza siatki zostaja widoczne (z ostrzezeniem).
  const days: DayOfWeek[] = useMemo(() => (plan ? planDays(plan.timeGrid.days.map((d) => d.day), plan.sections) : []), [plan]);
  const outsideGridDays = useMemo(() => {
    const grid = new Set(plan?.timeGrid.days.map((d) => d.day));
    return Object.fromEntries(days.filter((d) => !grid.has(d)).map((d) => [d, 'Dzien poza siatka godzin — przenies zajecia'])) as Partial<
      Record<DayOfWeek, string>
    >;
  }, [plan, days]);
  const closedDays = useMemo(() => {
    if (!zjazdPeriod) return outsideGridDays;
    const closed = days.flatMap((d) => {
      const info = zjazdDays.get(d);
      if (!info) return [[d, 'Poza zjazdem'] as const];
      return info.teaching ? [] : [[d, info.label ?? 'Dzien wolny'] as const];
    });
    return { ...outsideGridDays, ...Object.fromEntries(closed) } as Partial<Record<DayOfWeek, string>>;
  }, [outsideGridDays, zjazdPeriod, zjazdDays, days]);
  const zjazdDayHeader = zjazdPeriod
    ? (day: DayOfWeek) => {
        const info = zjazdDays.get(day);
        return info ? `${WEEKDAY_LABELS[day]} ${formatDayMonth(info.date)}` : WEEKDAY_LABELS[day];
      }
    : undefined;
  // Zablokowany na stale (archiwum / brak uprawnien) — akcji nie pokazujemy wcale.
  const archived = plan?.calendar?.status === 'ARCHIVED';
  const locked = archived || !(isAdmin || me?.role === 'DEAN_OFFICE');
  // Brak kalendarza i wersja programu w projekcie da sie naprawic — akcje widoczne, ale
  // wylaczone (uklad naglowka nie skacze), z podpowiedzia, co zrobic.
  const noCalendar = !!plan && !plan.calendar;
  const draftVersion = plan?.cohort.programVersion.status === 'DRAFT';
  const blockedReason = draftVersion
    ? 'Najpierw zatwierdz wersje programu tego rocznika'
    : noCalendar
      ? 'Najpierw zaloz kalendarz dla tego rocznika'
      : null;
  const readOnly = locked || !plan?.calendar || draftVersion;
  // Studia stacjonarne: ten sam plan w kazdym tygodniu + kalendarz Rektora. Terminy sa tylko do
  // wgladu (bez przeniesien) — zmiana planu od tygodnia idzie przez wzorzec.
  // Ta sama regula w API (services/occurrenceChanges.assertPlanEditable).
  const stationary = plan?.cohort.studyMode === 'FULL_TIME';

  // Dlugosc zajec dla podpowiedzi: domyslnie godziny rozlozone na tygodnie/zjazdy semestru
  // (15 h -> 1 h tygodniowo), planista moze ja zmienic przy "Umieszczasz".
  const [lengthChoice, setLengthChoice] = useState<{ sectionId: string; length: number } | null>(null);
  const periodsCount = zjazdCalendar ? (plan?.calendar?.zjazdy.length ?? 0) : (plan?.calendar?.teachingWeeks ?? 0);
  const placeLength = selected
    ? lengthChoice?.sectionId === selected.id
      ? lengthChoice.length
      : suggestedLength(selected, periodsCount)
    : 1;

  // Podpowiedz dostepnosci dla wybranych zajec (grupa + prowadzacy z obsady).
  const { data: availability } = useQuery({
    queryKey: ['availability', term?.key, selected?.id, zjazd, placeLength],
    queryFn: () =>
      fetchAvailability(term!.key, {
        sectionId: selected!.id,
        length: placeLength,
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
  // Niestacjonarne ukladaja przedmioty blokami na wybranych zjazdach: wczesny koniec to norma.
  const earlyEnds = (zjazdCalendar ? [] : sections)
    .filter((s) => s.status === 'ACTIVE' && inView(s))
    .map((s) => ({ section: s, weeks: earlyEndWeeks(s, plan?.calendar?.endDate) }))
    .filter((e): e is { section: PlanSection; weeks: number } => e.weeks !== null);

  // Zjazd pokazujemy jak w arkuszu planu: „tydz. N” (numer tygodnia semestru); w danych zostaje numer kolejny.
  const weekOf = (zjazdNumber: number | string) => plan?.calendar?.zjazdy.find((z) => z.number === Number(zjazdNumber))?.week ?? zjazdNumber;
  const visiblePlacement = (p: PlanPlacement) => !zjazd || inZjazd(p, zjazd);
  // Niezgodnosci zajec widocznych w filtrze grupy (lib/planIssues).
  const issues = issueRows(sections.filter(inView));

  const items: GridItem[] = sections.filter((s) => showOtherGroups || inView(s)).flatMap((s) =>
    s.placements.filter(visiblePlacement).map((p) => ({
      id: p.id,
      dayOfWeek: p.dayOfWeek,
      startOrder: p.startOrder,
      endOrder: p.endOrder,
      classType: s.classType,
      title: s.subject.name,
      lines: [s.group.name, p.room?.label ?? 'ON-LINE', `${p.instructor?.name ?? 'NN'} · ${patternLabel(p, weekOf)}`],
      muted: !inView(s),
      warning: placementWarning(s, p.id),
    })),
  );
  const placementOwner = new Map(sections.flatMap((s) => s.placements.map((p) => [p.id, { section: s, placement: p }] as const)));

  // Kopiowanie zjazdu k -> m: swiadoma akcja planisty, dopisuje numer m do umieszczen ze zjazdu k.
  const toCopy = zjazd && copyTo ? copyCandidates(sections.flatMap((s) => s.placements), zjazd, Number(copyTo)) : [];
  const copyZjazd = useMutation({
    mutationFn: async () => {
      const to = Number(copyTo);
      const list = toCopy;
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
      else toast.success(`Skopiowano ${plural(done, 'zajecia', 'zajecia', 'zajec')} na tydz. ${weekOf(copyTo)}`);
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
            {plan && !locked && (
              // Dymek natywny na spanie: wylaczony przycisk nie reaguje na najechanie, a powod ma byc widoczny.
              <span title={blockedReason ?? undefined} className="inline-flex flex-wrap gap-2">
                    <Button variant="outline" disabled={!!blockedReason} onClick={() => setCarrying(true)}>
                      <History /> Przenies plan z zeszlego roku
                    </Button>
                    <Button
                      disabled={!!blockedReason}
                      onClick={() => setGenerating(true)}
                      variant={plan.stale ? 'default' : 'outline'}
                    >
                      <CalendarCheck /> Generuj terminy
                    </Button>
              </span>
            )}
          </>
        }
      />

      {/* Filtry w kolejnosci zaleznosci: wydzial -> tryb, kierunek, stopien, semestr -> rocznik. */}
      {term && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {isAdmin && <FacultySelector />}
          <CohortFacetFilters filters={cohortFilter.filters} facets={cohortFilter.facets} onChange={cohortFilter.setFacet} loading={cohortsPending} />
          {/* Licznik i czyszczenie przed strzalka: dotycza filtrow po lewej, nie wyboru rocznika. */}
          <span className="text-muted-foreground">
            {cohortsPending
              ? 'wczytywanie rocznikow…'
              : cohortFilter.facetsActive
                ? `${cohorts.length} z ${allCohorts.length} rocznikow`
                : `${allCohorts.length} rocznikow`}
          </span>
          {cohortFilter.facetsActive && (
            <Button variant="ghost" size="sm" onClick={cohortFilter.clearFacets}>
              <FilterX /> Wyczysc filtry
            </Button>
          )}
          {/* Strzalka i rocznik zawijaja sie razem (strzalka nie zostaje sama na koncu linii). */}
          <div className="flex shrink-0 items-center gap-3">
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            <NativeSelect
              value={cohortId}
              onChange={(e) => { setCohortId(e.target.value); setSelected(null); setZjazd(null); setGroupFilter('all'); }}
              className="w-64"
              aria-label="Rocznik"
              title={cohorts.find((c) => c.id === cohortId)?.program.name}
              disabled={cohorts.length === 0}
            >
              {cohorts.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.program.code} · sem. {c.semester} · nabor {c.startTermLabel}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>
      )}

      {cohortsData && allCohorts.length === 0 && (
        <p className="text-sm text-muted-foreground">W tym semestrze nie ma rocznikow — sprawdz Roczniki i grupy.</p>
      )}
      {allCohorts.length > 0 && cohorts.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Zaden rocznik nie pasuje do wybranych filtrow — zmien je albo wyczysc.
        </p>
      )}
      {isPending && cohortId && <Skeleton className="h-96 w-full" />}

      {cohort && (
        // Tylko informacja: zajecia rocznika wynikaja z tej wersji programu (zmiana wersji — poza tym widokiem).
        <p className="text-sm text-muted-foreground">
          Plan korzysta z programu studiow{' '}
          <span className="cursor-help font-medium text-foreground" title={cohort.program.name}>
            {cohort.program.code}
          </span>
          {' · '}
          <Link
            to={`/curriculum/program/${cohort.programVersion.id}`}
            className="font-medium text-foreground underline underline-offset-4"
            title="Otworz przedmioty tej wersji programu"
          >
            {cohort.programVersion.label}
          </Link>
          {cohort.programVersion.status === 'DRAFT' ? (
            <Badge variant="outline" className="ml-2">projekt</Badge>
          ) : (
            <Badge variant="secondary" className="ml-2">zatwierdzona</Badge>
          )}
          {plan && (
            <>
              {' · siatka godzin '}
              <span className="font-medium text-foreground">{describeDays(plan.timeGrid.days)}</span>
            </>
          )}
        </p>
      )}
      {plan?.calendar?.status === 'ARCHIVED' && (isAdmin || me?.role === 'DEAN_OFFICE') && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>Kalendarz w archiwum — plan tylko do odczytu</AlertTitle>
          <AlertDescription>
            <p>
              Plan, terminy, zajecia i obsada tego rocznika to zapis tego, co sie odbylo — nie da sie ich zmienic.
              {isAdmin
                ? ' Jesli to pomylka, przywroc kalendarz w „Kalendarz semestru” (zmien status).'
                : ' Z archiwum moze go przywrocic tylko administrator.'}
            </p>
          </AlertDescription>
        </Alert>
      )}
      {plan && draftVersion && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Wersja programu w projekcie — plan tylko do odczytu</AlertTitle>
          <AlertDescription>
            <p>
              Plan uklada sie tylko z zatwierdzonego programu, bo wersja w projekcie moze sie jeszcze zmienic. Zatwierdz{' '}
              <Link
                to={`/curriculum/program/${plan.cohort.programVersion.id}`}
                className="font-medium underline underline-offset-4"
              >
                {plan.cohort.programVersion.label}
              </Link>
              , a potem zsynchronizuj zajecia na stronie „Obsada”. Istniejace umieszczenia zostaja.
            </p>
          </AlertDescription>
        </Alert>
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
          <AlertTitle>Terminy nieaktualne</AlertTitle>
          <AlertDescription>
            {staleMessage(plan.staleReasons)}{' '}
            {zjazdCalendar
              ? 'Plan zjazdu pokazuje juz zmiany, a terminy (Moj plan, publikacja) — stan sprzed nich; uzyj „Generuj terminy”, gdy skonczysz zmiany.'
              : 'Zakladka „Terminy” pokazuje jeszcze stan sprzed tych zmian — uzyj „Generuj terminy”, gdy skonczysz zmiany.'}
          </AlertDescription>
        </Alert>
      )}

      {plan && blocks && term && (
        <Tabs key={zjazdCalendar ? 'zjazd' : 'tydzien'} defaultValue="pattern">
          {/* Niestacjonarne (kalendarz zjazdow): jeden "Plan zjazdu" bez zakladek; tygodniowe: wzorzec + terminy. */}
          {!zjazdCalendar && (
            <TabsList>
              <TabsTrigger value="pattern">Wzorzec tygodnia</TabsTrigger>
              <TabsTrigger value="occurrences">Terminy ({plan.occurrenceCount})</TabsTrigger>
            </TabsList>
          )}

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
              {groupFilter !== 'all' && (
                <label
                  className="flex items-center gap-2 text-sm"
                  title="Zajecia grup, na ktore wybrana grupa nie chodzi — wyszarzone, zajmuja miejsce w siatce"
                >
                  <Checkbox checked={showOtherGroups} onCheckedChange={(v) => setShowOtherGroups(v === true)} />
                  Pokaz inne grupy
                </label>
              )}
              {zjazdCalendar && zjazdy.length === 0 && (
                <span className="text-sm text-muted-foreground">Kalendarz rocznika nie ma jeszcze zjazdow — dodaj je w „Kalendarzu semestru”.</span>
              )}
              {zjazdCalendar && zjazdy.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="mr-1 text-sm font-medium">Plan zjazdu:</span>
                  {zjazdy.map((z) => (
                    <Button
                      key={z.number}
                      size="sm"
                      variant={zjazd === z.number ? 'default' : 'outline'}
                      className="tabular-nums"
                      title={`Zjazd ${formatRange(z.startDate, z.endDate)}`}
                      onClick={() => setZjazd(z.number)}
                    >
                      tydz. {z.week}
                    </Button>
                  ))}
                  {zjazd !== null && !readOnly && (
                    <span className="ml-2 flex items-center gap-1 text-sm">
                      <Copy className="size-4" /> kopiuj tydz. {weekOf(zjazd)} na
                      <NativeSelect value={copyTo} onChange={(e) => setCopyTo(e.target.value)} className="w-28" aria-label="Zjazd docelowy">
                        <NativeSelectOption value="">—</NativeSelectOption>
                        {plan.calendar!.zjazdy.filter((z) => z.number !== zjazd).map((z) => (
                          <NativeSelectOption key={z.number} value={z.number}>
                            tydz. {z.week}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={toCopy.length === 0 || copyZjazd.isPending}
                        title={
                          copyTo && toCopy.length === 0
                            ? `Nic do skopiowania: kopiuja sie zajecia "na wybranych zjazdach" z tygodnia ${weekOf(zjazd)}, ktorych jeszcze nie ma w tygodniu ${weekOf(copyTo)}`
                            : undefined
                        }
                        onClick={() => copyZjazd.mutate()}
                      >
                        Kopiuj{copyTo && ` (${toCopy.length})`}
                      </Button>
                    </span>
                  )}
                </div>
              )}
              {selected && (
                <Badge variant="secondary" className="gap-1">
                  Umieszczasz: {selected.subject.name} ({CLASS_LABELS[selected.classType]}) {selected.group.name} —
                  <select
                    aria-label="Dlugosc zajec"
                    value={placeLength}
                    onChange={(e) => setLengthChoice({ sectionId: selected.id, length: Number(e.target.value) })}
                    className="rounded border bg-background px-1 py-0.5 text-xs"
                  >
                    {Array.from({ length: Math.min(MAX_SUGGESTED_LENGTH, selected.hours) }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n} h
                      </option>
                    ))}
                  </select>
                  — kliknij godzine
                  <button type="button" aria-label="Anuluj wybor" onClick={() => setSelected(null)}>
                    <X className="size-3" />
                  </button>
                </Badge>
              )}
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
              <WeekGrid
                days={days}
                closedDays={closedDays}
                dayHeader={zjazdDayHeader}
                blocks={blocks}
                blocksOf={blocksOf}
                items={items}
                availability={selected ? availability?.cells : null}
                passThrough={!!selected && !readOnly}
                onCellClick={
                  readOnly || !selected
                    ? undefined
                    : (day, order) => {
                        rememberFocus();
                        setTarget({ section: selected, placement: null, day, startOrder: order, zjazd, length: placeLength });
                      }
                }
                onItemClick={(id) => {
                  const owner = placementOwner.get(id);
                  if (!owner) return;
                  rememberFocus();
                  // Archiwum / bez uprawnien: szczegoly do odczytu (jak termin w zakladce "Terminy").
                  if (readOnly) setViewing(owner);
                  else setTarget({ section: owner.section, placement: owner.placement, day: owner.placement.dayOfWeek, startOrder: owner.placement.startOrder, zjazd });
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
                          Obsada
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
                      {archived
                        ? 'Kalendarz w archiwum — tylko informacja, planu juz sie nie zmienia.'
                        : 'Rytm wyczerpuje godziny wczesniej. Jesli to niezamierzone, zmniejsz liczbe umieszczen albo ustaw „Od/Do tygodnia”.'}
                    </p>
                  </div>
                )}
                {issues.length > 0 && (
                  <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
                    <div className="font-medium text-amber-700 dark:text-amber-400">Niezgodnosci w planie ({issues.length})</div>
                    <ul className="space-y-1">
                      {issues.map((row) => {
                        const placement = row.placementId ? row.section.placements.find((p) => p.id === row.placementId) : null;
                        const label = `${CLASS_LABELS[row.section.classType]} · ${row.section.subject.name} · ${row.section.group.name}`;
                        return (
                          <li key={row.key}>
                            {placement && !readOnly ? (
                              <button
                                type="button"
                                className="text-left font-medium underline-offset-2 hover:underline"
                                onClick={() =>
                                  setTarget({ section: row.section, placement, day: placement.dayOfWeek, startOrder: placement.startOrder, zjazd })
                                }
                              >
                                {label}
                              </button>
                            ) : (
                              <span className="font-medium">{label}</span>
                            )}
                            <div className="text-muted-foreground">{row.message}</div>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="text-muted-foreground">
                      {archived
                        ? 'Kalendarz w archiwum — tylko informacja, planu juz sie nie zmienia.'
                        : 'Zmiany obsady, sal, grup lub kalendarza po umieszczeniu zajec. Kliknij zajecia, zeby poprawic umieszczenie.'}
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

          {!zjazdCalendar && (
          <TabsContent value="occurrences" className="mt-3 space-y-3">
            {stationary && (
              <p className="text-sm text-muted-foreground">
                Studia stacjonarne — terminy tylko do wgladu: co bylo i co bedzie, dni wolne i zajecia z innego dnia wg
                kalendarza. Pojedynczych terminow sie nie przenosi. Zmiana planu od tygodnia: we wzorcu dotychczasowe
                umieszczenie „Do tygodnia”, nowe „Od tygodnia”, potem „Generuj terminy”.
              </p>
            )}
            <OccurrencesTab
              termKey={term.key}
              cohortId={cohortId}
              sections={sections}
              blocks={blocks}
              blocksOf={blocksOf}
              readOnly={readOnly || stationary}
              periods={plan?.calendar?.periods ?? []}
              modeDays={days}
            />
          </TabsContent>
          )}
        </Tabs>
      )}

      {viewing && (
        <Dialog open onOpenChange={(open) => !open && setViewing(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {CLASS_LABELS[viewing.section.classType]} · {viewing.section.subject.name}
              </DialogTitle>
              <DialogDescription>Umieszczenie we wzorcu — tylko do odczytu.</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Grupa</dt>
              <dd>{viewing.section.group.name}</dd>
              <dt className="text-muted-foreground">Termin</dt>
              <dd>
                {WEEKDAY_LABELS[viewing.placement.dayOfWeek]}{' '}
                {blocksOf(viewing.placement.dayOfWeek).find((b) => b.order === viewing.placement.startOrder)?.startTime}–
                {blocksOf(viewing.placement.dayOfWeek).find((b) => b.order === viewing.placement.endOrder)?.endTime}
              </dd>
              <dt className="text-muted-foreground">Rytm</dt>
              <dd>{patternLabel(viewing.placement, weekOf)}</dd>
              <dt className="text-muted-foreground">Sala</dt>
              <dd>{viewing.placement.room?.label ?? 'ON-LINE'}</dd>
              <dt className="text-muted-foreground">Prowadzacy</dt>
              <dd>{viewing.placement.instructor?.name ?? 'NN'}</dd>
              <dt className="text-muted-foreground">Godziny</dt>
              <dd>
                {viewing.section.plannedHours}/{viewing.section.hours} h zaplanowane
              </dd>
            </dl>
          </DialogContent>
        </Dialog>
      )}

      {target && plan && blocks && term && (
        <PlacementDialog
          termKey={term.key}
          plan={plan}
          days={days}
          blocksOf={blocksOf}
          target={target}
          onClose={() => setTarget(null)}
          onSaved={async (movedTo) => {
            setSelected(null);
            // Zajecia przeniesione do innego zjazdu: pokazujemy zjazd, do ktorego trafily.
            if (movedTo !== undefined) setZjazd(movedTo);
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
          filteredCohortIds={cohorts.map((c) => c.id)}
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
          filteredCohortIds={cohorts.map((c) => c.id)}
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
