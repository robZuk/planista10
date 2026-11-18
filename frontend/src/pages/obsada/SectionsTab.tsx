import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ChevronLeft, ChevronRight, CircleCheck, FilterX, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { groupSize, type SectionGroup } from '@/lib/obsadaGroups';
import { CLASS_FULL_LABELS } from '@/lib/scheduleDisplay';
import { matchesAllWords } from '@/lib/searchMatch';
import type { ClassSectionRow } from '@/types';

/** Pozycji (przedmiot × forma) na stronie — semestr wydzialu to setki pozycji, cala uczelnia tysiace. */
const PAGE_SIZE = 50;

type Person = { id: string; name: string };

/** Obsada jednej grupy: prowadzacy z godzinami, NN, braki i nadmiar godzin. */
function SectionStaff({ section }: { section: ClassSectionRow }) {
  if (section.instructors.length === 0) return <Badge variant="destructive">brak obsady</Badge>;
  return (
    <>
      {section.instructors.map((i) => (
        <Badge key={i.id} variant={i.instructorId ? 'secondary' : 'destructive'}>
          {i.name} · {i.hours} h
        </Badge>
      ))}
      {section.assignedHours < section.hours && <Badge variant="outline">brakuje {section.hours - section.assignedHours} h</Badge>}
      {section.assignedHours > section.hours && (
        <Badge variant="destructive" title="Obsada ma wiecej godzin niz zajecia — popraw podzial godzin">
          nadmiar {section.assignedHours - section.hours} h
        </Badge>
      )}
    </>
  );
}

/**
 * Zajecia semestru od strony zajec: pozycje przedmiot × forma z grupami (jak w zleceniach
 * wydzialu) i ich obsada. Tu widac braki — grupy bez prowadzacego, NN, niepelne godziny.
 */
