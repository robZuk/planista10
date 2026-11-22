import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CalendarPlus, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { PageHeader } from '@/components/PageHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FacultySelector } from '@/components/FacultySelector';
import {
  deleteTerm,
  deleteTermCalendar,
  fetchCalendarProposal,
  fetchCalendarUsage,
  fetchTermCalendars,
  setTermCalendarStatus,
} from '@/api/terms';
import { fetchFaculties } from '@/api/faculties';
import { TERMS_QUERY_KEY, useCurrentTerm } from '@/hooks/useTerm';
import { getErrorMessage } from '@/lib/errors';
import {
  CALENDAR_KIND_LABELS,
  CALENDAR_STATUS_LABELS,
  CALENDAR_STATUSES,
  STUDY_MODE_LABELS,
  STUDY_MODES,
} from '@/lib/labels';
import { useAuthStore } from '@/store/authStore';
import { useFacultyFilterStore } from '@/store/facultyStore';
import type { CalendarStatus, Faculty, StudyMode, TermCalendar } from '@/types';
import { CalendarEditorDialog, type EditorTarget } from './calendar/CalendarEditorDialog';
import { NewTermDialog } from './calendar/NewTermDialog';
import { calendarDayLabel, formatDayKey, formatRange } from './calendar/calendarUtils';
import { statusChangeWarning, usageNote } from './calendar/statusChange';
import { toDateKey } from '@/lib/scheduleDates';

const STATUS_VARIANT: Record<CalendarStatus, 'default' | 'secondary' | 'outline'> = {
  PLANNING: 'default',
  PUBLISHED: 'secondary',
  ARCHIVED: 'outline',
};
// Opublikowany na zielono: plan widza wszyscy.
const STATUS_CLASS: Partial<Record<CalendarStatus, string>> = {
  PUBLISHED: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
};

/**
 * Kalendarz semestru wydzialu: dla kazdego trybu studiow daty zajec, przerwy, wyjatki
 * dni i (dla niestacjonarnych) zjazdy. Semestr wybiera sie przelacznikiem w naglowku;
 * nowy kalendarz startuje z propozycji przeniesionej z tego samego semestru rok wczesniej.
 */
