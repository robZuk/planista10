import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, List } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/PageHeader';
import { fetchMyPlan } from '@/api/plan';
import { useCurrentTerm } from '@/hooks/useTerm';
import { CLASS_FULL_LABELS } from '@/lib/scheduleDisplay';
import { formatMinutes } from '@/lib/timeGrid';
import { formatDayMonth } from '@/lib/planHours';
import { useAuthStore } from '@/store/authStore';
import { addDaysKey } from './calendar/calendarUtils';
import { MyPlanWeek } from './myPlan/MyPlanWeek';
import { RequestDialog } from './myPlan/RequestDialog';
import { REQUEST_KIND_LABELS } from '@/lib/requestLabels';
import type { MyPlanRow } from '@/types';

const WEEKDAY = ['Niedziela', 'Poniedzialek', 'Wtorek', 'Sroda', 'Czwartek', 'Piatek', 'Sobota'];

function mondayOf(key: string): string {
  const d = new Date(`${key}T12:00:00Z`).getUTCDay();
  return addDaysKey(key, d === 0 ? -6 : 1 - d);
}

/**
 * Plan osobisty studenta albo prowadzacego — tylko z opublikowanych kalendarzy.
 * Student widzi zajecia swoich grup (z wykladami calego rocznika), prowadzacy — swoje.
 */
