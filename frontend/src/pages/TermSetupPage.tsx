import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, CircleAlert, EyeOff, FilterX, ListFilter, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/PageHeader';
import { FacultySelector } from '@/components/FacultySelector';
import { fetchSetup } from '@/api/plan';
import { useCurrentTerm } from '@/hooks/useTerm';
import { CALENDAR_STATUS_LABELS, STUDY_MODE_LABELS } from '@/lib/labels';
import { staleMessage } from '@/lib/planStaleness';
import { cn } from '@/lib/utils';
import { setupIssues, sortSetupCohorts } from '@/lib/setupIssues';
import { cohortsWithIssues, setupSteps, STEP_ISSUES, type SetupStep, type StepState } from '@/lib/setupSteps';
import { CohortFacetFilters } from './cohorts/CohortFacetFilters';
import { useCohortFilters } from './cohorts/useCohortFilters';
import { useAuthStore } from '@/store/authStore';
import { useFacultyFilterStore } from '@/store/facultyStore';

const STATE_ICON: Record<StepState, { Icon: typeof CheckCircle2; className: string; label: string }> = {
  done: { Icon: CheckCircle2, className: 'text-green-600', label: 'gotowe' },
  warn: { Icon: CircleAlert, className: 'text-amber-600', label: 'do uzupelnienia' },
  todo: { Icon: Circle, className: 'text-muted-foreground', label: 'do zrobienia' },
};

