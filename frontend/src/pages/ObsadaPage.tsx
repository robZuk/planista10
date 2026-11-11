import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CircleCheck, Download, FilterX, History, RefreshCw, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/PageHeader';
import { FacultySelector } from '@/components/FacultySelector';
import { downloadSectionsCsv, fetchSections, fetchWorkload } from '@/api/sections';
import { useCurrentTerm } from '@/hooks/useTerm';
import { getErrorMessage } from '@/lib/errors';
import { CLASS_FULL_LABELS } from '@/lib/scheduleDisplay';
import { useAuthStore } from '@/store/authStore';
import { useFacultyFilterStore } from '@/store/facultyStore';
import type { ClassSectionRow } from '@/types';
import { AssignmentDialog, CarryDialog, ImportDialog, SyncDialog } from './obsada/ObsadaDialogs';

/**
 * Zajecia i obsada semestru — osobny etap przed ukladaniem planu. Lista zajec wynika
 * z programow i grup rocznikow (synchronizacja); tu wpisuje sie tez, kto prowadzi ile
 * godzin. Obsade mozna przeniesc z poprzedniego roku albo wczytac z CSV od katedr.
 */
const PAGE_SIZE = 50;

/** Procent obsady w dol — 100% dopiero przy pelnej obsadzie (99,99% to wciaz brakujace godziny). */
function staffedPercent(assigned: number, total: number): number {
  if (total <= 0) return 0;
  return assigned >= total ? 100 : Math.floor((100 * assigned) / total);
}

