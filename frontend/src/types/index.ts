export type Role = 'ADMIN' | 'DEAN_OFFICE' | 'INSTRUCTOR' | 'STUDENT';

export interface StudentGroupRef {
  id: string;
  name: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  instructorId: string | null;
  facultyId: string | null;
  studentGroups: StudentGroupRef[];
}

/** Uzytkownik w widoku administracyjnym (lista /users) — bogatszy niz zalogowany User. */
export interface UserListItem {
  id: string;
  email: string;
  name: string;
  role: Role;
  instructorId: string | null;
  facultyId: string | null;
  createdAt: string;
  instructor: { id: string; firstName: string; lastName: string; title: string | null } | null;
  studentGroups: StudentGroupRef[];
}

export interface Faculty {
  id: string;
  name: string;
  shortName: string;
  createdAt: string;
}

/** Katedra (zaklad, studium) — przysyla obciazenia swoich prowadzacych; bez wydzialu = miedzywydzialowa (SJO). */
export interface Department {
  id: string;
  name: string;
  shortName: string;
  facultyId: string | null;
  faculty: Pick<Faculty, 'id' | 'name' | 'shortName'> | null;
  /** Liczba prowadzacych (lista katedr). */
  _count?: { instructors: number };
  createdAt: string;
}

export type RoomType = 'LECTURE' | 'EXERCISE' | 'LAB' | 'COMPUTER_LAB' | 'SEMINAR' | 'SPORTS';

export interface Room {
  id: string;
  number: string;
  type: RoomType;
  capacity: number;
  buildingId: string;
}

export interface Building {
  id: string;
  name: string;
  address: string | null;
  facultyId: string | null;
  faculty?: Faculty | null;
  rooms?: Room[];
  createdAt: string;
}

export interface Instructor {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  title: string | null;
  facultyId: string | null;
  faculty?: Faculty | null;
  departmentId: string | null;
  department?: Department | null;
  /** Konto logowania powiazane z prowadzacym (lista prowadzacych). */
  user?: { id: string; name: string; email: string } | null;
  createdAt: string;
}

export interface TimeBlock {
  id: string;
  order: number;
  startTime: string;
  endTime: string;
  label: string;
  createdAt?: string;
}

/** Dzien zajec siatki z opcjonalnym oknem godzin ("HH:MM"; null = bez ograniczenia). */
export interface GridDay {
  day: DayOfWeek;
  from: string | null;
  to: string | null;
}

/**
 * Siatka godzin wydzialu dla trybu studiow (kazdy wydzial: stacjonarna i niestacjonarna). `base` —
 * siatka podstawowa; pozostale to siatki dnia z wlasnymi blokami dla wybranych dni (np. piatek).
 */
export interface TimeGrid {
  id: string;
  faculty: { id: string; name: string; shortName: string };
  studyMode: StudyMode;
  base: boolean;
  days: GridDay[];
  blocks: TimeBlock[];
  breaks: { afterOrder: number; startMinute: number; endMinute: number; minutes: number }[];
  /** W dniach tej siatki jest plan biezacego semestru — bloki zablokowane (dni mozna zmieniac). */
  locked: boolean;
}

/** Siatki wydzialu i trybu rocznika w widoku planu: suma dni (z oknem godzin) i siatki z blokami. */
export interface PlanTimeGrid {
  studyMode: StudyMode;
  days: GridDay[];
  /** Podstawowa i siatki dnia; dzien spoza siatek liczy sie wg podstawowej. */
  grids: { id: string; base: boolean; days: DayOfWeek[]; blocks: TimeBlock[] }[];
}

export interface FieldOfStudy {
  id: string;
  name: string;
  shortName: string;
  facultyId: string;
  faculty?: Faculty;
  createdAt: string;
}

export interface Specialization {
  id: string;
  name: string;
  shortName: string;
  fieldOfStudyId: string;
  fieldOfStudy?: FieldOfStudy & { faculty?: Faculty };
  createdAt: string;
}

export interface Subject {
  id: string;
  name: string;
  code: string | null;
  createdAt: string;
  /** Liczba wpisow programow z tym przedmiotem (lista slownika). */
  _count?: { programEntries: number };
}

export type StudyMode = 'FULL_TIME' | 'PART_TIME';
export type DegreeLevel = 'BACHELOR' | 'MASTER';
export type AssessmentType = 'EXAM' | 'CREDIT';
export type SemesterType = 'WINTER' | 'SUMMER';

