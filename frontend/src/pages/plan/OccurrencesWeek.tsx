import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { formatDayMonth } from '@/lib/planHours';
import { dayNote, initialPeriodIndex, occurrenceMarker, occurrencesIn, periodColumns, periodLabel } from '@/lib/occurrenceWeek';
import { toDateKey } from '@/lib/scheduleDates';
import type { CalendarPeriod, DayOfWeek, OccurrenceRow, TimeBlock } from '@/types';
import { WeekGrid, type GridItem } from './WeekGrid';

const DAY_SHORT: Record<DayOfWeek, string> = {
  MONDAY: 'Pn',
  TUESDAY: 'Wt',
  WEDNESDAY: 'Sr',
  THURSDAY: 'Cz',
  FRIDAY: 'Pt',
  SATURDAY: 'Sb',
  SUNDAY: 'Nd',
};

/**
 * Terminy jednego tygodnia (albo zjazdu) na siatce jak wzorzec: daty w naglowkach, swieta
 * i przerwy wyszarzone, terminy odwolane przekreslone, przeniesione i reczne oznaczone.
 * Klikniecie terminu otwiera jego akcje (przenies, odwolaj, przywroc).
 */
export function OccurrencesWeek({
  periods,
  modeDays,
  blocks,
  occurrences,
  onSelect,
}: {
  periods: CalendarPeriod[];
  modeDays: DayOfWeek[];
  blocks: TimeBlock[];
  occurrences: OccurrenceRow[];
  onSelect: (occurrence: OccurrenceRow) => void;
}) {
  const [index, setIndex] = useState(() =>
    initialPeriodIndex(
      periods,
      toDateKey(new Date()),
      occurrences.map((o) => o.date),
    ),
  );
  const period = periods[Math.min(index, periods.length - 1)];

  const columns = useMemo(() => (period ? periodColumns(period, modeDays, occurrences) : []), [period, modeDays, occurrences]);
  const inPeriod = useMemo(() => (period ? occurrencesIn(period, occurrences) : []), [period, occurrences]);

  if (!period) {
    return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Kalendarz rocznika nie ma tygodni zajec.</p>;
  }

  // Kolumna = dzien tygodnia (okres ma najwyzej 7 dni, kazdy dzien raz).
  const byDay = new Map(columns.map((d) => [d.dayOfWeek, d]));
  const byId = new Map(inPeriod.map((o) => [o.id, o]));
  const items: GridItem[] = inPeriod.map((o) => ({
    id: o.id,
    dayOfWeek: columns.find((d) => d.date === o.date)!.dayOfWeek,
    startOrder: o.startOrder,
    endOrder: o.endOrder,
    classType: o.classType,
    title: o.subject,
    lines: [o.group, o.room.label, o.instructor, ...(o.note ? [o.note] : [])],
    cancelled: o.status === 'CANCELLED',
    marker: occurrenceMarker(o),
  }));
  const closedDays = Object.fromEntries(columns.filter((d) => !d.teaching).map((d) => [d.dayOfWeek, d.label ?? ''])) as Partial<
    Record<DayOfWeek, string>
  >;
  const active = inPeriod.filter((o) => o.status !== 'CANCELLED').length;
  const cancelled = inPeriod.length - active;
  const today = toDateKey(new Date());

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon-sm" aria-label="Poprzedni" disabled={index <= 0} onClick={() => setIndex(index - 1)}>
          <ChevronLeft />
        </Button>
        <NativeSelect aria-label="Tydzien" value={index} onChange={(e) => setIndex(Number(e.target.value))} className="w-64">
          {periods.map((p, i) => (
            <NativeSelectOption key={p.from} value={i}>
              {periodLabel(p)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Nastepny"
          disabled={index >= periods.length - 1}
          onClick={() => setIndex(index + 1)}
        >
          <ChevronRight />
        </Button>
        <span className="text-sm text-muted-foreground">
          {active} terminow{cancelled > 0 && `, odwolanych ${cancelled}`}
        </span>
      </div>
      <WeekGrid
        days={columns.map((d) => d.dayOfWeek)}
        blocks={blocks}
        items={items}
        closedDays={closedDays}
        dayHeader={(day) => {
          const d = byDay.get(day)!;
          const note = dayNote(d);
          return (
            <div className="flex flex-col items-center leading-tight" title={note ?? undefined}>
              <span className={cn(d.date === today && 'text-primary')}>
                {DAY_SHORT[day]} {formatDayMonth(d.date)}
              </span>
              {note && d.teaching && <span className="max-w-36 truncate text-[10px] font-normal text-amber-700 dark:text-amber-400">{note}</span>}
            </div>
          );
        }}
        onItemClick={(id) => {
          const o = byId.get(id);
          if (o) onSelect(o);
        }}
      />
    </div>
  );
}
