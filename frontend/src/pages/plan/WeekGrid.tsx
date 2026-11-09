import type { ReactNode } from 'react';
import { assignLanes } from '@/lib/gridLanes';
import { cn } from '@/lib/utils';
import { CLASS_COLORS, CLASS_LABELS, fitGridLines } from '@/lib/scheduleDisplay';
import { gridLayout } from '@/lib/timeGrid';
import type { ClassType, DayOfWeek, TimeBlock } from '@/types';

// Godzina zajec (60 min) ma ROW px; krotsze bloki sa skalowane, ale miescza tytul i 3 linie.
export const ROW = 68;
const HEADER = 36;
/** Wysokosc linii tekstu w bloku (text-[11px] leading-tight) i pionowy padding (py-1). */
const LINE = 14;
const PAD = 8;

export interface GridItem {
  id: string;
  dayOfWeek: DayOfWeek;
  startOrder: number;
  endOrder: number;
  classType: ClassType;
  title: string;
  lines: string[];
  muted?: boolean;
  /** Termin odwolany: przekreslony i wyszarzony. */
  cancelled?: boolean;
  /** Krotkie oznaczenie przy tytule ("przeniesiony", "reczny"). */
  marker?: string;
}

const DAY_SHORT: Record<string, string> = {
  MONDAY: 'Poniedzialek',
  TUESDAY: 'Wtorek',
  WEDNESDAY: 'Sroda',
  THURSDAY: 'Czwartek',
  FRIDAY: 'Piatek',
  SATURDAY: 'Sobota',
  SUNDAY: 'Niedziela',
};

/**
 * Siatka wzorca: dni x bloki siatki godzin kalendarza rocznika, na osi minut — blok 45 min
 * jest nizszy niz 60 min, a przerwy miedzy blokami maja wlasny pas. Zajecia rownolegle
 * (rozne grupy w tym samym czasie) stoja obok siebie — tory wg `lib/gridLanes`.
 * `availability` cieniuje komorki, gdy planista wybral zajecia do umieszczenia
 * (zielone — wolne, czerwone — kolizja).
 */
