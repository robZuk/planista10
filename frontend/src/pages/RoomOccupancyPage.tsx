import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarRange, DoorOpen, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/PageHeader';
import { PlanPdfDialog } from '@/components/PlanPdfDialog';
import { fetchBuildings } from '@/api/buildings';
import { fetchFaculties } from '@/api/faculties';
import { useCurrentTerm } from '@/hooks/useTerm';
import { usePlanPdf } from '@/hooks/usePlanPdf';
import { getErrorMessage } from '@/lib/errors';
import { plural } from '@/lib/setupSteps';
import { ROOM_TYPE_LABELS, ROOM_TYPES } from '@/lib/labels';
import { busyByResource, freeRange, indexEntries, isFree, overlapping, timeAxis } from '@/lib/occupancyView';
import { buildingFilterOptions, defaultBuildingFilter, roomRows, type BuildingFilter, type RoomRow } from '@/lib/roomOccupancy';
import { useAuthStore } from '@/store/authStore';
import { useFacultyFilterStore } from '@/store/facultyStore';
import type { OccupancyEntry, RoomType } from '@/types';
import { WeekTable, type WeekSort } from './occupancy/WeekTable';
import { DayTimeline } from './occupancy/DayTimeline';
import { EntryDialog } from './occupancy/EntryDialog';
import { DayControls } from './occupancy/DayControls';
import { OccupancyLegend } from './occupancy/Legend';
import { WeekNav } from './occupancy/WeekNav';
import { useOccupancyWeek } from './occupancy/useOccupancyWeek';
import type { OccupancyRow } from './occupancy/resource';

/** Sala jako wiersz widoku zajetosci. */
const toRow = ({ room, building }: RoomRow): OccupancyRow => ({
  id: room.id,
  label: room.number,
  sublabel: `${building.name} · ${ROOM_TYPE_LABELS[room.type].toLowerCase()}`,
  title: `Sala ${room.number} — ${building.name} · ${ROOM_TYPE_LABELS[room.type].toLowerCase()}`,
  capacity: room.capacity,
});

/**
 * Zajetosc sal — cala uczelnia, konkretne daty: plan wszystkich wydzialow wg wzorca (jak przy
 * kolizjach, takze przed „Generuj terminy”), terminy reczne i zajetosci zewnetrzne. Tydzien: sala ×
 * dni z paskami zajec i zajetymi godzinami; klik w dzien — os godzin tego dnia z kafelkami zajec
 * i wyszukiwaniem sali wolnej w podanych godzinach. Tylko do wgladu — plan zmienia sie w Ukladaniu planu.
 * Ten sam widok dla prowadzacych: InstructorOccupancyPage.
 */