export type ClassType = 'LECTURE' | 'EXERCISE' | 'LAB' | 'PROJECT' | 'SEMINAR';
export type DayOfWeek = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

export interface RoomRef {
  id: string;
  number: string;
  type: RoomType;
  capacity: number;
  building: { id: string; name: string };
}

export interface PublicHoliday {
  id: string;
  date: string;
  name: string;
}

export interface UpcomingDayOff {
  id: string;
  kind: 'HOLIDAY' | 'BREAK' | 'DAY_OFF';
  name: string;
  /** YYYY-MM-DD */
  start: string;
  end: string;
  /** Kalendarze, ktorych dotyczy; null = wszystkie (i swieta ustawowe). */
  calendars: string[] | null;
}

export interface DashboardEntry {
  id: string;
  classType: ClassType;
  date: string;
  room: { number: string; building: { name: string } };
  instructor: { firstName: string; lastName: string; title: string | null } | null;
  studentGroup: { id: string; name: string } | null;
  curriculumEntry: { subject: { name: string } };
  startBlock: { order: number; startTime: string };
  endBlock: { order: number; endTime: string };
}

export interface DashboardStats {
  users: { total: number; byRole: Record<Role, number> };
  instructors: { total: number };
  groups: { total: number };
  students: { total: number };
  rooms: { total: number };
  buildings: { total: number };
  templates: { total: number };
  entries: { total: number; todayCount: number };
  faculties: { total: number };
  subjects: { total: number };
  calendars: { total: number };
  /** Zakres kafelkow: cala uczelnia (admin) albo wydzial dziekanatu. */
  scope: { kind: 'ALL' } | { kind: 'FACULTY'; name: string; shortName: string };
  todayEntries: DashboardEntry[];
  /** Biezacy tydzien (pon-nd), przyciety do roli: student/prowadzacy — tylko swoje, opublikowane. */
  weekEntries: DashboardEntry[];
  upcomingHolidays: PublicHoliday[];
  /** Karta planisty: swieta oraz przerwy i dni wolne kalendarzy (60 dni, zakres roli). */
  upcomingDaysOff: UpcomingDayOff[];
  recentUsers: { id: string; name: string; email: string; role: Role; createdAt: string }[];
}

/** Ksztalt odpowiedzi API: { data } lub { error }. */
export interface ApiOk<T> {
  data: T;
  message?: string;
}
export interface ApiError {
  error: string;
  details?: unknown;
}

// ─── Semestry i kalendarze (nowy model) ──────────────────────

export type CalendarKind = 'WEEKLY' | 'ZJAZD';
export type CalendarStatus = 'PLANNING' | 'PUBLISHED' | 'ARCHIVED';
export type CalendarDayKind = 'DAY_OFF' | 'FOLLOWS_WEEKDAY' | 'CLOSED_FROM';

/** Kalendarz w skrocie — tyle wystarcza przelacznikowi semestru. */
export interface TermCalendarRef {
  id: string;
  facultyId: string;
  studyMode: StudyMode;
  name: string;
  status: CalendarStatus;
  kind: CalendarKind;
}

export interface AcademicTerm {
  id: string;
  /** Klucz w adresie URL: "2026-Z" / "2026-L". */
  key: string;
  /** "2026/27 zimowy" */
  label: string;
  academicYear: string;
  startYear: number;
  type: SemesterType;
  ordinal: number;
  calendars: TermCalendarRef[];
}

export interface CalendarBreak {
  id?: string;
  name: string;
  startDate: string;
  endDate: string;
}

export interface CalendarDay {
  id?: string;
  date: string;
  kind: CalendarDayKind;
  name?: string | null;
  followsWeekday?: DayOfWeek | null;
  closedFromBlockOrder?: number | null;
}

export interface Zjazd {
  id?: string;
  /** Numer kolejny (umieszczenia wskazuja zjazdy tym numerem). */
  number: number;
  /** Etykieta „tydz. N”: numer tygodnia semestru, z lukami na przerwy (z API; formularz liczy sam). */
  week?: number;
  startDate: string;
  endDate: string;
}

/** Tresc kalendarza — to, co edytuje planista. */
export interface CalendarBody {
  name: string;
  kind: CalendarKind;
  startDate: string;
  endDate: string;
  breaks: CalendarBreak[];
  days: CalendarDay[];
  zjazdy: Zjazd[];
}

export interface CalendarSummary {
  teachingWeeks: number;
  teachingDays: number;
  zjazdCount: number;
}