export function WeekGrid({
  days,
  blocks,
  items,
  availability,
  onCellClick,
  onItemClick,
  dayHeader,
  closedDays,
  passThrough,
}: {
  days: DayOfWeek[];
  blocks: TimeBlock[];
  items: GridItem[];
  availability?: Record<string, Record<number, string | null>> | null;
  onCellClick?: (day: DayOfWeek, order: number) => void;
  onItemClick?: (id: string) => void;
  /** Wlasny naglowek dnia (np. z data) zamiast samej nazwy. */
  dayHeader?: (day: DayOfWeek) => ReactNode;
  /** Dni bez zajec (swieto, przerwa, dzien wolny) — kolumna wyszarzona z opisem. */
  closedDays?: Partial<Record<DayOfWeek, string>>;
  /**
   * Umieszczanie zajec: karty polprzezroczyste i przepuszczaja klikniecie do komorki pod nimi —
   * zajecia innej grupy w tej samej godzinie nie zaslaniaja wolnego miejsca.
   */
  passThrough?: boolean;
}) {
  // Najkrotszy blok miesci tytul i trzy linie opisu; 60 min nie mniej niz ROW.
  const layout = gridLayout(blocks, { minBlockPx: 4 * LINE + PAD + 2, minPxPerMinute: ROW / 60 });
  const breakBands = layout.breaks.map((br) => (
    <div
      key={br.start}
      style={{ position: 'absolute', top: br.top, height: br.height, left: 0, right: 0 }}
      className="bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--color-muted)_6px_8px)] opacity-70"
    />
  ));
  return (
    <div className="flex overflow-x-auto rounded-lg border">
      <div className="w-14 shrink-0 border-r">
        <div style={{ height: HEADER }} className="border-b" />
        <div className="relative" style={{ height: layout.totalHeight }}>
          {layout.rows.map((r) => (
            <div
              key={r.order}
              style={{ position: 'absolute', top: r.top, height: r.height, left: 0, right: 0 }}
              className="border-t px-1 pt-1 text-right text-xs text-muted-foreground tabular-nums first:border-transparent"
            >
              {r.startTime}
            </div>
          ))}
          {layout.breaks.map((br) => (
            <div
              key={br.start}
              title={`Przerwa ${br.start}-${br.end}`}
              style={{ position: 'absolute', top: br.top, height: br.height, left: 0, right: 0 }}
              className="flex items-center justify-end overflow-hidden px-1 text-[10px] leading-none text-amber-700 dark:text-amber-400"
            >
              {br.height >= 12 ? `${br.minutes} min` : ''}
            </div>
          ))}
        </div>
      </div>
      {days.map((day) => {
        const dayItems = items.filter((i) => i.dayOfWeek === day);
        const lanes = assignLanes(dayItems);
        return (
          <div key={day} className="min-w-40 flex-1 border-r last:border-r-0">
            <div style={{ height: HEADER }} className="flex items-center justify-center border-b text-sm font-medium">
              {dayHeader ? dayHeader(day) : DAY_SHORT[day]}
            </div>
            <div className="relative" style={{ height: layout.totalHeight }}>
              {breakBands}
              {closedDays?.[day] !== undefined && (
                <div className="absolute inset-0 flex items-start justify-center bg-[repeating-linear-gradient(135deg,var(--muted)_0_8px,transparent_8px_16px)] pt-4 text-center text-xs font-medium text-muted-foreground">
                  <span className="rounded bg-background/90 px-2 py-1">{closedDays[day] || 'Bez zajec'}</span>
                </div>
              )}
              {layout.rows.map((r) => {
                const reason = availability?.[day]?.[r.order];
                const state = availability ? (reason === null ? 'free' : reason === undefined ? undefined : 'busy') : undefined;
                return (
                  <div
                    key={r.order}
                    title={reason ?? undefined}
                    onClick={() => onCellClick?.(day, r.order)}
                    style={{ position: 'absolute', top: r.top, height: r.height, left: 0, right: 0 }}
                    className={cn(
                      'border-t border-border/60 first:border-transparent',
                      onCellClick && 'cursor-pointer hover:bg-muted/60',
                      state === 'free' && 'bg-green-500/10',
                      state === 'busy' && 'bg-red-500/10',
                    )}
                  />
                );
              })}
              {dayItems.map((item) => {
                const lane = lanes.get(item.id) ?? { lane: 0, span: 1, lanes: 1 };
                const width = 100 / lane.lanes;
                const span = layout.span(item.startOrder, item.endOrder);
                if (!span) return null;
                const height = span.height - 2;
                // Blok 1 h: tytul w jednej linii; dluzszy: tytul do 2 linii. Reszta miejsca na opis.
                const titleLines = item.endOrder === item.startOrder ? 1 : 2;
                const lines = fitGridLines(item.lines, Math.floor((height - PAD) / LINE) - titleLines);
                const title = `${CLASS_LABELS[item.classType]} · ${item.title}`;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onItemClick?.(item.id)}
                    title={[item.marker ? `${title} (${item.marker})` : title, ...item.lines].join('\n')}
                    style={{
                      position: 'absolute',
                      top: span.top + 1,
                      height,
                      left: `calc(${lane.lane * width}% + 2px)`,
                      width: `calc(${width * lane.span}% - 4px)`,
                    }}
                    className={cn(
                      'flex flex-col justify-start overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm',
                      CLASS_COLORS[item.classType],
                      item.muted && 'opacity-40',
                      item.cancelled && 'line-through opacity-50 grayscale',
                      passThrough && 'pointer-events-none opacity-45',
                    )}
                  >
                    <div className={cn('font-semibold', titleLines === 1 ? 'truncate' : 'line-clamp-2')}>
                      {item.marker && <span className="mr-1 rounded bg-background/70 px-1 font-normal no-underline">{item.marker}</span>}
                      {title}
                    </div>
                    {lines.map((line, n) => (
                      <div key={n} className="truncate">
                        {line}
                      </div>
                    ))}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
