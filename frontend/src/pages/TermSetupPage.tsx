import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, CircleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/PageHeader';
import { FacultySelector } from '@/components/FacultySelector';
import { fetchSetup } from '@/api/plan';
import { useCurrentTerm } from '@/hooks/useTerm';
import { CALENDAR_STATUS_LABELS, STUDY_MODE_LABELS } from '@/lib/labels';
import { staleMessage } from '@/lib/planStaleness';
import { useAuthStore } from '@/store/authStore';
import { useFacultyFilterStore } from '@/store/facultyStore';

type State = 'done' | 'todo' | 'warn';

function Step({ n, title, state, children, to, link }: { n: number; title: string; state: State; children: React.ReactNode; to: string; link: string }) {
  const Icon = state === 'done' ? CheckCircle2 : state === 'warn' ? CircleAlert : Circle;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={state === 'done' ? 'text-green-600' : state === 'warn' ? 'text-amber-600' : 'text-muted-foreground'} />
          {n}. {title}
        </CardTitle>
        <CardDescription>{children}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link to={to} className="text-sm font-medium text-primary hover:underline">
          {link} →
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * Przygotowanie semestru — lista kontrolna wydzialu z licznikami: kalendarz, roczniki,
 * zajecia, obsada, plan, terminy i publikacja. Nic tu nie dzieje sie automatycznie —
 * kazdy krok prowadzi do strony, na ktorej planista wykonuje go sam.
 */
export default function TermSetupPage() {
  const me = useAuthStore((s) => s.user);
  const isAdmin = me?.role === 'ADMIN';
  const facultyFilter = useFacultyFilterStore((s) => s.facultyId);
  const facultyId = isAdmin ? facultyFilter : undefined;
  const { term } = useCurrentTerm();
  const { data, isPending } = useQuery({
    queryKey: ['setup', term?.key, facultyId],
    queryFn: () => fetchSetup(term!.key, facultyId),
    enabled: !!term,
  });

  const t = data?.totals;
  const key = term?.key ?? '';
  return (
    <>
      <PageHeader
        title="Przygotowanie semestru"
        description={term ? `Semestr ${term.label} — co jest gotowe, a co zostalo.` : 'Wybierz semestr w naglowku.'}
        actions={isAdmin && <FacultySelector />}
      />
      {isPending && term && <Skeleton className="h-64 w-full" />}
      {data && t && (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Step n={1} title="Kalendarz" state={data.missingCalendars > 0 ? 'todo' : 'done'} to={`/calendar/${key}`} link="Kalendarz semestru">
              {data.calendars.length} kalendarzy
              {data.missingCalendars > 0 ? ` · brakuje ${data.missingCalendars} (tryb bez kalendarza)` : ' · daty, przerwy, zjazdy'}
            </Step>
            <Step n={2} title="Roczniki i grupy" state={t.cohorts === 0 ? 'todo' : t.cohortsWithoutCalendar > 0 ? 'warn' : 'done'} to={`/cohorts/${key}`} link="Roczniki i grupy">
              {t.cohorts} rocznikow w semestrze{t.cohortsWithoutCalendar > 0 ? ` · ${t.cohortsWithoutCalendar} bez kalendarza` : ''} · nowy nabor zakladasz recznie
            </Step>
            <Step
              n={3}
              title="Programy zatwierdzone"
              state={t.cohorts === 0 ? 'todo' : t.cohortsWithDraftVersion > 0 ? 'todo' : 'done'}
              to="/curriculum"
              link="Programy studiow"
            >
              {t.cohortsWithDraftVersion > 0
                ? `Roczniki z wersja programu w projekcie: ${t.cohortsWithDraftVersion} — bez zatwierdzenia nie powstana zajecia ani plan`
                : 'Wszystkie roczniki korzystaja z zatwierdzonych wersji programu'}
            </Step>
            <Step n={4} title="Zajecia" state={t.cohortsWithoutSections > 0 || t.sections === 0 ? 'todo' : 'done'} to={`/obsada/${key}`} link="Synchronizuj zajecia">
              {t.sections} zajec{t.cohortsWithoutSections > 0 ? ` · ${t.cohortsWithoutSections} rocznikow bez zajec — zsynchronizuj` : ''}
            </Step>
            <Step n={5} title="Obsada" state={t.sections === 0 ? 'todo' : t.vacancies > 0 ? 'warn' : 'done'} to={`/obsada/${key}`} link="Zajecia i obsada">
              {t.vacancies > 0 ? `${t.vacancies} zajec bez pelnej obsady (NN)` : 'Wszystkie zajecia obsadzone'}
            </Step>
            <Step n={6} title="Plan (wzorzec)" state={t.sections === 0 ? 'todo' : t.placedSections < t.sections ? 'warn' : 'done'} to={`/plan/${key}`} link="Ukladanie planu">
              {t.placedSections}/{t.sections} zajec umieszczonych · opcjonalnie „Przenies plan z zeszlego roku”
            </Step>
            <Step n={7} title="Terminy i publikacja" state={t.staleCohorts > 0 ? 'warn' : t.published > 0 ? 'done' : 'todo'} to={`/calendar/${key}`} link="Publikacja w kalendarzu">
              {t.staleCohorts > 0 ? `${t.staleCohorts} rocznikow z nieaktualnymi terminami — „Generuj terminy”` : 'Terminy aktualne'} ·{' '}
              {t.published > 0 ? `opublikowane kalendarze: ${t.published}` : 'nic nie opublikowano'}
            </Step>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rocznik</TableHead>
                  <TableHead>Program</TableHead>
                  <TableHead>Kalendarz</TableHead>
                  <TableHead className="text-right">Grupy</TableHead>
                  <TableHead className="text-right">Zajecia</TableHead>
                  <TableHead className="text-right">Braki obsady</TableHead>
                  <TableHead className="text-right">Umieszczone</TableHead>
                  <TableHead className="text-right">Terminy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.cohorts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      {c.code} · semestr {c.semester}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Link to={`/curriculum/program/${c.programVersion.id}`} className="underline-offset-4 hover:underline">
                        {c.programVersion.label}
                      </Link>
                      {c.programVersion.status === 'DRAFT' && (
                        <Badge variant="destructive" className="ml-1">
                          projekt
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.calendar ? `${c.calendar.name} (${CALENDAR_STATUS_LABELS[c.calendar.status].toLowerCase()})` : <span className="text-destructive">brak</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.groups}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.sections}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.vacancies}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.placedSections}/{c.sections}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.occurrences}
                      {c.stale && (
                        <Badge
                          variant="outline"
                          className="ml-1 cursor-help"
                          title={`${staleMessage(c.staleReasons)} Uzyj „Generuj terminy” w Ukladaniu planu.`}
                        >
                          nieaktualne
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {data.calendars.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Kalendarze:{' '}
              {data.calendars.map((c) => `${STUDY_MODE_LABELS[c.studyMode]} · ${c.name} (${CALENDAR_STATUS_LABELS[c.status].toLowerCase()})`).join('; ')}
              . Studenci i prowadzacy widza plan dopiero po zmianie statusu kalendarza na „Opublikowany”.
            </p>
          )}
        </>
      )}
    </>
  );
}
