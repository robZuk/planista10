import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/PageHeader';
import { FacultySelector } from '@/components/FacultySelector';
import { fetchMakeups } from '@/api/plan';
import { useCurrentTerm } from '@/hooks/useTerm';
import { CLASS_FULL_LABELS } from '@/lib/scheduleDisplay';
import { formatDate, MAKEUP_STATE_LABELS } from '@/lib/makeupLabels';
import { useAuthStore } from '@/store/authStore';
import { useFacultyFilterStore } from '@/store/facultyStore';

/**
 * Odrobienia: odwolane zajecia semestru i to, czy maja juz termin odrobienia. Odwoluje i odrabia
 * tylko planista (administrator, dziekanat) w Ukladaniu planu → Terminy; tu jest przeglad calosci.
 * Tylko studia niestacjonarne — stacjonarne maja terminy do wgladu (odwolan sie nie rejestruje).
 */
export default function MakeupsPage() {
  const { term } = useCurrentTerm();
  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN';
  const facultyFilter = useFacultyFilterStore((s) => s.facultyId);
  const facultyId = isAdmin ? facultyFilter : undefined;

  const { data: rows, isPending } = useQuery({
    queryKey: ['makeups', term?.key, facultyId],
    queryFn: () => fetchMakeups(term!.key, facultyId),
    enabled: !!term,
  });
  const todo = (rows ?? []).filter((m) => m.state === 'TODO').length;

  return (
    <>
      <PageHeader
        title="Odrobienia"
        description="Odwolane zajecia semestru i ich odrobienia (studia niestacjonarne — na stacjonarnych odwolan sie nie rejestruje). Zajecia odwolujesz, a termin odrobienia dodajesz w „Ukladaniu planu” → Terminy (termin reczny wskazujacy odwolane zajecia)."
        actions={isAdmin ? <FacultySelector /> : undefined}
      />
      {isPending && term && <Skeleton className="h-48 w-full" />}
      {rows && (
        <section className="space-y-2">
          <h3 className="font-medium">
            Do odrobienia {todo > 0 && <Badge variant="destructive">{todo}</Badge>}
          </h3>
          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Brak odwolanych zajec w tym semestrze.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Odwolane</TableHead>
                    <TableHead>Zajecia</TableHead>
                    <TableHead>Prowadzacy</TableHead>
                    <TableHead>Stan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((m) => (
                    <TableRow key={m.occurrenceId}>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {formatDate(m.date)} {m.time}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{m.subject}</div>
                        <div className="text-xs text-muted-foreground">
                          {CLASS_FULL_LABELS[m.classType].toLowerCase()} · {m.program} · {m.group} · {m.hours} h
                          {m.note && ` · ${m.note}`}
                        </div>
                      </TableCell>
                      <TableCell>{m.instructor}</TableCell>
                      <TableCell>
                        <Badge variant={m.state === 'MADE_UP' ? 'default' : 'destructive'}>{MAKEUP_STATE_LABELS[m.state]}</Badge>
                        {m.makeup && (
                          <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                            {formatDate(m.makeup.date)} {m.makeup.time}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
