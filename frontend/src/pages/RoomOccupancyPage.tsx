import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, ChevronLeft, ChevronRight, DoorOpen, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PageHeader } from '@/components/PageHeader';
import { PlanPdfDialog } from '@/components/PlanPdfDialog';
import { fetchBuildings } from '@/api/buildings';
import { fetchFaculties } from '@/api/faculties';
import { fetchRoomOccupancy } from '@/api/roomOccupancy';
import { useCurrentTerm } from '@/hooks/useTerm';
import { usePlanPdf } from '@/hooks/usePlanPdf';
import { getErrorMessage } from '@/lib/errors';
import { plural } from '@/lib/setupSteps';
import { ROOM_TYPE_LABELS, ROOM_TYPES } from '@/lib/labels';
import { todayKey } from '@/lib/externalBusy';
import { toMinutes } from '@/lib/timeGrid';
import {
  buildingFilterOptions,
  busyMinutes,
  defaultBuildingFilter,
  indexEntries,
  isFree,
  overlapping,
  roomRows,
  timeAxis,
  visibleDays,
  weekLabel,
  type BuildingFilter,
} from '@/lib/roomOccupancy';
import { useAuthStore } from '@/store/authStore';
import { useFacultyFilterStore } from '@/store/facultyStore';
import type { Building, Room, RoomOccupancyEntry, RoomType } from '@/types';
import { WeekTable, type WeekSort } from './roomOccupancy/WeekTable';
import { DayTimeline } from './roomOccupancy/DayTimeline';
import { EntryDialog } from './roomOccupancy/EntryDialog';
import { LEGEND, dayShort } from './roomOccupancy/occupancyStyle';

const TIME_RE = /^\d{2}:\d{2}$/;

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/**
 * Zajetosc sal — cala uczelnia, konkretne daty: plan wszystkich wydzialow wg wzorca (jak przy
 * kolizjach, takze przed „Generuj terminy”), terminy reczne i zajetosci zewnetrzne. Tydzien: sala ×
 * dni z paskami zajec i zajetymi godzinami; klik w dzien — os godzin tego dnia z kafelkami zajec
 * i wyszukiwaniem sali wolnej w podanych godzinach. Tylko do wgladu — plan zmienia sie w Ukladaniu planu.
 */
