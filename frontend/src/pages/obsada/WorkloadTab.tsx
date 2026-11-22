import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ListFilter, Pencil, Plus, Search, UserPlus, Users } from 'lucide-react';
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Combobox } from '@/components/Combobox';
import { fetchWorkload } from '@/api/sections';
import { useInstructorOptions } from '@/hooks/useInstructorOptions';
import { departmentLabel, departmentSelectGroups, instructorName } from '@/lib/departments';
import type { SectionGroup } from '@/lib/obsadaGroups';
import { CLASS_FULL_LABELS } from '@/lib/scheduleDisplay';
import { plural } from '@/lib/setupSteps';
import { ALL_DEPARTMENTS, NO_DEPARTMENT, itemJointWith, itemSize, workloadBlocks, type ModeFilter } from '@/lib/workloadView';
import type { Department, WorkloadPerson } from '@/types';
import { AddClassesDialog } from './AddClassesDialog';

type Person = { id: string; name: string };

/** Godziny z podzialem na tryby — jak osobne arkusze katedr "stac" i "niestac". */
function HoursSplit({ person, mode }: { person: Pick<WorkloadPerson, 'here' | 'fullTime' | 'partTime'>; mode: ModeFilter }) {
  return (
    <span className="flex items-baseline gap-2 whitespace-nowrap tabular-nums">
      <span className="font-medium">{person.here} h</span>
      {mode === 'all' && person.fullTime > 0 && person.partTime > 0 && (
        <span className="text-xs text-muted-foreground">
          stac. {person.fullTime} · niestac. {person.partTime}
        </span>
      )}
    </span>
  );
}

/**
 * Obciazenia prowadzacych w semestrze — w ukladzie arkuszy, ktore przysylaja katedry:
 * katedra → prowadzacy → przedmiot i forma w roczniku z grupami. Stad tez wpisuje sie zajecia
 * z arkusza katedry ("Dodaj zajecia"). Wakatow tu nie widac (nikt ich nie prowadzi) — braki
 * pokazuje zakladka "Zajecia".
 */
