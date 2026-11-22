import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarRange, Search, UserRoundSearch, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/PageHeader';
import { PlanPdfDialog } from '@/components/PlanPdfDialog';
import { fetchFaculties } from '@/api/faculties';
import { fetchInstructors } from '@/api/instructors';
import { useCurrentTerm } from '@/hooks/useTerm';
import { usePlanPdf } from '@/hooks/usePlanPdf';
import { departmentLabel, instructorName } from '@/lib/departments';
import { getErrorMessage } from '@/lib/errors';
import { plural } from '@/lib/setupSteps';
import { busyByResource, freeRange, indexEntries, isFree, overlapping, timeAxis } from '@/lib/occupancyView';
import {
  NO_DEPARTMENT,
  NO_FACULTY,
  defaultFacultyFilter,
  departmentsInFaculty,
  instructorRows,
  instructorUnit,
} from '@/lib/instructorOccupancy';
import { useAuthStore } from '@/store/authStore';
import { useFacultyFilterStore } from '@/store/facultyStore';
import type { Instructor, OccupancyEntry } from '@/types';
import { WeekTable, type WeekSort } from './occupancy/WeekTable';
import { DayTimeline } from './occupancy/DayTimeline';
import { EntryDialog } from './occupancy/EntryDialog';
import { DayControls } from './occupancy/DayControls';
import { OccupancyLegend } from './occupancy/Legend';
import { WeekNav } from './occupancy/WeekNav';
import { useOccupancyWeek } from './occupancy/useOccupancyWeek';
import type { OccupancyRow } from './occupancy/resource';

/** Prowadzacy jako wiersz widoku zajetosci: nazwisko i imie, pod spodem tytul i katedra. */
const toRow = (i: Instructor): OccupancyRow => {
  const unit = instructorUnit(i);
  return {
    id: i.id,
    label: `${i.lastName} ${i.firstName}`,
    sublabel: [i.title, unit ?? 'bez katedry'].filter(Boolean).join(' · '),
    title: [instructorName(i), unit].filter(Boolean).join(' · '),
  };
};

/**
 * Zajetosc prowadzacych — jak „Zajetosc sal”, tylko wierszem jest prowadzacy: cala uczelnia na konkretnych
 * datach (plan wszystkich wydzialow wg wzorca, jak przy kolizjach, takze przed „Generuj terminy”; terminy
 * reczne; zajetosci zewnetrzne prowadzacych), zajecia online tez zajmuja prowadzacego. Tydzien: prowadzacy ×
 * dni z paskami zajec i godzinami tygodnia; klik w dzien — os godzin z kafelkami (sala i grupy) i szukanie
 * prowadzacych wolnych w podanych godzinach (np. w katedrze). Tylko do wgladu.
 */