export default function RoomOccupancyPage() {
  const queryClient = useQueryClient();
  const { term } = useCurrentTerm();
  const me = useAuthStore((s) => s.user);
  const globalFaculty = useFacultyFilterStore((s) => s.facultyId);
  const setGlobalFaculty = useFacultyFilterStore((s) => s.setFacultyId);
  const [params, setParams] = useSearchParams();
  const weekParam = params.get('week');
  const dayParam = params.get('day');

  const [buildingChoice, setBuildingChoice] = useState<BuildingFilter | null>(null);
  const [type, setType] = useState<RoomType | 'all'>('all');
  const [minCapacity, setMinCapacity] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<WeekSort>('room');
  const [freeFrom, setFreeFrom] = useState('');
  const [freeTo, setFreeTo] = useState('');
  const [selected, setSelected] = useState<RoomOccupancyEntry | null>(null);
  const pdf = usePlanPdf(term?.key);

  const { data: buildings, isPending: buildingsPending } = useQuery({ queryKey: ['buildings'], queryFn: fetchBuildings });
  const { data: faculties } = useQuery({ queryKey: ['faculties'], queryFn: fetchFaculties });
  const { data, isPending, isFetching, isPlaceholderData, error } = useQuery({
    queryKey: ['room-occupancy', term?.key, weekParam ?? 'default'],
    queryFn: async () => {
      const result = await fetchRoomOccupancy(term!.key, weekParam);
      // Tydzien domyslny zapisany tez pod swoim poniedzialkiem — powrot do niego z listy nie pobiera go drugi raz.
      if (!weekParam && result.week) queryClient.setQueryData(['room-occupancy', term!.key, result.week], result);
      return result;
    },
    enabled: !!term,
    // Przy zmianie tygodnia zostaje poprzedni (z wskaznikiem ladowania) — tabela nie znika.
    placeholderData: keepPreviousData,
  });

  const building = buildingChoice ?? defaultBuildingFilter(me?.role, me?.facultyId, globalFaculty, buildings ?? []);
  const options = useMemo(() => buildingFilterOptions(buildings ?? [], faculties ?? []), [buildings, faculties]);
  const capacity = Number.parseInt(minCapacity, 10);
  const filtered = useMemo(
    () => roomRows(buildings ?? [], { building, type, minCapacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null, query }),
    [buildings, building, type, capacity, query],
  );

  const entries = data?.entries;
  const index = useMemo(() => indexEntries(entries ?? []), [entries]);
  const days = useMemo(() => visibleDays(data?.days ?? [], entries ?? []), [data?.days, entries]);
  const holidays = useMemo(() => new Map((data?.holidays ?? []).map((h) => [h.date, h.name])), [data?.holidays]);
  const busyByRoom = useMemo(() => {
    const map = new Map<string, number>();
    for (const [roomId, byDay] of index) map.set(roomId, busyMinutes([...byDay.values()].flat()));
    return map;
  }, [index]);

  const week = data?.week ?? null;
  const weeks = data?.weeks ?? [];
  const weekIndex = weeks.findIndex((w) => w.monday === week);
  // Dzien z adresu, gdy nalezy do pokazanego tygodnia (w trakcie ladowania innego tygodnia — tez, zeby
  // widok nie przeskakiwal na chwile na caly tydzien).
  const day = dayParam && week && (days.includes(dayParam) || isPlaceholderData) ? dayParam : null;
  const free = useMemo(
    () => (day && TIME_RE.test(freeFrom) && TIME_RE.test(freeTo) && toMinutes(freeFrom) < toMinutes(freeTo) ? { from: toMinutes(freeFrom), to: toMinutes(freeTo) } : null),
    [day, freeFrom, freeTo],
  );

  const rows = useMemo(() => {
    let list = filtered;
    if (day && free) list = list.filter(({ room }) => isFree(index.get(room.id)?.get(day) ?? [], free.from, free.to));
    if (!day && sort === 'busy') list = [...list].sort((a, b) => (busyByRoom.get(b.room.id) ?? 0) - (busyByRoom.get(a.room.id) ?? 0));
    return list;
  }, [filtered, day, free, index, sort, busyByRoom]);

  // Os czasu wspolna dla widoku (tydzien albo dzien) — z zajec pokazywanych sal.
  const axis = useMemo(() => {
    const shown = new Set(rows.map((r) => r.room.id));
    const relevant = (entries ?? []).filter((e) => shown.has(e.roomId) && (!day || e.date === day));
    return timeAxis(relevant);
  }, [rows, entries, day]);

  const roomById = useMemo(() => {
    const map = new Map<string, { room: Room; building: Building }>();
    for (const b of buildings ?? []) for (const room of b.rooms ?? []) map.set(room.id, { room, building: b });
    return map;
  }, [buildings]);

  const stats = useMemo(() => {
    const shown = new Set(rows.map((r) => r.room.id));
    const visible = (entries ?? []).filter((e) => shown.has(e.roomId) && (day ? e.date === day : days.includes(e.date)));
    return { entries: visible.length, conflicts: visible.filter((e) => e.conflict).length, usedRooms: new Set(visible.map((e) => e.roomId)).size };
  }, [rows, entries, day, days]);

  const setParam = (changes: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: false },
    );

  /** Inny tydzien — w widoku dnia ten sam dzien tygodnia. */
  const goToWeek = (monday: string) => {
    const offset = day && week ? daysBetween(week, day) : null;
    setParam({ week: monday, day: offset === null ? null : addDays(monday, offset) });
  };
  const today = todayKey();
  const todayWeek = weeks.find((w) => w.monday <= today && today <= addDays(w.monday, 6)) ?? null;

  const canOpenPlan = (facultyId: string) => me?.role === 'ADMIN' || me?.facultyId === facultyId;
  // Ukladanie planu admina pokazuje roczniki wydzialu z filtra — rocznik innego wydzialu by sie nie otworzyl.
  const beforeOpenPlan = (facultyId: string) => {
    if (me?.role === 'ADMIN' && globalFaculty !== 'all' && globalFaculty !== facultyId) setGlobalFaculty(facultyId);
  };
  const openRoomPdf = (room: Room, b: Building) => pdf.open({ roomId: room.id }, `Sala ${room.number} — ${b.name}`);
  const selectedRoom = selected ? (roomById.get(selected.roomId) ?? null) : null;
  const filtersActive = buildingChoice !== null || type !== 'all' || minCapacity !== '' || query !== '';

  return (
    <>
      <PageHeader
        title="Zajetosc sal"
        description="Cala uczelnia na konkretnych datach: plan wszystkich wydzialow (wg wzorca, jak przy sprawdzaniu kolizji), terminy reczne i zajetosci zewnetrzne. Kliknij dzien, by zobaczyc godziny i szczegoly zajec."
      />

      {/* Tydzien */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            disabled={weekIndex <= 0}
            onClick={() => goToWeek(weeks[weekIndex - 1]!.monday)}
            aria-label="Poprzedni tydzien"
            title="Poprzedni tydzien"
          >
            <ChevronLeft />
          </Button>
          <Select value={week ?? ''} onValueChange={goToWeek} disabled={weeks.length === 0}>
            <SelectTrigger className="w-80 *:data-[slot=select-value]:flex-1" aria-label="Tydzien">
              <CalendarRange className="size-4 text-muted-foreground" />
              <SelectValue placeholder={isPending ? 'Ladowanie…' : 'Brak tygodni'} />
            </SelectTrigger>
            <SelectContent>
              {weeks.map((w) => (
                <SelectItem key={w.monday} value={w.monday}>
                  {weekLabel(w)}
                  {w.monday === todayWeek?.monday ? ' · biezacy' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            disabled={weekIndex < 0 || weekIndex >= weeks.length - 1}
            onClick={() => goToWeek(weeks[weekIndex + 1]!.monday)}
            aria-label="Nastepny tydzien"
            title="Nastepny tydzien"
          >
            <ChevronRight />
          </Button>
          {todayWeek && todayWeek.monday !== week && (
            <Button variant="ghost" onClick={() => goToWeek(todayWeek.monday)}>
              Biezacy tydzien
            </Button>
          )}
          {isFetching && !isPending && <Spinner className="ml-1 size-4 text-muted-foreground" />}
        </div>
      </div>

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
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setParam({ day: null })}>
            <ChevronLeft /> Caly tydzien
          </Button>
          <ToggleGroup type="single" variant="outline" value={day} onValueChange={(v) => v && setParam({ day: v })} aria-label="Dzien">
            {days.map((d) => (
              <ToggleGroupItem key={d} value={d} className="px-2.5" title={holidays.get(d)}>
                {dayShort(d)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Wolne od</span>
            <Input type="time" value={freeFrom} onChange={(e) => setFreeFrom(e.target.value)} className="w-28" aria-label="Wolne od godziny" />
            <span className="text-muted-foreground">do</span>
            <Input type="time" value={freeTo} onChange={(e) => setFreeTo(e.target.value)} className="w-28" aria-label="Wolne do godziny" />
            {(freeFrom || freeTo) && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setFreeFrom('');
                  setFreeTo('');
                }}
                aria-label="Wyczysc godziny"
                title="Wyczysc godziny"
              >
                <X />
              </Button>
            )}
          </div>
        </div>
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
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {LEGEND.map((l) => (
              <span key={l.label} className="flex items-center gap-1">
                <span className={`inline-block h-2.5 w-4 rounded-[2px] ${l.className}`} />
                {l.label}
              </span>
            ))}
          </span>
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
          rows={rows}
          date={day}
          index={index}
          axis={axis}
          free={free}
          onSelect={setSelected}
          onRoomPdf={openRoomPdf}
          pdfPending={pdf.isPending}
        />
      ) : (
        <WeekTable
          rows={rows}
          days={days}
          index={index}
          axis={axis}
          holidays={holidays}
          busyByRoom={busyByRoom}
          sort={sort}
          onSort={setSort}
          onOpenDay={(date) => setParam({ day: date })}
        />
      )}

      <EntryDialog
        entry={selected}
        clashes={selected?.conflict ? overlapping(selected, index.get(selected.roomId)?.get(selected.date) ?? []) : []}
        room={selectedRoom?.room ?? null}
        building={selectedRoom?.building ?? null}
        faculties={faculties ?? []}
        termKey={term?.key ?? ''}
        canOpenPlan={canOpenPlan}
        onOpenPlan={beforeOpenPlan}
        onRoomPdf={openRoomPdf}
        pdfPending={pdf.isPending}
        onClose={() => setSelected(null)}
      />
      <PlanPdfDialog preview={pdf.preview} onClose={pdf.close} />
    </>
  );
}