export default function MyPlanPage() {
  const { term } = useCurrentTerm();
  // Prowadzacy nie potrzebuje wlasnego nazwiska w kazdym wierszu; student — tak.
  const isInstructor = useAuthStore((s) => s.user?.role) === 'INSTRUCTOR';
  const showInstructor = !isInstructor;
  // Prowadzacy: klikniecie zajec otwiera zgloszenie do dziekanatu (odwolanie, przeniesienie, odrobienie).
  const [requestFor, setRequestFor] = useState<string | null>(null);
  const onSelect = isInstructor ? (r: MyPlanRow) => setRequestFor(r.id) : undefined;
  const [view, setView] = useState<'week' | 'list'>('week');
  const [monday, setMonday] = useState(() => mondayOf(new Date().toISOString().slice(0, 10)));
  const sunday = addDaysKey(monday, 6);
  const { data, isPending } = useQuery({
    queryKey: ['my-plan', term?.key, monday],
    queryFn: () => fetchMyPlan(term!.key, monday, sunday),
    enabled: !!term,
  });
  const range = data?.range ?? null;
  // Tydzien poza semestrem (np. po przelaczeniu na semestr letni w listopadzie) albo semestr bez
  // opublikowanego planu: zamiast pustego tygodnia z samym swietem — wyjasnienie i skok do semestru.
  const outside = !!data && (!range || sunday < range.start || monday > range.end);
  const rows = useMemo(() => (outside ? [] : (data?.rows ?? [])), [data, outside]);
  const daysOff = useMemo(() => (outside ? {} : (data?.daysOff ?? {})), [data, outside]);
  // Dni z zajeciami i dni wolne (swieto, przerwa) — na liscie dzien wolny ma wlasny wpis.
  const byDay = useMemo(() => {
    const map = new Map<string, MyPlanRow[]>(Object.keys(daysOff).map((d) => [d, []]));
    for (const row of rows) map.set(row.date, [...(map.get(row.date) ?? []), row]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows, daysOff]);

  return (
    <>
      <PageHeader
        title="Moj plan"
        description={
          term
            ? `Semestr ${term.label}. Widzisz tylko plan opublikowany przez dziekanat.${isInstructor ? ' Kliknij zajecia, zeby poprosic o odwolanie, przeniesienie albo odrobienie.' : ''}`
            : 'Wybierz semestr w naglowku.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border p-0.5" role="group" aria-label="Widok planu">
              <Button
                size="sm"
                variant={view === 'week' ? 'secondary' : 'ghost'}
                aria-pressed={view === 'week'}
                onClick={() => setView('week')}
              >
                <CalendarDays /> Tydzien
              </Button>
              <Button
                size="sm"
                variant={view === 'list' ? 'secondary' : 'ghost'}
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
              >
                <List /> Lista
              </Button>
            </div>
            <Button variant="outline" size="icon" aria-label="Poprzedni tydzien" onClick={() => setMonday(addDaysKey(monday, -7))}>
              <ChevronLeft />
            </Button>
            <span className="text-sm tabular-nums">
              {monday} – {sunday}
            </span>
            <Button variant="outline" size="icon" aria-label="Nastepny tydzien" onClick={() => setMonday(addDaysKey(monday, 7))}>
              <ChevronRight />
            </Button>
          </div>
        }
      />
      {isPending && term && <Skeleton className="h-48 w-full" />}
      {data && view === 'week' && byDay.length > 0 && (
        <MyPlanWeek monday={monday} rows={rows} daysOff={daysOff} showInstructor={showInstructor} onSelect={onSelect} />
      )}
      {data && !range && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Plan na semestr {term?.label} nie jest jeszcze opublikowany{isInstructor ? ' albo nie masz w nim zajec' : ''}.
        </p>
      )}
      {data && range && outside && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          <p>
            Ten tydzien jest poza semestrem {term?.label} ({formatDayMonth(range.start)} – {formatDayMonth(range.end)}).
          </p>
          <Button variant="outline" size="sm" onClick={() => setMonday(mondayOf(monday > range.end ? range.end : range.start))}>
            {monday > range.end ? 'Przejdz do ostatniego tygodnia' : 'Przejdz do pierwszego tygodnia'}
          </Button>
        </div>
      )}
      {data && !outside && byDay.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          W tym tygodniu brak zajec.
        </p>
      )}
      <div className="space-y-4">
        {view === 'list' &&
          byDay.map(([date, dayRows]) => (
            <section key={date} className="space-y-1">
              <h3 className="flex flex-wrap items-center gap-2 font-medium">
                {WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()]} {formatDayMonth(date)}
                {daysOff[date] && <Badge variant="secondary">{daysOff[date]}</Badge>}
              </h3>
              {dayRows.length > 0 && (
                <ul className="divide-y rounded-lg border">
                  {dayRows.map((r) => (
                    <li
                      key={r.id}
                      role={onSelect ? 'button' : undefined}
                      tabIndex={onSelect ? 0 : undefined}
                      onClick={onSelect ? () => onSelect(r) : undefined}
                      onKeyDown={onSelect ? (e) => (e.key === 'Enter' || e.key === ' ') && onSelect(r) : undefined}
                      className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm ${r.status === 'CANCELLED' ? 'text-muted-foreground line-through' : ''} ${onSelect ? 'cursor-pointer hover:bg-muted' : ''}`}
                    >
                      <span className="w-28 tabular-nums">
                        {formatMinutes(r.startMinute)}–{formatMinutes(r.endMinute)}
                      </span>
                      <span className="font-medium">{r.subject}</span>
                      <Badge variant="outline">{CLASS_FULL_LABELS[r.classType]}</Badge>
                      <span>
                        {r.program} · {r.group}
                      </span>
                      <span className="text-muted-foreground">{r.room}</span>
                      {showInstructor && <span className="text-muted-foreground">{r.instructor}</span>}
                      {r.status === 'CANCELLED' && <Badge variant="destructive">odwolane</Badge>}
                      {r.status === 'MAKEUP' && <Badge>odrobienie</Badge>}
                      {r.pendingRequest && (
                        <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                          zgloszono: {REQUEST_KIND_LABELS[r.pendingRequest].toLowerCase()}
                        </Badge>
                      )}
                      {r.note && <span className="text-xs text-muted-foreground">{r.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
      </div>
      {requestFor && <RequestDialog occurrenceId={requestFor} onClose={() => setRequestFor(null)} />}
    </>
  );
}
