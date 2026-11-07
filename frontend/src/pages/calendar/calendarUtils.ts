import { useEffect, useState } from 'react';

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
