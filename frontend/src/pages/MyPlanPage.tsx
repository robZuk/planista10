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
import { useAuthStore } from '@/store/authStore';
import { addDaysKey } from './calendar/calendarUtils';
import { MyPlanWeek } from './myPlan/MyPlanWeek';

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
  const showInstructor = useAuthStore((s) => s.user?.role) !== 'INSTRUCTOR';
  const [view, setView] = useState<'week' | 'list'>('week');
  const [monday, setMonday] = useState(() => mondayOf(new Date().toISOString().slice(0, 10)));
  const sunday = addDaysKey(monday, 6);
  const { data, isPending } = useQuery({
    queryKey: ['my-plan', term?.key, monday],
    queryFn: () => fetchMyPlan(term!.key, monday, sunday),
    enabled: !!term,
  });
  const byDay = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>>();
    for (const row of data ?? []) map.set(row.date, [...(map.get(row.date) ?? []), row]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  return (
    <>
      <PageHeader
        title="Moj plan"
        description={term ? `Semestr ${term.label}. Widzisz tylko plan opublikowany przez dziekanat.` : 'Wybierz semestr w naglowku.'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border p-0.5" role="group" aria-label="Widok planu">
              <Button size="sm" variant={view === 'week' ? 'secondary' : 'ghost'} aria-pressed={view === 'week'} onClick={() => setView('week')}>
                <CalendarDays /> Tydzien
              </Button>
              <Button size="sm" variant={view === 'list' ? 'secondary' : 'ghost'} aria-pressed={view === 'list'} onClick={() => setView('list')}>
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
      {data && view === 'week' && byDay.length > 0 && <MyPlanWeek monday={monday} rows={data} showInstructor={showInstructor} />}
      {data && byDay.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          W tym tygodniu brak zajec (albo plan nie jest jeszcze opublikowany).
        </p>
      )}
      <div className="space-y-4">
        {view === 'list' && byDay.map(([date, rows]) => (
          <section key={date} className="space-y-1">
            <h3 className="font-medium">
              {WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()]} {date}
            </h3>
            <ul className="divide-y rounded-lg border">
              {rows.map((r) => (
                <li key={r.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm ${r.status === 'CANCELLED' ? 'text-muted-foreground line-through' : ''}`}>
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
                  {r.note && <span className="text-xs text-muted-foreground">{r.note}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
