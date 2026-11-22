import { Link } from 'react-router-dom';
import { FileDown, LayoutGrid, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CLASS_FULL_LABELS } from '@/lib/scheduleDisplay';
import { formatMinutes } from '@/lib/timeGrid';
import { entrySummary, fullDate } from '@/lib/occupancyView';
import type { Faculty, OccupancyEntry, OccupancyResource } from '@/types';
import { dayLong } from './occupancyStyle';
import { RESOURCE_TEXT } from './resource';

/** Zasob okna (sala albo prowadzacy): opis w naglowku i wiersz w szczegolach. */
export interface EntrySubject {
  /** "sala 101 (Budynek C)" / "dr inz. Jan Kowalski". */
  heading: string;
  /** Wiersz szczegolow: "Sala" — "101 · 120 miejsc" / "Prowadzacy" — "dr inz. Jan Kowalski · KEO-WE". */
  label: string;
  value: string;
}

interface Props {
  resource: OccupancyResource;
  entry: OccupancyEntry | null;
  /** Inne pozycje tego samego zasobu nachodzace na `entry` (kolizja). */
  clashes: OccupancyEntry[];
  subject: EntrySubject | null;
  faculties: Faculty[];
  termKey: string;
  /** Czy wolno otworzyc plan rocznika tego wydzialu (admin — kazdy, dziekanat — swoj). */
  canOpenPlan: (facultyId: string) => boolean;
  /** Przed przejsciem do planu rocznika (admin: filtr wydzialu na wydzial rocznika). */
  onOpenPlan: (facultyId: string) => void;
  onPdf: () => void;
  pdfPending: boolean;
  onClose: () => void;
}

const KIND_LABEL = { CLASS: 'Zajecia z planu', MANUAL: 'Termin reczny (zajecia dodatkowe)', EXTERNAL: 'Zajetosc zewnetrzna (zgloszenie innego wydzialu)' };

/** Szczegoly zajec sali albo prowadzacego: kto, kiedy, gdzie, jakie grupy; skrot do planu rocznika i do PDF zasobu. */
export function EntryDialog({ resource, entry, clashes, subject, faculties, termKey, canOpenPlan, onOpenPlan, onPdf, pdfPending, onClose }: Props) {
  const text = RESOURCE_TEXT[resource];
  const shortOf = new Map(faculties.map((f) => [f.id, f.shortName]));
  // Rocznik raz, nawet gdy zajecia laczone maja w nim kilka grup; tylko roczniki, ktorych plan wolno otworzyc.
  const cohorts = entry
    ? [...new Map(entry.groups.filter((g) => canOpenPlan(g.facultyId)).map((g) => [g.cohortId, { label: g.label.split(' · ')[0] ?? g.label, facultyId: g.facultyId }])).entries()]
    : [];
  // Druga strona zajec: w widoku sal — prowadzacy, w widoku prowadzacych — sala.
  const other: { label: string; value: string } | null = !entry
    ? null
    : resource === 'room'
      ? entry.kind !== 'EXTERNAL' || entry.instructor
        ? { label: 'Prowadzacy', value: entry.instructor ?? 'NN (wakat)' }
        : null
      : entry.room
        ? { label: 'Sala', value: entry.room }
        : entry.kind !== 'EXTERNAL'
          ? { label: 'Sala', value: 'online (bez sali)' }
          : null;

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {entry && subject && (
          <>
            <DialogHeader className="pr-8">
              <DialogTitle>{entry.kind === 'EXTERNAL' ? 'Zajetosc zewnetrzna' : entry.title}</DialogTitle>
              <DialogDescription>
                {dayLong(entry.date)} {fullDate(entry.date)}, {formatMinutes(entry.startMinute)}–{formatMinutes(entry.endMinute)} · {subject.heading}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">{KIND_LABEL[entry.kind]}</Badge>
              {entry.classType && <Badge variant="outline">{CLASS_FULL_LABELS[entry.classType].toLowerCase()}</Badge>}
              {entry.joint && <Badge variant="outline">zajecia laczone · {entry.groups.length} gr.</Badge>}
            </div>

            <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2 text-sm">
              {entry.groups.length > 0 && (
                <>
                  <dt className="text-muted-foreground">{entry.groups.length > 1 ? 'Grupy' : 'Grupa'}</dt>
                  <dd>
                    {entry.groups.map((g) => (
                      <div key={`${g.cohortId}|${g.label}`}>{g.label}</div>
                    ))}
                  </dd>
                </>
              )}
              {other && (
                <>
                  <dt className="text-muted-foreground">{other.label}</dt>
                  <dd>{other.value}</dd>
                </>
              )}
              {entry.facultyIds.length > 0 && (
                <>
                  <dt className="text-muted-foreground">Wydzial</dt>
                  <dd>{entry.facultyIds.map((id) => shortOf.get(id) ?? '?').join(', ')}</dd>
                </>
              )}
              {entry.note && (
                <>
                  <dt className="text-muted-foreground">Opis</dt>
                  <dd>{entry.note}</dd>
                </>
              )}
              <dt className="text-muted-foreground">{subject.label}</dt>
              <dd>{subject.value}</dd>
            </dl>

            {entry.conflict && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>{text.conflictTitle}</AlertTitle>
                <AlertDescription>
                  <p>{text.conflictLead}</p>
                  <ul className="list-disc pl-4">
                    {clashes.map((c) => (
                      <li key={c.id}>
                        {entrySummary(c, resource, { withConflict: false })}
                        {c.facultyIds.length > 0 && ` (${c.facultyIds.map((id) => shortOf.get(id) ?? '?').join(', ')})`}
                      </li>
                    ))}
                  </ul>
                  <p>Przeloz zajecia w Ukladaniu planu albo popraw wpis zajetosci zewnetrznej.</p>
                </AlertDescription>
              </Alert>
            )}

            <DialogFooter className="flex-wrap gap-2 sm:justify-start">
              {entry.kind !== 'EXTERNAL' &&
                cohorts.map(([cohortId, cohort]) => (
                  <Button key={cohortId} variant="outline" asChild>
                    <Link to={`/plan/${termKey}?cohort=${cohortId}`} onClick={() => onOpenPlan(cohort.facultyId)}>
                      <LayoutGrid /> Plan {cohorts.length > 1 ? cohort.label : 'rocznika'}
                    </Link>
                  </Button>
                ))}
              <Button variant="outline" disabled={pdfPending} onClick={onPdf}>
                <FileDown /> {text.pdf}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
