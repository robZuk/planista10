import { useEffect, useState } from 'react';
import type { CalendarDay, CalendarProposal } from '@/types';
import { CALENDAR_DAY_KIND_LABELS, WEEKDAY_LABELS } from '@/lib/labels';

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

/**
 * Wyjatek dnia w podsumowaniu kalendarza: "5.11 wg planu: poniedzialek", "2.11 Dzien wolny od zajec",
 * "12.11 godziny rektorskie od bloku 5". Wlasna nazwa dnia ma pierwszenstwo, ale zamiana dni
 * i godziny rektorskie zawsze mowia, wg ktorego dnia i od ktorego bloku.
 */
export function calendarDayLabel(day: Pick<CalendarDay, 'date' | 'kind' | 'name' | 'followsWeekday' | 'closedFromBlockOrder'>): string {
  const detail =
    day.kind === 'FOLLOWS_WEEKDAY' && day.followsWeekday
      ? `wg planu: ${WEEKDAY_LABELS[day.followsWeekday].toLowerCase()}`
      : day.kind === 'CLOSED_FROM' && day.closedFromBlockOrder
        ? `godziny rektorskie od bloku ${day.closedFromBlockOrder}`
        : null;
  const name = day.name?.trim();
  const text = name ? (detail ? `${name} (${detail})` : name) : (detail ?? CALENDAR_DAY_KIND_LABELS[day.kind].toLowerCase());
  return `${formatDayKey(day.date)} ${text}`;
}

/**
 * Numer tygodnia semestru („tydz.” zjazdu jak w arkuszu planu niestacjonarnych): tydzien 1 to
 * tydzien (pn-nd) pierwszego dnia zajec, kolejne co 7 dni — razem z tygodniami przerw. Ta sama
 * regula co backend (`lib/teachingCalendar.semesterWeekOf`); null — niepelne daty w formularzu.
 */
export function semesterWeekOf(date: string, semesterStart: string): number | null {
  const monday = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    const t = Date.UTC(y!, m! - 1, d!);
    const weekday = new Date(t).getUTCDay();
    return t - ((weekday + 6) % 7) * 86_400_000;
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(semesterStart)) return null;
  return Math.round((monday(date) - monday(semesterStart)) / (7 * 86_400_000)) + 1;
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
        `Daty semestru i przerw przeniesione z ${source.termLabel} na ten semestr (semestr zaczynany w poniedzialek znow zaczyna sie w poniedzialek), zjazdy wyrownane do tych samych dni tygodnia. ` +
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
