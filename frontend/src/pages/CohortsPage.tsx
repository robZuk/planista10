import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, FilterX, Info, Search, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PageHeader } from '@/components/PageHeader';
import { FacultySelector } from '@/components/FacultySelector';
import { createCohort, fetchTermCohorts, setCohortTerm, updateCohort } from '@/api/cohorts';
import { fetchPrograms } from '@/api/programs';
import { useCurrentTerm } from '@/hooks/useTerm';
import { getErrorMessage } from '@/lib/errors';
import { CALENDAR_KIND_LABELS, STUDY_MODE_LABELS } from '@/lib/labels';
import { useAuthStore } from '@/store/authStore';
import { useFacultyFilterStore } from '@/store/facultyStore';
import type { AcademicTerm, IntakeCandidate, TermCohort } from '@/types';
import { CohortFacetFilters } from './cohorts/CohortFacetFilters';
import { useCohortFilters } from './cohorts/useCohortFilters';
import { GroupTreePanel } from './cohorts/GroupTreePanel';

/**
 * Roczniki aktywne w wybranym semestrze. Rocznik zaklada sie raz (nowy nabor) — potem
 * sam przechodzi przez kolejne semestry razem z grupami; tu sprawdza sie, w ktorym
 * semestrze programu jest, wedlug ktorego kalendarza ma zajecia, i koryguje grupy.
 */