export default function ObsadaPage() {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const isAdmin = me?.role === 'ADMIN';
  const canEdit = isAdmin || (me?.role === 'DEAN_OFFICE' && !!me.facultyId);
  const facultyFilter = useFacultyFilterStore((s) => s.facultyId);
  const facultyId = isAdmin ? facultyFilter : undefined;
  const { term } = useCurrentTerm();

  const [cohortFilter, setCohortFilter] = useState('all');
  const [onlyVacant, setOnlyVacant] = useState(false);
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<'sync' | 'carry' | 'import' | null>(null);
  const [editing, setEditing] = useState<ClassSectionRow | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['sections', term?.key, facultyId],
    queryFn: () => fetchSections(term!.key, facultyId),
    enabled: !!term,
  });
  const { data: workload } = useQuery({
    queryKey: ['workload', term?.key, facultyId],
    queryFn: () => fetchWorkload(term!.key, facultyId),
    enabled: !!term,
  });

  const refresh = async () => {
    setDialog(null);
    setEditing(null);
    await queryClient.invalidateQueries({ queryKey: ['sections'] });
    await queryClient.invalidateQueries({ queryKey: ['workload'] });
  };

  const cohorts = useMemo(() => {
    const map = new Map<string, ClassSectionRow['cohort']>();
    for (const row of data?.rows ?? []) map.set(row.cohort.id, row.cohort);
    return [...map.values()];
  }, [data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.rows ?? []).filter(
      (r) =>
        (cohortFilter === 'all' || r.cohort.id === cohortFilter) &&
        (!onlyVacant || r.hasVacancy) &&
        (!q ||
          r.subject.name.toLowerCase().includes(q) ||
          r.group.name.toLowerCase().includes(q) ||
          r.instructors.some((i) => i.name.toLowerCase().includes(q))),
    );
  }, [data, cohortFilter, onlyVacant, search]);

  // Strony po 50 wierszy — semestr wydzialu to setki zajec (WM: ~900), cala uczelnia — tysiace.
  // Zmiana filtra wraca na pierwsza strone (strona pamietana razem z kluczem filtrow).
  const filterKey = `${cohortFilter}|${onlyVacant}|${search}|${facultyId}|${term?.key}`;
  const [pageState, setPageState] = useState({ key: filterKey, page: 0 });
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = pageState.key === filterKey ? Math.min(pageState.page, pageCount - 1) : 0;
  const setPage = (p: number) => setPageState({ key: filterKey, page: p });
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const summary = data?.summary;
  const filtersActive = cohortFilter !== 'all' || onlyVacant || search.trim() !== '';
  const clearFilters = () => {
    setCohortFilter('all');
    setOnlyVacant(false);
    setSearch('');
  };
  // Pusty wynik samego "Tylko braki" przy braku brakow to dobra wiadomosc, nie "nic nie znaleziono".
  const allStaffed = onlyVacant && cohortFilter === 'all' && search.trim() === '' && summary?.vacancies === 0;

  return (
    <>
      <PageHeader
        title="Zajecia i obsada"
        description={
          term
            ? `Semestr ${term.label}: zajecia wynikajace z programow i grup rocznikow oraz kto je prowadzi i ile godzin.`
            : 'Wybierz semestr w naglowku.'
        }
        actions={
          <>
            {isAdmin && <FacultySelector />}
            {canEdit && term && !summary?.archived && (
              <>
                <Button variant="outline" onClick={() => setDialog('sync')}>
                  <RefreshCw /> Synchronizuj zajecia
                </Button>
                <Button variant="outline" onClick={() => setDialog('carry')}>
                  <History /> Obsada z poprzedniego roku
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => downloadSectionsCsv(term.key, facultyId).catch((e) => toast.error(getErrorMessage(e)))}
                >
                  <Download /> CSV
                </Button>
                <Button variant="ghost" onClick={() => setDialog('import')}>
                  <Upload /> Import
                </Button>
              </>
            )}
          </>
        }
      />

      {summary?.archived && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          Kalendarze rocznikow sa w archiwum — zajecia i obsada tego semestru sa tylko do odczytu.
        </p>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ['Zajec', summary.sections],
            ['Godzin', summary.hours],
            ['Obsadzonych godzin', `${summary.assignedHours} (${staffedPercent(summary.assignedHours, summary.hours)}%)`],
            ['Zajec z brakami', summary.vacancies],
            ['Osieroconych', summary.orphaned],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-xl font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
      )}

      {data && data.rows.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          W tym semestrze nie ma jeszcze zajec. Uzyj „Synchronizuj zajecia” — powstana z programow i grup rocznikow.
        </p>
      )}

      {data && data.rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <NativeSelect value={cohortFilter} onChange={(e) => setCohortFilter(e.target.value)} className="w-72" aria-label="Rocznik">
            <NativeSelectOption value="all">Wszystkie roczniki</NativeSelectOption>
            {cohorts.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.code} · semestr {c.semester}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <div className="relative">
            <Search className="absolute top-2.5 left-2 size-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Przedmiot, grupa, prowadzacy…" className="w-72 pl-8" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={onlyVacant} onCheckedChange={(v) => setOnlyVacant(v === true)} />
            Tylko braki (NN / niepelna obsada)
          </label>
          <span className="text-sm text-muted-foreground">
            {filtersActive ? `${rows.length} z ${data.rows.length} pozycji` : `${rows.length} pozycji`}
          </span>
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <FilterX /> Wyczysc filtry
            </Button>
          )}
        </div>
      )}

      {isPending && term && <Skeleton className="h-64 w-full" />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        {/* Lewa kolumna zostaje takze przy pustym wyniku filtra — inaczej karta obciazenia
            zajmowala cala szerokosc i wygladala jak wynik filtra. */}
        {data && data.rows.length > 0 && rows.length === 0 && (
          <Empty className="h-fit border">
            <EmptyHeader>
              <EmptyMedia variant="icon">{allStaffed ? <CircleCheck /> : <FilterX />}</EmptyMedia>
              <EmptyTitle>{allStaffed ? 'Brak brakow w obsadzie' : 'Brak zajec dla tych filtrow'}</EmptyTitle>
              <EmptyDescription>
                {allStaffed
                  ? 'Wszystkie zajecia semestru maja pelna obsade — nie ma NN ani niepelnych godzin.'
                  : 'Zadne zajecia nie pasuja do wybranego rocznika, wyszukiwania lub filtra brakow.'}
              </EmptyDescription>
            </EmptyHeader>
            {filtersActive && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                <FilterX /> {allStaffed ? 'Pokaz wszystkie zajecia' : 'Wyczysc filtry'}
              </Button>
            )}
          </Empty>
        )}

        {rows.length > 0 && (
          <div className="min-w-0 space-y-2">
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rocznik</TableHead>
                    <TableHead>Przedmiot</TableHead>
                    <TableHead>Forma</TableHead>
                    <TableHead>Grupa</TableHead>
                    <TableHead className="text-right">Godz.</TableHead>
                    <TableHead>Obsada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((row) => (
                    <TableRow
                      key={row.id}
                      className={canEdit && !row.cohort.archived ? 'cursor-pointer' : undefined}
                      title={row.cohort.archived ? 'Kalendarz rocznika w archiwum — obsada tylko do odczytu' : undefined}
                      onClick={() => canEdit && !row.cohort.archived && setEditing(row)}
                    >
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {row.cohort.code} · s{row.cohort.semester}
                      </TableCell>
                      <TableCell className="font-medium">
                        {row.subject.name}
                        {row.specialization && (
                          <Badge
                            variant="outline"
                            className="ml-2 cursor-help"
                            title={`Przedmiot specjalnosci ${row.specialization}${row.specializationName ? ` (${row.specializationName})` : ''} — tylko dla jej studentow`}
                          >
                            {row.specialization}
                          </Badge>
                        )}
                        {row.status === 'ORPHANED' && (
                          <Badge variant="destructive" className="ml-2">
                            osierocone
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{CLASS_FULL_LABELS[row.classType]}</TableCell>
                      <TableCell className="whitespace-nowrap">{row.group.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.hours}</TableCell>
                      <TableCell>
                        {row.instructors.length === 0 ? (
                          <Badge variant="destructive">brak obsady</Badge>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {row.instructors.map((i) => (
                              <Badge key={i.id} variant={i.instructorId ? 'secondary' : 'destructive'}>
                                {i.name} · {i.hours} h
                              </Badge>
                            ))}
                            {row.assignedHours < row.hours && (
                              <Badge variant="outline">brakuje {row.hours - row.assignedHours} h</Badge>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {pageCount > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  Strona {page + 1} z {pageCount} (wiersze {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, rows.length)} z {rows.length})
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage(page - 1)} disabled={page === 0}>
                    <ChevronLeft />
                    Poprzednia
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={page >= pageCount - 1}>
                    Nastepna
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {workload && workload.length > 0 && (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">Obciazenie prowadzacych</CardTitle>
              <CardDescription>Caly semestr — niezaleznie od filtrow listy.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {workload.map((w) => (
                  <li key={w.id} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate" title={w.name}>
                      {w.name}
                    </span>
                    <span className="shrink-0 whitespace-nowrap tabular-nums">
                      {w.here} h{w.total !== w.here && <span className="text-muted-foreground"> / {w.total}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {term && dialog === 'sync' && <SyncDialog termKey={term.key} facultyId={facultyId} onClose={() => setDialog(null)} onDone={refresh} />}
      {term && dialog === 'carry' && <CarryDialog termKey={term.key} facultyId={facultyId} onClose={() => setDialog(null)} onDone={refresh} />}
      {term && dialog === 'import' && <ImportDialog termKey={term.key} facultyId={facultyId} onClose={() => setDialog(null)} onDone={refresh} />}
      {editing && <AssignmentDialog section={editing} onClose={() => setEditing(null)} onDone={refresh} />}
    </>
  );
}
