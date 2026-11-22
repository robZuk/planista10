import { LEGEND } from './occupancyStyle';

/** Legenda kolorow pozycji (formy zajec, zajetosc zewnetrzna, kolizja) — wspolna dla sal i prowadzacych. */
export function OccupancyLegend() {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {LEGEND.map((l) => (
        <span key={l.label} className="flex items-center gap-1">
          <span className={`inline-block h-2.5 w-4 rounded-[2px] ${l.className}`} />
          {l.label}
        </span>
      ))}
    </span>
  );
}