export interface TermCalendar extends CalendarBody {
  id: string;
  termId: string;
  termKey: string;
  termLabel: string;
  facultyId: string;
  faculty: { id: string; name: string; shortName: string };
  studyMode: StudyMode;
  status: CalendarStatus;
  summary: CalendarSummary;
  updatedAt: string;
}

export interface TeachingWeek {
  index: number | null;
  monday: string;
  sunday: string;
  teachingDays: number;
  notes: string[];
  breakName: string | null;
}

export interface CalendarPreview extends Partial<CalendarSummary> {
  problems: string[];
  weeks?: TeachingWeek[];
  zjazdy?: (Zjazd & { teachingDays: number; notes: string[] })[];
  holidays?: { date: string; name: string }[];
}

export interface CalendarProposal {
  source: { termKey: string; termLabel: string; facultyName: string; name: string } | null;
  calendar: CalendarBody;
}

// ─── Programy studiow (nowy model) ───────────────────────────

export type ProgramVersionStatus = 'DRAFT' | 'APPROVED';

export interface ProgramVersionSummary {
  id: string;
  programId: string;
  label: string;
  status: ProgramVersionStatus;
  totalSemesters: number;
  defaultStartType: SemesterType;
  clonedFromId: string | null;
  clonedFrom: { id: string; label: string } | null;
  createdAt: string;
  updatedAt: string;
  _count: { entries: number };
}

export interface Program {
  id: string;
  code: string;
  name: string;
  fieldOfStudyId: string;
  degreeLevel: DegreeLevel;
  studyMode: StudyMode;
  fieldOfStudy: {
    id: string;
    name: string;
    shortName: string;
    facultyId: string;
    faculty: { id: string; name: string; shortName: string };
  };
  versions: ProgramVersionSummary[];
}

export interface ProgramEntry {
  id: string;
  versionId: string;
  subjectId: string;
  semester: number;
  specializationId: string | null;
  orderInSemester: number;
  hoursLecture: number;
  hoursExercise: number;
  hoursLab: number;
  hoursProject: number;
  hoursSeminar: number;
  ects: number;
  assessmentType: AssessmentType;
  subject: { id: string; name: string; code: string | null };
  specialization: { id: string; shortName: string; name: string } | null;
  /** Zajecia utworzone z tej pozycji: > 0 blokuje zmiane przedmiotu, specjalnosci, semestru i usuwanie. */
  _count: { sections: number };
}

export interface ProgramVersionDetail {
  version: Omit<ProgramVersionSummary, '_count'> & {
    /** Roczniki korzystajace z tej wersji (cofniecie do projektu blokuje ich plan). */
    cohorts: { id: string; label: string }[];
    program: {
      id: string;
      code: string;
      name: string;
      degreeLevel: DegreeLevel;
      studyMode: StudyMode;
      fieldOfStudy: {
        id: string;
        name: string;
        shortName: string;
        facultyId: string;
        faculty: { id: string; name: string; shortName: string };
        specializations: { id: string; name: string; shortName: string }[];
      };
    };
  };
  semesters: { semester: number; totalEcts: number; totalHours: number; entries: ProgramEntry[] }[];
  outOfRange: ProgramEntry[];
}

// ─── Roczniki i grupy (nowy model) ───────────────────────────

export type CohortLectureMode = 'SEPARATE' | 'JOINT';

export interface CohortDto {
  id: string;
  name: string | null;
  label: string;
  lectureMode: CohortLectureMode;
  startTermKey: string;
  startTermLabel: string;
  program: {
    id: string;
    code: string;
    name: string;
    studyMode: StudyMode;
    degreeLevel: DegreeLevel;
    fieldOfStudy: {
      id: string;
      name: string;
      shortName: string;
      facultyId: string;
      specializations: { id: string; name: string; shortName: string }[];
    };
  };
  programVersion: { id: string; label: string; status: ProgramVersionStatus; totalSemesters: number };
}

export interface TermCohort extends CohortDto {
  semester: number;
  studyYear: number;
  semesterOverridden: boolean;
  calendar: { id: string; name: string; kind: CalendarKind; status: CalendarStatus } | null;
  calendarIsDefault: boolean;
  availableCalendars: { id: string; name: string; kind: CalendarKind; status: CalendarStatus }[];
  groupCount: number;
  size: number;
}

export interface IntakeCandidate {
  id: string;
  code: string;
  name: string;
  studyMode: StudyMode;
}

