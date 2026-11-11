import type {
  AcademicTerm,
  CalendarBreak,
  CalendarDay,
  StudyMode,
  TermCalendar,
  Zjazd,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  addDays,
  daysBetween,
  eachDay,
  fromIsoDate,
  isoDate,
  toIsoDate,
  yearOf,
  type IsoDate,
} from '../lib/isoDate';
import { holidaysInRange } from '../lib/holidays';
import { TeachingCalendar, type CalendarInput } from '../lib/teachingCalendar';
import {
  defaultTermDates,
  shiftDateByYears,
  termKey,
  termLabel,
  termOfDate,
  termOrdinal,
  type TermRef,
} from '../lib/terms';
import type { CalendarBody } from '../schemas/termCalendar';

export type CalendarWithChildren = TermCalendar & {
  term: AcademicTerm;
  faculty: { id: string; name: string; shortName: string };
  breaks: CalendarBreak[];
  days: CalendarDay[];
  zjazdy: Zjazd[];
};

export const calendarInclude = {
  term: true,
  faculty: { select: { id: true, name: true, shortName: true } },
  breaks: { orderBy: { startDate: 'asc' as const } },
  days: { orderBy: { date: 'asc' as const } },
  zjazdy: { orderBy: { number: 'asc' as const } },
};

/** Wiersz z bazy -> wejscie czystych funkcji kalendarza. */
export function toCalendarInput(calendar: CalendarWithChildren): CalendarInput {
  return {
    kind: calendar.kind,
    studyMode: calendar.studyMode,
    startDate: toIsoDate(calendar.startDate),
    endDate: toIsoDate(calendar.endDate),
    breaks: calendar.breaks.map((b) => ({
      name: b.name,
      startDate: toIsoDate(b.startDate),
      endDate: toIsoDate(b.endDate),
    })),
    days: calendar.days.map((d) => ({
      date: toIsoDate(d.date),
      kind: d.kind,
      name: d.name,
      followsWeekday: d.followsWeekday,
      closedFromBlockOrder: d.closedFromBlockOrder,
    })),
    zjazdy: calendar.zjazdy.map((z) => ({
      number: z.number,
      startDate: toIsoDate(z.startDate),
      endDate: toIsoDate(z.endDate),
    })),
  };
}

/** Podsumowanie kalendarza do listy: ile tygodni i dni zajec. */
export function summarize(input: CalendarInput) {
  const cal = new TeachingCalendar(input);
  const weeks = cal.teachingWeeks();
  return {
    teachingWeeks: weeks.filter((w) => w.index !== null).length,
    teachingDays: weeks.reduce((sum, w) => sum + w.teachingDays, 0),
    zjazdCount: input.zjazdy.length,
  };
}

/** Pelny podglad: tygodnie z numerami, zjazdy z liczba dni zajec, swieta w zakresie. */
export function preview(input: CalendarInput) {
  const cal = new TeachingCalendar(input);
  return {
    weeks: cal.teachingWeeks(),
    zjazdy: input.zjazdy.map((zjazd) => {
      const days = [...eachDay(zjazd.startDate, zjazd.endDate)].map((date) => cal.dayInfo(date));
      return {
        ...zjazd,
        teachingDays: days.filter((day) => day.teaching).length,
        notes: days.filter((day) => !day.teaching && day.label).map((day) => `${day.date}: ${day.label}`),
      };
    }),
    holidays: input.startDate <= input.endDate ? holidaysInRange(input.startDate, input.endDate) : [],
    ...summarize(input),
  };
}

/** Kalendarz do odpowiedzi API: daty jako "YYYY-MM-DD" + klucz i etykieta semestru. */
export function serializeCalendar(calendar: CalendarWithChildren) {
  const input = toCalendarInput(calendar);
  const term: TermRef = { startYear: calendar.term.startYear, type: calendar.term.type };
  return {
    id: calendar.id,
    termId: calendar.termId,
    termKey: termKey(term),
    termLabel: termLabel(term),
    facultyId: calendar.facultyId,
    faculty: calendar.faculty,
    studyMode: calendar.studyMode,
    name: calendar.name,
    kind: calendar.kind,
    status: calendar.status,
    startDate: input.startDate,
    endDate: input.endDate,
    breaks: calendar.breaks.map((b, i) => ({ id: b.id, ...input.breaks[i]! })),
    days: calendar.days.map((d, i) => ({ id: d.id, ...input.days[i]! })),
    zjazdy: calendar.zjazdy.map((z, i) => ({ id: z.id, ...input.zjazdy[i]! })),
    summary: summarize(input),
    updatedAt: calendar.updatedAt,
  };
}

/** Dane do zagniezdzonego zapisu dzieci kalendarza (create / createMany). */
export function childrenData(body: CalendarBody) {
  return {
    breaks: body.breaks.map((b) => ({
      name: b.name,
      startDate: fromIsoDate(b.startDate),
      endDate: fromIsoDate(b.endDate),
    })),
    days: body.days.map((d) => ({
      date: fromIsoDate(d.date),
      kind: d.kind,
      name: d.name ?? null,
      followsWeekday: d.kind === 'FOLLOWS_WEEKDAY' ? (d.followsWeekday ?? null) : null,
      closedFromBlockOrder: d.kind === 'CLOSED_FROM' ? (d.closedFromBlockOrder ?? null) : null,
    })),
    zjazdy: body.zjazdy.map((z) => ({
      number: z.number,
      startDate: fromIsoDate(z.startDate),
      endDate: fromIsoDate(z.endDate),
    })),
  };
}

export function bodyToInput(body: CalendarBody, studyMode: StudyMode): CalendarInput {
  return { ...body, studyMode, days: body.days.map((d) => ({ ...d })) };
}

