import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { Combobox } from '@/components/Combobox';
import { AssignmentDialog } from '@/pages/obsada/ObsadaDialogs';
import { createPlacement, deletePlacement, updatePlacement } from '@/api/plan';
import { fetchBuildings } from '@/api/buildings';
import { getErrorMessage } from '@/lib/errors';
import { WEEKDAY_LABELS } from '@/lib/labels';
import { CLASS_FULL_LABELS, ROOM_TYPES_FOR_CLASS } from '@/lib/scheduleDisplay';
import type { DayOfWeek, PlacementPattern, PlanPlacement, PlanSection, PlanView, TimeBlock } from '@/types';

export interface PlacementTarget {
  section: PlanSection;
  placement: PlanPlacement | null;
  day: DayOfWeek;
  startOrder: number;
  /** Zjazd wybrany w widoku (dla nowego umieszczenia: domyslnie tylko ten zjazd). */
  zjazd: number | null;
}

/**
 * Umieszczenie zajec we wzorcu: dzien, godziny, sala, prowadzacy z obsady i rytm.
 * Serwer sprawdza kolizje na konkretnych datach semestru i odrzuca zapis z lista dat.
 */
export function PlacementDialog({
  termKey,
  plan,
  days,
  blocks,
  target,
  onClose,
  onSaved,
  onObsadaSaved,
}: {
  termKey: string;
  plan: PlanView;
  days: DayOfWeek[];
  blocks: TimeBlock[];
  target: PlacementTarget;
  onClose: () => void;
  onSaved: () => void;
  /** Po zmianie obsady z tego okna — odswiezenie planu (lista prowadzacych z obsady). */
  onObsadaSaved: () => Promise<void> | void;
}) {
  const { placement } = target;
  // Swieze dane zajec z planu: po zmianie obsady z tego okna lista prowadzacych sie odswieza.
  const section = plan.sections.find((s) => s.id === target.section.id) ?? target.section;
  const zjazdCalendar = plan.calendar?.kind === 'ZJAZD';
  const [day, setDay] = useState<DayOfWeek>(placement?.dayOfWeek ?? target.day);
  const [start, setStart] = useState(placement?.startOrder ?? target.startOrder);
  const [length, setLength] = useState(placement ? placement.endOrder - placement.startOrder + 1 : Math.min(2, section.hours));
  const [roomId, setRoomId] = useState(placement?.room.id ?? '');
  const staff = section.instructors.filter((i) => i.instructorId);
  const [instructorId, setInstructorId] = useState(placement?.instructor?.id ?? staff[0]?.instructorId ?? '');
  const [assigning, setAssigning] = useState(false);
  const [pickAfterAssign, setPickAfterAssign] = useState(false);
  // Po przypisaniu obsady z tego okna wybierz od razu pierwsza osobe (jesli dotad bylo NN).
  useEffect(() => {
    if (!pickAfterAssign || staff.length === 0) return;
    setPickAfterAssign(false);
    if (!instructorId) setInstructorId(staff[0]!.instructorId!);
  }, [pickAfterAssign, staff, instructorId]);
  // Osoba usunieta z obsady nie moze zostac w formularzu — pole pokazaloby NN, a serwer
  // odrzucilby zapis (prowadzacy spoza obsady). Wracamy jawnie na NN.
  useEffect(() => {
    if (instructorId && !staff.some((i) => i.instructorId === instructorId)) setInstructorId('');
  }, [staff, instructorId]);
  const [pattern, setPattern] = useState<PlacementPattern>(
    placement?.pattern ?? (zjazdCalendar && target.zjazd ? 'LIST' : 'ALL'),
  );
  const [numbers, setNumbers] = useState<number[]>(placement?.numbers ?? (target.zjazd ? [target.zjazd] : []));
  const [fromIndex, setFromIndex] = useState(placement?.fromIndex ? String(placement.fromIndex) : '');
  const [toIndex, setToIndex] = useState(placement?.toIndex ? String(placement.toIndex) : '');
  const [jointKey, setJointKey] = useState(placement?.jointKey ?? '');

  const { data: buildings } = useQuery({ queryKey: ['buildings'], queryFn: fetchBuildings });
  const roomOptions = useMemo(
    () =>
      (buildings ?? []).flatMap((b) =>
        (b.rooms ?? [])
          .filter((r) => ROOM_TYPES_FOR_CLASS[section.classType].includes(r.type))
          .map((r) => ({ value: r.id, label: `${r.number} — ${b.name} (${r.capacity} miejsc)`, keywords: b.name })),
      ),
    [buildings, section.classType],
  );

  const payload = {
    sectionId: section.id,
    dayOfWeek: day,
    startOrder: start,
    endOrder: start + length - 1,
    roomId,
    instructorId: instructorId || null,
    cycle: zjazdCalendar ? ('ZJAZD' as const) : ('WEEK' as const),
    pattern,
    numbers: pattern === 'LIST' ? numbers : [],
    fromIndex: fromIndex ? Number(fromIndex) : null,
    toIndex: toIndex ? Number(toIndex) : null,
    jointKey: jointKey.trim() || null,
  };

  const save = useMutation({
    mutationFn: () => (placement ? updatePlacement(placement.id, payload) : createPlacement(termKey, payload)),
    onSuccess: (r) => {
      toast.success(r.message);
      onSaved();
    },
    onError: (e) => toast.error(getErrorMessage(e), { duration: 10000 }),
  });
  const remove = useMutation({
    mutationFn: () => deletePlacement(placement!.id),
    onSuccess: (r) => {
      toast.success(r.message);
      onSaved();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const listOptions = zjazdCalendar
    ? (plan.calendar?.zjazdy ?? []).map((z) => z.number)
    : Array.from({ length: plan.calendar?.teachingWeeks ?? 15 }, (_, i) => i + 1);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{section.subject.name}</DialogTitle>
          <DialogDescription>
            {CLASS_FULL_LABELS[section.classType]} · {section.group.name} · {section.plannedHours}/{section.hours} h
            zaplanowane
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="pl-day">Dzien</FieldLabel>
            <NativeSelect id="pl-day" value={day} onChange={(e) => setDay(e.target.value as DayOfWeek)}>
              {days.map((d) => (
                <NativeSelectOption key={d} value={d}>
                  {WEEKDAY_LABELS[d]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="pl-start">Od</FieldLabel>
            <NativeSelect id="pl-start" value={start} onChange={(e) => setStart(Number(e.target.value))}>
              {blocks.map((b) => (
                <NativeSelectOption key={b.id} value={b.order}>
                  {b.startTime}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="pl-len">Dlugosc</FieldLabel>
            <NativeSelect id="pl-len" value={length} onChange={(e) => setLength(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 8].map((n) => (
                <NativeSelectOption key={n} value={n}>
                  {n} h
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="pl-room">Sala</FieldLabel>
            <Combobox id="pl-room" options={roomOptions} value={roomId} onChange={setRoomId} placeholder="Wybierz sale" searchPlaceholder="Numer, budynek…" />
          </Field>
          <Field>
            <FieldLabel htmlFor="pl-instr">Prowadzacy (z obsady)</FieldLabel>
            <NativeSelect id="pl-instr" value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
              <NativeSelectOption value="">NN</NativeSelectOption>
              {staff.map((i) => (
                <NativeSelectOption key={i.instructorId!} value={i.instructorId!}>
                  {i.name} ({i.hours} h)
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button type="button" variant="link" size="sm" className="h-auto justify-start px-0" onClick={() => setAssigning(true)}>
              <UserPlus /> {staff.length === 0 ? 'Przypisz prowadzacego' : 'Zmien obsade'}
            </Button>
          </Field>
          {staff.length === 0 && (
            <p className="text-xs text-muted-foreground sm:col-span-3">
              Zajecia nie maja obsady, wiec do wyboru jest tylko NN. Przypisz prowadzacego tutaj albo na stronie{' '}
              <Link to={`/obsada/${termKey}`} className="font-medium text-foreground underline underline-offset-4">
                Zajecia i obsada
              </Link>
              .
            </p>
          )}
          <Field className="sm:col-span-3">
            <FieldLabel htmlFor="pl-pattern">Rytm</FieldLabel>
            <NativeSelect id="pl-pattern" value={pattern} onChange={(e) => setPattern(e.target.value as PlacementPattern)}>
              {zjazdCalendar ? (
                <>
                  <NativeSelectOption value="ALL">na kazdym zjezdzie</NativeSelectOption>
                  <NativeSelectOption value="LIST">na wybranych zjazdach</NativeSelectOption>
                </>
              ) : (
                <>
                  <NativeSelectOption value="ALL">co tydzien</NativeSelectOption>
                  <NativeSelectOption value="ODD">tygodnie nieparzyste</NativeSelectOption>
                  <NativeSelectOption value="EVEN">tygodnie parzyste</NativeSelectOption>
                  <NativeSelectOption value="LIST">wybrane tygodnie</NativeSelectOption>
                </>
              )}
            </NativeSelect>
          </Field>
          {pattern === 'LIST' && (
            <div className="flex flex-wrap gap-1 sm:col-span-3">
              {listOptions.map((n) => {
                const on = numbers.includes(n);
                return (
                  <Button
                    key={n}
                    type="button"
                    size="sm"
                    variant={on ? 'default' : 'outline'}
                    className="w-10"
                    onClick={() => setNumbers(on ? numbers.filter((x) => x !== n) : [...numbers, n].sort((a, b) => a - b))}
                  >
                    {n}
                  </Button>
                );
              })}
            </div>
          )}
          {pattern !== 'LIST' && (
            <>
              <Field>
                <FieldLabel htmlFor="pl-from">{zjazdCalendar ? 'Od zjazdu' : 'Od tygodnia'}</FieldLabel>
                <Input id="pl-from" type="number" min={1} value={fromIndex} onChange={(e) => setFromIndex(e.target.value)} placeholder="1" />
              </Field>
              <Field>
                <FieldLabel htmlFor="pl-to">{zjazdCalendar ? 'Do zjazdu' : 'Do tygodnia'}</FieldLabel>
                <Input id="pl-to" type="number" min={1} value={toIndex} onChange={(e) => setToIndex(e.target.value)} placeholder="do konca" />
              </Field>
            </>
          )}
          <Field>
            <FieldLabel htmlFor="pl-joint">Zajecia laczone (klucz)</FieldLabel>
            <Input id="pl-joint" value={jointKey} onChange={(e) => setJointKey(e.target.value)} placeholder="np. FIZ-W-1" />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Zajecia laczone: wpisz ten sam klucz w umieszczeniach innych kierunkow/trybow — beda w tym samym czasie i sali,
          bez kolizji miedzy soba. Terminy w kalendarzu zmienia sie dopiero po „Generuj terminy”.
        </p>
        <DialogFooter className="sm:justify-between">
          {placement ? (
            <Button variant="ghost" className="text-destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
              <Trash2 /> Usun z planu
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Anuluj
            </Button>
            <Button onClick={() => save.mutate()} disabled={!roomId || save.isPending || (pattern === 'LIST' && numbers.length === 0)}>
              {save.isPending && <Spinner />}
              {placement ? 'Zapisz' : 'Umiesc'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
      {assigning && (
        <AssignmentDialog
          section={section}
          onClose={() => setAssigning(false)}
          onDone={async () => {
            setAssigning(false);
            setPickAfterAssign(true);
            await onObsadaSaved();
          }}
        />
      )}
    </Dialog>
  );
}
