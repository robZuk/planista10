/**
 * Siatki godzin po stronie UI: minuty, przerwy miedzy blokami i generator blokow
 * (np. 45 min z przerwa 15 min co 2 bloki). Te same reguly co backend (lib/timeGrid.ts).
 */

export interface BlockTimes {
  startTime: string;
  endTime: string;
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function formatMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Problemy z blokami (jak backend lib/timeGrid.validateBlocks): blok konczacy sie przed
 * startem i bloki nachodzace na siebie. Edytor pokazuje je od razu i blokuje zapis.
 */
export function blockProblems(blocks: BlockTimes[]): string[] {
  const problems: string[] = [];
  for (const b of blocks) {
    if (toMinutes(b.startTime) >= toMinutes(b.endTime)) problems.push(`Blok ${b.startTime}-${b.endTime} konczy sie przed startem`);
  }
  const sorted = [...blocks].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (toMinutes(cur.startTime) < toMinutes(prev.endTime)) {
      problems.push(`Bloki ${prev.startTime}-${prev.endTime} i ${cur.startTime}-${cur.endTime} nachodza na siebie`);
    }
  }
  return problems;
}

/** Odstepy miedzy kolejnymi blokami (bloki w kolejnosci godzin). */
export function breaksBetween(blocks: BlockTimes[]): { afterIndex: number; start: string; end: string; minutes: number }[] {
  const out = [];
  for (let i = 1; i < blocks.length; i++) {
    const end = toMinutes(blocks[i - 1]!.endTime);
    const start = toMinutes(blocks[i]!.startTime);
    if (start > end) out.push({ afterIndex: i - 1, start: blocks[i - 1]!.endTime, end: blocks[i]!.startTime, minutes: start - end });
  }
  return out;
}

export interface GeneratorInput {
  start: string; // "08:00"
  length: number; // minuty bloku
  count: number; // ile blokow
  breakEvery: number; // przerwa po co N blokach (0 = bez przerw)
  breakMinutes: number;
}

/** Bloki od godziny startu, z przerwa po co `breakEvery` blokach; konczy przed polnoca. */
export function generateBlocks(input: GeneratorInput): BlockTimes[] {
  const blocks: BlockTimes[] = [];
  let t = toMinutes(input.start);
  for (let i = 0; i < input.count; i++) {
    if (t + input.length > 24 * 60) break;
    blocks.push({ startTime: formatMinutes(t), endTime: formatMinutes(t + input.length) });
    t += input.length;
    if (input.breakEvery > 0 && (i + 1) % input.breakEvery === 0) t += input.breakMinutes;
  }
  return blocks;
}

/** 1 blok, 2-4 bloki (poza 12-14), 5+ blokow. */
export function blocksWord(n: number): string {
  if (n === 1) return 'blok';
  const last = n % 10;
  const lastTwo = n % 100;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'bloki' : 'blokow';
}

/** Krotki opis siatki: "08:00-16:15 · 10 blokow po 45 min · 4 przerwy". */
export function describeGrid(blocks: BlockTimes[]): string {
  if (blocks.length === 0) return 'brak blokow';
  const lengths = [...new Set(blocks.map((b) => toMinutes(b.endTime) - toMinutes(b.startTime)))];
  const breaks = breaksBetween(blocks).length;
  return [
    `${blocks[0]!.startTime}-${blocks[blocks.length - 1]!.endTime}`,
    `${blocks.length} ${blocksWord(blocks.length)}${lengths.length === 1 ? ` po ${lengths[0]} min` : ''}`,
    breaks > 0 ? `przerwy: ${breaks}` : 'bez przerw',
  ].join(' · ');
}

export interface LayoutBlock {
  order: number;
  startTime: string;
  endTime: string;
}

export interface GridLayout {
  pxPerMinute: number;
  totalHeight: number;
  rows: { order: number; startTime: string; top: number; height: number }[];
  breaks: { top: number; height: number; minutes: number; start: string; end: string }[];
  /** Pozycja zakresu blokow startOrder..endOrder (null, gdy blokow nie ma w siatce). */
  span(startOrder: number, endOrder: number): { top: number; height: number } | null;
  /** Pozycja przedzialu minut (terminy niosa rzeczywisty czas). */
  spanMinutes(startMinute: number, endMinute: number): { top: number; height: number };
}

