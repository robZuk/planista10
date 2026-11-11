import {
  Building2,
  CalendarDays,
  CalendarRange,
  Clock,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  School,
  ShieldCheck,
  Table2,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/types';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Role, ktore widza ten link. */
  roles: Role[];
  /** Slowa kluczowe dla palety polecen (Ctrl+K) — poza samym labelem. */
  keywords?: string[];
  /**
   * Strona dziala w kontekscie semestru: adres ma postac `${to}/:termKey`, a w naglowku
   * pojawia sie przelacznik semestru. Strony bez tej flagi nie zaleza od czasu.
   */
  termScoped?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Jedno zrodlo prawdy dla nawigacji: sidebar, breadcrumbs i paleta polecen
 * czytaja z tej samej struktury. Dodanie strony = dopisanie jednego wpisu.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Planowanie',
    items: [
      {
        to: '/',
        label: 'Panel glowny',
        icon: LayoutDashboard,
        roles: ['ADMIN', 'DEAN_OFFICE', 'INSTRUCTOR', 'STUDENT'],
        keywords: ['dashboard', 'start', 'statystyki'],
      },
      {
        to: '/setup',
        label: 'Przygotowanie semestru',
        icon: ListChecks,
        roles: ['ADMIN', 'DEAN_OFFICE'],
        keywords: ['lista kontrolna', 'postep', 'nowy semestr', 'publikacja'],
        termScoped: true,
      },
      {
        to: '/my-plan',
        label: 'Moj plan',
        icon: CalendarDays,
        roles: ['INSTRUCTOR', 'STUDENT'],
        keywords: ['plan', 'zajecia', 'tydzien'],
        termScoped: true,
      },
      {
        to: '/requests',
        label: 'Zgloszenia zmian',
        icon: Inbox,
        roles: ['ADMIN', 'DEAN_OFFICE', 'INSTRUCTOR'],
        keywords: ['odwolanie', 'przeniesienie', 'odrobienie', 'prosba', 'zgloszenie', 'powiadomienia'],
        termScoped: true,
      },
      {
        to: '/curriculum',
        label: 'Programy studiow',
        icon: Table2,
        roles: ['ADMIN', 'DEAN_OFFICE', 'INSTRUCTOR'],
        keywords: ['siatka godzin', 'program', 'przedmioty', 'ects', 'kierunki', 'wersje'],
      },
      {
        to: '/calendar',
        label: 'Kalendarz semestru',
        icon: CalendarRange,
        roles: ['ADMIN', 'DEAN_OFFICE'],
        keywords: ['semestr', 'daty', 'tygodnie', 'przerwy', 'zjazdy', 'swieta', 'dni wolne'],
        termScoped: true,
      },
      {
        to: '/cohorts',
        label: 'Roczniki i grupy',
        icon: Users,
        roles: ['ADMIN', 'DEAN_OFFICE'],
        keywords: ['grupy', 'studenci', 'podgrupy', 'nabor', 'specjalnosci'],
        termScoped: true,
      },
      {
        to: '/obsada',
        label: 'Zajecia i obsada',
        icon: UserCheck,
        roles: ['ADMIN', 'DEAN_OFFICE'],
        keywords: ['obsada', 'synchronizacja', 'prowadzacy', 'przydzial', 'pensum', 'obciazenie', 'katedry', 'NN'],
        termScoped: true,
      },
      {
        to: '/plan',
        label: 'Ukladanie planu',
        icon: LayoutGrid,
        roles: ['ADMIN', 'DEAN_OFFICE'],
        keywords: ['wzorzec', 'umieszczenie', 'terminy', 'generuj', 'zjazdy'],
        termScoped: true,
      },
    ],
  },
  {
    label: 'Zasoby',
    items: [
      {
        to: '/faculties',
        label: 'Wydzialy',
        icon: School,
        roles: ['ADMIN', 'DEAN_OFFICE'],
      },
      {
        to: '/buildings',
        label: 'Budynki i sale',
        icon: Building2,
        roles: ['ADMIN', 'DEAN_OFFICE'],
        keywords: ['pokoje', 'laboratoria', 'pojemnosc'],
      },
      {
        to: '/instructors',
        label: 'Prowadzacy',
        icon: GraduationCap,
        roles: ['ADMIN', 'DEAN_OFFICE', 'INSTRUCTOR'],
        keywords: ['wykladowcy', 'kadra'],
      },
    ],
  },
  {
    label: 'Ustawienia',
    items: [
      {
        to: '/time-grids',
        label: 'Siatki godzin',
        icon: Clock,
        roles: ['ADMIN'],
        keywords: ['godziny', 'dzwonki', 'bloki', 'przerwy', 'dni zajec'],
      },
      {
        to: '/users',
        label: 'Uzytkownicy',
        icon: ShieldCheck,
        roles: ['ADMIN'],
        keywords: ['konta', 'role', 'impersonacja'],
      },
    ],
  },
];

/** Plaska lista wszystkich pozycji — wygodna do breadcrumbow i wyszukiwania. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** Grupy przefiltrowane pod role; grupy bez widocznych pozycji znikaja w calosci. */
export function visibleGroups(role: Role | undefined): NavGroup[] {
  if (!role) return [];
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.includes(role)),
  })).filter((group) => group.items.length > 0);
}

/**
 * Sciezka breadcrumbow dla adresu: [nazwa grupy, nazwa strony].
 * Dopasowanie po prefiksie, zeby /plan/2026-L tez trafil w "Ukladanie planu".
 */
export function breadcrumbFor(pathname: string): { group: string; item: NavItem } | null {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const matches = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to);
      if (matches) return { group: group.label, item };
    }
  }
  return null;
}

/** Pozycja nawigacji dzialajaca w kontekscie semestru, w ktorej jest adres (albo null). */
export function termScopedItemFor(pathname: string): NavItem | null {
  const crumb = breadcrumbFor(pathname);
  return crumb?.item.termScoped ? crumb.item : null;
}

/** Klucz semestru z adresu strony semestralnej: "/calendar/2026-L" -> "2026-L". */
export function termKeyFromPath(pathname: string, item: NavItem): string | null {
  const rest = pathname.slice(item.to.length).split('/').filter(Boolean);
  return rest[0] ?? null;
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  DEAN_OFFICE: 'Dziekanat',
  INSTRUCTOR: 'Prowadzacy',
  STUDENT: 'Student',
};
