import { useEffect, useState } from 'react';
import type { CalendarProposal } from '@/types';

/** "2026-10-09" + n dni — liczone w UTC, wiec zmiana czasu nie przesuwa dnia. */
export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days));
  return date.toISOString().slice(0, 10);
}

/** "2026-10-09" -> "9.10" (krotko) albo "9.10.2026" (z rokiem). */
export function formatDayKey(key: string, withYear = false): string {
  const [y, m, d] = key.split('-');
  return `${Number(d)}.${m}${withYear ? `.${y}` : ''}`;
}

export function formatRange(from: string, to: string): string {
  return from.slice(0, 4) === to.slice(0, 4)
    ? `${formatDayKey(from)} – ${formatDayKey(to, true)}`
    : `${formatDayKey(from, true)} – ${formatDayKey(to, true)}`;
}

/** Wartosc opozniona o `delay` ms — zeby podglad nie pytal serwera po kazdym znaku. */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Opis propozycji nowego kalendarza: skopiowany z zeszlego roku albo (pierwszy kalendarz
 * tego typu) domyslne daty — wtedy mowimy wprost, co trzeba uzupelnic recznie.
 */
export function proposalNote(proposal: CalendarProposal, termKey?: string): { title: string; description: string } {
  const { source, calendar } = proposal;
  // Nowy wariant w semestrze, ktory ma juz kalendarz: kopia tamtego, nie "pierwszy kalendarz".
  if (source && source.termKey === termKey) {
    return {
      title: `Kopia kalendarza „${source.name}” z tego semestru`,
      description:
        'Daty semestru, przerwy, dni wolne i zjazdy sa takie same jak w nim. Zmien tylko to, czym wariant sie rozni (np. inne zjazdy dla czesci kierunkow).',
    };
  }
  if (source) {
    return {
      title: `Propozycja na podstawie: ${source.termLabel} (${source.name})`,
      description:
        `Daty semestru i przerw przeniesione z ${source.termLabel} na ten semestr, zjazdy wyrownane do tych samych dni tygodnia. ` +
        'Jednorazowe dni wolne i zamiany dni trzeba dodac na nowo. Sprawdz wszystko przed zapisem.',
    };
  }
  const breaks = calendar.breaks.length > 0 ? `, przerwa: ${calendar.breaks.map((b) => b.name).join(', ')}` : ', bez przerw';
  const toAdd = [calendar.kind === 'ZJAZD' && 'zjazdy', calendar.breaks.length > 0 ? 'pozostale przerwy' : 'przerwy', 'dni wolne uczelni']
    .filter(Boolean)
    .join(', ');
  return {
    title: 'Pierwszy kalendarz tego typu — domyslne daty',
    description:
      `Nie ma wczesniejszego kalendarza tego rodzaju semestru dla tego wydzialu i trybu, wiec nie ma z czego kopiowac. ` +
      `Przyjeto domyslne daty semestru (${formatRange(calendar.startDate, calendar.endDate)})${breaks}. ` +
      `Dodaj recznie: ${toAdd}. Kolejne kalendarze tego typu beda juz proponowane na podstawie tego.`,
  };
}
