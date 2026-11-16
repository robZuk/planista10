import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
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
import { Spinner } from '@/components/ui/spinner';
import { Combobox } from '@/components/Combobox';
import { replaceStaff } from '@/api/sections';
import { useInstructorOptions } from '@/hooks/useInstructorOptions';
import { getErrorMessage } from '@/lib/errors';
import { groupLabel, groupSize, type SectionGroup } from '@/lib/obsadaGroups';
import { draftRows, sameAssignments, staffRowsProblem, toAssignments, type StaffDraftRow } from '@/lib/staffRows';
import { StaffRowsEditor } from './StaffRowsEditor';

/**
 * Obsada wszystkich grup przedmiotu i formy w jednym oknie — jak pozycja w arkuszu katedry
 * ("cwiczenia, 3 gr. × 15 h"). "Ustaw wszystkim grupom" wpisuje jedna osobe na pelne godziny
 * kazdej grupy; zapis obejmuje tylko zmienione grupy, wszystko albo nic.
 */
export function GroupStaffDialog({
  termKey,
  group,
  onClose,
  onDone,
}: {
  termKey: string;
  group: SectionGroup;
  onClose: () => void;
  onDone: () => void;
}) {
  const { options } = useInstructorOptions(true);
  const [drafts, setDrafts] = useState<Record<string, StaffDraftRow[]>>(() =>
    Object.fromEntries(group.sections.map((s) => [s.id, draftRows(s)])),
  );
  const [everyone, setEveryone] = useState('');

  // Grupa bez obsady, w ktorej nikogo nie wybrano (pusty wiersz startowy), zostaje jak byla —
  // nie jest zmiana ani bledem, wiec nie blokuje zapisu pozostalych grup.
  const edited = group.sections.filter(
    (s) => !(s.instructors.length === 0 && drafts[s.id]!.length === 1 && !drafts[s.id]![0]!.instructorId),
  );
  const changes = edited
    .map((s) => ({ section: s, assignments: toAssignments(drafts[s.id]!) }))
    .filter(({ section, assignments }) => !sameAssignments(assignments, section.instructors));
  const problems = edited.flatMap((s) => {
    const problem = staffRowsProblem(drafts[s.id]!, s.hours);
    return problem ? [`${s.group.name}: ${problem}`] : [];
  });

  const save = useMutation({
    mutationFn: () =>
      replaceStaff(
        termKey,
        changes.map(({ section, assignments }) => ({ sectionId: section.id, assignments })),
      ),
    onSuccess: (r) => {
      toast.success(r.message);
      onDone();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const setForAll = () =>
    setDrafts(Object.fromEntries(group.sections.map((s) => [s.id, [{ instructorId: everyone, hours: String(s.hours) }]])));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{group.subject.name}</DialogTitle>
          <DialogDescription>
            {groupLabel(group)} · {groupSize(group)}. Obsade wpisuje sie dla kazdej grupy; godziny mozna podzielic miedzy
            kilku prowadzacych.
          </DialogDescription>
        </DialogHeader>

        {group.sections.length > 1 && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/40 p-3">
            <div className="min-w-56 flex-1">
              <p className="mb-1 text-sm font-medium">Ustaw wszystkim grupom</p>
              <Combobox
                options={options}
                value={everyone}
                onChange={setEveryone}
                placeholder="Wybierz prowadzacego"
                searchPlaceholder="Szukaj po nazwisku, katedrze lub e-mailu…"
              />
            </div>
            <Button variant="outline" disabled={!everyone} onClick={setForAll}>
              Ustaw ({group.sections.length} gr.)
            </Button>
          </div>
        )}

        <div className="space-y-4">
          {group.sections.map((section) => (
            <div key={section.id} className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{section.group.name}</span>
                <span className="text-muted-foreground">{section.hours} h</span>
                {section.status === 'ORPHANED' && <Badge variant="destructive">osierocone</Badge>}
              </div>
              <StaffRowsEditor
                rows={drafts[section.id]!}
                onChange={(rows) => setDrafts({ ...drafts, [section.id]: rows })}
                sectionHours={section.hours}
                options={options}
              />
            </div>
          ))}
        </div>

        <DialogFooter className="items-center">
          <span className="mr-auto text-sm text-muted-foreground">
            {changes.length === 0 ? 'Bez zmian' : `Zmienione grupy: ${changes.length}`}
          </span>
          <Button variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || changes.length === 0 || problems.length > 0}>
            {save.isPending && <Spinner />}
            Zapisz obsade
          </Button>
        </DialogFooter>
        {problems.length > 0 && changes.length > 0 && (
          <p className="text-sm text-destructive">Popraw przed zapisem: {problems.join('; ')}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
