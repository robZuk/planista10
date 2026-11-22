import { ChevronLeft, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { dayShort } from './occupancyStyle';

interface Props {
  days: string[];
  day: string;
  /** Data -> nazwa swieta ustawowego. */
  holidays: Map<string, string>;
  /** "Wolne" (sale — wolne godziny sali) / "Wolny" (prowadzacy). */
  freeWord: string;
  freeFrom: string;
  freeTo: string;
  onFreeChange: (from: string, to: string) => void;
  onDay: (day: string) => void;
  onWeek: () => void;
}

/** Widok dnia: powrot do tygodnia, wybor dnia i szukanie wolnego zasobu w podanych godzinach. */
export function DayControls({ days, day, holidays, freeWord, freeFrom, freeTo, onFreeChange, onDay, onWeek }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={onWeek}>
        <ChevronLeft /> Caly tydzien
      </Button>
      <ToggleGroup type="single" variant="outline" value={day} onValueChange={(v) => v && onDay(v)} aria-label="Dzien">
        {days.map((d) => (
          <ToggleGroupItem key={d} value={d} className="px-2.5" title={holidays.get(d)}>
            {dayShort(d)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="flex items-center gap-1.5 text-sm">
        <span className="text-muted-foreground">{freeWord} od</span>
        <Input type="time" value={freeFrom} onChange={(e) => onFreeChange(e.target.value, freeTo)} className="w-28" aria-label={`${freeWord} od godziny`} />
        <span className="text-muted-foreground">do</span>
        <Input type="time" value={freeTo} onChange={(e) => onFreeChange(freeFrom, e.target.value)} className="w-28" aria-label={`${freeWord} do godziny`} />
        {(freeFrom || freeTo) && (
          <Button variant="ghost" size="icon-sm" onClick={() => onFreeChange('', '')} aria-label="Wyczysc godziny" title="Wyczysc godziny">
            <X />
          </Button>
        )}
      </div>
    </div>
  );
}
