import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, History, Info, RefreshCw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/PageHeader';
import { FacultySelector } from '@/components/FacultySelector';
import { downloadSectionsCsv, fetchSections, syncSections } from '@/api/sections';
import { useCurrentTerm } from '@/hooks/useTerm';
import { getErrorMessage } from '@/lib/errors';
import { groupSections, type SectionGroup } from '@/lib/obsadaGroups';
import { syncNotice } from '@/lib/syncNotice';
import { useAuthStore } from '@/store/authStore';
import { useFacultyFilterStore } from '@/store/facultyStore';
import { CarryDialog, ImportDialog, SyncDialog } from './obsada/ObsadaDialogs';
import { GroupStaffDialog } from './obsada/GroupStaffDialog';
import SectionsTab from './obsada/SectionsTab';
import WorkloadTab from './obsada/WorkloadTab';
import OrdersTab from './obsada/OrdersTab';

/**
 * Obsada semestru — osobny etap przed ukladaniem planu. Dwie strony tych samych danych:
 *  - Obciazenia — od strony prowadzacych, tak jak przysylaja je katedry (katedra → osoba →
 *    przedmioty z grupami); stad wpisuje sie zajecia z arkuszy katedr,
 *  - Zajecia    — od strony zajec (przedmiot × forma z grupami): tu widac braki (NN, wakaty),
 *  - Zlecenia   — katedra kazdej formy przedmiotu (zlecenie wydzialu), braki i CSV dla katedry.
 * Lista zajec wynika z programow i grup rocznikow (synchronizacja): podglad liczy sie sam przy
 * wejsciu, a komunikat nad zakladkami pojawia sie tylko, gdy jest cos do zrobienia (nowy semestr,
 * zmiany programu lub grup, sprawy do wyjasnienia) — zmiany stosuje sie z okna podgladu. Obsade
 * mozna tez przeniesc z poprzedniego roku albo wczytac z CSV. Zakladka w adresie (?widok=zajecia / zlecenia).
 */

/** Procent obsady w dol — 100% dopiero przy pelnej obsadzie (99,99% to wciaz brakujace godziny). */
function staffedPercent(assigned: number, total: number): number {
  if (total <= 0) return 0;
  return assigned >= total ? 100 : Math.floor((100 * assigned) / total);
}

