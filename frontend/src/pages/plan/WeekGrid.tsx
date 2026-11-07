import { cn } from '@/lib/utils';
import { CLASS_COLORS, CLASS_LABELS } from '@/lib/scheduleDisplay';
import type { ClassType, DayOfWeek, TimeBlock } from '@/types';

export const ROW = 56;
const HEADER = 36;

export interface GridItem {
  id: string;
  dayOfWeek: DayOfWeek;
  startOrder: number;
  endOrder: number;
  classType: ClassType;
  title: string;
  lines: string[];
  muted?: boolean;
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

/** Tory dla zajec rownoleglych: kazdy blok dostaje kolumne, w ktorej nie nachodzi na inne. */
function assignLanes(items: GridItem[]): Map<string, { lane: number; lanes: number }> {
  const result = new Map<string, { lane: number; lanes: number }>();
  const sorted = [...items].sort((a, b) => a.startOrder - b.startOrder || a.endOrder - b.endOrder);
  const laneEnds: number[] = [];
  const assigned: { item: GridItem; lane: number }[] = [];
  for (const item of sorted) {
    let lane = laneEnds.findIndex((end) => end < item.startOrder);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endOrder);
    } else laneEnds[lane] = item.endOrder;
    assigned.push({ item, lane });
  }
  // Szerokosc: liczba torow w grupie nakladajacych sie blokow.
  for (const { item, lane } of assigned) {
    const overlapping = assigned.filter(
      (o) => o.item.startOrder <= item.endOrder && item.startOrder <= o.item.endOrder,
    );
    const lanes = Math.max(...overlapping.map((o) => o.lane)) + 1;
    result.set(item.id, { lane, lanes });
  }
  return result;
}

/**
 * Siatka wzorca: dni x bloki godzinowe. Zajecia rownolegle (rozne grupy w tym samym
 * czasie) stoja obok siebie, a nie jedne na drugich. `availability` cieniuje komorki,
 * gdy planista wybral zajecia do umieszczenia (zielone — wolne, czerwone — kolizja).
 */
export function WeekGrid({
  days,
  blocks,
  items,
  availability,
  onCellClick,
  onItemClick,
}: {
  days: DayOfWeek[];
  blocks: TimeBlock[];
  items: GridItem[];
  availability?: Record<string, Record<number, string | null>> | null;
  onCellClick?: (day: DayOfWeek, order: number) => void;
  onItemClick?: (id: string) => void;
}) {
  const firstOrder = blocks[0]?.order ?? 1;
  return (
    <div className="flex overflow-x-auto rounded-lg border">
      <div className="w-14 shrink-0 border-r">
        <div style={{ height: HEADER }} className="border-b" />
        {blocks.map((b) => (
          <div key={b.id} style={{ height: ROW }} className="border-t px-1 pt-1 text-right text-xs text-muted-foreground tabular-nums first:border-transparent">
            {b.startTime}
          </div>
        ))}
      </div>
      {days.map((day) => {
        const dayItems = items.filter((i) => i.dayOfWeek === day);
        const lanes = assignLanes(dayItems);
        return (
          <div key={day} className="min-w-40 flex-1 border-r last:border-r-0">
            <div style={{ height: HEADER }} className="flex items-center justify-center border-b text-sm font-medium">
              {DAY_SHORT[day]}
            </div>
            <div className="relative" style={{ height: blocks.length * ROW }}>
              {blocks.map((b, i) => {
                const reason = availability?.[day]?.[b.order];
                const state = availability ? (reason === null ? 'free' : reason === undefined ? undefined : 'busy') : undefined;
                return (
                  <div
                    key={b.id}
                    title={reason ?? undefined}
                    onClick={() => onCellClick?.(day, b.order)}
                    style={{ position: 'absolute', top: i * ROW, height: ROW, left: 0, right: 0 }}
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
                const lane = lanes.get(item.id) ?? { lane: 0, lanes: 1 };
                const width = 100 / lane.lanes;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onItemClick?.(item.id)}
                    style={{
                      position: 'absolute',
                      top: (item.startOrder - firstOrder) * ROW + 1,
                      height: (item.endOrder - item.startOrder + 1) * ROW - 2,
                      left: `calc(${lane.lane * width}% + 2px)`,
                      width: `calc(${width}% - 4px)`,
                    }}
                    className={cn(
                      'overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm',
                      CLASS_COLORS[item.classType],
                      item.muted && 'opacity-40',
                    )}
                  >
                    <div className="font-semibold">
                      {CLASS_LABELS[item.classType]} · {item.title}
                    </div>
                    {item.lines.map((line, n) => (
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
