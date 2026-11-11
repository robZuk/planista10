import type { PlanSection } from '@/types';

/**
 * Opis ostrzezenia na kafelku umieszczenia: jego wlasne niezgodnosci i niezgodnosci calych
 * zajec (grupa, obsada). null = kafelek bez znacznika.
 */
export function placementWarning(section: Pick<PlanSection, 'issues'>, placementId: string): string | null {
  const own = section.issues.filter((i) => i.placementId === placementId || i.placementId === null);
  return own.length > 0 ? own.map((i) => i.message).join('\n') : null;
}

export interface IssueRow {
  key: string;
  section: PlanSection;
  placementId: string | null;
  message: string;
}

/** Lista niezgodnosci planu (kolejnosc zajec jak na liscie), do ramki obok siatki. */
export function issueRows(sections: PlanSection[]): IssueRow[] {
  return sections.flatMap((s) =>
    s.issues.map((i, n) => ({ key: `${s.id}:${n}`, section: s, placementId: i.placementId, message: i.message })),
  );
}