export default function ObsadaPage() {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const isAdmin = me?.role === 'ADMIN';
  const canEdit = isAdmin || (me?.role === 'DEAN_OFFICE' && !!me.facultyId);
  const facultyFilter = useFacultyFilterStore((s) => s.facultyId);
  const facultyId = isAdmin ? facultyFilter : undefined;
  // Wydzial widoku (dziekanat — swoj, admin — wybrany; null = cala uczelnia): katedry tego wydzialu
  // ida w wyborach na gore, katedry innych wydzialow osobno.
  const viewFacultyId = isAdmin ? (facultyFilter && facultyFilter !== 'all' ? facultyFilter : null) : (me?.facultyId ?? null);
  const { term } = useCurrentTerm();
  const [params, setParams] = useSearchParams();
  const VIEW_PARAM: Record<string, string> = { sections: 'zajecia', orders: 'zlecenia' };
  const tab = params.get('widok') === 'zajecia' ? 'sections' : params.get('widok') === 'zlecenia' ? 'orders' : 'workload';
  const setTab = (value: string) => setParams(VIEW_PARAM[value] ? { widok: VIEW_PARAM[value] } : {}, { replace: true });

  // Prowadzacy wybrany w Obciazeniach ("Pokaz w Zajeciach") — lista zajec pokazuje tylko jego zajecia.
  const [instructorFilter, setInstructorFilter] = useState<{ id: string; name: string } | null>(null);
  const [dialog, setDialog] = useState<'sync' | 'carry' | 'import' | null>(null);
  const [editing, setEditing] = useState<SectionGroup | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['sections', term?.key, facultyId],
    queryFn: () => fetchSections(term!.key, facultyId),
    enabled: !!term,
  });
  const groups = useMemo(() => groupSections(data?.rows ?? []), [data]);
  // Podglad synchronizacji (dryRun — bez blokady i bez zapisu) liczony przy kazdym wejsciu:
  // planista nie musi pamietac o synchronizacji po zmianie programu albo grup.
  const { data: syncReport } = useQuery({
    queryKey: ['sync-preview', term?.key, facultyId],
    queryFn: () => syncSections(term!.key, { facultyId, dryRun: true }).then((r) => r.data),
    enabled: !!term && canEdit,
  });

  const refresh = async () => {
    setDialog(null);
    setEditing(null);
    await queryClient.invalidateQueries({ queryKey: ['sections'] });
    await queryClient.invalidateQueries({ queryKey: ['workload'] });
    await queryClient.invalidateQueries({ queryKey: ['sync-preview'] });
  };

  const summary = data?.summary;
  const editable = canEdit && !summary?.archived;
  const notice = editable && data && syncReport ? syncNotice(syncReport, data.rows.length) : null;

  return (
    <>
      <PageHeader
        title="Obsada"
        description={
          term
            ? `Semestr ${term.label}: kto prowadzi zajecia — od strony prowadzacych (obciazenia z arkuszy katedr) i od strony zajec (braki).`
            : 'Wybierz semestr w naglowku.'
        }
        actions={
          <>
            {isAdmin && <FacultySelector />}
            {editable && term && (
              <>
                <Button variant="outline" onClick={() => setDialog('carry')}>
                  <History /> Obsada z poprzedniego roku
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => downloadSectionsCsv(term.key, facultyId).catch((e) => toast.error(getErrorMessage(e)))}
                >
                  <Download /> CSV
                </Button>
                <Button variant="ghost" onClick={() => setDialog('import')}>
                  <Upload /> Import
                </Button>
              </>
            )}
          </>
        }
      />
      {summary?.archived && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          Kalendarze rocznikow sa w archiwum — zajecia i obsada tego semestru sa tylko do odczytu.
        </p>
      )}
      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ['Zajec', summary.sections],
            ['Godzin', summary.hours],
            ['Obsadzonych godzin', `${summary.assignedHours} (${staffedPercent(summary.assignedHours, summary.hours)}%)`],
            ['Zajec z brakami', summary.vacancies],
            ['Osieroconych', summary.orphaned],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-xl font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
      )}
      {notice && (
        <Alert className={notice.kind === 'problems' ? undefined : 'border-primary/50'}>
          {notice.kind === 'problems' ? <Info /> : <RefreshCw className="text-primary" />}
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>
            <p>{notice.description}</p>
            <Button size="sm" variant={notice.kind === 'problems' ? 'outline' : 'default'} onClick={() => setDialog('sync')}>
              {notice.action}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {data && data.rows.length === 0 && notice?.kind !== 'create' && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          W tym semestrze nie ma jeszcze zajec. Powstaja z programow i grup rocznikow aktywnych w semestrze — gdy beda,
          tu pojawi sie „Utworz zajecia semestru”.
        </p>
      )}
      {isPending && term && <Skeleton className="h-64 w-full" />}

      {term && data && data.rows.length > 0 && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="workload">Obciazenia</TabsTrigger>
            <TabsTrigger value="sections">Zajecia</TabsTrigger>
            <TabsTrigger value="orders">Zlecenia dla katedr</TabsTrigger>
          </TabsList>
          <TabsContent value="workload" className="mt-4">
            <WorkloadTab
              viewFacultyId={viewFacultyId}
              termKey={term.key}
              facultyId={facultyId}
              groups={groups}
              canEdit={editable}
              onShowSections={(person) => {
                setInstructorFilter(person);
                setTab('sections');
              }}
              onChanged={refresh}
            />
          </TabsContent>
          <TabsContent value="sections" className="mt-4">
            <SectionsTab
              rows={data.rows}
              groups={groups}
              canEdit={canEdit}
              allStaffedOverall={summary?.vacancies === 0}
              instructorFilter={instructorFilter}
              onInstructorFilterChange={setInstructorFilter}
              onEdit={setEditing}
              scopeKey={`${term.key}|${facultyId}`}
            />
          </TabsContent>
          <TabsContent value="orders" className="mt-4">
            <OrdersTab termKey={term.key} viewFacultyId={viewFacultyId} groups={groups} canEdit={editable} onChanged={refresh} />
          </TabsContent>
        </Tabs>
      )}

      {term && dialog === 'sync' && (
        <SyncDialog termKey={term.key} facultyId={facultyId} initialReport={syncReport} onClose={() => setDialog(null)} onDone={refresh} />
      )}
      {term && dialog === 'carry' && <CarryDialog termKey={term.key} facultyId={facultyId} onClose={() => setDialog(null)} onDone={refresh} />}
      {term && dialog === 'import' && <ImportDialog termKey={term.key} facultyId={facultyId} onClose={() => setDialog(null)} onDone={refresh} />}
      {term && editing && <GroupStaffDialog termKey={term.key} group={editing} onClose={() => setEditing(null)} onDone={refresh} />}
    </>
  );
}
