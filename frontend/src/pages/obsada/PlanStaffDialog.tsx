import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { changePlanStaff } from '@/api/sections';
import { getErrorMessage } from '@/lib/errors';
import { CLASS_FULL_LABELS } from '@/lib/scheduleDisplay';
import { changesPlan, checkText, initialChoices, staffChanges, type StaffChoices } from '@/lib/planStaff';
import type { StaffMismatchRow } from '@/types';

/**
 * "Przepnij prowadzacego w planie" (strona Obsada): zajecia w planie z prowadzacym spoza obsady albo
 * NN mimo pelnej obsady. Planista wybiera osobe z obsady grupy (podpowiedz z serwera), podglad
 * (dryRun) liczy kolizje kazdej zmiany — takze miedzy zmianami z listy — a zapis przepina tylko
 * zajecia bez kolizji. Terminy jak po kazdej zmianie planu (w przygotowaniu przeliczaja sie same).
 */
export function PlanStaffDialog({
  termKey,
  rows,
  onClose,
  onDone,
}: {
  termKey: string;
  rows: StaffMismatchRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [choices, setChoices] = useState<StaffChoices>(() => initialChoices(rows));
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(rows.filter((r) => changesPlan(r, r.proposed ?? '')).map((r) => r.placementId)),
  );
  const changes = useMemo(() => staffChanges(rows, choices, selected), [rows, choices, selected]);

  // Podglad bez blokady i zapisu — liczy sie od nowa po kazdej zmianie wyboru.
  const preview = useQuery({
    queryKey: ['plan-staff-check', termKey, changes],
    queryFn: () => changePlanStaff(termKey, { changes, dryRun: true }).then((r) => r.data.results),
    enabled: changes.length > 0,
    placeholderData: (previous) => previous,
  });
  const checks = new Map((preview.data ?? []).map((c) => [c.placementId, c]));
  // Wynik podgladu pasuje do wyboru dopiero, gdy dotyczy tej samej osoby (stary wynik czeka na nowy).
  const checkOf = (placementId: string, instructorId: string | null) => {
    const check = checks.get(placementId);
    return check && check.instructorId === instructorId ? check : undefined;
  };
  const ready = changes.filter((c) => {
    const check = checkOf(c.placementId, c.instructorId);
    return !!check && !check.error && check.conflicts.length === 0;
  });

  const apply = useMutation({
    mutationFn: () => changePlanStaff(termKey, { changes: ready, dryRun: false }),
    onSuccess: (r) => {
      if (r.warning) toast.warning(r.message ?? 'Przepieto', { description: r.warning, duration: 10000 });
      else toast.success(r.message ?? 'Przepieto');
      onDone();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const setChoice = (row: StaffMismatchRow, value: string) => {
    setChoices((prev) => ({ ...prev, [row.placementId]: value }));
    setSelected((prev) => {
      const next = new Set(prev);
      if (changesPlan(row, value)) next.add(row.placementId);
      else next.delete(row.placementId);
      return next;
    });
  };
  const toggle = (placementId: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(placementId);
      else next.delete(placementId);
      return next;
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Przepnij prowadzacych w planie</DialogTitle>
          <DialogDescription>
            Plan pamieta prowadzacego w kazdych zajeciach, a zmiana obsady go nie zmienia. Wybierz osobe z obsady grupy — zapis
            przepnie tylko zajecia bez kolizji. Terminy: w kalendarzu w przygotowaniu przelicza sie same, w opublikowanym — po
            „Generuj terminy”.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Zajecia w planie</TableHead>
                <TableHead>Teraz w planie</TableHead>
                <TableHead>Przepnij na</TableHead>
                <TableHead>Podglad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const choice = choices[r.placementId] ?? '';
                const changing = changesPlan(r, choice);
                const on = changing && selected.has(r.placementId);
                const check = on ? checkText(checkOf(r.placementId, choice || null)) : null;
                return (
                  <TableRow key={r.placementId}>
                    <TableCell className="align-top">
                      <Checkbox
                        checked={on}
                        disabled={!changing}
                        onCheckedChange={(v) => toggle(r.placementId, v === true)}
                        aria-label={`Przepnij: ${r.subject}, ${r.group}`}
                      />
                    </TableCell>
                    <TableCell className="align-top whitespace-normal">
                      <div className="font-medium">
                        {r.subject}
                        {r.specialization && <span className="text-muted-foreground"> ({r.specialization})</span>} —{' '}
                        {CLASS_FULL_LABELS[r.classType].toLowerCase()}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.cohort.label} · {r.group} · {r.slot}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div>{r.current?.name ?? 'NN'}</div>
                      <Badge variant={r.kind === 'FOREIGN' ? 'destructive' : 'outline'} className="mt-1">
                        {r.kind === 'FOREIGN' ? 'spoza obsady' : 'NN mimo obsady'}
                      </Badge>
                    </TableCell>
                    <TableCell className="align-top">
                      <NativeSelect
                        className="w-64"
                        value={choice}
                        onChange={(e) => setChoice(r, e.target.value)}
                        aria-label={`Przepnij na: ${r.subject}, ${r.group}`}
                      >
                        {r.staff.map((s) => (
                          <NativeSelectOption key={s.id} value={s.id}>
                            {s.name} ({s.hours} h)
                          </NativeSelectOption>
                        ))}
                        <NativeSelectOption value="">NN (bez prowadzacego)</NativeSelectOption>
                      </NativeSelect>
                    </TableCell>
                    <TableCell className="align-top text-xs whitespace-normal">
                      {!on ? (
                        <span className="text-muted-foreground">{changing ? 'pominiete' : 'bez zmiany'}</span>
                      ) : check ? (
                        <span className={check.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'} title={check.details}>
                          {check.text}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Spinner className="size-3" /> sprawdzam…
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button disabled={ready.length === 0 || preview.isFetching || apply.isPending} onClick={() => apply.mutate()}>
            {apply.isPending && <Spinner />} Przepnij ({ready.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