/** Ta sama data (miesiac-dzien) w roku przesunietym o `years` — dla dat semestru i przerw. */
function sameDateShifted(date: IsoDate, years: number): IsoDate {
  return addDays(isoDate(yearOf(date) + years, Number(date.slice(5, 7)), Number(date.slice(8, 10))), 0);
}

export interface CalendarProposal {
  source: { termKey: string; termLabel: string; facultyName: string; name: string } | null;
  calendar: CalendarBody;
}

/**
 * Propozycja kalendarza. Nowy wariant w semestrze z kalendarzem — kopia tamtego (patrz nizej).
 * Pierwszy kalendarz w semestrze: ostatni kalendarz tego samego typu
 * semestru (ten sam wydzial i tryb, najlepiej ten sam wariant) przesuniety o lata.
 * Daty semestru i przerw zachowuja dzien miesiaca; zjazdy — dzien tygodnia (zjazd
 * musi dalej zaczynac sie w piatek). Jednorazowe wyjatki dni NIE sa kopiowane —
 * rektorskie i zamiany dni sa specyficzne dla konkretnego roku.
 */
export async function proposeCalendar(
  term: TermRef,
  facultyId: string,
  studyMode: StudyMode,
  name: string,
): Promise<CalendarProposal> {
  // Nowy wariant w semestrze, ktory ma juz kalendarz tego wydzialu i trybu: kopia tamtego
  // (najlepiej "Podstawowy") — te same daty, przerwy, dni wolne i zjazdy; planista zmienia
  // tylko to, czym wariant sie rozni (np. inne zjazdy dla czesci kierunkow).
  const sameTerm = await prisma.termCalendar.findMany({
    where: { facultyId, studyMode, term: { type: term.type, startYear: term.startYear } },
    include: calendarInclude,
    orderBy: { createdAt: 'asc' },
  });
  const base = sameTerm.find((c) => c.name === 'Podstawowy') ?? sameTerm[0];
  if (base) {
    const input = toCalendarInput(base);
    return {
      source: { termKey: termKey(base.term), termLabel: termLabel(base.term), facultyName: base.faculty.name, name: base.name },
      calendar: {
        name,
        kind: base.kind,
        startDate: input.startDate,
        endDate: input.endDate,
        breaks: input.breaks.map((b) => ({ name: b.name ?? 'Przerwa', startDate: b.startDate, endDate: b.endDate })),
        days: input.days.map((d) => ({
          date: d.date,
          kind: d.kind,
          name: d.name ?? null,
          followsWeekday: d.followsWeekday ?? null,
          closedFromBlockOrder: d.closedFromBlockOrder ?? null,
        })),
        zjazdy: input.zjazdy.map((z) => ({ number: z.number, startDate: z.startDate, endDate: z.endDate })),
      },
    };
  }

  const candidates = await prisma.termCalendar.findMany({
    where: { facultyId, studyMode, term: { type: term.type, startYear: { lt: term.startYear } } },
    include: calendarInclude,
  });
  candidates.sort(
    (a, b) =>
      // najpierw ten sam wariant, potem najnowszy rok
      Number(b.name === name) - Number(a.name === name) || b.term.startYear - a.term.startYear,
  );
  const source = candidates[0];

  if (!source) {
    const dates = defaultTermDates(term);
    const breaks =
      term.type === 'WINTER'
        ? [
            {
              name: 'Przerwa swiateczna',
              startDate: isoDate(term.startYear, 12, 23),
              endDate: isoDate(term.startYear + 1, 1, 1),
            },
          ]
        : [];
    return {
      source: null,
      calendar: {
        name,
        kind: studyMode === 'FULL_TIME' ? 'WEEKLY' : 'ZJAZD',
        ...dates,
        breaks,
        days: [],
        zjazdy: [],
      },
    };
  }

  const years = term.startYear - source.term.startYear;
  const input = toCalendarInput(source);
  return {
    source: {
      termKey: termKey(source.term),
      termLabel: termLabel(source.term),
      facultyName: source.faculty.name,
      name: source.name,
    },
    calendar: {
      name,
      kind: source.kind,
      startDate: sameDateShifted(input.startDate, years),
      endDate: sameDateShifted(input.endDate, years),
      breaks: input.breaks.map((b) => ({
        name: b.name ?? 'Przerwa',
        startDate: sameDateShifted(b.startDate, years),
        endDate: sameDateShifted(b.endDate, years),
      })),
      days: [],
      zjazdy: input.zjazdy.map((z) => {
        const startDate = shiftDateByYears(z.startDate, years);
        return { number: z.number, startDate, endDate: addDays(startDate, daysBetween(z.startDate, z.endDate)) };
      }),
    },
  };
}

/**
 * Semestr domyslnie wybrany w przelaczniku: najwczesniejszy semestr (od biezacego
 * wzwyz), w ktorym wydzial ma kalendarz w przygotowaniu; inaczej biezacy semestr
 * wg daty; inaczej najnowszy istniejacy.
 */
export function pickDefaultTerm(
  terms: { startYear: number; type: TermRef['type']; calendars: { facultyId: string; status: string }[] }[],
  facultyId: string | null,
  today: IsoDate,
): string | null {
  if (terms.length === 0) return null;
  const current = termOrdinal(termOfDate(today));
  const sorted = [...terms].sort((a, b) => termOrdinal(a) - termOrdinal(b));
  const planning = sorted.find(
    (t) =>
      termOrdinal(t) >= current &&
      t.calendars.some((c) => c.status === 'PLANNING' && (!facultyId || c.facultyId === facultyId)),
  );
  if (planning) return termKey(planning);
  const currentTerm = sorted.find((t) => termOrdinal(t) === current);
  if (currentTerm) return termKey(currentTerm);
  return termKey(sorted[sorted.length - 1]!);
}
