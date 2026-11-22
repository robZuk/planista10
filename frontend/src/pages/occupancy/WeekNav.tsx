import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { todayKey } from '@/lib/externalBusy';
import { isoAddDays, weekLabel } from '@/lib/occupancyView';
import type { TermWeek } from '@/types';

interface Props {
  weeks: TermWeek[];
  week: string | null;
  isPending: boolean;
  isFetching: boolean;
  onGo: (monday: string) => void;
}

/** Wybor tygodnia semestru: poprzedni/nastepny, lista „tydz. N · daty” i skok do biezacego. */
export function WeekNav({ weeks, week, isPending, isFetching, onGo }: Props) {
  const index = weeks.findIndex((w) => w.monday === week);
  const today = todayKey();
  const current = weeks.find((w) => w.monday <= today && today <= isoAddDays(w.monday, 6)) ?? null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          disabled={index <= 0}
          onClick={() => onGo(weeks[index - 1]!.monday)}
          aria-label="Poprzedni tydzien"
          title="Poprzedni tydzien"
        >
          <ChevronLeft />
        </Button>
        <Select value={week ?? ''} onValueChange={onGo} disabled={weeks.length === 0}>
          <SelectTrigger className="w-80 *:data-[slot=select-value]:flex-1" aria-label="Tydzien">
            <CalendarRange className="size-4 text-muted-foreground" />
            <SelectValue placeholder={isPending ? 'Ladowanie…' : 'Brak tygodni'} />
          </SelectTrigger>
          <SelectContent>
            {weeks.map((w) => (
              <SelectItem key={w.monday} value={w.monday}>
                {weekLabel(w)}
                {w.monday === current?.monday ? ' · biezacy' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          disabled={index < 0 || index >= weeks.length - 1}
          onClick={() => onGo(weeks[index + 1]!.monday)}
          aria-label="Nastepny tydzien"
          title="Nastepny tydzien"
        >
          <ChevronRight />
        </Button>
        {current && current.monday !== week && (
          <Button variant="ghost" onClick={() => onGo(current.monday)}>
            Biezacy tydzien
          </Button>
        )}
        {isFetching && !isPending && <Spinner className="ml-1 size-4 text-muted-foreground" />}
      </div>
    </div>
  );
}
