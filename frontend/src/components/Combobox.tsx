import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { matchesAllWords } from '@/lib/searchMatch';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Dodatkowy tekst brany pod uwage przy wyszukiwaniu (np. kod przedmiotu). */
  keywords?: string;
  /** Opcja widoczna, ale niewybieralna (np. prowadzacy z innym kontem). */
  disabled?: boolean;
  /** Krotki dopisek pod etykieta (np. powod zablokowania). */
  hint?: string;
}

interface Props {
  options: ComboboxOption[];
  value: string | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
}

/**
 * Select z wyszukiwaniem — shadcn nie ma tego jako gotowego pliku, sklada sie go
 * z Popover + Command. Uzywamy tam, gdzie lista jest zbyt dluga na zwykly Select
 * (np. slownik przedmiotow).
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Wybierz…',
  searchPlaceholder = 'Szukaj…',
  emptyText = 'Brak wynikow.',
  id,
  invalid,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        {/* Dopasowanie fragmentow slow (lib/searchMatch) zamiast rozmytego cmdk. */}
        <Command filter={(value, search) => (matchesAllWords(value, search) ? 1 : 0)}>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  // `value` trafia do wyszukiwarki Command — dokladamy slowa kluczowe,
                  // zeby dalo sie szukac takze po kodzie przedmiotu.
                  value={`${option.label} ${option.keywords ?? ''}`}
                  disabled={option.disabled}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn('mr-2 size-4', option.value === value ? 'opacity-100' : 'opacity-0')}
                  />
                  {option.hint ? (
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{option.label}</span>
                      <span className="truncate text-xs text-muted-foreground">{option.hint}</span>
                    </span>
                  ) : (
                    option.label
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