export default function SectionsTab({
  rows,
  groups,
  canEdit,
  allStaffedOverall,
  instructorFilter,
  onInstructorFilterChange,
  onEdit,
  scopeKey,
}: {
  rows: ClassSectionRow[];
  groups: SectionGroup[];
  canEdit: boolean;
  /** Semestr bez brakow — pusty wynik "Tylko braki" to dobra wiadomosc, nie "nic nie znaleziono". */
  allStaffedOverall: boolean;
  instructorFilter: Person | null;
  onInstructorFilterChange: (person: Person | null) => void;
  onEdit: (group: SectionGroup) => void;
  /** Semestr i wydzial — zmiana wraca na pierwsza strone. */
  scopeKey: string;
}) {
  const [cohortFilter, setCohortFilter] = useState('all');
  const [onlyVacant, setOnlyVacant] = useState(false);
  const [search, setSearch] = useState('');

  const cohorts = useMemo(() => {
    const map = new Map<string, ClassSectionRow['cohort']>();
    for (const row of rows) map.set(row.cohort.id, row.cohort);
    return [...map.values()];
  }, [rows]);

  const shown = useMemo(() => {
    const q = search.trim();
    // Kazde slowo gdziekolwiek w pozycji, bez znaczenia polskie znaki ("matematyka dut" — przedmiot i grupa).
    return groups.filter(
      (g) =>
        (cohortFilter === 'all' || g.cohort.id === cohortFilter) &&
        (!onlyVacant || g.hasVacancy) &&
        (!instructorFilter || g.sections.some((s) => s.instructors.some((i) => i.instructorId === instructorFilter.id))) &&
        (!q ||
          matchesAllWords(
            [g.cohort.label, g.subject.name, g.specialization ?? '', ...g.sections.flatMap((s) => [s.group.name, ...s.instructors.map((i) => i.name)])].join(' '),
            q,
          )),
    );
  }, [groups, cohortFilter, onlyVacant, search, instructorFilter]);

  // Zmiana filtra wraca na pierwsza strone (strona pamietana razem z kluczem filtrow).
  const filterKey = `${cohortFilter}|${onlyVacant}|${search}|${instructorFilter?.id}|${scopeKey}`;
  const [pageState, setPageState] = useState({ key: filterKey, page: 0 });
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const page = pageState.key === filterKey ? Math.min(pageState.page, pageCount - 1) : 0;
  const setPage = (p: number) => setPageState({ key: filterKey, page: p });
  const pageGroups = shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const filtersActive = cohortFilter !== 'all' || onlyVacant || search.trim() !== '' || !!instructorFilter;
  const clearFilters = () => {
    setCohortFilter('all');
    setOnlyVacant(false);
    setSearch('');
    onInstructorFilterChange(null);
  };
  const allStaffed = onlyVacant && cohortFilter === 'all' && search.trim() === '' && !instructorFilter && allStaffedOverall;

  return (
    <div className="space-y-4">
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
        {instructorFilter && (
          <Badge variant="secondary" className="h-7 gap-1 pr-1">
            Prowadzacy: {instructorFilter.name}
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              aria-label="Pokaz zajecia wszystkich prowadzacych"
              onClick={() => onInstructorFilterChange(null)}
            >
              <X />
            </Button>
          </Badge>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={onlyVacant} onCheckedChange={(v) => setOnlyVacant(v === true)} />
          Tylko braki (NN / niepelna obsada)
        </label>
        <span className="text-sm text-muted-foreground">
          {filtersActive ? `${shown.length} z ${groups.length} pozycji` : `${groups.length} pozycji`} · {rows.length} grup
        </span>
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <FilterX /> Wyczysc filtry
          </Button>
        )}
      </div>

      {shown.length === 0 && (
        <Empty className="h-fit border">
          <EmptyHeader>
            <EmptyMedia variant="icon">{allStaffed ? <CircleCheck /> : <FilterX />}</EmptyMedia>
            <EmptyTitle>{allStaffed ? 'Brak brakow w obsadzie' : 'Brak zajec dla tych filtrow'}</EmptyTitle>
            <EmptyDescription>
              {allStaffed
                ? 'Wszystkie zajecia semestru maja pelna obsade — nie ma NN ani niepelnych godzin.'
                : 'Zadne zajecia nie pasuja do wybranego rocznika, prowadzacego, wyszukiwania lub filtra brakow.'}
            </EmptyDescription>
          </EmptyHeader>
          {filtersActive && (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              <FilterX /> {allStaffed ? 'Pokaz wszystkie zajecia' : 'Wyczysc filtry'}
            </Button>
          )}
        </Empty>
      )}

      {shown.length > 0 && (
        <div className="space-y-2">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rocznik</TableHead>
                  <TableHead>Przedmiot</TableHead>
                  <TableHead>Forma</TableHead>
                  <TableHead>Wymiar</TableHead>
                  <TableHead>Obsada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageGroups.map((g) => {
                  const editable = canEdit && !g.archived;
                  return (
                    <TableRow
                      key={g.key}
                      className={editable ? 'cursor-pointer' : undefined}
                      title={g.archived ? 'Kalendarz rocznika w archiwum — obsada tylko do odczytu' : undefined}
                      onClick={() => editable && onEdit(g)}
                    >
                      <TableCell className="align-top whitespace-nowrap text-muted-foreground">
                        {g.cohort.code} · s{g.cohort.semester}
                      </TableCell>
                      <TableCell className="align-top font-medium">
                        {g.subject.name}
                        <Link
                          to={`/curriculum/program/${g.programVersionId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="ml-1.5 inline-flex align-middle text-muted-foreground hover:text-foreground"
                          title="Pozycja w programie studiow (godziny, ECTS, wersja programu)"
                          aria-label="Pozycja w programie studiow"
                        >
                          <BookOpen className="size-3.5" />
                        </Link>
                        {g.specialization && (
                          <Badge
                            variant="outline"
                            className="ml-2 cursor-help"
                            title={`Przedmiot specjalnosci ${g.specialization}${g.specializationName ? ` (${g.specializationName})` : ''} — tylko dla jej studentow`}
                          >
                            {g.specialization}
                          </Badge>
                        )}
                        {g.department && (
                          <Badge variant="secondary" className="ml-2" title={`Katedra prowadzaca te forme: ${g.department.name}`}>
                            {g.department.label}
                          </Badge>
                        )}
                        {g.planOutsideStaff > 0 && (
                          <Badge
                            variant="outline"
                            className="ml-2 border-amber-500 text-amber-700 dark:text-amber-400"
                            title="W planie te zajecia ma prowadzacy, ktorego nie ma juz w obsadzie. Otworz je w Ukladaniu planu i wybierz prowadzacego."
                          >
                            plan: inny prowadzacy ({g.planOutsideStaff})
                          </Badge>
                        )}
                        {g.orphaned && (
                          <Badge variant="destructive" className="ml-2">
                            osierocone
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="align-top">{CLASS_FULL_LABELS[g.classType]}</TableCell>
                      <TableCell className="align-top whitespace-nowrap tabular-nums">{groupSize(g)}</TableCell>
                      <TableCell>
                        {g.sections.length === 1 ? (
                          <div className="flex flex-wrap gap-1">
                            <SectionStaff section={g.sections[0]!} />
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {g.sections.map((s) => (
                              <div key={s.id} className="flex flex-wrap items-center gap-1">
                                <span className="mr-1 text-xs whitespace-nowrap text-muted-foreground">{s.group.name}</span>
                                <SectionStaff section={s} />
                              </div>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {pageCount > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Strona {page + 1} z {pageCount} (pozycje {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, shown.length)} z {shown.length})
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
    </div>
  );
}
