import type { OccupancyResource } from '@/types';

/** Wiersz widoku zajetosci: sala albo prowadzacy. */
export interface OccupancyRow {
  /** Id zasobu — klucz indeksu pozycji (lib/occupancyView → indexEntries). */
  id: string;
  /** Pierwsza linia: numer sali / nazwisko i imie. */
  label: string;
  /** Druga linia: budynek i typ sali / tytul i katedra. */
  sublabel: string;
  /** Pelny opis do dymku: "Sala 101 — Budynek C" / "dr inz. Jan Kowalski · KEO-WE". */
  title: string;
  /** Liczba miejsc (tylko sala) — kolumna tabeli tygodnia i dopisek na osi dnia. */
  capacity?: number;
}

/** Napisy widokow zajetosci — sala jest „wolna”, prowadzacy „wolny”. */
export const RESOURCE_TEXT: Record<
  OccupancyResource,
  {
    column: string;
    sortTitle: string;
    free: string;
    weekAria: string;
    dayAria: string;
    pdf: string;
    busyTitle: string;
    conflictTitle: string;
    conflictLead: string;
  }
> = {
  room: {
    column: 'Sala',
    sortTitle: 'Sortuj wg budynku i numeru sali',
    free: 'wolna',
    weekAria: 'Zajetosc sal w tygodniu',
    dayAria: 'Zajetosc sal w dniu',
    pdf: 'Plan sali (PDF)',
    busyTitle: 'Godziny zegarowe zajete w tygodniu; procent wzgledem 60 h (pn–pt 8:00–20:00). Kliknij, by posortowac od najbardziej zajetych.',
    conflictTitle: 'Kolizja sali',
    conflictLead: 'W tym czasie sale zajmuje tez:',
  },
  instructor: {
    column: 'Prowadzacy',
    sortTitle: 'Sortuj wg nazwiska',
    free: 'wolny',
    weekAria: 'Zajetosc prowadzacych w tygodniu',
    dayAria: 'Zajetosc prowadzacych w dniu',
    pdf: 'Plan prowadzacego (PDF)',
    busyTitle: 'Godziny zegarowe zajec w tygodniu (zajecia laczone raz). Kliknij, by posortowac od najbardziej zajetych.',
    conflictTitle: 'Kolizja prowadzacego',
    conflictLead: 'W tym czasie prowadzacy ma tez:',
  },
};
