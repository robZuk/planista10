import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Flag, Plus, Trash2, TriangleAlert, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  createCohortGroup,
  createCohortGroupsBulk,
  deleteCohortGroup,
  fetchCohortGroups,
  updateCohortGroup,
} from '@/api/cohorts';
import { getErrorMessage } from '@/lib/errors';
import { defaultSubPartition } from '@/lib/subPartition';
import { partitionOverflows } from '@/lib/groupSizes';
import { useSyncHint } from '@/hooks/useSyncHint';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { CohortGroup, TermCohort } from '@/types';

/** Podzialy rocznika: ROOT (caly rocznik) i SPEC sa zakladane osobno. */
const PARTITION_LABELS: Record<string, string> = {
  ROOT: 'caly rocznik',
  SPEC: 'specjalnosc',
  C: 'cwiczeniowe',
  L: 'laboratoryjne',
  P: 'projektowe',
  S: 'seminaryjne',
  JEZ: 'jezykowe',
};
const SUB_PARTITIONS = ['C', 'L', 'P', 'S', 'JEZ'];

type AddTarget = { parent: CohortGroup; mode: 'sub' | 'spec' } | null;

/**
 * Drzewo grup rocznika w wybranym semestrze. Grupy ida z rocznikiem przez studia —
 * tu sie je tylko koryguje: liczebnosc, podgrupy, podzial na specjalnosci, a zmiana
 * struktury od jakiegos semestru to "zakoncz po semestrze" + nowe grupy od kolejnego.
 */