export default function CohortsPage() {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const isAdmin = me?.role === 'ADMIN';
  const facultyFilter = useFacultyFilterStore((s) => s.facultyId);
  const { term } = useCurrentTerm();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  // Wyszukiwanie i "tylko bez kalendarza" sa tylko tej strony; reszta filtrow wspolna z Planem.
  const [search, setSearch] = useState('');
  const [withoutCalendar, setWithoutCalendar] = useState(false);

  const facultyParam = isAdmin ? facultyFilter : (me?.facultyId ?? undefined);
  const { data, isPending } = useQuery({
    queryKey: ['term-cohorts', term?.key, facultyParam],
    queryFn: () => fetchTermCohorts(term!.key, facultyParam),
    enabled: !!term,
  });

  const allCohorts = useMemo(() => data?.cohorts ?? [], [data]);
  const cohortFilter = useCohortFilters(allCohorts, { search, withoutCalendar });
  const visibleCohorts = cohortFilter.visible;
  const filtered = cohortFilter.facetsActive || search.trim() !== '' || withoutCalendar;
  const clearFilters = () => {
    cohortFilter.clearFacets();
    setSearch('');
    setWithoutCalendar(false);
  };

  const canEdit = (cohort: TermCohort) =>
    isAdmin || (me?.role === 'DEAN_OFFICE' && cohort.program.fieldOfStudy.facultyId === me.facultyId);
  const canCreate = isAdmin || (me?.role === 'DEAN_OFFICE' && !!me.facultyId);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['term-cohorts'] });

  const calendarMutation = useMutation({
    mutationFn: ({ cohort, calendarId }: { cohort: TermCohort; calendarId: string }) =>
      setCohortTerm(term!.key, cohort.id, { calendarId }),
    onSuccess: async () => {
      toast.success('Kalendarz rocznika zapisany');
      await refresh();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const lectureMutation = useMutation({
    mutationFn: ({ cohort, joint }: { cohort: TermCohort; joint: boolean }) =>
      updateCohort(cohort.id, { lectureMode: joint ? 'JOINT' : 'SEPARATE' }),
    onSuccess: async () => {
      toast.success('Zapisano');
      await refresh();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <>
      <PageHeader
        title="Roczniki i grupy"
        description={
          term
            ? `Roczniki uczace sie w semestrze ${term.label}. Grupy ida z rocznikiem przez cale studia — tu tylko je korygujesz.`
            : 'Wybierz semestr w naglowku.'
        }
        actions={
          <>
            {canCreate && term && (
              <Button onClick={() => setIntakeOpen(true)}>
                <UserPlus />
                Nowy nabor
              </Button>
            )}
          </>
        }
      />

      {isPending && <Skeleton className="h-48 w-full" />}

      {data && data.intakeCandidates.length > 0 && term && (
        <p className="text-sm text-muted-foreground">
          Programy bez naboru startujacego w tym semestrze:{' '}
          {data.intakeCandidates.map((p) => p.code).join(', ')}. Jesli jest nabor — zaloz go przyciskiem „Nowy nabor”.
        </p>
      )}

      {data?.cohorts.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>Brak rocznikow w tym semestrze</EmptyTitle>
            <EmptyDescription>Zaden rocznik nie ma w tym semestrze zajec wg programu.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {/* Filtry w kolejnosci zaleznosci: wydzial -> tryb, kierunek, stopien, semestr; potem wyszukiwanie. */}
      {term && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {isAdmin && <FacultySelector />}
          <CohortFacetFilters filters={cohortFilter.filters} facets={cohortFilter.facets} onChange={cohortFilter.setFacet} />
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Szukaj rocznika"
              placeholder="Szukaj: kod, kierunek..."
              className="w-56 pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2">
            <Checkbox checked={withoutCalendar} onCheckedChange={(v) => setWithoutCalendar(v === true)} />
            Tylko bez kalendarza
          </label>
          <span className="text-muted-foreground">
            {filtered ? `${visibleCohorts.length} z ${allCohorts.length} rocznikow` : `${allCohorts.length} rocznikow`}
          </span>
          {filtered && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <FilterX />
              Wyczysc filtry
            </Button>
          )}
        </div>
      )}

      {allCohorts.length > 0 && visibleCohorts.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FilterX />
            </EmptyMedia>
            <EmptyTitle>Brak rocznikow dla tych filtrow</EmptyTitle>
            <EmptyDescription>Zaden rocznik nie pasuje do wybranych filtrow — zmien je albo wyczysc.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <div className="space-y-3">
        {visibleCohorts.map((cohort) => {
          const open = expanded === cohort.id;
          const editable = canEdit(cohort);
          return (
            <Card key={cohort.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {cohort.program.code}
                  <Badge variant="secondary">
                    semestr {cohort.semester} · rok {cohort.studyYear}
                  </Badge>
                  {cohort.isNewIntake && <Badge>nowy nabor</Badge>}
                  <span className="text-sm font-normal text-muted-foreground">nabor {cohort.startTermLabel}</span>
                </CardTitle>
                <CardDescription>
                  {cohort.program.name} · program:{' '}
                  <Link to={`/curriculum/program/${cohort.programVersion.id}`} className="underline-offset-4 hover:underline">
                    {cohort.programVersion.label}
                  </Link>
                  {cohort.programVersion.status === 'DRAFT' && ' (projekt)'} · {cohort.size} studentow ·{' '}
                  {cohort.groupCount} grup
                </CardDescription>
                <CardAction>
                  <Button variant="outline" size="sm" onClick={() => setExpanded(open ? null : cohort.id)}>
                    {open ? <ChevronUp /> : <ChevronDown />}
                    Grupy
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <span className="text-muted-foreground">Kalendarz:</span>
                    {cohort.availableCalendars.length === 0 ? (
                      <span className="text-destructive">
                        brak kalendarza {STUDY_MODE_LABELS[cohort.program.studyMode].toLowerCase()} w tym semestrze
                      </span>
                    ) : (
                      <NativeSelect
                        aria-label="Kalendarz rocznika"
                        className="w-64"
                        disabled={!editable || calendarMutation.isPending}
                        value={cohort.calendar?.id ?? ''}
                        onChange={(e) => calendarMutation.mutate({ cohort, calendarId: e.target.value })}
                      >
                        {cohort.availableCalendars.map((c) => (
                          <NativeSelectOption key={c.id} value={c.id}>
                            {c.name} ({CALENDAR_KIND_LABELS[c.kind].toLowerCase()})
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    )}
                  </label>
                  {cohort.program.fieldOfStudy.specializations.length > 1 && (
                    <div className="flex items-center gap-1.5">
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={cohort.lectureMode === 'JOINT'}
                          disabled={!editable || lectureMutation.isPending}
                          onCheckedChange={(v) => lectureMutation.mutate({ cohort, joint: v === true })}
                        />
                        Wyklady przedmiotow wspolnych razem dla calego rocznika
                      </label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label="Co oznacza ta opcja?"
                            className="cursor-help text-muted-foreground hover:text-foreground"
                          >
                            <Info className="size-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="block space-y-1.5 text-left">
                          <p>
                            Dotyczy tylko wykladow przedmiotow wspolnych dla wszystkich specjalnosci rocznika.
                          </p>
                          <p>
                            <strong>Zaznaczone:</strong> jeden wyklad dla calego rocznika.
                            <br />
                            <strong>Odznaczone:</strong> osobny wyklad dla kazdej specjalnosci.
                          </p>
                          <p>Cwiczenia, laboratoria i przedmioty specjalnosciowe sie nie zmieniaja.</p>
                          <p>Zmiana obejmie zajecia po „Synchronizuj zajecia” w „Zajecia i obsada”.</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </div>
                {open && <GroupTreePanel cohort={cohort} canEdit={editable} />}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {intakeOpen && term && data && (
        <NewIntakeDialog
          term={term}
          candidates={data.intakeCandidates}
          onClose={() => setIntakeOpen(false)}
          onCreated={async () => {
            setIntakeOpen(false);
            await refresh();
          }}
        />
      )}
    </>
  );
}

function NewIntakeDialog({
  term,
  candidates,
  onClose,
  onCreated,
}: {
  term: AcademicTerm;
  candidates: IntakeCandidate[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const { data: programs } = useQuery({
    queryKey: ['programs', me?.role === 'ADMIN' ? 'all' : me?.facultyId],
    queryFn: () => fetchPrograms(me?.role === 'ADMIN' ? undefined : (me?.facultyId ?? undefined)),
  });
  const [programId, setProgramId] = useState(candidates[0]?.id ?? '');
  const [versionId, setVersionId] = useState('');
  const [copy, setCopy] = useState(true);
  const [rootSize, setRootSize] = useState('');
  const program = programs?.find((p) => p.id === programId);

  const mutation = useMutation({
    mutationFn: () =>
      createCohort({
        programId,
        startTermKey: term.key,
        ...(versionId ? { programVersionId: versionId } : {}),
        copyStructure: copy,
        ...(rootSize ? { rootSize: Number(rootSize) } : {}),
      }),
    onSuccess: (result) => {
      toast.success(result.message);
      onCreated();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nowy nabor — {term.label}</DialogTitle>
          <DialogDescription>
            Rocznik startuje w tym semestrze. Dostaje te sama wersje programu co poprzedni nabor i jego strukture grup
            z 1. semestru — potem poprawisz liczebnosci.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field>
            <FieldLabel htmlFor="intake-program">Program</FieldLabel>
            <NativeSelect id="intake-program" value={programId} onChange={(e) => setProgramId(e.target.value)}>
              <NativeSelectOption value="">— wybierz —</NativeSelectOption>
              {programs?.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="intake-version">Wersja programu</FieldLabel>
            <NativeSelect id="intake-version" value={versionId} onChange={(e) => setVersionId(e.target.value)}>
              <NativeSelectOption value="">jak poprzedni nabor (domyslnie)</NativeSelectOption>
              {program?.versions.map((v) => (
                <NativeSelectOption key={v.id} value={v.id}>
                  {v.label} {v.status === 'APPROVED' ? '' : '(projekt)'}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="intake-size">Liczba przyjetych (opcjonalnie)</FieldLabel>
            <Input id="intake-size" type="number" min={0} value={rootSize} onChange={(e) => setRootSize(e.target.value)} placeholder="jak w poprzednim naborze" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={copy} onCheckedChange={(v) => setCopy(v === true)} />
            Skopiuj strukture grup z poprzedniego naboru
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!programId || mutation.isPending}>
            {mutation.isPending && <Spinner />}
            Utworz nabor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
