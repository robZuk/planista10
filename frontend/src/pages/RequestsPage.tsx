import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, CircleAlert, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/PageHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FacultySelector } from '@/components/FacultySelector';
import { approveChangeRequest, fetchMakeups, fetchRequests, rejectChangeRequest, withdrawChangeRequest } from '@/api/requests';
import { useCurrentTerm } from '@/hooks/useTerm';
import { getErrorMessage } from '@/lib/errors';
import { CLASS_FULL_LABELS } from '@/lib/scheduleDisplay';
import { formatDate, MAKEUP_STATE_LABELS, REQUEST_KIND_LABELS, REQUEST_STATUS_LABELS } from '@/lib/requestLabels';
import { useAuthStore } from '@/store/authStore';
import { useFacultyFilterStore } from '@/store/facultyStore';
import type { ChangeRequestRow, MakeupRow } from '@/types';
import { RequestDialog } from './myPlan/RequestDialog';

const STATUS_VARIANT: Record<ChangeRequestRow['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING: 'outline',
  APPROVED: 'default',
  REJECTED: 'destructive',
  WITHDRAWN: 'secondary',
};

/** Opis zgloszenia: zajecia, termin i propozycja. */
function RequestSummary({ r, showInstructor }: { r: ChangeRequestRow; showInstructor: boolean }) {
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{REQUEST_KIND_LABELS[r.kind]}</Badge>
        <span className="font-medium">{r.subject}</span>
        <span className="text-muted-foreground">
          {CLASS_FULL_LABELS[r.classType].toLowerCase()} · {r.program} · {r.group}
        </span>
        {showInstructor && <span className="text-muted-foreground">· {r.instructor}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 tabular-nums">
        <span className={r.kind === 'CANCEL' ? '' : 'text-muted-foreground'}>
          {r.kind === 'MAKEUP' ? 'Odwolane: ' : ''}
          {formatDate(r.original.date)} {r.original.time}
        </span>
        {r.proposal && (
          <>
            <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
            <span className="font-medium">
              {r.proposal.date ? formatDate(r.proposal.date) : '?'} {r.proposal.time ?? ''} · {r.proposal.room ?? 'sala do ustalenia'}
            </span>
          </>
        )}
      </div>
      <p className="text-muted-foreground">Powod: {r.reason}</p>
      {r.decisionNote && <p>Dziekanat: {r.decisionNote}</p>}
    </div>
  );
}