export function GroupTreePanel({ cohort, canEdit }: { cohort: TermCohort; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const queryKey = ['cohort-groups', cohort.id, cohort.semester];
  const { data, isPending } = useQuery({
    queryKey,
    queryFn: () => fetchCohortGroups(cohort.id, cohort.semester),
  });
  const [addTarget, setAddTarget] = useState<AddTarget>(null);
  const [deleting, setDeleting] = useState<CohortGroup | null>(null);
  // Zakonczenie grupy po biezacym semestrze — z potwierdzeniem (zmienia zajecia kolejnych semestrow).
  const [ending, setEnding] = useState<CohortGroup | null>(null);

  const syncHint = useSyncHint();
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['cohort-groups', cohort.id] });
    await queryClient.invalidateQueries({ queryKey: ['term-cohorts'] });
  };

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateCohortGroup>[1] }) =>
      updateCohortGroup(id, input),
    onSuccess: async (_data, vars) => {
      if (vars.input.size !== undefined) toast.success('Liczebnosc zapisana');
      if (vars.input.toSemester !== undefined) {
        syncHint(vars.input.toSemester === null ? 'Grupa trwa dalej (bez daty konca)' : `Grupa konczy sie po semestrze ${vars.input.toSemester}`);
        setEnding(null);
      }
      await refresh();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteCohortGroup(id),
    onSuccess: async () => {
      syncHint('Grupa usunieta');
      setDeleting(null);
      await refresh();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const { roots, children, inactive } = useMemo(() => {
    const groups = data?.groups ?? [];
    const activeIds = new Set(groups.filter((g) => g.active).map((g) => g.id));
    const map = new Map<string, CohortGroup[]>();
    for (const g of groups) {
      if (!g.active || !g.parentId) continue;
      const list = map.get(g.parentId) ?? [];
      list.push(g);
      map.set(g.parentId, list);
    }
    return {
      roots: groups.filter((g) => g.active && (!g.parentId || !activeIds.has(g.parentId))),
      children: map,
      inactive: groups.filter((g) => !g.active),
    };
  }, [data]);

  if (isPending) return <Skeleton className="h-32 w-full" />;

  const renderNode = (group: CohortGroup, depth: number): React.ReactNode => {
    const kids = (children.get(group.id) ?? []).sort((a, b) =>
      `${a.partitionKey}${a.code}`.localeCompare(`${b.partitionKey}${b.code}`),
    );
    const isRoot = group.partitionKey === 'ROOT';
    return (
      <li key={group.id}>
        <div
          className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/50"
          style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
        >
          {depth > 0 && <ChevronRight className="size-3 text-muted-foreground" />}
          <span className="font-medium tabular-nums">{group.name}</span>
          <Badge variant="outline" className="text-[10px]">
            {PARTITION_LABELS[group.partitionKey ?? ''] ?? group.partitionKey}
          </Badge>
          {group.toSemester !== null && (
            <span className="text-xs text-muted-foreground">do sem. {group.toSemester}</span>
          )}
          {group.fromSemester > 1 && <span className="text-xs text-muted-foreground">od sem. {group.fromSemester}</span>}
          {group.memberCount > 0 && <span className="text-xs text-muted-foreground">{group.memberCount} stud.</span>}
          {partitionOverflows(group, kids).map((o) => (
            <span
              key={o.partitionKey}
              className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400"
              title="Grupy jednego podzialu dziela studentow tej grupy — suma ich liczebnosci nie powinna jej przekraczac"
            >
              <TriangleAlert className="size-3" />
              {(PARTITION_LABELS[o.partitionKey] ?? o.partitionKey).toLowerCase()}: razem {o.sum} os. &gt; {group.size}
            </span>
          ))}
          <span className="ml-auto flex items-center gap-1">
            {canEdit ? (
              <Input
                key={`${group.id}-${group.size}`}
                type="number"
                min={0}
                defaultValue={group.size}
                aria-label={`Liczebnosc ${group.name}`}
                className="h-7 w-20 text-right tabular-nums"
                onBlur={(e) => {
                  const size = Number(e.target.value);
                  if (Number.isInteger(size) && size >= 0 && size !== group.size) {
                    update.mutate({ id: group.id, input: { size } });
                  }
                }}
              />
            ) : (
              <span className="text-sm tabular-nums">{group.size} os.</span>
            )}
            {canEdit && (
              <>
                {isRoot && cohort.program.fieldOfStudy.specializations.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setAddTarget({ parent: group, mode: 'spec' })}>
                    <Plus /> Specjalnosc
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setAddTarget({ parent: group, mode: 'sub' })}>
                  <Plus /> Podgrupy
                </Button>
                {!isRoot &&
                  (group.toSemester === cohort.semester ? (
                    // Zakonczona wlasnie na tym semestrze — cofniecie od razu, bez szukania jej w kolejnym semestrze.
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Grupa ma trwac dalej — usun date konca"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: group.id, input: { toSemester: null } })}
                    >
                      <Undo2 /> Nie koncz
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      title={`Zakoncz grupe po semestrze ${cohort.semester} (od kolejnego juz jej nie ma)`}
                      aria-label="Zakoncz po tym semestrze"
                      onClick={() => setEnding(group)}
                    >
                      <Flag />
                    </Button>
                  ))}
                {!isRoot && group.childCount === 0 && !group.usedInPlan && group.memberCount === 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive hover:text-destructive"
                    aria-label={`Usun ${group.name}`}
                    onClick={() => setDeleting(group)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </>
            )}
          </span>
        </div>
        {kids.length > 0 && <ul>{kids.map((kid) => renderNode(kid, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <ul className="space-y-0.5 text-sm">{roots.map((g) => renderNode(g, 0))}</ul>
      {inactive.length > 0 && (
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">Grupy nieaktywne w semestrze {cohort.semester} ({inactive.length})</summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {inactive.map((g) => (
              <li key={g.id} className="flex items-center gap-2">
                {g.name}
                <span className="text-xs">
                  (sem. {g.fromSemester}–{g.toSemester ?? 'koniec'})
                </span>
                {canEdit && g.toSemester !== null && g.toSemester < cohort.semester && (
                  <Button variant="link" size="sm" onClick={() => update.mutate({ id: g.id, input: { toSemester: null } })}>
                    przywroc
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <ConfirmDialog
        open={!!ending}
        onOpenChange={(open) => !open && setEnding(null)}
        title={`Zakonczyc grupe ${ending?.name ?? ''} po semestrze ${cohort.semester}?`}
        description={`Od semestru ${cohort.semester + 1} tej grupy juz nie bedzie — jej zajecia w kolejnych semestrach znikna po „Synchronizuj zajecia”. Do czasu synchronizacji mozna to cofnac przyciskiem „Nie koncz”.`}
        confirmLabel="Zakoncz"
        isPending={update.isPending}
        onConfirm={() => update.mutate({ id: ending!.id, input: { toSemester: cohort.semester } })}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Usunac grupe ${deleting?.name ?? ''}?`}
        description="Grupa nie ma zajec, podgrup ani studentow. Jesli ma byc tylko w czesci studiow, zamiast usuwac zakoncz ja na wybranym semestrze (flaga)."
        isPending={remove.isPending}
        onConfirm={() => remove.mutate(deleting!.id)}
      />
      {addTarget && (
        <AddGroupsDialog
          cohort={cohort}
          target={addTarget}
          onClose={() => setAddTarget(null)}
          onDone={async () => {
            setAddTarget(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function AddGroupsDialog({
  cohort,
  target,
  onClose,
  onDone,
}: {
  cohort: TermCohort;
  target: NonNullable<AddTarget>;
  onClose: () => void;
  onDone: () => void;
}) {
  const syncHint = useSyncHint();
  const specs = cohort.program.fieldOfStudy.specializations;
  const [partition, setPartition] = useState(defaultSubPartition(target.parent.partitionKey));
  const [custom, setCustom] = useState('');
  const [count, setCount] = useState('2');
  const [size, setSize] = useState(String(Math.max(1, Math.round(target.parent.size / 2))));
  const [specId, setSpecId] = useState(specs[0]?.id ?? '');
  const [fromSemester, setFromSemester] = useState(String(cohort.semester));

  const mutation = useMutation({
    mutationFn: async () => {
      if (target.mode === 'spec') {
        await createCohortGroup(cohort.id, {
          parentId: target.parent.id,
          partitionKey: 'SPEC',
          specializationId: specId,
          size: Number(size),
          fromSemester: Number(fromSemester),
        });
        return 'Specjalnosc dodana';
      }
      const result = await createCohortGroupsBulk(cohort.id, {
        parentIds: [target.parent.id],
        partitionKey: partition === '__custom__' ? custom : partition,
        perParent: Number(count),
        size: Number(size),
        fromSemester: Number(fromSemester),
      });
      return result.message;
    },
    onSuccess: (message) => {
      syncHint(message);
      onDone();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {target.mode === 'spec' ? 'Podzial na specjalnosci' : `Podgrupy w ${target.parent.name}`}
          </DialogTitle>
          <DialogDescription>
            {target.mode === 'spec'
              ? 'Grupa specjalnosci dzieli caly rocznik. Ustaw semestr, od ktorego obowiazuje (np. 5, gdy specjalnosci zaczynaja sie od 3. roku).'
              : 'Grupy tego samego podzialu sa rozlaczne (np. C-A i C-B). Rozne podzialy (np. projektowe i laboratoryjne) moga sie przecinac — system traktuje je jako kolidujace.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {target.mode === 'spec' ? (
            <Field className="col-span-2">
              <FieldLabel htmlFor="spec">Specjalnosc</FieldLabel>
              <NativeSelect id="spec" value={specId} onChange={(e) => setSpecId(e.target.value)}>
                {specs.map((s) => (
                  <NativeSelectOption key={s.id} value={s.id}>
                    {s.name} ({s.shortName})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="partition">Rodzaj grup</FieldLabel>
                <NativeSelect id="partition" value={partition} onChange={(e) => setPartition(e.target.value)}>
                  {SUB_PARTITIONS.map((p) => (
                    <NativeSelectOption key={p} value={p}>
                      {p} — {PARTITION_LABELS[p]}
                    </NativeSelectOption>
                  ))}
                  <NativeSelectOption value="__custom__">inny (wlasny kod)</NativeSelectOption>
                </NativeSelect>
              </Field>
              {partition === '__custom__' ? (
                <Field>
                  <FieldLabel htmlFor="custom">Kod podzialu</FieldLabel>
                  <Input id="custom" value={custom} onChange={(e) => setCustom(e.target.value.toUpperCase())} placeholder="np. WF" />
                </Field>
              ) : (
                <Field>
                  <FieldLabel htmlFor="count">Ile grup</FieldLabel>
                  <Input id="count" type="number" min={1} max={26} value={count} onChange={(e) => setCount(e.target.value)} />
                </Field>
              )}
              {partition === '__custom__' && (
                <Field>
                  <FieldLabel htmlFor="count2">Ile grup</FieldLabel>
                  <Input id="count2" type="number" min={1} max={26} value={count} onChange={(e) => setCount(e.target.value)} />
                </Field>
              )}
            </>
          )}
          <Field>
            <FieldLabel htmlFor="size">Liczebnosc {target.mode === 'sub' ? 'kazdej grupy' : ''}</FieldLabel>
            <Input id="size" type="number" min={0} value={size} onChange={(e) => setSize(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="from">Od semestru</FieldLabel>
            <Input id="from" type="number" min={1} max={cohort.programVersion.totalSemesters} value={fromSemester} onChange={(e) => setFromSemester(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending && <Spinner />}
            Dodaj
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
