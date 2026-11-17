import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Sparkles } from 'lucide-react';
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fetchDepartments } from '@/api/departments';
import { setEntryDepartments } from '@/api/programs';
import { useInstructorOptions } from '@/hooks/useInstructorOptions';
import { compareDepartments, departmentLabel } from '@/lib/departments';
import { departmentOrders, orderCsv, staffedHours, suggestDepartments, type DepartmentSuggestion } from '@/lib/departmentOrders';
import { getErrorMessage } from '@/lib/errors';
import { groupLabel, groupSize, type SectionGroup } from '@/lib/obsadaGroups';
import { CLASS_FULL_LABELS } from '@/lib/scheduleDisplay';
import { plural } from '@/lib/setupSteps';

const NONE = '__none__';

function downloadCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Zlecenia dla katedr — jak arkusz "Zajecia planowane" wydzialu z kolumna "Katedra": ktora katedra
 * prowadzi kazda forme przedmiotu, ile godzin ma obsadzonych i ile brakuje. Katedre przypisuje sie
 * pozycji programu (raz na wersje programu, dla wszystkich rocznikow), zlecenie dla katedry
 * pobiera sie jako CSV do wyslania.
 */
export default function OrdersTab({
  termKey,
  groups,
  canEdit,
  onChanged,
}: {
  termKey: string;
  groups: SectionGroup[];
  canEdit: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments });
  const { instructors } = useInstructorOptions(false);
  const [selected, setSelected] = useState<string | null>(null); // id katedry, NONE albo null (nic)
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  const orders = useMemo(() => departmentOrders(groups), [groups]);
  const sortedDepartments = useMemo(() => [...(departments ?? [])].sort(compareDepartments), [departments]);
  const suggestions = useMemo(
    () => (canEdit ? suggestDepartments(groups, instructors ?? [], departmentLabel) : []),
    [groups, instructors, canEdit],
  );
  const current = orders.find((o) => (o.id ?? NONE) === selected) ?? null;
  const shown = (current?.groups ?? []).filter((g) => !onlyMissing || g.sections.some((s) => staffedHours(s) < s.hours));

  const save = useMutation({
    mutationFn: (items: { group: SectionGroup; departmentId: string | null }[]) =>
      setEntryDepartments(items.map(({ group, departmentId }) => ({ programEntryId: group.programEntryId, classType: group.classType, departmentId }))),
    onSuccess: async (r) => {
      toast.success(r.message);
      setSuggesting(false);
      await onChanged();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Katedra</TableHead>
              <TableHead className="text-right">Pozycji</TableHead>
              <TableHead className="text-right">Godzin</TableHead>
              <TableHead className="text-right">Obsadzonych</TableHead>
              <TableHead className="text-right">Braki</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => {
              const key = o.id ?? NONE;
              return (
                <TableRow key={key} data-state={selected === key ? 'selected' : undefined} className="cursor-pointer" onClick={() => setSelected(key)}>
                  <TableCell>
                    <Badge variant={o.id ? 'secondary' : 'outline'}>{o.label}</Badge>
                    {o.name && <span className="ml-2 text-sm">{o.name}</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{o.groups.length}</TableCell>
                  <TableCell className="text-right tabular-nums">{o.hours} h</TableCell>
                  <TableCell className="text-right tabular-nums">{o.staffed} h</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {o.missing > 0 ? <Badge variant="destructive">{o.missing} h</Badge> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    {o.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Zlecenie dla katedry jako CSV (Excel)"
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadCsv(`zlecenie-${o.label}-${termKey}.csv`, orderCsv(o));
                        }}
                      >
                        <Download /> CSV
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {canEdit && suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3 text-sm">
          <span>
            {plural(suggestions.length, 'pozycja bez katedry ma', 'pozycje bez katedry maja', 'pozycji bez katedry ma')} obsade z jednej
            katedry.
          </span>
          <Button size="sm" variant="outline" onClick={() => setSuggesting(true)}>
            <Sparkles /> Podpowiedz katedry z obsady
          </Button>
        </div>
      )}

      {current && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-medium">
              {current.id ? `Zlecenie ${current.label}` : 'Pozycje bez katedry'} · {plural(current.groups.length, 'pozycja', 'pozycje', 'pozycji')}
            </h3>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={onlyMissing} onCheckedChange={(v) => setOnlyMissing(v === true)} />
              Tylko z brakami
            </label>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rocznik</TableHead>
                  <TableHead>Przedmiot</TableHead>
                  <TableHead>Forma</TableHead>
                  <TableHead>Wymiar</TableHead>
                  <TableHead>Obsada</TableHead>
                  <TableHead>Katedra</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((g) => {
                  const staffed = g.sections.reduce((sum, s) => sum + staffedHours(s), 0);
                  return (
                    <TableRow key={g.key}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {g.cohort.code} · s{g.cohort.semester}
                      </TableCell>
                      <TableCell className="font-medium">
                        {g.subject.name}
                        {g.specialization && (
                          <Badge variant="outline" className="ml-2">
                            {g.specialization}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{CLASS_FULL_LABELS[g.classType]}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{groupSize(g)}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {staffed} / {g.hours} h
                        {staffed < g.hours && (
                          <Badge variant="destructive" className="ml-2">
                            brak {g.hours - staffed} h
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {canEdit && !g.archived ? (
                          <NativeSelect
                            value={g.department?.id ?? NONE}
                            className="w-44"
                            aria-label={`Katedra: ${groupLabel(g)}`}
                            disabled={save.isPending}
                            onChange={(e) => save.mutate([{ group: g, departmentId: e.target.value === NONE ? null : e.target.value }])}
                          >
                            <NativeSelectOption value={NONE}>Bez katedry</NativeSelectOption>
                            {sortedDepartments.map((d) => (
                              <NativeSelectOption key={d.id} value={d.id}>
                                {departmentLabel(d)}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        ) : (
                          (g.department?.label ?? '—')
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {shown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      {onlyMissing ? 'Wszystkie pozycje tej katedry maja pelna obsade.' : 'Brak pozycji.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Katedra zapisuje sie w pozycji programu — obowiazuje wszystkie roczniki tej wersji programu i przechodzi do jej klonow.
          </p>
        </section>
      )}

      {suggesting && (
        <SuggestDialog suggestions={suggestions} pending={save.isPending} onClose={() => setSuggesting(false)} onApply={(items) => save.mutate(items)} />
      )}
    </div>
  );
}

/** Podglad podpowiedzi katedr z obsady — zapis dopiero po potwierdzeniu (jak kazda akcja masowa). */
function SuggestDialog({
  suggestions,
  pending,
  onClose,
  onApply,
}: {
  suggestions: DepartmentSuggestion[];
  pending: boolean;
  onClose: () => void;
  onApply: (items: { group: SectionGroup; departmentId: string }[]) => void;
}) {
  const counts = suggestions.reduce((map, s) => map.set(s.department.label, (map.get(s.department.label) ?? 0) + 1), new Map<string, number>());
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Katedry z obsady</DialogTitle>
          <DialogDescription>
            Pozycje bez katedry, ktorych wszyscy prowadzacy naleza do jednej katedry, dostana te katedre. Pozycje bez obsady albo
            z osobami z roznych katedr zostaja do przypisania recznie.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          {[...counts].sort((a, b) => b[1] - a[1]).map(([label, n]) => `${label}: ${n}`).join(' · ')}
        </p>
        <ul className="max-h-72 space-y-0.5 overflow-y-auto text-sm">
          {suggestions.slice(0, 300).map((s) => (
            <li key={s.group.key} className="flex flex-wrap gap-x-2">
              <span>{groupLabel(s.group)}</span>
              <span className="text-muted-foreground">→ {s.department.label}</span>
            </li>
          ))}
          {suggestions.length > 300 && <li className="text-muted-foreground">… i {suggestions.length - 300} wiecej</li>}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button disabled={pending} onClick={() => onApply(suggestions.map((s) => ({ group: s.group, departmentId: s.department.id })))}>
            {pending && <Spinner />}
            Przypisz ({suggestions.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
