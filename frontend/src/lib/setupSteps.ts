import type { SetupStatus } from '@/types';
import { setupIssues, type SetupIssue } from './setupIssues';

/**
 * Karty listy kontrolnej "Przygotowanie semestru". Czysta funkcja — stan kazdego kroku
 * i, gdy krok nie jest gotowy, konkretna czynnosc do wykonania z linkiem do niej.
 *
 * Stany:
 *   done — zielony ptaszek: krok nie wymaga dzialania,
 *   warn — "!": krok zaczety, ale cos zostalo do uzupelnienia,
 *   todo — puste kolko: krok jeszcze nie zaczety (albo blokuje go wczesniejszy).
 */
export type StepState = 'done' | 'warn' | 'todo';

export interface SetupStep {
  n: number;
  title: string;
  state: StepState;
  /** Co jest — zawsze widoczne. */
  summary: string;
  /** Co zrobic — tylko gdy krok nie jest gotowy. */
  todo: string | null;
  to: string;
  link: string;
}

/** Braki rocznikow liczone w krokach listy (filtr tabeli: `?krok=N`). */
export const STEP_ISSUES: Record<number, SetupIssue[]> = {
  5: ['VACANCIES'],
  6: ['UNPLACED'],
  7: ['NO_OCCURRENCES', 'STALE', 'SHORT_HOURS'],
};

/** Ile rocznikow ma ktorykolwiek z brakow kroku. */
export function cohortsWithIssues(cohorts: Parameters<typeof setupIssues>[0][], issues: SetupIssue[]): number {
  return cohorts.filter((c) => {
    const has = setupIssues(c);
    return issues.some((i) => has.has(i));
  }).length;
}

/** Odmiana: 1 rocznik, 2-4 roczniki, 5+ rocznikow (12-14 jak 5+). */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return `1 ${one}`;
  const lastTwo = n % 100;
  const last = n % 10;
  return `${n} ${last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many}`;
}

const cohortsN = (n: number) => plural(n, 'rocznik', 'roczniki', 'rocznikow');
const rocznikom = (n: number) => (n === 1 ? '1 rocznikowi' : `${n} rocznikom`);
const sectionsN = (n: number) => plural(n, 'zajecia', 'zajecia', 'zajec');