export default function InstructorOccupancyPage() {
  const { term } = useCurrentTerm();
  const me = useAuthStore((s) => s.user);
  const globalFaculty = useFacultyFilterStore((s) => s.facultyId);
  const setGlobalFaculty = useFacultyFilterStore((s) => s.setFacultyId);

  const [facultyChoice, setFacultyChoice] = useState<string | null>(null);
  const [departmentChoice, setDepartmentChoice] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<WeekSort>('name');
  const [freeFrom, setFreeFrom] = useState('');
  const [freeTo, setFreeTo] = useState('');
  const [selected, setSelected] = useState<OccupancyEntry | null>(null);
  const pdf = usePlanPdf(term?.key);

  const { data: instructors, isPending: instructorsPending } = useQuery({ queryKey: ['instructors'], queryFn: fetchInstructors });
  const { data: faculties } = useQuery({ queryKey: ['faculties'], queryFn: fetchFaculties });
  const { entries, days, holidays, week, weeks, day, dayParam, setParam, goToWeek, isPending, isFetching, isPlaceholderData, error } = useOccupancyWeek(
    'instructor',
    term?.key,
  );

  const faculty = facultyChoice ?? defaultFacultyFilter(me?.role, me?.facultyId, globalFaculty, instructors ?? []);
  const departments = useMemo(() => departmentsInFaculty(instructors ?? [], faculty), [instructors, faculty]);
  // Katedra spoza wybranego wydzialu dawalaby pusta liste — wtedy wszystkie katedry.
  const department =
    departmentChoice === 'all' || departmentChoice === NO_DEPARTMENT || departments.some((d) => d.id === departmentChoice) ? departmentChoice : 'all';
  const sortedFaculties = useMemo(() => [...(faculties ?? [])].sort((a, b) => a.shortName.localeCompare(b.shortName, 'pl')), [faculties]);
  const filtered = useMemo(() => instructorRows(instructors ?? [], { faculty, department, query }), [instructors, faculty, department, query]);

  const index = useMemo(() => indexEntries(entries ?? [], 'instructor'), [entries]);
  const busyById = useMemo(() => busyByResource(index), [index]);
  const free = useMemo(() => (day ? freeRange(freeFrom, freeTo) : null), [day, freeFrom, freeTo]);

  const rows = useMemo(() => {
    let list = filtered;
    if (day && free) list = list.filter((i) => isFree(index.get(i.id)?.get(day) ?? [], free.from, free.to));
    if (!day && sort === 'busy') list = [...list].sort((a, b) => (busyById.get(b.id) ?? 0) - (busyById.get(a.id) ?? 0));
    return list;
  }, [filtered, day, free, index, sort, busyById]);
  const viewRows = useMemo(() => rows.map(toRow), [rows]);

  // Os czasu wspolna dla widoku (tydzien albo dzien) — z zajec pokazywanych prowadzacych.
  const shownIds = useMemo(() => new Set(rows.map((i) => i.id)), [rows]);
  const axis = useMemo(
    () => timeAxis((entries ?? []).filter((e) => e.instructorId && shownIds.has(e.instructorId) && (!day || e.date === day))),
    [entries, shownIds, day],
  );
  const stats = useMemo(() => {
    const visible = (entries ?? []).filter((e) => e.instructorId && shownIds.has(e.instructorId) && (day ? e.date === day : days.includes(e.date)));
    return { entries: visible.length, conflicts: visible.filter((e) => e.conflict).length, used: new Set(visible.map((e) => e.instructorId)).size };
  }, [entries, shownIds, day, days]);

  const instructorById = useMemo(() => new Map((instructors ?? []).map((i) => [i.id, i])), [instructors]);
  const canOpenPlan = (facultyId: string) => me?.role === 'ADMIN' || me?.facultyId === facultyId;
  // Ukladanie planu admina pokazuje roczniki wydzialu z filtra — rocznik innego wydzialu by sie nie otworzyl.
  const beforeOpenPlan = (facultyId: string) => {
    if (me?.role === 'ADMIN' && globalFaculty !== 'all' && globalFaculty !== facultyId) setGlobalFaculty(facultyId);
  };
  const openInstructorPdf = (instructorId: string) => {
    const person = instructorById.get(instructorId);
    if (person) pdf.open({ instructorId }, instructorName(person));
  };
  const selectedPerson = selected?.instructorId ? (instructorById.get(selected.instructorId) ?? null) : null;
  const filtersActive = facultyChoice !== null || departmentChoice !== 'all' || query !== '';

  return (
    <>
      <PageHeader
        title="Zajetosc prowadzacych"
        description="Cala uczelnia na konkretnych datach: zajecia wszystkich wydzialow (wg wzorca, jak przy sprawdzaniu kolizji, takze online), terminy reczne i zajetosci zewnetrzne prowadzacych. Kliknij dzien, by zobaczyc godziny i szczegoly zajec."
      />

      <WeekNav weeks={weeks} week={week} isPending={isPending} isFetching={isFetching} onGo={goToWeek} />

      {/* Filtry prowadzacych */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={faculty} onValueChange={setFacultyChoice}>
          <SelectTrigger className="w-64" aria-label="Wydzial prowadzacego">
            <SelectValue placeholder="Wydzial" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Wszystkie wydzialy</SelectItem>
            <SelectItem value={NO_FACULTY}>Ogolnouczelniani (bez wydzialu)</SelectItem>
            {sortedFaculties.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.shortName} — {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={department} onValueChange={setDepartmentChoice}>
          <SelectTrigger className="w-48" aria-label="Katedra">
            <SelectValue placeholder="Katedra" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Wszystkie katedry</SelectItem>
            <SelectItem value={NO_DEPARTMENT}>Bez katedry</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id} title={d.name}>
                {departmentLabel(d)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nazwisko albo katedra" aria-label="Szukaj prowadzacego" className="w-56 pl-8" />
        </div>
        {filtersActive && (
          <Button
            variant="ghost"
            onClick={() => {
              setFacultyChoice(null);
              setDepartmentChoice('all');
              setQuery('');
            }}
          >
            <X /> Wyczysc filtry
          </Button>
        )}
      </div>

      {/* Dzien: wybor dnia i szukanie wolnego prowadzacego */}
      {day && (
        <DayControls
          days={days}
          day={day}
          holidays={holidays}
          freeWord="Wolny"
          freeFrom={freeFrom}
          freeTo={freeTo}
          onFreeChange={(from, to) => {
            setFreeFrom(from);
            setFreeTo(to);
          }}
          onDay={(d) => setParam({ day: d })}
          onWeek={() => setParam({ day: null })}
        />
      )}

      {/* Podsumowanie i legenda */}
      {week && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span>
            {free
              ? `Wolni ${freeFrom}–${freeTo}: ${rows.length} z ${plural(filtered.length, 'prowadzacego', 'prowadzacych', 'prowadzacych')}`
              : `${plural(rows.length, 'prowadzacy', 'prowadzacych', 'prowadzacych')} · ${stats.used} z zajeciami · ${plural(stats.entries, 'zajecia', 'zajecia', 'zajec')} ${day ? 'w dniu' : 'w tygodniu'}`}
            {stats.conflicts > 0 && <span className="ml-2 font-medium text-red-600">· {stats.conflicts} w kolizji</span>}
          </span>
          <OccupancyLegend />
        </div>
      )}

      {error ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Nie udalo sie wczytac zajetosci prowadzacych</EmptyTitle>
            <EmptyDescription>{getErrorMessage(error)}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : !term || isPending || instructorsPending || (dayParam && isPlaceholderData) ? (
        // Widok dnia innego tygodnia: dane poprzedniego tygodnia nie maja tego dnia — czekamy na nowe.
        <Skeleton className="h-96 w-full" />
      ) : !week ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarRange />
            </EmptyMedia>
            <EmptyTitle>Semestr nie ma jeszcze kalendarzy</EmptyTitle>
            <EmptyDescription>Zajetosc prowadzacych liczy sie na datach kalendarzy semestru — zaloz kalendarz w „Kalendarzu semestru”.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserRoundSearch />
            </EmptyMedia>
            <EmptyTitle>{free ? 'Brak wolnych prowadzacych w tych godzinach' : 'Brak prowadzacych dla tych filtrow'}</EmptyTitle>
            <EmptyDescription>
              {free
                ? 'Zmien godziny, wydzial albo katedre.'
                : query.trim() && faculty !== 'all'
                  ? 'Szukasz tylko w wybranym wydziale — wybierz „Wszystkie wydzialy”, zeby szukac wszedzie.'
                  : 'Zmien wydzial albo katedre.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : day ? (
        <DayTimeline
          resource="instructor"
          rows={viewRows}
          date={day}
          index={index}
          axis={axis}
          free={free}
          onSelect={setSelected}
          onRowPdf={(row) => openInstructorPdf(row.id)}
          pdfPending={pdf.isPending}
        />
      ) : (
        <WeekTable
          resource="instructor"
          rows={viewRows}
          days={days}
          index={index}
          axis={axis}
          holidays={holidays}
          busyById={busyById}
          sort={sort}
          onSort={setSort}
          onOpenDay={(date) => setParam({ day: date })}
        />
      )}

      <EntryDialog
        resource="instructor"
        entry={selected}
        clashes={selected?.conflict && selected.instructorId ? overlapping(selected, index.get(selected.instructorId)?.get(selected.date) ?? []) : []}
        subject={
          selected
            ? {
                heading: selectedPerson ? instructorName(selectedPerson) : (selected.instructor ?? ''),
                label: 'Prowadzacy',
                value: selectedPerson
                  ? [instructorName(selectedPerson), instructorUnit(selectedPerson)].filter(Boolean).join(' · ')
                  : (selected.instructor ?? ''),
              }
            : null
        }
        faculties={faculties ?? []}
        termKey={term?.key ?? ''}
        canOpenPlan={canOpenPlan}
        onOpenPlan={beforeOpenPlan}
        onPdf={() => selected?.instructorId && openInstructorPdf(selected.instructorId)}
        pdfPending={pdf.isPending}
        onClose={() => setSelected(null)}
      />
      <PlanPdfDialog preview={pdf.preview} onClose={pdf.close} />
    </>
  );
}
