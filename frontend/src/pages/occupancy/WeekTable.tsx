import { ArrowDownWideNarrow } from 'lucide-react';
import { cn } from '@/lib/utils';
import { entrySummary, hourTick, hoursLabel, utilizationPercent } from '@/lib/occupancyView';
import type { OccupancyEntry, OccupancyResource } from '@/types';
import { barClass, dayShort, hourLines } from './occupancyStyle';
import { RESOURCE_TEXT, type OccupancyRow } from './resource';

export type WeekSort = 'name' | 'busy';

interface Props {
  resource: OccupancyResource;
  rows: OccupancyRow[];
  days: string[];
  index: Map<string, Map<string, OccupancyEntry[]>>;
  axis: { start: number; end: number };
  /** Data -> nazwa swieta ustawowego. */
  holidays: Map<string, string>;
  busyById: Map<string, number>;
  sort: WeekSort;
  onSort: (sort: WeekSort) => void;
  /** Klik w dzien (naglowek albo pasek wiersza) — os godzin tego dnia. */
  onOpenDay: (date: string) => void;
}

/**
 * Tydzien: wiersz = sala albo prowadzacy, kolumna = dzien z paskiem zajec na osi godzin (wspolnej dla
 * calej tabeli), na koncu zajete godziny tygodnia (sala — tez procent wykorzystania). Naglowek
 * i kolumna wierszy zostaja na miejscu przy przewijaniu.
 */
export function WeekTable({ resource, rows, days, index, axis, holidays, busyById, sort, onSort, onOpenDay }: Props) {
  const text = RESOURCE_TEXT[resource];
  const rooms = resource === 'room';
  const span = axis.end - axis.start;
  const at = (minute: number) => ((minute - axis.start) / span) * 100;
  // Etykiety osi co 2 h (co 4 h, gdy dzien jest dlugi) — w waskiej kolumnie wiecej sie nie zmiesci.
  const step = span > 12 * 60 ? 240 : 120;
  const ticks: number[] = [];
  for (let m = Math.ceil(axis.start / step) * step; m < axis.end; m += step) if (m > axis.start) ticks.push(m);
  // Sala: krotki numer i kolumna miejsc; prowadzacy: dluzsze nazwisko, bez kolumny miejsc.
  const columns = {
    gridTemplateColumns: rooms
      ? `minmax(8.5rem, 11rem) 3.25rem repeat(${days.length}, minmax(7rem, 1fr)) 5.5rem`
      : `minmax(11rem, 14rem) repeat(${days.length}, minmax(7rem, 1fr)) 5rem`,
  };
  const lines = hourLines(axis.start, axis.end, 'color-mix(in oklab, var(--border) 70%, transparent)');

  return (
    <div className="max-h-[calc(100svh-17rem)] min-h-64 overflow-auto rounded-lg border">
      <div className="min-w-max" role="table" aria-label={text.weekAria}>
        <div role="row" className="sticky top-0 z-20 grid border-b bg-background text-xs font-medium text-muted-foreground" style={columns}>
          <button
            type="button"
            role="columnheader"
            onClick={() => onSort('name')}
            className={cn('sticky left-0 z-10 flex items-end bg-background px-3 py-2 text-left hover:text-foreground', sort === 'name' && 'text-foreground')}
            title={text.sortTitle}
          >
            {text.column}
          </button>
          {rooms && (
            <div role="columnheader" className="flex items-end justify-end px-2 py-2" title="Liczba miejsc">
              Miejsc
            </div>
          )}
          {days.map((date) => (
            <button
              key={date}
              type="button"
              role="columnheader"
              onClick={() => onOpenDay(date)}
              className="border-l px-1.5 pt-2 pb-1 text-left hover:bg-muted/60 hover:text-foreground"
              title="Pokaz ten dzien na osi godzin"
            >
              <div className={cn('font-medium text-foreground', holidays.has(date) && 'text-red-600')}>{dayShort(date)}</div>
              <div className="truncate text-[11px] font-normal">{holidays.get(date) ?? ' '}</div>
              <div className="relative mt-0.5 h-3.5 text-[10px] font-normal tabular-nums">
                {ticks.map((m) => (
                  <span key={m} className="absolute -translate-x-1/2" style={{ left: `${at(m)}%` }}>
                    {hourTick(m)}
                  </span>
                ))}
              </div>
            </button>
          ))}
          <button
            type="button"
            role="columnheader"
            onClick={() => onSort('busy')}
            className={cn('flex items-end justify-end gap-1 border-l px-2 py-2 hover:text-foreground', sort === 'busy' && 'text-foreground')}
            title={text.busyTitle}
          >
            {sort === 'busy' && <ArrowDownWideNarrow className="size-3.5" />}
            Zajete
          </button>
        </div>

        {rows.map((row) => {
          const byDay = index.get(row.id);
          const minutes = busyById.get(row.id) ?? 0;
          const percent = utilizationPercent(minutes);
          return (
            <div key={row.id} role="row" className="grid border-b last:border-b-0 hover:bg-muted/30" style={columns}>
              <div role="cell" className="sticky left-0 z-10 min-w-0 bg-background px-3 py-1.5">
                <div className="truncate text-sm font-medium" title={row.title}>
                  {row.label}
                </div>
                <div className="truncate text-[11px] text-muted-foreground" title={row.title}>
                  {row.sublabel}
                </div>
              </div>
              {rooms && (
                <div role="cell" className="flex items-center justify-end px-2 text-sm tabular-nums text-muted-foreground">
                  {row.capacity}
                </div>
              )}
              {days.map((date) => {
                const entries = byDay?.get(date) ?? [];
                const tooltip = [`${row.title} · ${dayShort(date)}`, ...(entries.length > 0 ? entries.map((e) => entrySummary(e, resource)) : [text.free])].join('\n');
                return (
                  <div key={date} role="cell" className="flex items-center border-l px-1.5 py-1.5">
                    <button
                      type="button"
                      onClick={() => onOpenDay(date)}
                      title={tooltip}
                      aria-label={tooltip}
                      className={cn(
                        'relative h-6 w-full overflow-hidden rounded-sm bg-muted/50 outline-none hover:ring-1 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring',
                        holidays.has(date) && 'bg-red-50 dark:bg-red-950/40',
                      )}
                      style={{ backgroundImage: lines }}
                    >
                      {entries.map((e) => (
                        <span
                          key={e.id}
                          className={cn('absolute inset-y-0.5 rounded-[2px]', barClass(e))}
                          style={{ left: `${at(e.startMinute)}%`, width: `max(2px, ${at(e.endMinute) - at(e.startMinute)}%)` }}
                        />
                      ))}
                    </button>
                  </div>
                );
              })}
              <div
                role="cell"
                className="flex flex-col justify-center gap-1 border-l px-2 text-right"
                title={rooms ? `${percent}% z 60 h (pn–pt 8:00–20:00)` : undefined}
              >
                <span className="text-sm tabular-nums">{minutes > 0 ? hoursLabel(minutes) : '—'}</span>
                {rooms && (
                  <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, percent)}%` }} />
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