export interface CohortGroup {
  id: string;
  parentId: string | null;
  partitionKey: string | null;
  code: string | null;
  specializationId: string | null;
  size: number;
  fromSemester: number;
  toSemester: number | null;
  active: boolean;
  name: string;
  memberCount: number;
  usedInPlan: boolean;
  childCount: number;
}

// ─── Zajecia semestru i obsada (nowy model) ─────────────────

export interface SectionAssignment {
  id: string;
  instructorId: string | null;
  name: string;
  hours: number;
}

export interface ClassSectionRow {
  id: string;
  /** archived: kalendarz rocznika w archiwum — zajecia i obsada tylko do odczytu. */
  cohort: { id: string; label: string; code: string; semester: number; archived: boolean };
  subject: { id: string; name: string; code: string | null };
  programEntryId: string;
  /** Wersja programu pozycji — link "pozycja w programie" ze strony Obsada. */
  programVersionId: string;
  /** Katedra prowadzaca te forme przedmiotu (z programu, zlecenie wydzialu); null = nieprzypisana. */
  department: { id: string; name: string; label: string } | null;
  order: number;
  /** Skrot specjalnosci przedmiotu (null = przedmiot wspolny dla kierunku). */
  specialization: string | null;
  specializationName: string | null;
  classType: ClassType;
  group: { id: string; partitionKey: string | null; name: string };
  hours: number;
  status: 'ACTIVE' | 'ORPHANED';
  assignedHours: number;
  hasVacancy: boolean;
  instructors: SectionAssignment[];
}

export interface SectionsSummary {
  sections: number;
  hours: number;
  assignedHours: number;
  vacancies: number;
  orphaned: number;
  /** Wszystkie roczniki widoku maja kalendarz w archiwum — akcje masowe niedostepne. */
  archived: boolean;
}

export interface SyncRow {
  cohortId?: string;
  cohort: string;
  subject: string;
  classType: ClassType;
  group: string;
  hours: number;
  oldHours?: number;
  fallback?: boolean;
  /** Obsada po zmianie godzin (przeskalowana do nowych godzin zajec). */
  instructors?: { name: string; hours: number }[];
}

export interface SyncReport {
  created: SyncRow[];
  hoursChanged: SyncRow[];
  reactivated: SyncRow[];
  orphaned: SyncRow[];
  deleted: SyncRow[];
  unchanged: number;
  problems: SyncProblem[];
  /** Tryb samoczynny: zmiany, ktore czekaja na decyzje (usuniecia, osierocenia, godziny zajec w planie). */
  pending?: number;
}

/**
 * Zajecia zmienione samoczynnie po zapisie naboru, grup, wersji programu albo kalendarza
 * (zmiany dodajace); `pending` — zmiany, ktore czekaja na podglad na stronie "Obsada".
 */
export interface AutoSyncSummary {
  created: number;
  reactivated: number;
  hoursChanged: number;
  pending: number;
}

export interface SyncProblem {
  /** Pelna etykieta rocznika ("EDST-N1 · nabor 2023/24 zimowy" albo nazwa wlasna). */
  cohort: string;
  cohortId: string;
  /** Semestr programu rocznika w synchronizowanym semestrze. */
  semester: number;
  subject: string;
  kind: 'NO_ROOT_GROUP' | 'MISSING_SPECIALIZATION_GROUP' | 'DRAFT_PROGRAM_VERSION' | 'ARCHIVED_CALENDAR';
  specialization: { id: string; shortName: string; name: string } | null;
  /** Wersja programu rocznika (DRAFT_PROGRAM_VERSION). */
  programVersion: { id: string; label: string } | null;
  message: string;
}

export interface CarryRow {
  sectionId: string;
  cohort: string;
  subject: string;
  classType: ClassType;
  group: string;
  hours: number;
  source?: string;
  instructors?: { name: string; hours: number }[];
}

/** Grupa zajec w obciazeniu osoby: jej godziny w grupie i godziny zajec grupy. */
export interface WorkloadGroup {
  sectionId: string;
  name: string;
  hours: number;
  sectionHours: number;
  /** Godziny liczone do obciazenia — 0, gdy te same zajecia sa laczone z inna pozycja (liczone raz). */
  countedHours: number;
  /** Zajecia laczone z ta grupa w planie (wspolny klucz) — np. "EDST-N1 · W". */
  jointWith: string[];
}

