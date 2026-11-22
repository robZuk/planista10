import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Building2,
  CalendarDays,
  CalendarOff,
  Clock,
  GraduationCap,
  LayoutGrid,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { PageHeader } from '@/components/PageHeader';
import { fetchDashboardStats } from '@/api/dashboard';
import { ROLE_LABELS } from '@/lib/navigation';
import { formatDateLong, toDateKey } from '@/lib/scheduleDates';
import { useAuthStore } from '@/store/authStore';
import { StatTile } from './dashboard/StatTile';
import { WeekLoadChart } from './dashboard/WeekLoadChart';
import { plural } from '@/lib/setupSteps';
import { TodayCard } from './dashboard/TodayCard';

const DAY_OFF_LABELS = { HOLIDAY: 'swieto', BREAK: 'przerwa', DAY_OFF: 'dzien wolny' } as const;

/** "11 listopada 2026" albo "23 grudnia 2026 – 1 stycznia 2027". */
function formatDayOffRange(start: string, end: string): string {
  return start === end ? formatDateLong(start) : `${formatDateLong(start)} – ${formatDateLong(end)}`;
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;


  const { data: stats, isPending } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: fetchDashboardStats,
  });

  /** Tydzien i dzis przychodza z /dashboard/stats juz przyciete do roli uzytkownika. */
  const myInstructorId = role === 'INSTRUCTOR' ? user?.instructorId : null;
  const myGroupIds = role === 'STUDENT' ? (user?.studentGroups.map((g) => g.id) ?? []) : [];
  const hasOwnPlan = !!myInstructorId || myGroupIds.length > 0;
  const weekEntries = stats?.weekEntries;

  const todayKey = toDateKey(new Date());
  const myToday = weekEntries?.filter((entry) => toDateKey(entry.date) === todayKey) ?? [];

  const greeting = `${ROLE_LABELS[role ?? 'STUDENT']} · ${formatDateLong(new Date())}`;
  // Swieto ustawowe dzis — pusty dzien prowadzacego/studenta dostaje powod zamiast "nie masz zajec".
  const todayHoliday = stats?.upcomingHolidays.find((h) => toDateKey(h.date) === todayKey) ?? null;

  // ─── Prowadzacy i student: wlasny plan, bez statystyk calej uczelni ───
  if (role === 'INSTRUCTOR' || role === 'STUDENT') {
    const isInstructor = role === 'INSTRUCTOR';
    const weekHours = (weekEntries ?? [])
      .reduce((sum, entry) => sum + (entry.endBlock.order - entry.startBlock.order + 1), 0);

    return (
      <>
        <PageHeader title={`Witaj, ${user?.name ?? ''}`} description={greeting} />

        {!hasOwnPlan && (
          <Card>
            <CardHeader>
              <CardTitle>Brak powiazania z planem</CardTitle>
              <CardDescription>
                {isInstructor
                  ? 'To konto nie jest powiazane z zadnym prowadzacym, wiec nie ma czego pokazac. Administrator moze to ustawic w Uzytkownikach.'
                  : 'To konto nie jest przypisane do zadnej grupy studenckiej. Administrator moze to ustawic w Uzytkownikach.'}
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile
            label="Zajec dzisiaj"
            value={myToday.length}
            icon={CalendarDays}
            loading={!weekEntries}
          />
          <StatTile
            label="Godzin w tym tygodniu"
            value={weekHours}
            icon={Clock}
            loading={!weekEntries}
          />
          <StatTile
            label="Zajec w tym tygodniu"
            value={weekEntries?.length ?? 0}
            icon={LayoutGrid}
            loading={!weekEntries}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <WeekLoadChart
            entries={weekEntries ?? []}
            title="Twoj tydzien"
            description="Godziny zajec w podziale na dni biezacego tygodnia."
          />
          <TodayCard
            entries={myToday}
            loading={!weekEntries}
            title={isInstructor ? 'Twoje dzisiejsze zajecia' : 'Dzis w planie grupy'}
            emptyText={todayHoliday ? `Dzis wolne: ${todayHoliday.name}.` : 'Dzis nie masz zajec.'}
          />
        </div>

        <Button variant="outline" asChild className="w-fit">
          <Link to="/my-plan">
            <CalendarDays />
            Zobacz caly plan
          </Link>
        </Button>
      </>
    );
  }

  // ─── Administrator i dziekanat: obraz calej uczelni ───
  const isAdmin = role === 'ADMIN';
  // Swieto albo przerwa we wszystkich kalendarzach — pusty dzien dostaje powod.
  const todayOffEverywhere =
    stats?.upcomingDaysOff.find((d) => d.calendars === null && d.start <= todayKey && todayKey <= d.end) ?? null;

  return (
    <>
      <PageHeader
        title={`Witaj, ${user?.name ?? ''}`}
        description={stats?.scope.kind === 'FACULTY' ? `${greeting} · liczby dla wydzialu: ${stats.scope.name}` : greeting}
      />

      <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${isAdmin ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
        {isAdmin && (
          <StatTile
            label="Uzytkownicy"
            value={stats?.users.total ?? 0}
            hint={
              stats
                ? `${plural(stats.users.byRole.INSTRUCTOR, 'prowadzacy', 'prowadzacych', 'prowadzacych')}, ${plural(stats.users.byRole.STUDENT, 'student', 'studentow', 'studentow')}`
                : undefined
            }
            icon={ShieldCheck}
            loading={isPending}
          />
        )}
        <StatTile
          label="Prowadzacy"
          value={stats?.instructors.total ?? 0}
          icon={GraduationCap}
          loading={isPending}
        />
        <StatTile
          label="Grupy"
          value={stats?.groups.total ?? 0}
          hint={stats ? plural(stats.students.total, 'student', 'studentow', 'studentow') : undefined}
          icon={Users}
          loading={isPending}
        />
        <StatTile
          label="Sale"
          value={stats?.rooms.total ?? 0}
          hint={stats ? `w ${stats.buildings.total} budynkach` : undefined}
          icon={Building2}
          loading={isPending}
        />
        <StatTile
          label="Terminy"
          value={stats?.entries.total ?? 0}
          hint={stats ? `${stats.entries.todayCount} dzisiaj` : undefined}
          icon={CalendarDays}
          loading={isPending}
        />
      </div>

      <WeekLoadChart entries={weekEntries ?? []} />

      <div className="grid gap-4 lg:grid-cols-2">
        <TodayCard
          entries={stats?.todayEntries}
          loading={isPending}
          limit={12}
          emptyText={todayOffEverywhere ? `Dzis wolne: ${todayOffEverywhere.name}.` : undefined}
        />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarOff className="size-4 text-muted-foreground" />
              Najblizsze dni wolne
            </CardTitle>
            <CardDescription>Swieta oraz przerwy i dni wolne z kalendarzy semestru — generator terminow je omija.</CardDescription>
          </CardHeader>
          <CardContent>
            {stats?.upcomingDaysOff.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                W najblizszych 60 dniach nie ma dni wolnych.
              </p>
            ) : (
              <ItemGroup className="rounded-lg border">
                {stats?.upcomingDaysOff.map((day) => (
                  <Item key={day.id} size="sm" variant="muted">
                    <ItemContent>
                      <ItemTitle>
                        {day.name}
                        <Badge variant="outline">{DAY_OFF_LABELS[day.kind]}</Badge>
                      </ItemTitle>
                      <ItemDescription>
                        {formatDayOffRange(day.start, day.end)}
                        {day.calendars && ` · ${day.calendars.join(', ')}`}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </CardContent>
        </Card>
      </div>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Ostatnio dodani uzytkownicy</CardTitle>
            <CardDescription>Pieciu najnowszych.</CardDescription>
          </CardHeader>
          <CardContent>
            <ItemGroup className="rounded-lg border">
              {stats?.recentUsers.map((recent) => (
                <Item key={recent.id} size="sm" variant="muted">
                  <ItemContent>
                    <ItemTitle>
                      {recent.name}
                      <Badge variant="secondary">{ROLE_LABELS[recent.role]}</Badge>
                    </ItemTitle>
                    <ItemDescription>{recent.email}</ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
      )}
    </>
  );
}
