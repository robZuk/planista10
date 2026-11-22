import { FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { assignLanes } from '@/lib/gridLanes';
import { formatMinutes } from '@/lib/timeGrid';
import { entryDetail, entrySummary, entryTitle } from '@/lib/occupancyView';
import type { OccupancyEntry, OccupancyResource } from '@/types';
import { hourLines, tileClass } from './occupancyStyle';
import { RESOURCE_TEXT, type OccupancyRow } from './resource';

/** Wysokosc toru (zajecia nakladajace sie w wierszu — kolizje — ida jedne pod drugimi). */
const LANE = 40;

interface Props {
  resource: OccupancyResource;
  rows: OccupancyRow[];
  date: string;
  index: Map<string, Map<string, OccupancyEntry[]>>;
  axis: { start: number; end: number };
  /** Szukany wolny przedzial — podswietlony na osi. */
  free: { from: number; to: number } | null;
  onSelect: (entry: OccupancyEntry) => void;
  onRowPdf: (row: OccupancyRow) => void;
  pdfPending: boolean;
}

/**
 * Dzien: wiersz = sala albo prowadzacy, os godzin z kafelkami zajec (przedmiot; sala — grupy, prowadzacy —
 * sala i grupy). Wolne miejsca widac od razu; klik w kafelek — szczegoly zajec. Kolumna wierszy i os
 * godzin zostaja na miejscu przy przewijaniu.
 */
export function DayTimeline({ resource, rows, date, index, axis, free, onSelect, onRowPdf, pdfPending }: Props) {
  const text = RESOURCE_TEXT[resource];
  const span = axis.end - axis.start;
  const at = (minute: number) => ((minute - axis.start) / span) * 100;
  const hours: number[] = [];
  for (let m = axis.start; m < axis.end; m += 60) hours.push(m);
  const columns = { gridTemplateColumns: resource === 'room' ? 'minmax(9rem, 12rem) minmax(48rem, 1fr)' : 'minmax(11rem, 14rem) minmax(48rem, 1fr)' };
  const lines = hourLines(axis.start, axis.end);

  return (
    <div className="max-h-[calc(100svh-19rem)] min-h-64 overflow-auto rounded-lg border">
      <div className="min-w-max" role="table" aria-label={text.dayAria}>
        <div role="row" className="sticky top-0 z-20 grid border-b bg-background text-xs text-muted-foreground" style={columns}>
          <div role="columnheader" className="sticky left-0 z-10 bg-background px-3 py-2 font-medium">
            {text.column}
          </div>
          <div role="columnheader" className="relative h-8 border-l">
            {hours.map((m) => (
              <span key={m} className="absolute top-2 pl-1 tabular-nums" style={{ left: `${at(m)}%` }}>
                {formatMinutes(m)}
              </span>
            ))}
          </div>
        </div>

        {rows.map((row) => {
          const entries = index.get(row.id)?.get(date) ?? [];
          const lanes = assignLanes(entries.map((e) => ({ id: e.id, startOrder: e.startMinute, endOrder: e.endMinute - 1 })));
          const laneCount = Math.max(1, ...[...lanes.values()].map((l) => l.lanes));
          return (
            <div key={row.id} role="row" className="grid border-b last:border-b-0" style={columns}>
              <div role="cell" className="group sticky left-0 z-10 flex min-w-0 items-start gap-1 bg-background px-3 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium" title={row.title}>
                    {row.label}
                    {row.capacity !== undefined && (
                      <span className="font-normal text-muted-foreground tabular-nums" title="Liczba miejsc">
                        {' '}
                        · {row.capacity} os.
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground" title={row.title}>
                    {row.sublabel}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  disabled={pdfPending}
                  title={text.pdf}
                  aria-label={`${text.pdf}: ${row.title}`}
                  onClick={() => onRowPdf(row)}
                >
                  <FileDown />
                </Button>
              </div>
              <div role="cell" className="relative border-l" style={{ height: laneCount * LANE + 6, backgroundImage: lines }}>
                {free && (
                  <div
                    className="absolute inset-y-0 bg-emerald-500/10 ring-1 ring-emerald-500/40 ring-inset"
                    style={{ left: `${at(free.from)}%`, width: `${at(free.to) - at(free.from)}%` }}
                    aria-hidden
                  />
                )}
                {entries.map((e) => {
                  const lane = lanes.get(e.id) ?? { lane: 0, span: 1, lanes: 1 };
                  const detail = entryDetail(e, resource);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => onSelect(e)}
                      title={entrySummary(e, resource)}
                      className={cn(
                        'absolute overflow-hidden rounded-sm border border-l-4 px-1 text-left text-[11px] leading-tight shadow-xs outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring',
                        tileClass(e),
                      )}
                      style={{
                        left: `${at(e.startMinute)}%`,
                        width: `max(4px, calc(${at(e.endMinute) - at(e.startMinute)}% - 2px))`,
                        top: 3 + lane.lane * LANE,
                        height: lane.span * LANE - 4,
                      }}
                    >
                      <div className="truncate font-medium">{entryTitle(e)}</div>
                      <div className="truncate opacity-80">
                        {formatMinutes(e.startMinute)}–{formatMinutes(e.endMinute)}
                        {detail ? ` · ${detail}` : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
