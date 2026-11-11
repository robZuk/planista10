import { useLocation, useNavigate } from 'react-router-dom';
import { CalendarRange } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTerms } from '@/hooks/useTerm';
import { termKeyFromPath, termScopedItemFor } from '@/lib/navigation';
import { useTermStore } from '@/store/termStore';
import type { AcademicTerm } from '@/types';

/**
 * Przelacznik semestru w naglowku aplikacji — widoczny tylko na stronach dzialajacych
 * w kontekscie semestru. Zmienia klucz w adresie (/calendar/2026-L), wiec link
 * do konkretnego semestru mozna wyslac komus innemu.
 */
export function TermSelector() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const setLastTermKey = useTermStore((s) => s.setLastTermKey);
  const { data } = useTerms();
  const item = termScopedItemFor(pathname);
  if (!item || !data) return null;

  const current = termKeyFromPath(pathname, item);
  const currentTerm = data.terms.find((t) => t.key === current);
  const years = new Map<string, AcademicTerm[]>();
  for (const term of data.terms) {
    const list = years.get(term.academicYear) ?? [];
    list.push(term);
    years.set(term.academicYear, list);
  }

  return (
    <Select
      value={current ?? undefined}
      onValueChange={(key) => {
        setLastTermKey(key);
        navigate(`${item.to}/${key}`);
      }}
    >
      {/* Semestr to kontekst calej strony — przelacznik ma byc widoczny od razu. */}
      <SelectTrigger
        className="h-10! gap-2 border-primary/50 bg-primary/5 pr-2.5 pl-3 shadow-sm hover:bg-primary/10 dark:bg-primary/10 dark:hover:bg-primary/15"
        aria-label="Semestr"
      >
        <CalendarRange className="size-4 text-primary" />
        <SelectValue placeholder="Wybierz semestr">
          {currentTerm && (
            <span className="flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground sm:inline">Semestr</span>
              <span className="text-base font-semibold">{currentTerm.label}</span>
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {[...years.entries()].map(([year, terms]) => (
          <SelectGroup key={year}>
            <SelectLabel>Rok akademicki {year}</SelectLabel>
            {terms.map((term) => (
              <SelectItem key={term.key} value={term.key}>
                {term.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