export default function RoomOccupancyPage() {
  const { term } = useCurrentTerm();
  const me = useAuthStore((s) => s.user);
  const globalFaculty = useFacultyFilterStore((s) => s.facultyId);
  const setGlobalFaculty = useFacultyFilterStore((s) => s.setFacultyId);

  const [buildingChoice, setBuildingChoice] = useState<BuildingFilter | null>(null);
  const [type, setType] = useState<RoomType | 'all'>('all');
  const [minCapacity, setMinCapacity] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<WeekSort>('name');
  const [freeFrom, setFreeFrom] = useState('');
  const [freeTo, setFreeTo] = useState('');
  const [selected, setSelected] = useState<OccupancyEntry | null>(null);
  const pdf = usePlanPdf(term?.key);

  const { data: buildings, isPending: buildingsPending } = useQuery({ queryKey: ['buildings'], queryFn: fetchBuildings });
  const { data: faculties } = useQuery({ queryKey: ['faculties'], queryFn: fetchFaculties });
  const { entries, days, holidays, week, weeks, day, dayParam, setParam, goToWeek, isPending, isFetching, isPlaceholderData, error } = useOccupancyWeek(
    'room',
    term?.key,
  );

  const building = buildingChoice ?? defaultBuildingFilter(me?.role, me?.facultyId, globalFaculty, buildings ?? []);
  const options = useMemo(() => buildingFilterOptions(buildings ?? [], faculties ?? []), [buildings, faculties]);
  const capacity = Number.parseInt(minCapacity, 10);
  const filtered = useMemo(
    () => roomRows(buildings ?? [], { building, type, minCapacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null, query }),
    [buildings, building, type, capacity, query],
  );

  const index = useMemo(() => indexEntries(entries ?? [], 'room'), [entries]);
  const busyById = useMemo(() => busyByResource(index), [index]);
  const free = useMemo(() => (day ? freeRange(freeFrom, freeTo) : null), [day, freeFrom, freeTo]);

  const rows = useMemo(() => {
    let list = filtered;
    if (day && free) list = list.filter(({ room }) => isFree(index.get(room.id)?.get(day) ?? [], free.from, free.to));
    if (!day && sort === 'busy') list = [...list].sort((a, b) => (busyById.get(b.room.id) ?? 0) - (busyById.get(a.room.id) ?? 0));
    return list;
  }, [filtered, day, free, index, sort, busyById]);
  const viewRows = useMemo(() => rows.map(toRow), [rows]);

  // Os czasu wspolna dla widoku (tydzien albo dzien) — z zajec pokazywanych sal.
  const axis = useMemo(() => {
    const shown = new Set(rows.map((r) => r.room.id));
    const relevant = (entries ?? []).filter((e) => e.roomId && shown.has(e.roomId) && (!day || e.date === day));
    return timeAxis(relevant);
  }, [rows, entries, day]);

  const roomById = useMemo(() => new Map((buildings ?? []).flatMap((b) => (b.rooms ?? []).map((room) => [room.id, { room, building: b }] as const))), [buildings]);

  const stats = useMemo(() => {
    const shown = new Set(rows.map((r) => r.room.id));
    const visible = (entries ?? []).filter((e) => e.roomId && shown.has(e.roomId) && (day ? e.date === day : days.includes(e.date)));
    return { entries: visible.length, conflicts: visible.filter((e) => e.conflict).length, usedRooms: new Set(visible.map((e) => e.roomId)).size };
  }, [rows, entries, day, days]);

  const canOpenPlan = (facultyId: string) => me?.role === 'ADMIN' || me?.facultyId === facultyId;
  // Ukladanie planu admina pokazuje roczniki wydzialu z filtra — rocznik innego wydzialu by sie nie otworzyl.
  const beforeOpenPlan = (facultyId: string) => {
    if (me?.role === 'ADMIN' && globalFaculty !== 'all' && globalFaculty !== facultyId) setGlobalFaculty(facultyId);
  };
  const openRoomPdf = (roomId: string) => {
    const found = roomById.get(roomId);
    if (found) pdf.open({ roomId }, `Sala ${found.room.number} — ${found.building.name}`);
  };
  const selectedRoom = selected?.roomId ? (roomById.get(selected.roomId) ?? null) : null;
  const filtersActive = buildingChoice !== null || type !== 'all' || minCapacity !== '' || query !== '';

  return (
    <>
      <PageHeader
        title="Zajetosc sal"
        description="Cala uczelnia na konkretnych datach: plan wszystkich wydzialow (wg wzorca, jak przy sprawdzaniu kolizji), terminy reczne i zajetosci zewnetrzne. Kliknij dzien, by zobaczyc godziny i szczegoly zajec."
      />

      <WeekNav weeks={weeks} week={week} isPending={isPending} isFetching={isFetching} onGo={goToWeek} />

      {/* Filtry sal */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={building} onValueChange={setBuildingChoice}>
          <SelectTrigger className="w-72" aria-label="Budynki">
            <SelectValue placeholder="Budynki" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {options.groups.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
            {options.buildings.length > 0 && <SelectSeparator />}
            <SelectGroup>
              <SelectLabel>Budynek</SelectLabel>
              {options.buildings.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={(v) => setType(v as RoomType | 'all')}>
          <SelectTrigger className="w-48" aria-label="Typ sali">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Wszystkie typy sal</SelectItem>
            {ROOM_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {ROOM_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          min={1}
          inputMode="numeric"
          value={minCapacity}
          onChange={(e) => setMinCapacity(e.target.value)}
          placeholder="Min. miejsc"
          aria-label="Minimalna liczba miejsc"
          className="w-32"
        />
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Sala albo budynek" aria-label="Szukaj sali" className="w-52 pl-8" />
        </div>
        {filtersActive && (
          <Button
            variant="ghost"
            onClick={() => {
              setBuildingChoice(null);
              setType('all');
              setMinCapacity('');
              setQuery('');
            }}
          >
            <X /> Wyczysc filtry
          </Button>
        )}
      </div>

      {/* Dzien: wybor dnia i szukanie wolnej sali */}
      {day && (
        <DayControls
          days={days}
          day={day}
          holidays={holidays}
          freeWord="Wolne"
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
              ? `Wolne ${freeFrom}–${freeTo}: ${rows.length} z ${plural(filtered.length, 'sali', 'sal', 'sal')}`
              : `${plural(rows.length, 'sala', 'sale', 'sal')} · ${stats.usedRooms} z zajeciami · ${plural(stats.entries, 'zajecia', 'zajecia', 'zajec')} ${day ? 'w dniu' : 'w tygodniu'}`}
            {stats.conflicts > 0 && <span className="ml-2 font-medium text-red-600">· {stats.conflicts} w kolizji</span>}
          </span>
          <OccupancyLegend />
        </div>
      )}

      {error ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Nie udalo sie wczytac zajetosci sal</EmptyTitle>
            <EmptyDescription>{getErrorMessage(error)}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : !term || isPending || buildingsPending || (dayParam && isPlaceholderData) ? (
        // Widok dnia innego tygodnia: dane poprzedniego tygodnia nie maja tego dnia — czekamy na nowe.
        <Skeleton className="h-96 w-full" />
      ) : !week ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarRange />
            </EmptyMedia>
            <EmptyTitle>Semestr nie ma jeszcze kalendarzy</EmptyTitle>
            <EmptyDescription>Zajetosc sal liczy sie na datach kalendarzy semestru — zaloz kalendarz w „Kalendarzu semestru”.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <DoorOpen />
            </EmptyMedia>
            <EmptyTitle>{free ? 'Brak wolnych sal w tych godzinach' : 'Brak sal dla tych filtrow'}</EmptyTitle>
            <EmptyDescription>
              {free
                ? 'Zmien godziny, budynek albo typ sali.'
                : query.trim() && building !== 'all'
                  ? 'Szukasz tylko w wybranych budynkach — wybierz „Wszystkie budynki”, zeby szukac wszedzie.'
                  : 'Zmien budynek, typ sali albo liczbe miejsc.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : day ? (
        <DayTimeline
          resource="room"
          rows={viewRows}
          date={day}
          index={index}
          axis={axis}
          free={free}
          onSelect={setSelected}
          onRowPdf={(row) => openRoomPdf(row.id)}
          pdfPending={pdf.isPending}
        />
      ) : (
        <WeekTable
          resource="room"
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
        resource="room"
        entry={selected}
        clashes={selected?.conflict && selected.roomId ? overlapping(selected, index.get(selected.roomId)?.get(selected.date) ?? []) : []}
        subject={
          selectedRoom
            ? {
                heading: `sala ${selectedRoom.room.number} (${selectedRoom.building.name})`,
                label: 'Sala',
                value: `${selectedRoom.room.number} · ${selectedRoom.room.capacity} miejsc`,
              }
            : null
        }
        faculties={faculties ?? []}
        termKey={term?.key ?? ''}
        canOpenPlan={canOpenPlan}
        onOpenPlan={beforeOpenPlan}
        onPdf={() => selected?.roomId && openRoomPdf(selected.roomId)}
        pdfPending={pdf.isPending}
        onClose={() => setSelected(null)}
      />
      <PlanPdfDialog preview={pdf.preview} onClose={pdf.close} />
    </>
  );
}