/** Przedmiot i forma w roczniku w obciazeniu osoby (np. cwiczenia 3 gr. × 15 h = 45 h). */
export interface WorkloadItem {
  key: string;
  cohort: { id: string; code: string; semester: number; label: string };
  subject: { id: string; name: string };
  order: number;
  classType: ClassType;
  studyMode: StudyMode;
  groups: WorkloadGroup[];
  hours: number;
}

/** Obciazenie prowadzacego w semestrze (Obsada → Obciazenia), jak w arkuszach katedr. */
export interface WorkloadPerson {
  id: string;
  name: string;
  department: { id: string; name: string; label: string } | null;
  /** Godziny na wybranym wydziale: razem, stacjonarne i niestacjonarne. */
  here: number;
  fullTime: number;
  partTime: number;
  /** Godziny w calej uczelni (z zajeciami innych wydzialow). */
  total: number;
  items: WorkloadItem[];
}

// ─── Plan (nowy model): umieszczenia i terminy ───────────────

export type PlacementCycle = 'WEEK' | 'ZJAZD';
export type PlacementPattern = 'ALL' | 'EVEN' | 'ODD' | 'LIST';

export interface PlanPlacement {
  id: string;
  dayOfWeek: DayOfWeek;
  startOrder: number;
  endOrder: number;
  /** null = zajecia online (bez sali). */
  room: { id: string; label: string } | null;
  instructor: { id: string; name: string } | null;
  cycle: PlacementCycle;
  pattern: PlacementPattern;
  numbers: number[];
  fromIndex: number | null;
  toIndex: number | null;
  jointKey: string | null;
  exceptionCount: number;
}

export interface PlanSection {
  id: string;
  subject: { id: string; name: string };
  order: number;
  specialization: string | null;
  classType: ClassType;
  /** ancestors: przodkowie grupy od korzenia (bez niej samej); size: liczebnosc grupy. */
  group: { id: string; name: string; size: number; ancestors: { id: string; name: string }[] };
  hours: number;
  plannedHours: number;
  /** Ostatnia data, na ktora starcza godzin (umieszczenia + terminy reczne); null = brak terminow. */
  endsOn: string | null;
  status: 'ACTIVE' | 'ORPHANED';
  instructors: { instructorId: string | null; name: string; hours: number }[];
  placements: PlanPlacement[];
  /** Niezgodnosci powstale po umieszczeniu (obsada, sala, grupa, godziny) — backend lib/planIssues. */
  issues: PlanIssue[];
}

export interface PlanIssue {
  kind: 'INSTRUCTOR_NOT_STAFFED' | 'ROOM_TYPE' | 'ROOM_CAPACITY' | 'GROUP_INACTIVE' | 'STAFF_HOURS' | 'OUTSIDE_GRID' | 'MISSING_PERIODS';
  /** null = problem zajec (grupa, obsada), nie jednego umieszczenia. */
  placementId: string | null;
  message: string;
}

/** Powod nieaktualnych terminow: zmiana wzorca, zmiana godzin zajec, usuniete umieszczenie. */
export type StaleReason = 'PLACEMENTS' | 'SECTIONS' | 'DELETED' | 'CALENDAR';

export interface PlanView {
  cohort: {
    id: string;
    label: string;
    code: string;
    semester: number;
    studyMode: StudyMode;
    programVersion: { id: string; label: string; status: ProgramVersionStatus };
  };
  calendar: {
    id: string;
    name: string;
    kind: CalendarKind;
    status: CalendarStatus;
    lastGeneratedAt: string | null;
    /** Ostatni dzien semestru wg kalendarza rocznika. */
    endDate: string;
    teachingWeeks: number;
    /** `week` — etykieta „tydz. N” (numer tygodnia semestru); `number` — numer w umieszczeniach. */
    zjazdy: { number: number; week: number; startDate: string; endDate: string }[];
    /** Tygodnie (pn-nd) albo zjazdy z dniami wolnymi — widok tygodnia w "Terminach". */
    periods: CalendarPeriod[];
  } | null;
  /** Siatki godzin wydzialu i trybu rocznika: dni zajec i bloki (podstawowa + siatki dnia). */
  timeGrid: PlanTimeGrid;
  stale: boolean;
  staleReasons: StaleReason[];
  /** Wszystkie terminy rocznika w semestrze (z wzorca i reczne). */
  occurrenceCount: number;
  sections: PlanSection[];
}

export interface PlacementPayload {
  sectionId: string;
  dayOfWeek: DayOfWeek;
  startOrder: number;
  endOrder: number;
  /** null = zajecia online (bez sali). */
  roomId: string | null;
  instructorId: string | null;
  cycle: PlacementCycle;
  pattern: PlacementPattern;
  numbers: number[];
  fromIndex: number | null;
  toIndex: number | null;
  jointKey: string | null;
}

