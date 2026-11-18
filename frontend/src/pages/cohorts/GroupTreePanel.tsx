import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Flag, Pencil, Plus, Trash2, TriangleAlert, Undo2 } from 'lucide-react';
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
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
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
import { plural } from '@/lib/setupSteps';
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

/** Powod, dla ktorego grupy nie mozna usunac (null — mozna); ten sam warunek sprawdza serwer. */
function deleteBlock(group: CohortGroup): string | null {
  if (group.childCount > 0) return 'Grupa ma podgrupy — usun je najpierw';
  if (group.usedInPlan) return 'Grupa ma zajecia z obsada albo w planie — zamiast usuwac, zakoncz ja po semestrze (flaga)';
  if (group.memberCount > 0) return 'Grupa ma przypisanych studentow — zmien ich grupy w Uzytkownikach';
  return null;
}

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
  const [editing, setEditing] = useState<CohortGroup | null>(null);
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
    onSuccess: async (data, vars) => {
      if (vars.input.size !== undefined) {
        if (data.warning) toast.warning('Liczebnosc zapisana', { description: data.warning, duration: 20000 });
        else toast.success('Liczebnosc zapisana');
      }
      if (vars.input.toSemester !== undefined) {
        syncHint(
          vars.input.toSemester === null ? 'Grupa trwa dalej (bez daty konca)' : `Grupa konczy sie po semestrze ${vars.input.toSemester}`,
          { warning: data.warning, sync: data.sync },
        );
        setEnding(null);
      }
      await refresh();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteCohortGroup(id),
    onSuccess: async (data) => {
      syncHint('Grupa usunieta', { sync: data?.sync });
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

  const editButton = (group: CohortGroup) => (
    <Button
      variant="ghost"
      size="icon"
      className="size-7"
      title="Edytuj grupe: kod, liczebnosc, semestry"
      aria-label={`Edytuj ${group.name}`}
      onClick={() => setEditing(group)}
    >
      <Pencil />
    </Button>
  );
  // Kosz widac zawsze; gdy grupy nie mozna usunac — wylaczony, a powod jest w dymku.
  const deleteButton = (group: CohortGroup) => {
    const block = deleteBlock(group);
    return (
      // span: wylaczony przycisk nie pokazuje dymka, a powod ma byc widoczny
      <span title={block ?? 'Usun grupe'}>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-destructive hover:text-destructive"
          aria-label={`Usun ${group.name}`}
          disabled={!!block}
          onClick={() => setDeleting(group)}
        >
          <Trash2 />
        </Button>
      </span>
    );
  };

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
                {!isRoot && editButton(group)}
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
                {!isRoot && deleteButton(group)}
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
                {/* Grupa spoza tego semestru (zakonczona albo od pozniejszego) — poprawka bez przelaczania semestru. */}
                {canEdit && g.partitionKey !== 'ROOT' && (
                  <>
                    {editButton(g)}
                    {deleteButton(g)}
                  </>
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
        description={`Od semestru ${cohort.semester + 1} tej grupy juz nie bedzie — po zastosowaniu zmian na stronie „Obsada” jej zajecia w kolejnych semestrach znikna, a te z planem albo obsada zostana oznaczone jako osierocone. Do tego czasu mozna to cofnac przyciskiem „Nie koncz”.`}
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
      {editing && (
        <EditGroupDialog
          cohort={cohort}
          group={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

const GROUP_CODE = /^[A-Z0-9]{1,8}$/;

/**
 * Edycja grupy: kod (grupy podzialow — z niego liczy sie nazwa), liczebnosc i zakres semestrow.
 * Szerszy zakres od razu daje brakujace zajecia; zajecia poza nowym zakresem czekaja na podglad
 * w Obsadzie, a te z planem serwer zglasza ostrzezeniem.
 */
function EditGroupDialog({
  cohort,
  group,
  onClose,
  onSaved,
}: {
  cohort: TermCohort;
  group: CohortGroup;
  onClose: () => void;
  onSaved: () => void;
}) {
  const syncHint = useSyncHint();
  const total = cohort.programVersion.totalSemesters;
  // Grupa specjalnosci bierze kod ze skrotu specjalnosci — tu go nie zmienia sie.
  const isSpec = group.partitionKey === 'SPEC';
  const spec = isSpec ? cohort.program.fieldOfStudy.specializations.find((s) => s.id === group.specializationId) : undefined;
  const [code, setCode] = useState(group.code ?? '');
  const [size, setSize] = useState(String(group.size));
  const [from, setFrom] = useState(String(group.fromSemester));
  const [to, setTo] = useState(group.toSemester === null ? '' : String(group.toSemester));

  const normalized = code.trim().toUpperCase();
  const codeValid = isSpec || GROUP_CODE.test(normalized);
  // Nazwa konczy sie kodem (EDST-3-L-A1) — podglad nowej nazwy bez liczenia jej od nowa.
  const preview =
    !isSpec && group.code && codeValid && group.name.endsWith(`-${group.code}`)
      ? `${group.name.slice(0, -group.code.length)}${normalized}`
      : null;

  const mutation = useMutation({
    mutationFn: () =>
      updateCohortGroup(group.id, {
        ...(isSpec ? {} : { code: normalized }),
        size: Number(size),
        fromSemester: Number(from),
        toSemester: to.trim() === '' ? null : Number(to),
      }),
    onSuccess: (result) => {
      syncHint('Grupa zapisana', { warning: result.warning, sync: result.sync });
      onSaved();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edytuj grupe {group.name}</DialogTitle>
          <DialogDescription>
            Grupa idzie z rocznikiem przez studia — zakres semestrow mowi, kiedy obowiazuje. Zajecia z nowych semestrow
            powstana same; te poza zakresem znikna po zastosowaniu zmian na stronie „Obsada”.
          </DialogDescription>
        </DialogHeader>
        <form
          id="edit-group-form"
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          {isSpec ? (
            <Field>
              <FieldLabel>Specjalnosc</FieldLabel>
              <p className="text-sm">{spec ? `${spec.name} (${spec.shortName})` : (group.code ?? '—')}</p>
            </Field>
          ) : (
            <Field data-invalid={!codeValid || undefined}>
              <FieldLabel htmlFor="group-code">Kod</FieldLabel>
              <Input
                id="group-code"
                value={code}
                maxLength={8}
                aria-invalid={!codeValid || undefined}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <FieldDescription>{preview ? `Nazwa: ${preview}` : 'Litery i cyfry, np. A albo A1'}</FieldDescription>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="group-size">Liczebnosc</FieldLabel>
            <Input id="group-size" type="number" min={0} value={size} onChange={(e) => setSize(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="group-from">Od semestru</FieldLabel>
            <Input id="group-from" type="number" min={1} max={total} value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="group-to">Do semestru</FieldLabel>
            <Input
              id="group-to"
              type="number"
              min={1}
              max={total}
              value={to}
              placeholder="do konca studiow"
              onChange={(e) => setTo(e.target.value)}
            />
            <FieldDescription>Puste — do konca studiow (semestr {total})</FieldDescription>
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button type="submit" form="edit-group-form" disabled={!codeValid || size === '' || from === '' || mutation.isPending}>
            {mutation.isPending && <Spinner />}
            Zapisz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
        const result = await createCohortGroup(cohort.id, {
          parentId: target.parent.id,
          partitionKey: 'SPEC',
          specializationId: specId,
          size: Number(size),
          fromSemester: Number(fromSemester),
        });
        return { message: 'Specjalnosc dodana', sync: result.sync };
      }
      const result = await createCohortGroupsBulk(cohort.id, {
        parentIds: [target.parent.id],
        partitionKey: partition === '__custom__' ? custom : partition,
        perParent: Number(count),
        size: Number(size),
        fromSemester: Number(fromSemester),
      });
      return { message: `Dodano ${plural(Number(count), 'grupe', 'grupy', 'grup')}`, sync: result.sync };
    },
    onSuccess: ({ message, sync }) => {
      syncHint(message, { sync });
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
