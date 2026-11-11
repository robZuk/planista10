import type { Holiday } from './holidays';
import type { IsoDate } from './isoDate';

/** Przerwa albo dzien wolny z jednego kalendarza semestru (etykieta: np. "WM stacj."). */
export interface CalendarDayOff {
  kind: 'BREAK' | 'DAY_OFF';
  name: string;
  start: IsoDate;
  end: IsoDate;
  calendar: string;
}

export interface UpcomingDayOff {
  id: string;
  kind: 'HOLIDAY' | 'BREAK' | 'DAY_OFF';
  name: string;
  start: IsoDate;
  end: IsoDate;
  /** Kalendarze, ktorych dotyczy; null = wszystkie w zakresie (i swieta ustawowe). */
  calendars: string[] | null;
}

/**
 * Najblizsze dni wolne na dashboardzie planisty: swieta ustawowe oraz przerwy i dni wolne
 * z kalendarzy semestru — to wszystko generator terminow omija. Ta sama przerwa w wielu
 * kalendarzach to jedna pozycja z lista kalendarzy (albo bez listy, gdy dotyczy wszystkich).
 * Swieto wewnatrz przerwy wspolnej dla wszystkich kalendarzy nic nie wnosi — pomijamy je.
 */
export function upcomingDaysOff(
  from: IsoDate,
  to: IsoDate,
  holidays: Holiday[],
  entries: CalendarDayOff[],
  allCalendars: string[],
  limit = 6,
): UpcomingDayOff[] {
  const groups = new Map<string, { kind: CalendarDayOff['kind']; name: string; start: IsoDate; end: IsoDate; calendars: Set<string> }>();
  for (const e of entries) {
    if (e.end < from || e.start > to) continue;
    const key = `${e.kind}|${e.name.trim().toLowerCase()}|${e.start}|${e.end}`;
    const g = groups.get(key) ?? { kind: e.kind, name: e.name.trim(), start: e.start, end: e.end, calendars: new Set<string>() };
    g.calendars.add(e.calendar);
    groups.set(key, g);
  }
  const all = new Set(allCalendars);
  const fromCalendars: UpcomingDayOff[] = [...groups.values()].map((g) => {
    const everywhere = all.size > 0 && [...all].every((c) => g.calendars.has(c));
    return {
      id: `${g.kind}|${g.name}|${g.start}|${g.end}`,
      kind: g.kind,
      name: g.name,
      start: g.start,
      end: g.end,
      calendars: everywhere ? null : [...g.calendars].sort((a, b) => a.localeCompare(b, 'pl')),
    };
  });
  const coveredEverywhere = (date: IsoDate) =>
    fromCalendars.some((d) => d.kind === 'BREAK' && d.calendars === null && d.start <= date && date <= d.end);
  const fromHolidays: UpcomingDayOff[] = holidays
    .filter((h) => h.date >= from && h.date <= to && !coveredEverywhere(h.date))
    .map((h) => ({ id: `HOLIDAY|${h.date}`, kind: 'HOLIDAY', name: h.name, start: h.date, end: h.date, calendars: null }));

  const order = { HOLIDAY: 0, BREAK: 1, DAY_OFF: 2 } as const;
  return [...fromHolidays, ...fromCalendars]
    .sort((a, b) => a.start.localeCompare(b.start) || order[a.kind] - order[b.kind] || a.name.localeCompare(b.name, 'pl'))
    .slice(0, limit);
}
