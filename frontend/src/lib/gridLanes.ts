/**
 * Tory dla zajec rownoleglych w kolumnie dnia siatki planu. Czysta funkcja — bez DOM.
 *
 * Zajecia nakladajace sie (takze posrednio: A z B, B z C) tworza KLASTER. Caly klaster
 * dzieli kolumne na te sama liczbe torow, wiec kafelki w nim maja wspolna siatke szerokosci
 * (wczesniej szerokosc liczona tylko z bezposrednich sasiadow dawala mieszanke 1/2, 1/3, 1/4
 * i dziury). Kafelek rozszerza sie w prawo na tory, ktore w jego czasie sa wolne.
 *
 * Bloki sa liczone wlacznie (startOrder..endOrder), jak w umieszczeniach.
 */

export interface LaneItem {
  id: string;
  startOrder: number;
  endOrder: number;
}

export interface LanePlacement {
  /** Indeks pierwszego toru (od 0). */
  lane: number;
  /** Ile torow zajmuje kafelek (>= 1) — rozszerzenie na wolne tory obok. */
  span: number;
  /** Liczba torow w klastrze kafelka. */
  lanes: number;
}

const overlaps = (a: LaneItem, b: LaneItem) => a.startOrder <= b.endOrder && b.startOrder <= a.endOrder;

export function assignLanes(items: LaneItem[]): Map<string, LanePlacement> {
  const result = new Map<string, LanePlacement>();
  // Kolejnosc deterministyczna: start, dluzsze najpierw (laduja w lewych torach), id —
  // ten sam plan zawsze uklada sie tak samo.
  const sorted = [...items].sort(
    (a, b) => a.startOrder - b.startOrder || b.endOrder - a.endOrder || a.id.localeCompare(b.id),
  );

  let i = 0;
  while (i < sorted.length) {
    // Klaster: kolejne zajecia, dopoki zaczynaja sie przed koncem ktoregos z poprzednich.
    const cluster: LaneItem[] = [];
    let clusterEnd = -Infinity;
    while (i < sorted.length && (cluster.length === 0 || sorted[i]!.startOrder <= clusterEnd)) {
      cluster.push(sorted[i]!);
      clusterEnd = Math.max(clusterEnd, sorted[i]!.endOrder);
      i++;
    }

    // Zachlannie: pierwszy tor, w ktorym poprzednie zajecia juz sie skonczyly.
    const laneEnds: number[] = [];
    const laneOf = new Map<string, number>();
    for (const item of cluster) {
      let lane = laneEnds.findIndex((end) => end < item.startOrder);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.endOrder);
      } else laneEnds[lane] = item.endOrder;
      laneOf.set(item.id, lane);
    }
    const lanes = laneEnds.length;

    for (const item of cluster) {
      const lane = laneOf.get(item.id)!;
      let span = 1;
      // Rozszerzenie w prawo, dopoki sasiedni tor jest w tym czasie wolny.
      while (
        lane + span < lanes &&
        !cluster.some((o) => o !== item && laneOf.get(o.id) === lane + span && overlaps(o, item))
      ) {
        span++;
      }
      result.set(item.id, { lane, span, lanes });
    }
  }
  return result;
}