function MakeupTable({ rows, showInstructor, onPropose }: { rows: MakeupRow[]; showInstructor: boolean; onPropose?: (r: MakeupRow) => void }) {
  if (rows.length === 0) {
    return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Brak odwolanych zajec w tym semestrze.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Odwolane</TableHead>
            <TableHead>Zajecia</TableHead>
            {showInstructor && <TableHead>Prowadzacy</TableHead>}
            <TableHead>Stan</TableHead>
            {onPropose && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((m) => (
            <TableRow key={m.key}>
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
              {showInstructor && <TableCell>{m.instructor}</TableCell>}
              <TableCell>
                <Badge variant={m.state === 'MADE_UP' ? 'default' : m.state === 'REQUESTED' ? 'outline' : 'destructive'}>
                  {MAKEUP_STATE_LABELS[m.state]}
                </Badge>
                {m.makeup && (
                  <div className="mt-1 text-xs tabular-nums text-muted-foreground">
                    {formatDate(m.makeup.date)} {m.makeup.time}
                  </div>
                )}
              </TableCell>
              {onPropose && (
                <TableCell className="text-right">
                  {m.state === 'TODO' && (
                    <Button size="sm" variant="outline" onClick={() => onPropose(m)}>
                      Zaproponuj termin
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Zgloszenia zmian. Prowadzacy: zajecia do odrobienia i wlasne zgloszenia (wycofanie).
 * Dziekanat: oczekujace zgloszenia wydzialu do zatwierdzenia / odrzucenia, historia
 * i odrobienia wydzialu. Admin — jak dziekanat, z wyborem wydzialu.
 */
export default function RequestsPage() {
  const { term } = useCurrentTerm();
  const role = useAuthStore((s) => s.user?.role);
  const isInstructor = role === 'INSTRUCTOR';
  const isAdmin = role === 'ADMIN';
  const facultyFilter = useFacultyFilterStore((s) => s.facultyId);
  const facultyId = isAdmin ? facultyFilter : undefined;
  const queryClient = useQueryClient();
  const refresh = () => {
    for (const key of ['requests', 'makeups', 'my-plan', 'notifications']) void queryClient.invalidateQueries({ queryKey: [key] });
  };

  const { data: requests, isPending } = useQuery({
    queryKey: ['requests', term?.key, facultyId],
    queryFn: () => fetchRequests(term!.key, { facultyId }),
    enabled: !!term,
  });
  const { data: makeups } = useQuery({
    queryKey: ['makeups', term?.key, facultyId],
    queryFn: () => fetchMakeups(term!.key, facultyId),
    enabled: !!term,
  });

  const [proposeFor, setProposeFor] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<ChangeRequestRow | null>(null);
  const [deciding, setDeciding] = useState<{ request: ChangeRequestRow; approve: boolean } | null>(null);
  const [note, setNote] = useState('');

  const withdraw = useMutation({
    mutationFn: (id: string) => withdrawChangeRequest(id),
    onSuccess: (r) => {
      toast.success(r.message);
      setWithdrawing(null);
      refresh();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const decide = useMutation({
    mutationFn: () => (deciding!.approve ? approveChangeRequest(deciding!.request.id, note) : rejectChangeRequest(deciding!.request.id, note)),
    onSuccess: (r) => {
      toast.success(r.message);
      setDeciding(null);
      setNote('');
      refresh();
    },
    onError: (e) => toast.error(getErrorMessage(e), { duration: 10000 }),
  });

  const pending = (requests ?? []).filter((r) => r.status === 'PENDING');
  const decided = (requests ?? []).filter((r) => r.status !== 'PENDING');
  const todo = (makeups ?? []).filter((m) => m.state === 'TODO').length;

  return (
    <>
      <PageHeader
        title="Zgloszenia zmian"
        description={
          isInstructor
            ? 'Twoje prosby do dziekanatu o odwolanie, przeniesienie albo odrobienie zajec oraz zajecia odwolane do odrobienia. Nowe zgloszenie: kliknij zajecia w „Moim planie”.'
            : 'Prosby prowadzacych o odwolanie, przeniesienie albo odrobienie zajec. Zatwierdzenie od razu wprowadza zmiane w planie (z kontrola kolizji); prowadzacy dostaje powiadomienie.'
        }
        actions={isAdmin ? <FacultySelector /> : undefined}
      />
      {isPending && term && <Skeleton className="h-48 w-full" />}

      {requests && isInstructor && (
        <div className="space-y-6">
          <section className="space-y-2">
            <h3 className="font-medium">
              Do odrobienia {todo > 0 && <Badge variant="destructive">{todo}</Badge>}
            </h3>
            <MakeupTable rows={makeups ?? []} showInstructor={false} onPropose={(m) => setProposeFor(m.occurrenceId)} />
          </section>
          <section className="space-y-2">
            <h3 className="font-medium">Moje zgloszenia</h3>
            {requests.length === 0 && (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nie masz jeszcze zgloszen w tym semestrze.</p>
            )}
            <ul className="space-y-2">
              {requests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
                  <RequestSummary r={r} showInstructor={false} />
                  <div className="flex items-center gap-2">
                    <Badge variant={STATUS_VARIANT[r.status]}>{REQUEST_STATUS_LABELS[r.status]}</Badge>
                    {r.status === 'PENDING' && (
                      <Button size="sm" variant="ghost" onClick={() => setWithdrawing(r)}>
                        <Undo2 /> Wycofaj
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {requests && !isInstructor && (
        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">Oczekujace ({pending.length})</TabsTrigger>
            <TabsTrigger value="decided">Rozpatrzone ({decided.length})</TabsTrigger>
            <TabsTrigger value="makeups">Do odrobienia ({todo})</TabsTrigger>
          </TabsList>
          <TabsContent value="pending" className="mt-3 space-y-2">
            {pending.length === 0 && (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Brak zgloszen czekajacych na decyzje.</p>
            )}
            {pending.map((r) => (
              <Card key={r.id}>
                <CardHeader>
                  <CardTitle className="text-base">{r.instructor}</CardTitle>
                  <CardDescription>Zgloszono {new Date(r.createdAt).toLocaleString('pl-PL')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <RequestSummary r={r} showInstructor={false} />
                  {r.stale && (
                    <Alert>
                      <CircleAlert />
                      <AlertDescription>Tego terminu juz nie ma w planie (plan wygenerowano od nowa) — odrzuc zgloszenie z wyjasnieniem.</AlertDescription>
                    </Alert>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" disabled={r.stale} onClick={() => setDeciding({ request: r, approve: true })}>
                      <Check /> Zatwierdz
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDeciding({ request: r, approve: false })}>
                      <X /> Odrzuc
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
          <TabsContent value="decided" className="mt-3">
            <ul className="space-y-2">
              {decided.length === 0 && <li className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Brak.</li>}
              {decided.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
                  <RequestSummary r={r} showInstructor />
                  <div className="text-right text-xs text-muted-foreground">
                    <Badge variant={STATUS_VARIANT[r.status]}>{REQUEST_STATUS_LABELS[r.status]}</Badge>
                    {r.decidedBy && <div className="mt-1">{r.decidedBy}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </TabsContent>
          <TabsContent value="makeups" className="mt-3">
            <MakeupTable rows={makeups ?? []} showInstructor />
          </TabsContent>
        </Tabs>
      )}

      {proposeFor && <RequestDialog occurrenceId={proposeFor} onClose={() => setProposeFor(null)} />}

      <ConfirmDialog
        open={!!withdrawing}
        onOpenChange={(open) => !open && setWithdrawing(null)}
        title="Wycofac zgloszenie?"
        description="Dziekanat dostanie informacje, ze zgloszenie jest nieaktualne."
        confirmLabel="Wycofaj"
        isPending={withdraw.isPending}
        onConfirm={() => withdraw.mutate(withdrawing!.id)}
      />

      <Dialog open={!!deciding} onOpenChange={(open) => !open && (setDeciding(null), setNote(''))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{deciding?.approve ? 'Zatwierdzic zgloszenie?' : 'Odrzucic zgloszenie?'}</DialogTitle>
            <DialogDescription>
              {deciding?.approve
                ? 'Zmiana zostanie od razu wprowadzona w planie (z kontrola kolizji), a prowadzacy dostanie powiadomienie.'
                : 'Prowadzacy dostanie powiadomienie z Twoim wyjasnieniem.'}
            </DialogDescription>
          </DialogHeader>
          {deciding && <RequestSummary r={deciding.request} showInstructor />}
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={deciding?.approve ? 'Uwagi dla prowadzacego (opcjonalnie)' : 'Dlaczego odrzucasz? np. sala zajeta — prosze o inny termin'}
            aria-label="Uwagi dla prowadzacego"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => (setDeciding(null), setNote(''))}>
              Anuluj
            </Button>
            <Button
              variant={deciding?.approve ? 'default' : 'destructive'}
              disabled={decide.isPending || (!deciding?.approve && note.trim().length < 3)}
              onClick={() => decide.mutate()}
            >
              {decide.isPending && <Spinner />}
              {deciding?.approve ? 'Zatwierdz' : 'Odrzuc'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