/** `cohorts` — roczniki z brakami tego kroku: przycisk zaweza do nich tabele ponizej. */
function Step({ step, cohorts, onShowCohorts }: { step: SetupStep; cohorts: number; onShowCohorts?: () => void }) {
  const { Icon, className, label } = STATE_ICON[step.state];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={className} aria-label={label} />
          {step.n}. {step.title}
        </CardTitle>
        <CardDescription>{step.summary}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {step.todo && (
          <p className={cn('text-sm font-medium', step.state === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-foreground')}>
            Do zrobienia: {step.todo}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link to={step.to} className="text-sm font-medium text-primary hover:underline">
            {step.link} →
          </Link>
          {onShowCohorts && cohorts > 0 && (
            <button type="button" onClick={onShowCohorts} className="inline-flex items-center gap-1 text-sm font-medium text-amber-600 hover:underline dark:text-amber-400">
              <ListFilter className="size-3.5" /> Pokaz roczniki ({cohorts})
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Przygotowanie semestru — lista kontrolna wydzialu z licznikami: kalendarz, roczniki,
 * zajecia, obsada, plan, terminy i publikacja. Nic tu nie dzieje sie automatycznie —
 * kazdy krok prowadzi do strony, na ktorej planista wykonuje go sam.
 */
export default function TermSetupPage() {
  const me = useAuthStore((s) => s.user);
  const isAdmin = me?.role === 'ADMIN';
  const facultyFilter = useFacultyFilterStore((s) => s.facultyId);
  const facultyId = isAdmin ? facultyFilter : undefined;
  const { term } = useCurrentTerm();
  const { data, isPending } = useQuery({
    queryKey: ['setup', term?.key, facultyId],
    queryFn: () => fetchSetup(term!.key, facultyId),
    enabled: !!term,
  });

  const [onlyIssues, setOnlyIssues] = useState(false);
  // „Pokaz roczniki” z karty kroku: tabela tylko z rocznikami z brakami tego kroku (?krok=N w adresie).
  const [params, setParams] = useSearchParams();
  const stepParam = Number(params.get('krok'));
  const stepFilter = STEP_ISSUES[stepParam] ? stepParam : null;
  const tableRef = useRef<HTMLDivElement>(null);
  const setStepFilter = (n: number | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (n === null) next.delete('krok');
        else next.set('krok', String(n));
        return next;
      },
      { replace: true },
    );

  const t = data?.totals;
  const key = term?.key ?? '';
  // Filtry rocznikow wspolne z Rocznikami i Planem (tryb globalny, reszta zapamietana). Karty
  // powyzej licza caly wydzial — filtry zawezaja tylko tabele.
  const allCohorts = useMemo(() => data?.cohorts ?? [], [data]);
  const cohortFilter = useCohortFilters(allCohorts);
  // Roczniki z brakami na gorze; komorka z brakiem wyrozniona (lib/setupIssues).
  const rows = sortSetupCohorts(cohortFilter.visible).map((c) => ({ c, issues: setupIssues(c) }));
  const withIssues = rows.filter((r) => r.issues.size > 0).length;
  const visibleRows = stepFilter
    ? rows.filter((r) => STEP_ISSUES[stepFilter]!.some((i) => r.issues.has(i)))
    : onlyIssues
      ? rows.filter((r) => r.issues.size > 0)
      : rows;
  const filtered = cohortFilter.facetsActive || onlyIssues || stepFilter !== null;
  const clearFilters = () => {
    cohortFilter.clearFacets();
    setOnlyIssues(false);
    setStepFilter(null);
  };
  // Liczby na kartach dotycza calego wydzialu — filtry rocznikow zdejmujemy, zeby tabela pokazala wszystkie.
  const showStepCohorts = (n: number) => {
    cohortFilter.clearFacets();
    setOnlyIssues(false);
    setStepFilter(n);
    requestAnimationFrame(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const steps = data ? setupSteps(data, key) : [];
  const STEP_FILTER_LABEL: Record<number, string> = {
    5: 'krok 5 — braki obsady',
    6: 'krok 6 — zajecia poza planem',
    7: 'krok 7 — terminy (brak, nieaktualne albo za malo godzin)',
  };
  // Plan widza studenci i prowadzacy tylko z kalendarzy opublikowanych lub w archiwum (services/visibility).
  const unpublished = (data?.calendars ?? []).filter((c) => c.status === 'PLANNING');
  const warn = (on: boolean) => (on ? 'font-semibold text-amber-600 dark:text-amber-400' : undefined);
  return (
    <>
      <PageHeader
        title="Przygotowanie semestru"
        description={term ? `Semestr ${term.label} — co jest gotowe, a co zostalo.` : 'Wybierz semestr w naglowku.'}
        actions={isAdmin && <FacultySelector />}
      />
      {isPending && term && <Skeleton className="h-64 w-full" />}
      {data && t && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {(['done', 'warn', 'todo'] as const).map((st) => {
              const { Icon, className, label } = STATE_ICON[st];
              return (
                <span key={st} className="inline-flex items-center gap-1">
                  <Icon className={cn('size-3.5', className)} /> {label}
                </span>
              );
            })}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {steps.map((step) => (
              <Step
                key={step.n}
                step={step}
                cohorts={STEP_ISSUES[step.n] && step.state !== 'done' ? cohortsWithIssues(allCohorts, STEP_ISSUES[step.n]!) : 0}
                onShowCohorts={() => showStepCohorts(step.n)}
              />
            ))}
          </div>

          {unpublished.length > 0 && (
            <Alert>
              <EyeOff />
              <AlertTitle>Studenci i prowadzacy nie widza jeszcze planu</AlertTitle>
              <AlertDescription>
                <p>
                  {unpublished.length === 1 ? 'Kalendarz w przygotowaniu' : 'Kalendarze w przygotowaniu'}:{' '}
                  {unpublished.map((c) => `${STUDY_MODE_LABELS[c.studyMode]} · ${c.name}`).join('; ')}. Plan rocznikow wg{' '}
                  {unpublished.length === 1 ? 'tego kalendarza' : 'tych kalendarzy'} widzi tylko dziekanat — opublikuj go w{' '}
                  <Link to={`/calendar/${key}`} className="font-medium text-primary underline-offset-4 hover:underline">
                    Kalendarzu semestru
                  </Link>
                  , gdy plan bedzie gotowy.
                </p>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <CohortFacetFilters filters={cohortFilter.filters} facets={cohortFilter.facets} onChange={cohortFilter.setFacet} loading={isPending} />
            {stepFilter && (
              <Badge variant="secondary" className="h-7 gap-1 border-amber-500/60 pr-1">
                Roczniki: {STEP_FILTER_LABEL[stepFilter]}
                <Button variant="ghost" size="icon" className="size-5" aria-label="Pokaz wszystkie roczniki" onClick={() => setStepFilter(null)}>
                  <X />
                </Button>
              </Badge>
            )}
            <label className="flex items-center gap-2">
              <Checkbox
                checked={onlyIssues}
                onCheckedChange={(v) => {
                  setOnlyIssues(v === true);
                  if (v === true) setStepFilter(null);
                }}
              />
              Tylko roczniki z brakami ({withIssues})
            </label>
            <span className="text-muted-foreground">
              {isPending
                ? 'wczytywanie rocznikow…'
                : filtered
                  ? `${visibleRows.length} z ${allCohorts.length} rocznikow`
                  : `${allCohorts.length} rocznikow`}
            </span>
            {filtered && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <FilterX /> Wyczysc filtry
              </Button>
            )}
          </div>
          <p className="-mt-1 text-xs text-muted-foreground">
            Roczniki z brakami sa na gorze; kliknij rocznik, zeby otworzyc jego plan. Karty powyzej licza caly wydzial.
          </p>

          <div ref={tableRef} className="scroll-mt-4 overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rocznik</TableHead>
                  <TableHead>Wersja programu</TableHead>
                  <TableHead>Kalendarz</TableHead>
                  <TableHead className="text-right">Grupy</TableHead>
                  <TableHead className="text-right">Zajecia</TableHead>
                  <TableHead className="text-right">Braki obsady</TableHead>
                  <TableHead className="text-right">Umieszczone</TableHead>
                  <TableHead className="text-right">Terminy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                      {onlyIssues && withIssues === 0
                        ? 'Wszystkie roczniki sa gotowe — brak brakow.'
                        : 'Zaden rocznik nie pasuje do wybranych filtrow.'}
                    </TableCell>
                  </TableRow>
                )}
                {visibleRows.map(({ c, issues }) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium whitespace-nowrap">
                      <Link
                        to={`/plan/${key}?cohort=${c.id}`}
                        title="Otworz ten rocznik w Ukladaniu planu"
                        className="underline-offset-4 hover:underline"
                      >
                        {c.code} · semestr {c.semester}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Link to={`/curriculum/program/${c.programVersion.id}`} className="underline-offset-4 hover:underline">
                        {c.programVersion.label}
                      </Link>
                      {c.programVersion.status === 'DRAFT' && (
                        <Badge variant="destructive" className="ml-1">
                          projekt
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.calendar ? `${c.calendar.name} (${CALENDAR_STATUS_LABELS[c.calendar.status].toLowerCase()})` : <span className="text-destructive">brak</span>}
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', warn(issues.has('NO_GROUPS')))}>{c.groups}</TableCell>
                    <TableCell
                      className={cn('text-right tabular-nums', warn(issues.has('NO_SECTIONS')))}
                      title={c.programEntries === 0 ? `Program nie ma przedmiotow w semestrze ${c.semester}` : undefined}
                    >
                      {c.programEntries === 0 ? <span className="text-muted-foreground">brak w programie</span> : c.sections}
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', warn(issues.has('VACANCIES')))}>{c.vacancies}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', warn(issues.has('UNPLACED')))}>
                      {c.placedSections}/{c.sections}
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', warn(issues.has('NO_OCCURRENCES')))}>
                      {c.occurrences}
                      {c.shortSections > 0 && (
                        <Badge
                          variant="outline"
                          className="ml-1 cursor-help border-amber-500/60 text-amber-600 dark:text-amber-400"
                          title="Terminy tych zajec daja mniej godzin niz program (np. przez swieta). Szczegoly: „Do zaplanowania” w Ukladaniu planu."
                        >
                          brak godzin: {c.shortSections}
                        </Badge>
                      )}
                      {c.stale && (
                        <Badge
                          variant="outline"
                          className="ml-1 cursor-help border-amber-500/60 text-amber-600 dark:text-amber-400"
                          title={`${staleMessage(c.staleReasons)} Uzyj „Generuj terminy” w Ukladaniu planu.`}
                        >
                          nieaktualne
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </>
  );
}
