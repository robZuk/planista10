import { cn } from '@/lib/utils';
import { formatDayMonth } from '@/lib/planHours';
import { CLASS_COLORS, CLASS_LABELS } from '@/lib/scheduleDisplay';
import { formatMinutes } from '@/lib/timeGrid';
import { hourRange, weekColumns, weekLanes } from '@/lib/myPlanWeek';
import { REQUEST_KIND_LABELS } from '@/lib/requestLabels';
import type { MyPlanRow } from '@/types';

const DAY_SHORT = ['Nd', 'Pn', 'Wt', 'Sr', 'Cz', 'Pt', 'Sb'];
/** Godzina = 84 px: kafelek 45 min (bloki WN) miesci godzine, przedmiot, grupe i sale. */
const PX_PER_MINUTE = 1.4;
const HEADER = 36;

/**
 * "Moj plan" jako kalendarz tygodnia. Os w minutach (plan laczy wydzialy o roznych siatkach),
 * zajecia rownolegle obok siebie, odwolane przekreslone, odrobienia oznaczone.
 * `showInstructor` — student widzi prowadzacego, prowadzacy nie widzi samego siebie.
 */
export function MyPlanWeek({
  monday,
  rows,
  daysOff,
  showInstructor,
  onSelect,
}: {
  monday: string;
  rows: MyPlanRow[];
  /** Data -> nazwa swieta, przerwy albo dnia wolnego uczelni (kolumna zakreskowana z opisem). */
  daysOff: Record<string, string>;
  showInstructor: boolean;
  /** Prowadzacy: klikniecie zajec otwiera zgloszenie do dziekanatu. */
  onSelect?: (row: MyPlanRow) => void;
}) {
  const days = weekColumns(monday, rows);
  const { from, to } = hourRange(rows);
  const lanes = weekLanes(rows);
  const height = (to - from) * PX_PER_MINUTE;
  const hours = Array.from({ length: (to - from) / 60 }, (_, i) => from + i * 60);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex overflow-x-auto rounded-lg border">
      <div className="w-12 shrink-0 border-r">
        <div style={{ height: HEADER }} className="border-b" />
        <div className="relative" style={{ height }}>
          {hours.map((m) => (
            <div
              key={m}
              style={{
                position: 'absolute',
                top: (m - from) * PX_PER_MINUTE,
                left: 0,
                right: 0,
              }}
              className="px-1 pt-0.5 text-right text-xs text-muted-foreground tabular-nums"
            >
              {formatMinutes(m)}
            </div>
          ))}
        </div>
      </div>
      {days.map((date) => {
        const dayRows = rows.filter((r) => r.date === date);
        const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
        return (
          <div key={date} className="min-w-36 flex-1 border-r last:border-r-0">
            <div
              style={{ height: HEADER }}
              className={cn('flex items-center justify-center border-b text-sm font-medium', date === today && 'text-primary')}
            >
              {DAY_SHORT[weekday]} {formatDayMonth(date)}
            </div>
            <div className="relative" style={{ height }}>
              {hours.map((m) => (
                <div
                  key={m}
                  style={{
                    position: 'absolute',
                    top: (m - from) * PX_PER_MINUTE,
                    left: 0,
                    right: 0,
                  }}
                  className="border-t border-border/60 first:border-transparent"
                />
              ))}
              {daysOff[date] && (
                <div className="absolute inset-0 flex items-start justify-center bg-[repeating-linear-gradient(135deg,var(--muted)_0_8px,transparent_8px_16px)] pt-4 text-center text-xs font-medium text-muted-foreground">
                  <span className="rounded bg-background/90 px-2 py-1">{daysOff[date]}</span>
                </div>
              )}
              {dayRows.map((r) => {
                const lane = lanes.get(r.id) ?? { lane: 0, span: 1, lanes: 1 };
                const width = 100 / lane.lanes;
                const time = `${formatMinutes(r.startMinute)}–${formatMinutes(r.endMinute)}`;
                const who = `${r.program} · ${r.group}`;
                const lines = [r.room, ...(showInstructor ? [r.instructor] : [])];
                const pending = r.pendingRequest ? `zgloszono: ${REQUEST_KIND_LABELS[r.pendingRequest].toLowerCase()}` : null;
                const status = pending ?? (r.status === 'CANCELLED' ? 'odwolane' : r.status === 'MAKEUP' ? 'odrobienie' : null);
                return (
                  <div
                    key={r.id}
                    role={onSelect ? 'button' : undefined}
                    tabIndex={onSelect ? 0 : undefined}
                    onClick={onSelect ? () => onSelect(r) : undefined}
                    onKeyDown={onSelect ? (e) => (e.key === 'Enter' || e.key === ' ') && onSelect(r) : undefined}
                    title={[
                      `${time} ${CLASS_LABELS[r.classType]} · ${r.subject}`,
                      who,
                      ...lines,
                      ...(status ? [status] : []),
                      ...(r.note ? [r.note] : []),
                    ].join('\n')}
                    style={{
                      position: 'absolute',
                      top: (r.startMinute - from) * PX_PER_MINUTE + 1,
                      height: (r.endMinute - r.startMinute) * PX_PER_MINUTE - 2,
                      left: `calc(${lane.lane * width}% + 2px)`,
                      width: `calc(${width * lane.span}% - 4px)`,
                    }}
                    className={cn(
                      'overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-[11px] leading-tight shadow-sm',
                      CLASS_COLORS[r.classType],
                      r.status === 'CANCELLED' && 'line-through opacity-50 grayscale',
                      onSelect && 'cursor-pointer hover:ring-2 hover:ring-primary/50',
                      pending && 'ring-2 ring-amber-500',
                    )}
                  >
                    <div className="tabular-nums opacity-80">
                      {time}
                      {status && <span className="ml-1 rounded bg-background/70 px-1 no-underline">{status}</span>}
                    </div>
                    {/* Zajecia do godziny: przedmiot w jednej linii (pelny w dymku), zeby zmiescily sie grupa i sala. */}
                    <div className={cn('font-semibold', r.endMinute - r.startMinute <= 60 ? 'truncate' : 'line-clamp-2')}>
                      {CLASS_LABELS[r.classType]} · {r.subject}
                    </div>
                    <div className="truncate">{who}</div>
                    {lines.map((line) => (
                      <div key={line} className="truncate">
                        {line}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