/**
 * Uklad siatki planu na osi minut: wysokosc bloku proporcjonalna do dlugosci, a skala tak
 * dobrana, zeby najkrotszy blok mial co najmniej `minBlockPx` (karta z opisem musi sie zmiescic).
 * `scaleBlocks` — bloki wszystkich dni widoku (siatki dnia maja wlasne bloki): wspolna skala,
 * poczatek i wysokosc, zeby kolumny dni byly wyrownane w czasie.
 */
export function gridLayout(
  blocks: LayoutBlock[],
  opts: { minBlockPx: number; minPxPerMinute: number; scaleBlocks?: BlockTimes[] },
): GridLayout {
  const sorted = [...blocks].sort((a, b) => a.order - b.order);
  const scale: BlockTimes[] = opts.scaleBlocks?.length ? opts.scaleBlocks : sorted;
  if (scale.length === 0) {
    return { pxPerMinute: opts.minPxPerMinute, totalHeight: 0, rows: [], breaks: [], span: () => null, spanMinutes: () => ({ top: 0, height: 0 }) };
  }
  const shortest = Math.min(...scale.map((b) => toMinutes(b.endTime) - toMinutes(b.startTime)));
  const pxPerMinute = Math.max(opts.minPxPerMinute, opts.minBlockPx / Math.max(shortest, 1));
  const origin = Math.min(...scale.map((b) => toMinutes(b.startTime)));
  const end = Math.max(...scale.map((b) => toMinutes(b.endTime)));
  const at = (minute: number) => Math.round((minute - origin) * pxPerMinute);
  const y = (time: string) => at(toMinutes(time));
  const rows = sorted.map((b) => ({ order: b.order, startTime: b.startTime, top: y(b.startTime), height: y(b.endTime) - y(b.startTime) }));
  const breaks = breaksBetween(sorted).map((br) => ({ top: y(br.start), height: y(br.end) - y(br.start), minutes: br.minutes, start: br.start, end: br.end }));
  const byOrder = new Map(sorted.map((b) => [b.order, b]));
  return {
    pxPerMinute,
    totalHeight: at(end),
    rows,
    breaks,
    span(startOrder, endOrder) {
      const s = byOrder.get(startOrder);
      const e = byOrder.get(endOrder);
      if (!s || !e || endOrder < startOrder) return null;
      return { top: y(s.startTime), height: y(e.endTime) - y(s.startTime) };
    },
    spanMinutes(startMinute, endMinute) {
      return { top: at(startMinute), height: at(endMinute) - at(startMinute) };
    },
  };
}

const WEEKDAY_OF_INDEX = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;

/** Dzien tygodnia daty "RRRR-MM-DD" (np. do wyboru blokow siatki dnia); null — niepelna data. */
export function dayOfDate(date: string): (typeof WEEKDAY_OF_INDEX)[number] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const index = new Date(`${date}T12:00:00Z`).getUTCDay();
  return Number.isNaN(index) ? null : WEEKDAY_OF_INDEX[index]!;
}

/**
 * Bloki obowiazujace w dniu tygodnia: siatka dnia, ktora ma ten dzien, albo podstawowa (takze
 * dla dni spoza siatek) — ta sama regula co backend (`gridSet.forDay`).
 */
export function blocksForDay<B>(timeGrid: { grids: { base: boolean; days: string[]; blocks: B[] }[] }, day: string): B[] {
  const grid = timeGrid.grids.find((g) => !g.base && g.days.includes(day)) ?? timeGrid.grids.find((g) => g.base) ?? timeGrid.grids[0];
  return grid?.blocks ?? [];
}

const SHORT_DAY: Record<string, string> = {
  MONDAY: 'pn',
  TUESDAY: 'wt',
  WEDNESDAY: 'sr',
  THURSDAY: 'czw',
  FRIDAY: 'pt',
  SATURDAY: 'sob',
  SUNDAY: 'nd',
};

/** Dni siatki z oknem godzin: "pn · wt · czw od 16:00 · nd do 18:00". */
export function describeDays(days: { day: string; from: string | null; to: string | null }[]): string {
  if (days.length === 0) return 'brak dni zajec';
  return days
    .map((d) => [SHORT_DAY[d.day] ?? d.day, d.from ? `od ${d.from}` : '', d.to ? `do ${d.to}` : ''].filter(Boolean).join(' '))
    .join(' · ');
}
