import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Combobox } from '@/components/Combobox';
import { setPersonStaff } from '@/api/sections';
import { getErrorMessage } from '@/lib/errors';
import { freeHoursFor, groupLabel, groupSize, personHours, type SectionGroup } from '@/lib/obsadaGroups';

type Picked = Record<string, { on: boolean; hours: string }>;

const activeSections = (group: SectionGroup) => group.sections.filter((s) => s.status === 'ACTIVE');

/** Stan startowy: grupy, ktore osoba juz prowadzi, z jej godzinami; reszta z wolnymi godzinami grupy. */
function initialPick(group: SectionGroup | undefined, personId: string): Picked {
  if (!group) return {};
  return Object.fromEntries(
    activeSections(group).map((s) => {
      const mine = personHours(s, personId);
      return [s.id, { on: mine > 0, hours: String(mine > 0 ? mine : freeHoursFor(s, personId)) }];
    }),
  );
}

/**
 * Zajecia prowadzacego wpisywane z arkusza katedry: przedmiot i forma w roczniku, potem grupy
 * i godziny. Godziny podpowiadaja sie jako wolne godziny kazdej grupy, wiec "45 h cwiczen" z arkusza
 * rozklada sie samo na 3 grupy × 15 h. Zapis zmienia tylko godziny tej osoby — obsada innych
 * zostaje, a NN (wakat) ustepuje.
 */
export function AddClassesDialog({
  termKey,
  person,
  groups,
  initialKey,
  onClose,
  onDone,
}: {
  termKey: string;
  person: { id: string; name: string };
  groups: SectionGroup[];
  initialKey?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [key, setKey] = useState(initialKey ?? '');
  const group = groups.find((g) => g.key === key);
  const [picked, setPicked] = useState<Picked>(() => initialPick(group, person.id));

  const options = useMemo(
    () =>
      groups
        .filter((g) => !g.archived && activeSections(g).length > 0)
        .map((g) => ({
          value: g.key,
          label: `${groupLabel(g)} · ${groupSize(g)}`,
          keywords: [g.cohort.label, g.specializationName, ...g.sections.map((s) => s.group.name)].filter(Boolean).join(' '),
        })),
    [groups],
  );

  const sections = group ? activeSections(group) : [];
  const rows = sections.map((s) => {
    const state = picked[s.id] ?? { on: false, hours: '' };
    const mine = personHours(s, person.id);
    const free = freeHoursFor(s, person.id);
    const hours = Number(state.hours);
    const error = !state.on
      ? null
      : state.hours.trim() === '' || !Number.isInteger(hours) || hours <= 0
        ? 'podaj godziny'
        : hours > free
          ? `wolnych ${free} h`
          : null;
    return { section: s, state, mine, free, error, others: s.instructors.filter((i) => i.instructorId !== person.id) };
  });
  // Tylko zmiany godzin tej osoby: nowa grupa, inne godziny albo odznaczona grupa, ktora prowadzila.
  const items = rows.flatMap(({ section, state, mine }) =>
    state.on ? (Number(state.hours) !== mine ? [{ sectionId: section.id, hours: Number(state.hours) }] : []) : mine > 0 ? [{ sectionId: section.id, hours: 0 }] : [],
  );
  const total = rows.reduce((sum, r) => sum + (r.state.on ? Number(r.state.hours) || 0 : 0), 0);
  const hasErrors = rows.some((r) => r.error);
  const allOn = rows.length > 0 && rows.every((r) => r.state.on);

  const save = useMutation({
    mutationFn: () => setPersonStaff(termKey, person.id, items),
    onSuccess: (r) => {
      toast.success(r.message);
      onDone();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const update = (sectionId: string, patch: Partial<Picked[string]>) =>
    setPicked({ ...picked, [sectionId]: { ...(picked[sectionId] ?? { on: false, hours: '' }), ...patch } });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Zajecia: {person.name}</DialogTitle>
          <DialogDescription>
            Jak w arkuszu katedry: przedmiot i forma, potem grupy i godziny. Obsada innych prowadzacych zostaje, a NN
            (wakat) ustepuje.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <p className="text-sm font-medium">Przedmiot i forma</p>
          <Combobox
            options={options}
            value={key}
            onChange={(value) => {
              setKey(value);
              setPicked(initialPick(groups.find((g) => g.key === value), person.id));
            }}
            placeholder="Wybierz przedmiot i forme zajec"
            searchPlaceholder="Np. elektro mibm cwiczenia…"
            emptyText="Nie ma takich zajec w tym semestrze."
          />
        </div>

        {group && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={allOn}
                onCheckedChange={(v) =>
                  setPicked(Object.fromEntries(rows.map((r) => [r.section.id, { ...r.state, on: v === true }])))
                }
              />
              Wszystkie grupy ({rows.length})
            </label>
            <ul className="divide-y rounded-md border">
              {rows.map(({ section, state, free, error, others }) => (
                <li key={section.id} className="grid grid-cols-[auto_1fr_5.5rem] items-center gap-x-3 gap-y-1 p-2 text-sm">
                  <Checkbox
                    checked={state.on}
                    onCheckedChange={(v) => update(section.id, { on: v === true })}
                    aria-label={`Grupa ${section.group.name}`}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="font-medium">{section.group.name}</span>
                      <span className="text-muted-foreground">
                        {section.hours} h · wolnych {free} h
                      </span>
                    </div>
                    {others.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {others.map((i) => (
                          <Badge key={i.id} variant={i.instructorId ? 'secondary' : 'outline'}>
                            {i.name} · {i.hours} h
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <Input
                      type="number"
                      min={1}
                      value={state.hours}
                      disabled={!state.on}
                      aria-label={`Godziny w grupie ${section.group.name}`}
                      aria-invalid={!!error}
                      className="text-right tabular-nums"
                      onChange={(e) => update(section.id, { hours: e.target.value })}
                    />
                    {error && <p className="mt-0.5 text-right text-xs text-destructive">{error}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="items-center">
          {group && <span className="mr-auto text-sm text-muted-foreground tabular-nums">Razem: {total} h</span>}
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => save.mutate()} disabled={!group || items.length === 0 || hasErrors || save.isPending}>
            {save.isPending && <Spinner />}
            Zapisz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
