import type {
  AssessmentType,
  CalendarDayKind,
  CalendarKind,
  CalendarStatus,
  DayOfWeek,
  DegreeLevel,
  RoomType,
  SemesterType,
  StudyMode,
} from '@/types';

/** Polskie nazwy typow sal (backend trzyma enumy po angielsku). */
export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  LECTURE: 'Wykladowa',
  EXERCISE: 'Cwiczeniowa',
  LAB: 'Laboratorium',
  COMPUTER_LAB: 'Pracownia komputerowa',
  SEMINAR: 'Seminaryjna',
  SPORTS: 'Sportowa',
};

export const ROOM_TYPES = Object.keys(ROOM_TYPE_LABELS) as RoomType[];

export const STUDY_MODE_LABELS: Record<StudyMode, string> = {
  FULL_TIME: 'Stacjonarne',
  PART_TIME: 'Niestacjonarne',
};

export const STUDY_MODES = Object.keys(STUDY_MODE_LABELS) as StudyMode[];

export const DEGREE_LEVEL_LABELS: Record<DegreeLevel, string> = {
  BACHELOR: 'I stopnia (inz./lic.)',
  MASTER: 'II stopnia (mgr)',
};

export const DEGREE_LEVELS = Object.keys(DEGREE_LEVEL_LABELS) as DegreeLevel[];

/** Semestr startu naboru (wersja programu: od ktorego semestru zwykle rusza rocznik). */
export const SEMESTER_TYPE_LABELS: Record<SemesterType, string> = {
  WINTER: 'Zimowy',
  SUMMER: 'Letni',
};

export const SEMESTER_TYPES = Object.keys(SEMESTER_TYPE_LABELS) as SemesterType[];

export const ASSESSMENT_TYPE_LABELS: Record<AssessmentType, string> = {
  EXAM: 'Egzamin',
  CREDIT: 'Zaliczenie',
};

export const ASSESSMENT_TYPES = Object.keys(ASSESSMENT_TYPE_LABELS) as AssessmentType[];


export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
  WEEKLY: 'Tygodniowy',
  ZJAZD: 'Zjazdowy',
};

export const CALENDAR_STATUS_LABELS: Record<CalendarStatus, string> = {
  PLANNING: 'W przygotowaniu',
  PUBLISHED: 'Opublikowany',
  ARCHIVED: 'Archiwum',
};

export const CALENDAR_STATUSES = Object.keys(CALENDAR_STATUS_LABELS) as CalendarStatus[];

export const CALENDAR_DAY_KIND_LABELS: Record<CalendarDayKind, string> = {
  DAY_OFF: 'Dzien wolny',
  FOLLOWS_WEEKDAY: 'Zajecia wg planu innego dnia',
  CLOSED_FROM: 'Godziny rektorskie (od bloku)',
};

export const CALENDAR_DAY_KINDS = Object.keys(CALENDAR_DAY_KIND_LABELS) as CalendarDayKind[];

export const WEEKDAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: 'Poniedzialek',
  TUESDAY: 'Wtorek',
  WEDNESDAY: 'Sroda',
  THURSDAY: 'Czwartek',
  FRIDAY: 'Piatek',
  SATURDAY: 'Sobota',
  SUNDAY: 'Niedziela',
};

export const WEEKDAYS = Object.keys(WEEKDAY_LABELS) as DayOfWeek[];
