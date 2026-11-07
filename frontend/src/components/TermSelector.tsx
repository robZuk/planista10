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
import { Badge } from '@/components/ui/badge';
import { useTerms } from '@/hooks/useTerm';
import { termKeyFromPath, termScopedItemFor } from '@/lib/navigation';
import { useTermStore } from '@/store/termStore';
import type { AcademicTerm } from '@/types';

/** Krotki stan semestru z kalendarzy widocznych dla uzytkownika. */
function termState(term: AcademicTerm): { label: string; variant: 'default' | 'secondary' | 'outline' } | null {
  const statuses = new Set(term.calendars.map((c) => c.status));
  if (statuses.size === 0) return null;
  if (statuses.has('PLANNING')) return { label: 'w przygotowaniu', variant: 'default' };
  if (statuses.has('PUBLISHED')) return { label: 'opublikowany', variant: 'secondary' };
  return { label: 'archiwum', variant: 'outline' };
}

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
      <SelectTrigger className="w-56" aria-label="Semestr">
        <CalendarRange className="size-4 text-muted-foreground" />
        <SelectValue placeholder="Wybierz semestr" />
      </SelectTrigger>
      <SelectContent>
        {[...years.entries()].map(([year, terms]) => (
          <SelectGroup key={year}>
            <SelectLabel>Rok akademicki {year}</SelectLabel>
            {terms.map((term) => {
              const state = termState(term);
              return (
                <SelectItem key={term.key} value={term.key}>
                  <span>{term.label}</span>
                  {state && (
                    <Badge variant={state.variant} className="ml-2 text-[10px]">
                      {state.label}
                    </Badge>
                  )}
                </SelectItem>
              );
            })}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