export interface GenerateReport {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  total: number;
  conflicts: { date: string; section: string; reason: string; with: string }[];
  beyondHours: number;
  shortfalls: { section: string; missing: number }[];
  orphanExceptions: { section: string; date: string }[];
  calendarsMissing: string[];
  /** Roczniki pominiete, bo ich wersja programu jest w projekcie. */
  draftVersions: string[];
}

export interface PeriodDay {
  date: string;
  dayOfWeek: DayOfWeek;
  teaching: boolean;
  /** Swieto, przerwa, dzien wolny albo nazwa zmiany dnia. */
  label: string | null;
  /** Zajecia wg planu innego dnia tygodnia. */
  followsWeekday: DayOfWeek | null;
  closedFromBlockOrder: number | null;
}

export interface CalendarPeriod {
  /** Numer tygodnia zajec / zjazdu; null = tydzien w przerwie. */
  index: number | null;
  label: string;
  from: string;
  to: string;
  days: PeriodDay[];
}

export interface OccurrenceRow {
  id: string;
  sectionId: string;
  placementId: string | null;
  date: string;
  originalDate: string | null;
  startOrder: number;
  endOrder: number;
  /** Rzeczywisty czas terminu (minuty od polnocy). */
  startMinute: number;
  endMinute: number;
  subject: string;
  classType: ClassType;
  group: string;
  groupId: string;
  /** id = null -> zajecia online (label "ON-LINE"). */
  room: { id: string | null; label: string };
  instructor: string;
  instructorId: string | null;
  kind: 'DERIVED' | 'MANUAL';
  changed: boolean;
  note: string | null;
}

// ─── Etap 6: przenoszenie planu, przygotowanie semestru, moj plan ──

export interface CarryPlanRow {
  cohort: string;
  subject: string;
  classType: ClassType;
  group: string;
  source?: string;
  problem?: string;
}

export interface CarryPlanReport {
  created: CarryPlanRow[];
  conflicts: CarryPlanRow[];
  unmatched: CarryPlanRow[];
  skipped: number;
  sources: { cohort: string; source: string | null }[];
}

export interface SetupCohort {
  id: string;
  label: string;
  code: string;
  program: {
    code: string;
    name: string;
    studyMode: StudyMode;
    degreeLevel: DegreeLevel;
    fieldOfStudy: { id: string; name: string; shortName: string };
  };
  semester: number;
  programVersion: { id: string; label: string; status: ProgramVersionStatus };
  calendar: { name: string; status: CalendarStatus } | null;
  groups: number;
  /** Przedmioty programu w semestrze rocznika (0 = np. sama praktyka — zajec nie bedzie). */
  programEntries: number;
  sections: number;
  vacancies: number;
  placedSections: number;
  occurrences: number;
  /** Ulozone zajecia, ktorych terminy maja mniej godzin niz program (0, gdy terminow jeszcze nie ma). */
  shortSections: number;
  stale: boolean;
  /** Powody nieaktualnych terminow — te same co w "Ukladaniu planu". */
  staleReasons: StaleReason[];
}

export interface SetupStatus {
  calendars: { id: string; facultyId: string; studyMode: StudyMode; name: string; kind: CalendarKind; status: CalendarStatus }[];
  missingCalendars: number;
  cohorts: SetupCohort[];
  totals: {
    cohorts: number;
    cohortsWithoutCalendar: number;
    cohortsWithDraftVersion: number;
    cohortsWithoutSections: number;
    /** Roczniki, ktorych program nie ma przedmiotow w ich semestrze — nie sa zaleglosci. */
    cohortsWithEmptySemester: number;
    sections: number;
    vacancies: number;
    placedSections: number;
    staleCohorts: number;
    shortSections: number;
    published: number;
  };
}

export interface MyPlanRow {
  id: string;
  date: string;
  startOrder: number;
  endOrder: number;
  /** Rzeczywisty czas terminu — plan moze laczyc wydzialy z roznymi siatkami godzin. */
  startMinute: number;
  endMinute: number;
  subject: string;
  classType: ClassType;
  program: string;
  /** Nazwa grupy na semestr rocznika (jak w Ukladaniu planu), np. "DUT-1-C-A". */
  group: string;
  room: string;
  instructor: string;
  note: string | null;
}