export default function WorkloadTab({
  termKey,
  facultyId,
  viewFacultyId,
  groups,
  canEdit,
  onShowSections,
  onChanged,
}: {
  termKey: string;
  facultyId?: string;
  /** Wydzial widoku (null = cala uczelnia) — jego katedry na gorze filtra. */
  viewFacultyId: string | null;
  groups: SectionGroup[];
  canEdit: boolean;
  /** "Pokaz w Zajeciach": lista zajec przefiltrowana do tej osoby. */
  onShowSections: (person: Person) => void;
  onChanged: () => Promise<void> | void;
}) {
  const { data: workload, isPending } = useQuery({
    queryKey: ['workload', termKey, facultyId],
    queryFn: () => fetchWorkload(termKey, facultyId),
  });
  const { instructors } = useInstructorOptions(false);
  const [department, setDepartment] = useState<string>(ALL_DEPARTMENTS);
  const [mode, setMode] = useState<ModeFilter>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ person: Person; key?: string } | null>(null);
  const [picking, setPicking] = useState(false);

  // W filtrze wszystkie katedry z prowadzacymi (takze bez godzin tutaj — do dopisania zajec z arkusza
  // katedry innego wydzialu), w czesciach jak lista: katedry wydzialu, inne jednostki z zajeciami
  // tutaj, pozostale katedry uczelni.
  const departmentGroups = useMemo(() => {
    const byId = new Map<string, Department>();
    for (const i of instructors ?? []) if (i.department) byId.set(i.department.id, i.department);
    const used = new Set((workload ?? []).flatMap((p) => (p.department ? [p.department.id] : [])));
    return departmentSelectGroups([...byId.values()], { facultyId: viewFacultyId, usedIds: used });
  }, [instructors, workload, viewFacultyId]);
  const blocks = useMemo(
    () => workloadBlocks(workload ?? [], { department, mode, search, members: instructors, facultyId: viewFacultyId }),
    [workload, department, mode, search, instructors, viewFacultyId],
  );
  // Z wydzialem widoku: czesc "Katedry wydzialu" i "Inne jednostki" (katedry innych wydzialow, SJO)
  // z sumami — kto z zewnatrz prowadzi zajecia wydzialu. Cala uczelnia — jedna lista bez naglowkow.
  const partTotals = (own: boolean) => {
    const list = blocks.filter((b) => b.own === own);
    return { people: list.reduce((n, b) => n + b.people.length, 0), hours: list.reduce((n, b) => n + b.hours, 0) };
  };
  const shownPeople = blocks.reduce((sum, b) => sum + b.people.length, 0);
  const shownHours = blocks.reduce((sum, b) => sum + b.hours, 0);
  const groupOfSection = useMemo(() => new Map(groups.flatMap((g) => g.sections.map((s) => [s.id, g.key] as const))), [groups]);

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <NativeSelect value={department} onChange={(e) => setDepartment(e.target.value)} className="w-60" aria-label="Katedra">
          <NativeSelectOption value={ALL_DEPARTMENTS}>Wszystkie katedry</NativeSelectOption>
          {departmentGroups.map((group) => (
            <NativeSelectOptGroup key={group.label} label={group.label}>
              {group.departments.map((d) => (
                <NativeSelectOption key={d.id} value={d.id}>
                  {departmentLabel(d)} — {d.name}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
          ))}
          <NativeSelectOption value={NO_DEPARTMENT}>Bez katedry</NativeSelectOption>
        </NativeSelect>
        <NativeSelect value={mode} onChange={(e) => setMode(e.target.value as ModeFilter)} className="w-60" aria-label="Tryb studiow">
          <NativeSelectOption value="all">Stacjonarne i niestacjonarne</NativeSelectOption>
          <NativeSelectOption value="FULL_TIME">Stacjonarne</NativeSelectOption>
          <NativeSelectOption value="PART_TIME">Niestacjonarne</NativeSelectOption>
        </NativeSelect>
        <div className="relative">
          <Search className="absolute top-2.5 left-2 size-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Prowadzacy, katedra…" className="w-64 pl-8" />
        </div>
        {workload && (
          <span className="text-sm text-muted-foreground tabular-nums">
            {plural(shownPeople, 'osoba', 'osoby', 'osob')} · {shownHours} h
          </span>
        )}
        {canEdit && (
          <Button variant="outline" className="ml-auto" onClick={() => setPicking(true)}>
            <UserPlus /> Dodaj zajecia prowadzacemu
          </Button>
        )}
      </div>

      {isPending && <Skeleton className="h-64 w-full" />}
      {workload && blocks.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>{workload.length === 0 ? 'Nikt nie ma jeszcze zajec' : 'Brak prowadzacych dla tych filtrow'}</EmptyTitle>
            <EmptyDescription>
              {workload.length === 0
                ? 'Wpisz zajecia z arkuszy katedr („Dodaj zajecia prowadzacemu”), przenies obsade z poprzedniego roku albo wczytaj CSV.'
                : 'Zmien katedre, tryb studiow albo wyszukiwanie.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {blocks.map((block, index) => (
        <Fragment key={`${block.own ? 'own' : 'other'}|${block.id ?? 'none'}`}>
          {viewFacultyId && (index === 0 || blocks[index - 1]!.own !== block.own) && (
            <div className={`flex flex-wrap items-baseline justify-between gap-2 ${index > 0 ? 'pt-2' : ''}`}>
              <h3 className="text-sm font-semibold">
                {block.own ? 'Katedry wydzialu' : 'Inne jednostki'}
                {!block.own && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    katedry innych wydzialow i jednostki miedzywydzialowe z zajeciami na tym wydziale
                  </span>
                )}
              </h3>
              <span className="text-sm text-muted-foreground tabular-nums">
                {plural(partTotals(block.own).people, 'osoba', 'osoby', 'osob')} · {partTotals(block.own).hours} h
              </span>
            </div>
          )}
          <section className="overflow-hidden rounded-lg border">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge variant={block.id ? 'secondary' : 'outline'}>{block.label}</Badge>
                {block.name && <span className="text-sm font-medium">{block.name}</span>}
                <span className="text-sm text-muted-foreground">· {plural(block.people.length, 'osoba', 'osoby', 'osob')}</span>
              </div>
              <HoursSplit person={{ here: block.hours, fullTime: block.fullTime, partTime: block.partTime }} mode={mode} />
            </header>
            <ul className="divide-y">
              {block.people.map((p) => {
                const open = expanded.has(p.id);
                const person = { id: p.id, name: p.name };
                return (
                  <li key={p.id}>
                    <div className="flex items-center gap-2 px-2 py-1">
                      <button
                        type="button"
                        onClick={() => toggle(p.id)}
                        aria-expanded={open}
                        className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                        <span className="truncate">{p.name}</span>
                      </button>
                      <span className="text-sm">
                        <HoursSplit person={p} mode={mode} />
                      </span>
                      {mode === 'all' && p.total > p.here && (
                        <span className="hidden text-xs whitespace-nowrap text-muted-foreground sm:inline" title="Godziny w calej uczelni — z zajeciami na innych wydzialach">
                          uczelnia {p.total} h
                        </span>
                      )}
                      {canEdit && (
                        <Button variant="ghost" size="icon" className="size-8" title="Dodaj zajecia" aria-label={`Dodaj zajecia: ${p.name}`} onClick={() => setEditing({ person })}>
                          <Plus />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        title="Pokaz zajecia tej osoby w zakladce Zajecia"
                        aria-label={`Pokaz w Zajeciach: ${p.name}`}
                        onClick={() => onShowSections(person)}
                      >
                        <ListFilter />
                      </Button>
                    </div>
                    {open && (
                      <ul className="space-y-1 pr-3 pb-2 pl-9 text-sm">
                        {p.items.length === 0 && (
                          <li className="text-muted-foreground">
                            Bez zajec {mode === 'all' ? 'w tym semestrze' : 'w tym trybie'} — dopisz je przyciskiem „+”.
                          </li>
                        )}
                        {p.items.map((item) => (
                          <li key={item.key} className="flex flex-wrap items-center gap-x-2">
                            <span>{item.subject.name}</span>
                            <span className="text-muted-foreground">
                              {CLASS_FULL_LABELS[item.classType].toLowerCase()} · {item.cohort.code} s{item.cohort.semester}
                            </span>
                            <span className="tabular-nums">{itemSize(item)}</span>
                            <span className="text-xs text-muted-foreground">({item.groups.map((g) => g.name).join(', ')})</span>
                            {itemJointWith(item).length > 0 && (
                              <Badge
                                variant="outline"
                                title="Zajecia laczone w planie (wspolny klucz) — to te same godziny osoby, wiec licza sie raz"
                              >
                                laczone z {itemJointWith(item).join(', ')}
                              </Badge>
                            )}
                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                title="Zmien grupy i godziny"
                                aria-label={`Zmien: ${item.subject.name}`}
                                onClick={() => setEditing({ person, key: groupOfSection.get(item.groups[0]!.sectionId) })}
                              >
                                <Pencil />
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </Fragment>
      ))}

      {picking && (
        <PersonPickerDialog
          onClose={() => setPicking(false)}
          onPick={(person) => {
            setPicking(false);
            setEditing({ person });
          }}
        />
      )}
      {editing && (
        <AddClassesDialog
          key={`${editing.person.id}|${editing.key ?? ''}`}
          termKey={termKey}
          person={editing.person}
          groups={groups}
          initialKey={editing.key}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

/** Wybor prowadzacego z calej uczelni (z katedra przy nazwisku) — przed wpisaniem jego zajec. */
function PersonPickerDialog({ onClose, onPick }: { onClose: () => void; onPick: (person: Person) => void }) {
  const { options, instructors } = useInstructorOptions(false);
  const [chosen, setChosen] = useState('');
  const instructor = instructors?.find((i) => i.id === chosen);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dodaj zajecia prowadzacemu</DialogTitle>
          <DialogDescription>
            Wybierz osobe z arkusza katedry — takze z katedry innego wydzialu. Nowa osobe dodaje sie w „Prowadzacy”.
          </DialogDescription>
        </DialogHeader>
        <Combobox
          options={options}
          value={chosen}
          onChange={setChosen}
          placeholder="Wybierz prowadzacego"
          searchPlaceholder="Szukaj po nazwisku, katedrze lub e-mailu…"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button disabled={!instructor} onClick={() => instructor && onPick({ id: instructor.id, name: instructorName(instructor) })}>
            Dalej
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