export function setupSteps(data: SetupStatus, termKey: string): SetupStep[] {
  const t = data.totals;
  const unplaced = t.sections - t.placedSections;
  const unplacedCohorts = data.cohorts.filter((c) => c.sections > 0 && c.placedSections < c.sections).length;
  const withoutOccurrences = data.cohorts.filter((c) => setupIssues(c).has('NO_OCCURRENCES')).length;
  const unpublished = data.calendars.filter((c) => c.status === 'PLANNING').length;
  const visibleCalendars = data.calendars.length - unpublished;
  const noSections = t.sections === 0;

  // Krok 7: terminy (nieaktualne, nigdy niewygenerowane) i publikacja kalendarzy.
  const step7Todos: string[] = [];
  // Pusty semestr (bez rocznikow albo bez zajec, np. nowy semestr letni z rocznikami
  // przeniesionymi z zimy): nie ma czego generowac ani publikowac — to nie jest "gotowe".
  if (data.cohorts.length === 0 || noSections) step7Todos.push('najpierw plan rocznikow (krok 6)');
  else if (data.calendars.length === 0) step7Todos.push('najpierw kalendarz semestru (krok 1)');
  if (t.staleCohorts > 0) step7Todos.push(`„Generuj terminy” ${rocznikom(t.staleCohorts)} z nieaktualnymi terminami`);
  if (withoutOccurrences > 0) step7Todos.push(`„Generuj terminy” ${rocznikom(withoutOccurrences)} bez terminow`);
  // Terminy sa, ale nie wyczerpuja godzin programu (np. swieta wypadaja w inne dni niz rok temu).
  if (t.shortSections > 0) {
    step7Todos.push(
      `uzupelnij godziny ${plural(t.shortSections, 'zajeciom', 'zajeciom', 'zajeciom')} — terminy daja mniej godzin niz program (zmiana wzorca albo termin reczny)`,
    );
  }
  if (unpublished > 0) {
    step7Todos.push(`opublikuj ${plural(unpublished, 'kalendarz', 'kalendarze', 'kalendarzy')} w przygotowaniu`);
  }
  const generateFirst = t.staleCohorts > 0 || withoutOccurrences > 0;
  const step7State: StepState =
    step7Todos.length === 0 ? 'done' : visibleCalendars === 0 && data.cohorts.every((c) => c.occurrences === 0) ? 'todo' : 'warn';

  return [
    {
      n: 1,
      title: 'Kalendarz',
      state: data.missingCalendars > 0 || data.calendars.length === 0 ? 'todo' : 'done',
      summary: `${plural(data.calendars.length, 'kalendarz', 'kalendarze', 'kalendarzy')} · daty, przerwy, zjazdy`,
      todo:
        data.calendars.length === 0
          ? 'Utworz kalendarz semestru dla trybow studiow wydzialu'
          : data.missingCalendars > 0
            ? `Utworz kalendarz dla ${plural(data.missingCalendars, 'trybu', 'trybow', 'trybow')} bez kalendarza — roczniki tego trybu nie dostana terminow`
            : null,
      to: `/calendar/${termKey}`,
      link: 'Kalendarz semestru',
    },
    {
      n: 2,
      title: 'Roczniki i grupy',
      state: t.cohorts === 0 ? 'todo' : t.cohortsWithoutCalendar > 0 ? 'warn' : 'done',
      summary: `${cohortsN(t.cohorts)} w semestrze`,
      todo:
        t.cohorts === 0
          ? 'Zaloz nabor przyciskiem „Nowy nabor” — w semestrze nie ma rocznikow'
          : t.cohortsWithoutCalendar > 0
            ? `Wybierz kalendarz ${rocznikom(t.cohortsWithoutCalendar)} bez kalendarza`
            : null,
      to: `/cohorts/${termKey}`,
      link: 'Roczniki i grupy',
    },
    {
      n: 3,
      title: 'Programy zatwierdzone',
      state: t.cohorts === 0 || t.cohortsWithDraftVersion > 0 ? 'todo' : 'done',
      summary:
        t.cohortsWithDraftVersion > 0
          ? `${cohortsN(t.cohortsWithDraftVersion)} z wersja programu w projekcie`
          : 'Wszystkie roczniki korzystaja z zatwierdzonych wersji programu',
      todo:
        t.cohorts === 0
          ? 'Najpierw roczniki (krok 2)'
          : t.cohortsWithDraftVersion > 0
            ? 'Zatwierdz wersje programu — bez tego nie powstana zajecia ani plan'
            : null,
      to: '/curriculum',
      link: 'Programy studiow',
    },
    {
      n: 4,
      title: 'Zajecia',
      state: t.cohortsWithoutSections > 0 || noSections ? 'todo' : 'done',
      summary:
        t.cohortsWithEmptySemester > 0
          ? `${sectionsN(t.sections)} · ${cohortsN(t.cohortsWithEmptySemester)} bez przedmiotow w tym semestrze programu`
          : sectionsN(t.sections),
      todo:
        t.cohortsWithoutSections > 0
          ? `Zastosuj zmiany zajec na stronie Obsada — ${cohortsN(t.cohortsWithoutSections)} bez zajec`
          : noSections
            ? 'Zajecia powstaja same z programow i grup, gdy rocznik ma kalendarz i zatwierdzony program — sprawdz komunikat na stronie Obsada'
            : null,
      to: `/obsada/${termKey}`,
      link: 'Obsada',
    },
    {
      n: 5,
      title: 'Obsada',
      state: noSections ? 'todo' : t.vacancies > 0 ? 'warn' : 'done',
      summary: t.vacancies > 0 ? `${sectionsN(t.vacancies)} bez pelnej obsady (NN)` : noSections ? 'Brak zajec' : 'Wszystkie zajecia obsadzone',
      todo: noSections
        ? 'Najpierw zajecia (krok 4)'
        : t.vacancies > 0
          ? 'Uzupelnij prowadzacych — recznie, z CSV albo „Obsada z poprzedniego roku”'
          : null,
      // Braki -> od razu zakladka Zajecia z filtrem „Tylko braki”.
      to: t.vacancies > 0 ? `/obsada/${termKey}?widok=zajecia&braki=1` : `/obsada/${termKey}`,
      link: 'Obsada',
    },
    {
      n: 6,
      title: 'Plan (wzorzec)',
      state: noSections ? 'todo' : unplaced > 0 ? 'warn' : 'done',
      summary: `${t.placedSections}/${t.sections} zajec umieszczonych`,
      todo: noSections
        ? 'Najpierw zajecia (krok 4)'
        : unplaced > 0
          ? `Umiesc jeszcze ${sectionsN(unplaced)} (${cohortsN(unplacedCohorts)}) — mozesz zaczac od „Przenies plan z zeszlego roku”`
          : null,
      to: `/plan/${termKey}`,
      link: 'Ukladanie planu',
    },
    {
      n: 7,
      title: 'Terminy i publikacja',
      state: step7State,
      summary: `${
        data.cohorts.length === 0 || noSections
          ? 'Brak terminow'
          : t.staleCohorts > 0 || withoutOccurrences > 0
            ? 'Terminy do wygenerowania'
            : 'Terminy aktualne'
      } · opublikowane kalendarze: ${visibleCalendars}/${data.calendars.length}`,
      todo: step7Todos.length > 0 ? step7Todos.join('; ').replace(/^./, (c) => c.toUpperCase()) : null,
      // Najpierw terminy (z planu rocznika), potem publikacja kalendarza.
      to: generateFirst ? `/plan/${termKey}` : `/calendar/${termKey}`,
      link: generateFirst ? 'Generuj terminy w Ukladaniu planu' : 'Publikacja w kalendarzu',
    },
  ];
}
