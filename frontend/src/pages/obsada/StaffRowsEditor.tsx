import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox, type ComboboxOption } from '@/components/Combobox';
import { draftTotal, staffRowsProblem, type StaffDraftRow } from '@/lib/staffRows';

/**
 * Wiersze obsady jednych zajec: prowadzacy (albo NN) i godziny, z podzialem na kilku.
 * Wspolne dla okna jednych zajec i okna wszystkich grup przedmiotu.
 */
export function StaffRowsEditor({
  rows,
  onChange,
  sectionHours,
  options,
}: {
  rows: StaffDraftRow[];
  onChange: (rows: StaffDraftRow[]) => void;
  sectionHours: number;
  options: ComboboxOption[];
}) {
  const total = draftTotal(rows);
  const problem = staffRowsProblem(rows, sectionHours);
  const set = (index: number, patch: Partial<StaffDraftRow>) => onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[1fr_5.5rem_auto] items-center gap-2">
          <Combobox
            options={options}
            value={row.instructorId}
            onChange={(value) => set(index, { instructorId: value })}
            placeholder="Wybierz prowadzacego"
            searchPlaceholder="Szukaj po nazwisku, katedrze lub e-mailu…"
          />
          <Input
            type="number"
            min={1}
            value={row.hours}
            aria-label="Godziny"
            className="text-right tabular-nums"
            onChange={(e) => set(index, { hours: e.target.value })}
          />
          <Button variant="ghost" size="icon" aria-label="Usun" onClick={() => onChange(rows.filter((_, i) => i !== index))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...rows, { instructorId: '', hours: String(Math.max(0, sectionHours - total)) }])}
        >
          <Plus /> Podziel godziny
        </Button>
        <span className={`text-sm tabular-nums ${total > sectionHours ? 'text-destructive' : 'text-muted-foreground'}`}>
          {total} / {sectionHours} h
        </span>
      </div>
      {/* Pusty wiersz (np. swiezo otwarte okno) to wskazowka, nie blad — bez czerwieni. */}
      {problem && (
        <p className={`text-sm ${rows.some((r) => !r.instructorId) ? 'text-muted-foreground' : 'text-destructive'}`}>{problem}</p>
      )}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Bez wierszy zapis usunie obsade tych zajec.</p>}
    </div>
  );
}
