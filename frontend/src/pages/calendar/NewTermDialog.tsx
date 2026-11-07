import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
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
import { createTerm } from '@/api/terms';
import { TERMS_QUERY_KEY } from '@/hooks/useTerm';
import { getErrorMessage } from '@/lib/errors';
import type { AcademicTerm, SemesterType } from '@/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  terms: AcademicTerm[];
}

/** Admin otwiera kolejny semestr; domyslnie ten, ktory nastepuje po najnowszym. */
export function NewTermDialog({ open, onOpenChange, terms }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const latest = terms.reduce<AcademicTerm | null>((best, t) => (!best || t.ordinal > best.ordinal ? t : best), null);
  const next = latest
    ? latest.type === 'WINTER'
      ? { startYear: latest.startYear, type: 'SUMMER' as SemesterType }
      : { startYear: latest.startYear + 1, type: 'WINTER' as SemesterType }
    : { startYear: new Date().getFullYear(), type: 'WINTER' as SemesterType };

  const [startYear, setStartYear] = useState(String(next.startYear));
  const [type, setType] = useState<SemesterType>(next.type);

  const mutation = useMutation({
    mutationFn: () => createTerm({ startYear: Number(startYear), type }),
    onSuccess: async (term) => {
      toast.success(`Utworzono semestr ${term.label}`);
      await queryClient.invalidateQueries({ queryKey: TERMS_QUERY_KEY });
      onOpenChange(false);
      navigate(`/calendar/${term.key}`);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nowy semestr</DialogTitle>
          <DialogDescription>
            Semestr jest wspolny dla calej uczelni. Kalendarze (daty, przerwy, zjazdy) ustawia potem kazdy wydzial.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="term-year">Rok akademicki od</FieldLabel>
            <Input
              id="term-year"
              type="number"
              min={2000}
              max={2100}
              value={startYear}
              onChange={(e) => setStartYear(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {Number(startYear)}/{Number(startYear) + 1}
            </p>
          </Field>
          <Field>
            <FieldLabel htmlFor="term-type">Semestr</FieldLabel>
            <NativeSelect id="term-type" value={type} onChange={(e) => setType(e.target.value as SemesterType)}>
              <NativeSelectOption value="WINTER">zimowy</NativeSelectOption>
              <NativeSelectOption value="SUMMER">letni</NativeSelectOption>
            </NativeSelect>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Anuluj
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending && <Spinner />}
            Utworz semestr
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
