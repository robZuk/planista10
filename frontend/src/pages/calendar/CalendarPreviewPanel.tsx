import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import type { CalendarKind, CalendarPreview } from '@/types';
import { formatDayKey, formatRange } from './calendarUtils';

interface Props {
  preview: CalendarPreview | null;
  kind: CalendarKind;
  loading: boolean;
}

/**
 * Podglad kalendarza: numery tygodni zajec z parzystoscia (tydzien A/B wspolny dla
 * wszystkich dni), przerwy, swieta i dni wolne; dla kalendarza zjazdowego — zjazdy
 * z liczba dni zajec. Liczone przez serwer tym samym kodem co generowanie terminow.
 */
export function CalendarPreviewPanel({ preview, kind, loading }: Props) {
  if (!preview?.weeks) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border text-sm text-muted-foreground">
        {loading ? <Spinner /> : 'Podaj daty semestru, aby zobaczyc podglad'}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Podglad</h3>
        {loading && <Spinner className="size-4" />}
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-md bg-muted p-2">
          <div className="text-xs text-muted-foreground">Tygodnie zajec</div>
          <div className="text-lg font-semibold tabular-nums">{preview.teachingWeeks}</div>
        </div>
        <div className="rounded-md bg-muted p-2">
          <div className="text-xs text-muted-foreground">{kind === 'ZJAZD' ? 'Zjazdy' : 'Dni zajec'}</div>
          <div className="text-lg font-semibold tabular-nums">
            {kind === 'ZJAZD' ? preview.zjazdCount : preview.teachingDays}
          </div>
        </div>
      </div>

      {kind === 'ZJAZD' ? (
        <ul className="max-h-[26rem] space-y-1 overflow-y-auto text-sm">
          {preview.zjazdy?.map((z) => (
            <li key={z.number} className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1 odd:bg-muted/50">
              <span className="w-10 font-medium tabular-nums">nr {z.number}</span>
              <span className="tabular-nums">{formatRange(z.startDate, z.endDate)}</span>
              <Badge variant={z.teachingDays === 0 ? 'destructive' : 'secondary'} className="ml-auto">
                {z.teachingDays} dni zajec
              </Badge>
              {z.notes.length > 0 && <span className="w-full text-xs text-muted-foreground">{z.notes.map((n) => `${formatDayKey(n.slice(0, 10))}${n.slice(10)}`).join('; ')}</span>}
            </li>
          ))}
          {preview.zjazdy?.length === 0 && <li className="text-muted-foreground">Brak zjazdow</li>}
        </ul>
      ) : (
        <ul className="max-h-[26rem] space-y-1 overflow-y-auto text-sm">
          {preview.weeks.map((week) => (
            <li
              key={week.monday}
              className={`flex flex-wrap items-center gap-2 rounded-md px-2 py-1 ${
                week.index === null ? 'bg-amber-500/10 text-muted-foreground' : 'odd:bg-muted/50'
              }`}
            >
              <span className="w-12 font-medium tabular-nums">{week.index === null ? '—' : `tydz. ${week.index}`}</span>
              <span className="tabular-nums">
                {formatDayKey(week.monday)}–{formatDayKey(week.sunday)}
              </span>
              {week.index !== null && (
                <Badge variant="outline" className="ml-auto">
                  {week.index % 2 === 1 ? 'nieparzysty' : 'parzysty'}
                </Badge>
              )}
              {week.index === null && <span className="ml-auto text-xs">{week.breakName ?? 'przerwa'}</span>}
              {week.notes.length > 0 && (
                <span className="w-full text-xs text-muted-foreground">
                  {week.notes.map((n) => `${formatDayKey(n.slice(0, 10))}${n.slice(10)}`).join('; ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