export default function TermCalendarPage() {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const isAdmin = me?.role === 'ADMIN';
  const { term, terms, isPending: termsPending } = useCurrentTerm();
  const facultyFilter = useFacultyFilterStore((s) => s.facultyId);

  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [deleting, setDeleting] = useState<TermCalendar | null>(null);
  // Usuwanie calego semestru (admin) — backend pozwala tylko na pusty: bez kalendarzy, naborow i zajec.
  const [deletingTerm, setDeletingTerm] = useState(false);
  const removeTerm = useMutation({
    mutationFn: () => deleteTerm(term!.key),
    onSuccess: async () => {
      toast.success(`Usunieto semestr ${term!.label}`);
      setDeletingTerm(false);
      // Adres wskazuje teraz nieistniejacy semestr — useCurrentTerm sam przejdzie na domyslny.
      await queryClient.invalidateQueries({ queryKey: TERMS_QUERY_KEY });
    },
    onError: (e) => toast.error(getErrorMessage(e), { duration: 10000 }),
  });
  // Przed usunieciem: czy roczniki maja juz plan na tym kalendarzu (wtedy usuniecie jest zablokowane).
  const { data: deletingUsage, isPending: usagePending } = useQuery({
    queryKey: ['calendar-usage', deleting?.id],
    queryFn: () => fetchCalendarUsage(deleting!.id),
    enabled: !!deleting,
    staleTime: 0,
  });
  // Zmiana statusu, ktora psuje dzialajacy plan (cofniecie publikacji, archiwum w trakcie semestru) — z potwierdzeniem.
  const [statusChange, setStatusChange] = useState<{ calendar: TermCalendar; status: CalendarStatus } | null>(null);
  const statusWarning = statusChange && statusChangeWarning(statusChange.calendar, statusChange.status, toDateKey(new Date()));
  const { data: statusUsage, isPending: statusUsagePending } = useQuery({
    queryKey: ['calendar-usage', statusChange?.calendar.id],
    queryFn: () => fetchCalendarUsage(statusChange!.calendar.id),
    enabled: !!statusWarning,
    staleTime: 0,
  });
  const [newTermOpen, setNewTermOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  const { data: faculties } = useQuery({ queryKey: ['faculties'], queryFn: fetchFaculties });
  const calendarsKey = ['term-calendars', term?.key, isAdmin ? facultyFilter : 'own'];
  const { data: calendars, isPending: calendarsPending } = useQuery({
    queryKey: calendarsKey,
    queryFn: () => fetchTermCalendars(term!.key, isAdmin ? facultyFilter : undefined),
    enabled: !!term,
  });

  // Wydzialy na stronie: admin — wybrany albo wszystkie; dziekanat — wlasny.
  const scopeFaculties = useMemo<Faculty[]>(() => {
    if (!faculties) return [];
    if (isAdmin) return facultyFilter === 'all' ? faculties : faculties.filter((f) => f.id === facultyFilter);
    return faculties.filter((f) => f.id === me?.facultyId);
  }, [faculties, isAdmin, facultyFilter, me?.facultyId]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['term-calendars'] });
    await queryClient.invalidateQueries({ queryKey: TERMS_QUERY_KEY });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CalendarStatus }) => setTermCalendarStatus(id, status),
    onSuccess: async ({ calendar, message, warning }) => {
      // Publikacja przelicza terminy — komunikat mowi ile, ostrzezenie: kolizje i braki godzin.
      const text = message || `Status: ${CALENDAR_STATUS_LABELS[calendar.status].toLowerCase()}`;
      if (warning) toast.warning(text, { description: warning, duration: 15000 });
      else toast.success(text);
      setStatusChange(null);
      await refresh();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTermCalendar(id),
    onSuccess: async () => {
      toast.success('Kalendarz usuniety');
      setDeleting(null);
      await refresh();
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  /** Nowy kalendarz zaczyna sie od propozycji z poprzedniego roku (albo domyslnych dat). */
  const openCreate = async (faculty: Faculty, studyMode: StudyMode, name: string) => {
    if (!term) return;
    const key = `${faculty.id}|${studyMode}|${name}`;
    setOpening(key);
    try {
      const proposal = await fetchCalendarProposal(term.key, {
        ...(isAdmin ? { facultyId: faculty.id } : {}),
        studyMode,
        name,
      });
      setEditor({ mode: 'create', facultyId: faculty.id, facultyName: faculty.name, studyMode, proposal });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setOpening(null);
    }
  };

  const canEdit = (calendar: TermCalendar) =>
    (isAdmin || calendar.facultyId === me?.facultyId) && calendar.status !== 'ARCHIVED';

  if (!isAdmin && !me?.facultyId) {
    return (
      <>
        <PageHeader title="Kalendarz semestru" />
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Konto bez przypisanego wydzialu</AlertTitle>
          <AlertDescription>
            Kalendarz semestru ustawia planista wydzialu. Popros administratora o przypisanie wydzialu do Twojego konta.
          </AlertDescription>
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Kalendarz semestru"
        description={
          term
            ? `Semestr ${term.label}: daty zajec, przerwy, dni wolne i zjazdy. Swieta ustawowe licza sie same.`
            : 'Wybierz semestr w naglowku.'
        }
        actions={
          isAdmin && (
            <>
              <FacultySelector />
              <Button variant="outline" onClick={() => setNewTermOpen(true)}>
                <CalendarPlus />
                Nowy semestr
              </Button>
              {term && (
                <Button variant="outline" className="text-destructive" onClick={() => setDeletingTerm(true)}>
                  <Trash2 />
                  Usun semestr
                </Button>
              )}
            </>
          )
        }
      />

      {(termsPending || (term && calendarsPending)) && <Skeleton className="h-48 w-full" />}

      {!termsPending && terms.length === 0 && (
        <Alert>
          <CalendarClock />
          <AlertTitle>Brak semestrow</AlertTitle>
          <AlertDescription>
            {isAdmin ? 'Utworz pierwszy semestr przyciskiem „Nowy semestr".' : 'Administrator nie utworzyl jeszcze semestrow.'}
          </AlertDescription>
        </Alert>
      )}

      {term &&
        calendars &&
        scopeFaculties.map((faculty) => (
          <section key={faculty.id} className="space-y-3">
            {scopeFaculties.length > 1 && <h2 className="font-heading text-lg font-semibold">{faculty.name}</h2>}
            <div className="grid gap-4 xl:grid-cols-2">
              {STUDY_MODES.map((studyMode) => {
                const own = calendars.filter((c) => c.facultyId === faculty.id && c.studyMode === studyMode);
                const createKey = `${faculty.id}|${studyMode}|Podstawowy`;
                return (
                  <div key={studyMode} className="space-y-3">
                    <h3 className="text-sm font-medium text-muted-foreground">{STUDY_MODE_LABELS[studyMode]}</h3>
                    {own.length === 0 ? (
                      <Card className="border-dashed">
                        <CardHeader>
                          <CardTitle>Brak kalendarza</CardTitle>
                          <CardDescription>
                            Zaloz kalendarz — dostaniesz propozycje dat z tego samego semestru rok wczesniej.
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <Button
                            onClick={() => openCreate(faculty, studyMode, 'Podstawowy')}
                            disabled={opening === createKey}
                          >
                            {opening === createKey ? <Spinner /> : <Plus />}
                            Utworz kalendarz
                          </Button>
                        </CardContent>
                      </Card>
                    ) : (
                      own.map((calendar) => (
                        <CalendarCard
                          key={calendar.id}
                          calendar={calendar}
                          editable={canEdit(calendar)}
                          canChangeStatus={isAdmin || (calendar.facultyId === me?.facultyId && calendar.status !== 'ARCHIVED')}
                          statusPending={statusMutation.isPending}
                          onEdit={() => setEditor({ mode: 'edit', calendar })}
                          onDelete={() => setDeleting(calendar)}
                          onStatus={(status) =>
                            statusChangeWarning(calendar, status, toDateKey(new Date()))
                              ? setStatusChange({ calendar, status })
                              : statusMutation.mutate({ id: calendar.id, status })
                          }
                        />
                      ))
                    )}
                    {own.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openCreate(faculty, studyMode, `Wariant ${own.length + 1}`)}
                      >
                        <Plus />
                        Dodaj wariant (np. inne zjazdy dla czesci kierunkow)
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

      {term && (
        <CalendarEditorDialog
          target={editor}
          term={term}
          isAdmin={isAdmin}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Usunac kalendarz?"
        description={
          deleting
            ? `${deleting.faculty.shortName} · ${STUDY_MODE_LABELS[deleting.studyMode]} · ${deleting.name} — ` +
              (usagePending
                ? 'sprawdzam, czy roczniki maja juz plan na tym kalendarzu...'
                : (deletingUsage?.deleteBlock ??
                  `razem z przerwami, wyjatkami dni i zjazdami.${
                    deletingUsage && deletingUsage.cohorts > 0
                      ? ` Korzystaja z niego roczniki (${deletingUsage.cohorts}, jeszcze bez planu) — po usunieciu przejda na inny wariant wydzialu albo zostana bez kalendarza.`
                      : ''
                  }`))
            : ''
        }
        isPending={deleteMutation.isPending}
        confirmDisabled={usagePending || !!deletingUsage?.deleteBlock}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />

      <ConfirmDialog
        open={!!statusWarning}
        onOpenChange={(open) => !open && setStatusChange(null)}
        title={statusWarning?.title ?? ''}
        description={
          statusChange && statusWarning
            ? `${statusChange.calendar.faculty.shortName} · ${STUDY_MODE_LABELS[statusChange.calendar.studyMode]} · ${statusChange.calendar.name}. ` +
              `${statusWarning.effect} ${usageNote(statusUsage, statusUsagePending)}`
            : ''
        }
        confirmLabel={statusWarning?.confirmLabel}
        isPending={statusMutation.isPending}
        onConfirm={() => statusChange && statusMutation.mutate({ id: statusChange.calendar.id, status: statusChange.status })}
      />

      <ConfirmDialog
        open={deletingTerm}
        onOpenChange={(open) => !open && setDeletingTerm(false)}
        title={`Usunac semestr ${term?.label ?? ''}?`}
        description="Usunac mozna tylko pusty semestr — np. zalozony przez pomylke. Gdy ma kalendarze wydzialow, nabor rocznikow albo zajecia, system odmowi i powie, co go blokuje."
        isPending={removeTerm.isPending}
        onConfirm={() => removeTerm.mutate()}
      />
      {isAdmin && newTermOpen && <NewTermDialog open={newTermOpen} onOpenChange={setNewTermOpen} terms={terms} />}
    </>
  );
}

interface CardProps {
  calendar: TermCalendar;
  editable: boolean;
  canChangeStatus: boolean;
  statusPending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onStatus: (status: CalendarStatus) => void;
}

function CalendarCard({ calendar, editable, canChangeStatus, statusPending, onEdit, onDelete, onStatus }: CardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {calendar.name}
          <Badge variant="outline">{CALENDAR_KIND_LABELS[calendar.kind]}</Badge>
          <Badge variant={STATUS_VARIANT[calendar.status]} className={STATUS_CLASS[calendar.status]}>{CALENDAR_STATUS_LABELS[calendar.status]}</Badge>
        </CardTitle>
        <CardDescription className="tabular-nums">{formatRange(calendar.startDate, calendar.endDate)}</CardDescription>
        <CardAction className="flex gap-1">
          {editable && (
            <>
              <Button variant="ghost" size="icon" className="size-8" aria-label="Edytuj kalendarz" onClick={onEdit}>
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive"
                aria-label="Usun kalendarz"
                onClick={onDelete}
              >
                <Trash2 />
              </Button>
            </>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span>
            <span className="font-semibold tabular-nums">{calendar.summary.teachingWeeks}</span> tygodni zajec
          </span>
          {calendar.kind === 'ZJAZD' && (
            <span>
              <span className="font-semibold tabular-nums">{calendar.summary.zjazdCount}</span> zjazdow
            </span>
          )}
          <span>
            <span className="font-semibold tabular-nums">{calendar.summary.teachingDays}</span> dni zajec
          </span>
        </div>
        {calendar.breaks.length > 0 && (
          <div>
            <span className="text-muted-foreground">Przerwy: </span>
            {calendar.breaks.map((b) => `${b.name} (${formatRange(b.startDate, b.endDate)})`).join(', ')}
          </div>
        )}
        {calendar.days.length > 0 && (
          <div>
            <span className="text-muted-foreground">Wyjatki dni: </span>
            {calendar.days
              .map(calendarDayLabel)
              .join(', ')}
          </div>
        )}
        {calendar.kind === 'ZJAZD' && calendar.zjazdy.length > 0 && (
          <div className="text-muted-foreground">
            Zjazdy: {calendar.zjazdy.map((z) => `tydz. ${z.week} (${formatDayKey(z.startDate)})`).join(', ')}
          </div>
        )}
        {canChangeStatus && (
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Status:</span>
            <NativeSelect
              aria-label="Status kalendarza"
              value={calendar.status}
              disabled={statusPending}
              onChange={(e) => onStatus(e.target.value as CalendarStatus)}
              className="w-48"
            >
              {CALENDAR_STATUSES.map((s) => (
                <NativeSelectOption key={s} value={s}>
                  {CALENDAR_STATUS_LABELS[s]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        )}
      </CardContent>
    </Card>
  );
}
