import { z, type ZodType } from 'zod';
import { loginSchema, refreshSchema } from './schemas/auth';
import { facultyCreateSchema, facultyUpdateSchema } from './schemas/faculty';
import { subjectCreateSchema } from './schemas/subject';
import { fieldOfStudyCreateSchema } from './schemas/fieldOfStudy';
import { specializationCreateSchema } from './schemas/specialization';
import { instructorCreateSchema, instructorUpdateSchema } from './schemas/instructor';
import {
  buildingCreateSchema,
  buildingUpdateSchema,
  roomCreateSchema,
  roomUpdateSchema,
} from './schemas/building';
import { calendarBodySchema, calendarCreateSchema, calendarPreviewSchema, calendarStatusSchema, termCreateSchema } from './schemas/termCalendar';
import { programCreateSchema, programEntrySchema, versionCreateSchema, versionUpdateSchema } from './schemas/program';
import { userCreateSchema, userUpdateSchema } from './schemas/user';
import { timeGridCreateSchema, timeGridUpdateSchema } from './schemas/timeGrid';

/**
 * Specyfikacja OpenAPI 3.1 serwowana przez Swagger UI (/api/docs).
 *
 * JEDNO ZRODLO PRAWDY: schematy request body sa te SAME co w walidacji wejscia
 * (middleware/validate.ts) — konwertowane do JSON Schema przez wbudowane w zod 4
 * `z.toJSONSchema`. Zmiana schematu zod = automatyczna zmiana w dokumentacji, bez dryfu.
 */

// Pola email z zod dostaja w JSON Schema dlugi `pattern` (regex) — Swagger UI robi z
// niego monstrualny "przykladowy" string. Usuwamy pattern, zostawiajac `format: email`,
// dzieki czemu UI generuje czytelne `user@example.com`.
function stripEmailPattern(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (obj.format === 'email' && 'pattern' in obj) delete obj.pattern;
  for (const value of Object.values(obj)) stripEmailPattern(value);
}

// zod -> JSON Schema; usuwamy klucz $schema, ktorego OpenAPI components nie potrzebuje.
function toJson(schema: ZodType): Record<string, unknown> {
  const s = z.toJSONSchema(schema) as Record<string, unknown>;
  delete s.$schema;
  stripEmailPattern(s);
  return s;
}

const schemas = {
  LoginRequest: toJson(loginSchema),
  RefreshRequest: toJson(refreshSchema),
  FacultyCreate: toJson(facultyCreateSchema),
  FacultyUpdate: toJson(facultyUpdateSchema),
  SubjectCreate: toJson(subjectCreateSchema),
  FieldOfStudyCreate: toJson(fieldOfStudyCreateSchema),
  SpecializationCreate: toJson(specializationCreateSchema),
  TimeGridUpdate: toJson(timeGridUpdateSchema),
  TimeGridCreate: toJson(timeGridCreateSchema),
  InstructorCreate: toJson(instructorCreateSchema),
  InstructorUpdate: toJson(instructorUpdateSchema),
  BuildingCreate: toJson(buildingCreateSchema),
  BuildingUpdate: toJson(buildingUpdateSchema),
  RoomCreate: toJson(roomCreateSchema),
  RoomUpdate: toJson(roomUpdateSchema),
  TermCreate: toJson(termCreateSchema),
  CalendarBody: toJson(calendarBodySchema),
  CalendarCreate: toJson(calendarCreateSchema),
  CalendarPreview: toJson(calendarPreviewSchema),
  CalendarStatus: toJson(calendarStatusSchema),
  ProgramCreate: toJson(programCreateSchema),
  VersionCreate: toJson(versionCreateSchema),
  VersionUpdate: toJson(versionUpdateSchema),
  ProgramEntry: toJson(programEntrySchema),
  UserCreate: toJson(userCreateSchema),
  UserUpdate: toJson(userUpdateSchema),
  // Wspolny ksztalt bledu z centralnego errorHandler.
  ErrorResponse: {
    type: 'object',
    properties: {
      error: { type: 'string', description: 'Komunikat lub kod bledu' },
      details: { type: 'object', additionalProperties: true, description: 'Opcjonalne szczegoly (np. konflikt)' },
    },
    required: ['error'],
  },
} as const;

// ─── Helpery skracajace definicje sciezek ────────────────────
const ref = (name: keyof typeof schemas) => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (name: keyof typeof schemas) => ({
  required: true,
  content: { 'application/json': { schema: ref(name) } },
});
const dataResp = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: { type: 'object', properties: { data: {}, message: { type: 'string' } } },
    },
  },
});
const errResp = (description: string) => ({
  description,
  content: { 'application/json': { schema: ref('ErrorResponse') } },
});
const bearer = [{ bearerAuth: [] as string[] }];
const pathId = (name = 'id') => ({ name, in: 'path', required: true, schema: { type: 'string' } });
const termKey = { name: 'key', in: 'path', required: true, description: 'Semestr, np. 2026-Z / 2026-L', schema: { type: 'string' } };
const dateQ = (name: string) => ({ name, in: 'query', schema: { type: 'string', format: 'date' } });

/** Standardowe 401/403 dla tras chronionych. */
const authErrors = { 401: errResp('Brak lub niewazny token'), 403: errResp('Brak uprawnien') };

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Planista API',
    version: '1.0.0',
    description:
      'API systemu ukladania planu zajec. Wszystkie trasy pod `/api/*` wymagaja tokenu JWT ' +
      '(naglowek `Authorization: Bearer <token>`) — uzyj "Authorize" powyzej. Schematy request ' +
      'body sa generowane z tych samych schematow zod, ktore waliduja wejscie.',
  },
  servers: [{ url: '/', description: 'Ten sam origin co aplikacja' }],
  tags: [
    { name: 'Auth', description: 'Logowanie, odswiezanie tokenu, dane zalogowanego' },
    { name: 'Zasoby', description: 'Wydzialy, budynki, sale, prowadzacy, siatki godzin' },
    { name: 'Semestr', description: 'Semestry, kalendarze (przerwy, wyjatki dni, zjazdy), swieta ustawowe' },
    { name: 'Program', description: 'Kierunki, specjalnosci, przedmioty, programy studiow i ich wersje' },
    { name: 'Roczniki', description: 'Roczniki (nabory) i drzewo grup' },
    { name: 'Obsada', description: 'Zajecia semestru i obsada prowadzacych' },
    { name: 'Plan', description: 'Umieszczenia, generowanie terminow, poprawki terminow, moj plan' },
    { name: 'Uzytkownicy', description: 'Konta i impersonacja (ADMIN)' },
    { name: 'System', description: 'Health-check' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas,
  },
  paths: {
    // ─── System ──────────────────────────────────────────────
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health-check (poza /api, bez tokenu)',
        security: [],
        responses: { 200: dataResp('Serwer zyje') },
      },
    },

    // ─── Auth ────────────────────────────────────────────────
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Logowanie — zwraca access + refresh token',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: ref('LoginRequest'),
              // Gotowe konto demo — po "Try it out" body jest od razu wypelnione.
              example: { email: 'admin@umg.edu.pl', password: 'Admin1234!' },
            },
          },
        },
        responses: {
          200: dataResp('Tokeny i dane uzytkownika'),
          400: errResp('Blad walidacji (np. zly format email)'),
          401: errResp('Nieprawidlowy email lub haslo'),
          429: errResp('Za duzo prob logowania (rate-limit)'),
        },
      },
    },
    '/api/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Wymiana refresh tokenu na nowy access token',
        security: [],
        requestBody: jsonBody('RefreshRequest'),
        responses: { 200: dataResp('Nowy access token'), 400: errResp('Brak pola'), 401: errResp('Token niewazny') },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Uniewaznienie refresh tokenu',
        security: [],
        requestBody: {
          required: false,
          content: { 'application/json': { schema: { type: 'object', properties: { refreshToken: { type: 'string' } } } } },
        },
        responses: { 200: dataResp('Wylogowano') },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Dane zalogowanego uzytkownika',
        security: bearer,
        responses: { 200: dataResp('Profil uzytkownika'), 401: errResp('Brak lub niewazny token') },
      },
    },

    // ─── Zasoby: Wydzialy ────────────────────────────────────
    '/api/faculties': {
      get: { tags: ['Zasoby'], summary: 'Lista wydzialow', security: bearer, responses: { 200: dataResp('Wydzialy'), ...authErrors } },
      post: {
        tags: ['Zasoby'],
        summary: 'Utworz wydzial (ADMIN)',
        security: bearer,
        requestBody: jsonBody('FacultyCreate'),
        responses: { 201: dataResp('Utworzony'), 400: errResp('Blad walidacji'), 409: errResp('Duplikat'), ...authErrors },
      },
    },
    '/api/faculties/{id}': {
      get: { tags: ['Zasoby'], summary: 'Wydzial po id', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Wydzial'), 404: errResp('Nie znaleziono'), ...authErrors } },
      put: {
        tags: ['Zasoby'],
        summary: 'Aktualizuj wydzial (ADMIN)',
        security: bearer,
        parameters: [pathId()],
        requestBody: jsonBody('FacultyUpdate'),
        responses: { 200: dataResp('Zaktualizowany'), 404: errResp('Nie znaleziono'), ...authErrors },
      },
      delete: { tags: ['Zasoby'], summary: 'Usun wydzial (ADMIN)', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Usuniety'), 409: errResp('W uzyciu'), ...authErrors } },
    },

    // ─── Zasoby: Budynki i sale ──────────────────────────────
    '/api/buildings': {
      get: { tags: ['Zasoby'], summary: 'Lista budynkow', security: bearer, responses: { 200: dataResp('Budynki'), ...authErrors } },
      post: { tags: ['Zasoby'], summary: 'Utworz budynek (ADMIN)', security: bearer, requestBody: jsonBody('BuildingCreate'), responses: { 201: dataResp('Utworzony'), 400: errResp('Blad walidacji'), ...authErrors } },
    },
    '/api/buildings/{id}': {
      get: { tags: ['Zasoby'], summary: 'Budynek po id', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Budynek'), 404: errResp('Nie znaleziono'), ...authErrors } },
      put: { tags: ['Zasoby'], summary: 'Aktualizuj budynek (ADMIN)', security: bearer, parameters: [pathId()], requestBody: jsonBody('BuildingUpdate'), responses: { 200: dataResp('Zaktualizowany'), ...authErrors } },
      delete: { tags: ['Zasoby'], summary: 'Usun budynek (ADMIN)', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Usuniety'), 409: errResp('Ma sale'), ...authErrors } },
    },
    '/api/buildings/{id}/rooms': {
      get: { tags: ['Zasoby'], summary: 'Sale w budynku', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Sale'), ...authErrors } },
      post: { tags: ['Zasoby'], summary: 'Utworz sale (ADMIN)', security: bearer, parameters: [pathId()], requestBody: jsonBody('RoomCreate'), responses: { 201: dataResp('Utworzona'), 400: errResp('Blad walidacji'), ...authErrors } },
    },
    '/api/buildings/{id}/rooms/{roomId}': {
      put: { tags: ['Zasoby'], summary: 'Aktualizuj sale (ADMIN)', security: bearer, parameters: [pathId(), pathId('roomId')], requestBody: jsonBody('RoomUpdate'), responses: { 200: dataResp('Zaktualizowana'), ...authErrors } },
      delete: { tags: ['Zasoby'], summary: 'Usun sale (ADMIN)', security: bearer, parameters: [pathId(), pathId('roomId')], responses: { 200: dataResp('Usunieta'), 409: errResp('W planie'), ...authErrors } },
    },

    // ─── Zasoby: Prowadzacy ──────────────────────────────────
    '/api/instructors': {
      get: { tags: ['Zasoby'], summary: 'Lista prowadzacych', security: bearer, parameters: [{ name: 'facultyId', in: 'query', schema: { type: 'string' } }], responses: { 200: dataResp('Prowadzacy'), ...authErrors } },
      post: { tags: ['Zasoby'], summary: 'Utworz prowadzacego (ADMIN)', security: bearer, requestBody: jsonBody('InstructorCreate'), responses: { 201: dataResp('Utworzony'), 400: errResp('Blad walidacji'), 409: errResp('Email zajety'), ...authErrors } },
    },
    '/api/instructors/{id}': {
      get: { tags: ['Zasoby'], summary: 'Prowadzacy po id', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Prowadzacy'), 404: errResp('Nie znaleziono'), ...authErrors } },
      put: { tags: ['Zasoby'], summary: 'Aktualizuj prowadzacego (ADMIN)', security: bearer, parameters: [pathId()], requestBody: jsonBody('InstructorUpdate'), responses: { 200: dataResp('Zaktualizowany'), ...authErrors } },
      delete: { tags: ['Zasoby'], summary: 'Usun prowadzacego (ADMIN)', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Usuniety'), 409: errResp('W planie'), ...authErrors } },
    },

    // ─── Zasoby: Siatki godzin ───────────────────────────────
    '/api/time-grids': {
      get: { tags: ['Zasoby'], summary: 'Siatki godzin wydzialow (stacjonarna i niestacjonarna, podstawowe i siatki dnia): bloki, przerwy, dni z oknem godzin', security: bearer, responses: { 200: dataResp('Siatki'), ...authErrors } },
      post: { tags: ['Zasoby'], summary: 'Zaloz siatke dnia (ADMIN): wlasne bloki dla wybranych dni wydzialu i trybu; dni przechodza z siatki podstawowej', security: bearer, requestBody: jsonBody('TimeGridCreate'), responses: { 201: dataResp('Zalozona'), 400: errResp('Zle bloki albo dni'), 409: errResp('Plan w tych dniach'), ...authErrors } },
    },
    '/api/time-grids/{id}': {
      put: { tags: ['Zasoby'], summary: 'Zmien bloki i/lub dni siatki (ADMIN); bloki zablokowane, gdy w dniach siatki jest plan biezacego semestru', security: bearer, parameters: [pathId()], requestBody: jsonBody('TimeGridUpdate'), responses: { 200: dataResp('Zapisana'), 400: errResp('Zle bloki'), 409: errResp('Plan istnieje'), ...authErrors } },
      delete: { tags: ['Zasoby'], summary: 'Usun siatke dnia (ADMIN); jej dni wracaja do siatki podstawowej', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Usunieta'), 400: errResp('Siatka podstawowa'), 409: errResp('Plan w tych dniach'), ...authErrors } },
    },

    // ─── Program: Kierunki / specjalnosci / przedmioty ───────
    '/api/fields-of-study': {
      get: { tags: ['Program'], summary: 'Lista kierunkow', security: bearer, parameters: [{ name: 'facultyId', in: 'query', schema: { type: 'string' } }], responses: { 200: dataResp('Kierunki'), ...authErrors } },
      post: { tags: ['Program'], summary: 'Utworz kierunek (ADMIN)', security: bearer, requestBody: jsonBody('FieldOfStudyCreate'), responses: { 201: dataResp('Utworzony'), 400: errResp('Blad walidacji'), ...authErrors } },
    },
    '/api/fields-of-study/{id}': {
      delete: { tags: ['Program'], summary: 'Usun kierunek (ADMIN)', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Usuniety'), 409: errResp('W uzyciu'), ...authErrors } },
    },
    '/api/specializations': {
      get: { tags: ['Program'], summary: 'Lista specjalnosci', security: bearer, parameters: [{ name: 'fieldOfStudyId', in: 'query', schema: { type: 'string' } }], responses: { 200: dataResp('Specjalnosci'), ...authErrors } },
      post: { tags: ['Program'], summary: 'Utworz specjalnosc (ADMIN)', security: bearer, requestBody: jsonBody('SpecializationCreate'), responses: { 201: dataResp('Utworzona'), 400: errResp('Blad walidacji'), ...authErrors } },
    },
    '/api/specializations/{id}': {
      delete: { tags: ['Program'], summary: 'Usun specjalnosc (ADMIN)', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Usunieta'), 409: errResp('W uzyciu'), ...authErrors } },
    },
    '/api/subjects': {
      get: { tags: ['Program'], summary: 'Lista przedmiotow', security: bearer, parameters: [{ name: 'search', in: 'query', schema: { type: 'string' } }], responses: { 200: dataResp('Przedmioty'), ...authErrors } },
      post: { tags: ['Program'], summary: 'Utworz przedmiot (ADMIN)', security: bearer, requestBody: jsonBody('SubjectCreate'), responses: { 201: dataResp('Utworzony'), 400: errResp('Blad walidacji'), 409: errResp('Duplikat'), ...authErrors } },
    },
    '/api/subjects/{id}': {
      delete: { tags: ['Program'], summary: 'Usun przedmiot (ADMIN)', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Usuniety'), 409: errResp('W programie'), ...authErrors } },
    },

    // ─── Semestry i kalendarze ───────────────────────────────
    '/api/terms': {
      get: { tags: ['Semestr'], summary: 'Semestry z kalendarzami i semestrem domyslnym', security: bearer, responses: { 200: dataResp('Semestry'), ...authErrors } },
      post: { tags: ['Semestr'], summary: 'Utworz semestr (ADMIN)', security: bearer, requestBody: jsonBody('TermCreate'), responses: { 201: dataResp('Utworzony'), 409: errResp('Istnieje'), ...authErrors } },
    },
    '/api/terms/holidays': {
      get: { tags: ['Semestr'], summary: 'Swieta ustawowe w zakresie dat (liczone)', security: bearer, parameters: [dateQ('from'), dateQ('to')], responses: { 200: dataResp('Swieta'), ...authErrors } },
    },
    '/api/terms/{key}/calendars': {
      get: { tags: ['Semestr'], summary: 'Kalendarze semestru', security: bearer, parameters: [termKey], responses: { 200: dataResp('Kalendarze'), ...authErrors } },
      post: { tags: ['Semestr'], summary: 'Zaloz kalendarz', security: bearer, parameters: [termKey], requestBody: jsonBody('CalendarCreate'), responses: { 201: dataResp('Utworzony'), 400: errResp('Niespojny kalendarz'), 409: errResp('Istnieje'), ...authErrors } },
    },
    '/api/terms/{key}/calendars/proposal': {
      get: { tags: ['Semestr'], summary: 'Propozycja kalendarza z ostatniego semestru tego typu', security: bearer, parameters: [termKey], responses: { 200: dataResp('Propozycja'), ...authErrors } },
    },
    '/api/term-calendars/preview': {
      post: { tags: ['Semestr'], summary: 'Podglad kalendarza (tygodnie, zjazdy, problemy)', security: bearer, requestBody: jsonBody('CalendarPreview'), responses: { 200: dataResp('Podglad'), ...authErrors } },
    },
    '/api/term-calendars/{id}': {
      put: { tags: ['Semestr'], summary: 'Zapisz kalendarz', security: bearer, parameters: [pathId()], requestBody: jsonBody('CalendarBody'), responses: { 200: dataResp('Zapisany'), 409: errResp('Archiwum'), ...authErrors } },
      delete: { tags: ['Semestr'], summary: 'Usun kalendarz', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Usuniety'), 409: errResp('Archiwum'), ...authErrors } },
    },
    '/api/term-calendars/{id}/status': {
      put: { tags: ['Semestr'], summary: 'Status: w przygotowaniu / opublikowany / archiwum', security: bearer, parameters: [pathId()], requestBody: jsonBody('CalendarStatus'), responses: { 200: dataResp('Zmieniony'), ...authErrors } },
    },

    // ─── Programy studiow ────────────────────────────────────
    '/api/programs': {
      get: { tags: ['Program'], summary: 'Programy z wersjami', security: bearer, responses: { 200: dataResp('Programy'), ...authErrors } },
      post: { tags: ['Program'], summary: 'Utworz program', security: bearer, requestBody: jsonBody('ProgramCreate'), responses: { 201: dataResp('Utworzony'), ...authErrors } },
    },
    '/api/programs/{id}/versions': {
      post: { tags: ['Program'], summary: 'Nowa wersja programu (pusta albo klon)', security: bearer, parameters: [pathId()], requestBody: jsonBody('VersionCreate'), responses: { 201: dataResp('Utworzona'), ...authErrors } },
    },
    '/api/program-versions/{id}': {
      get: { tags: ['Program'], summary: 'Wersja z przedmiotami po semestrach', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Wersja'), ...authErrors } },
      put: { tags: ['Program'], summary: 'Zmien wersje (etykieta, status, semestry)', security: bearer, parameters: [pathId()], requestBody: jsonBody('VersionUpdate'), responses: { 200: dataResp('Zapisana'), ...authErrors } },
      delete: { tags: ['Program'], summary: 'Usun wersje (projekt, nieuzywana)', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Usunieta'), 409: errResp('Uzywana / zatwierdzona'), ...authErrors } },
    },
    '/api/program-versions/{id}/entries': {
      post: { tags: ['Program'], summary: 'Dodaj przedmiot do wersji', security: bearer, parameters: [pathId()], requestBody: jsonBody('ProgramEntry'), responses: { 201: dataResp('Dodany'), 409: errResp('Wersja zatwierdzona / duplikat'), ...authErrors } },
    },
    '/api/program-entries/{id}': {
      put: { tags: ['Program'], summary: 'Zmien pozycje programu', security: bearer, parameters: [pathId()], requestBody: jsonBody('ProgramEntry'), responses: { 200: dataResp('Zapisana'), ...authErrors } },
      delete: { tags: ['Program'], summary: 'Usun pozycje programu', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Usunieta'), ...authErrors } },
    },

    // ─── Roczniki i grupy ────────────────────────────────────
    '/api/cohorts': {
      get: { tags: ['Roczniki'], summary: 'Roczniki', security: bearer, responses: { 200: dataResp('Roczniki'), ...authErrors } },
      post: { tags: ['Roczniki'], summary: 'Nowy nabor (z kopia struktury grup)', security: bearer, responses: { 201: dataResp('Utworzony'), 409: errResp('Istnieje'), ...authErrors } },
    },
    '/api/terms/{key}/cohorts': {
      get: { tags: ['Roczniki'], summary: 'Roczniki aktywne w semestrze', security: bearer, parameters: [termKey], responses: { 200: dataResp('Roczniki'), ...authErrors } },
    },
    '/api/cohorts/{id}/groups': {
      get: { tags: ['Roczniki'], summary: 'Drzewo grup z nazwami dla semestru', security: bearer, parameters: [pathId(), { name: 'semester', in: 'query', schema: { type: 'integer' } }], responses: { 200: dataResp('Grupy'), ...authErrors } },
      post: { tags: ['Roczniki'], summary: 'Dodaj grupe', security: bearer, parameters: [pathId()], responses: { 201: dataResp('Dodana'), ...authErrors } },
    },
    '/api/cohorts/{id}/groups/bulk': {
      post: { tags: ['Roczniki'], summary: 'Kreator podgrup (N pod kazdym rodzicem)', security: bearer, parameters: [pathId()], responses: { 201: dataResp('Dodane'), ...authErrors } },
    },

    // ─── Zajecia i obsada ────────────────────────────────────
    '/api/terms/{key}/sections': {
      get: { tags: ['Obsada'], summary: 'Zajecia semestru z obsada', security: bearer, parameters: [termKey], responses: { 200: dataResp('Zajecia'), ...authErrors } },
    },
    '/api/terms/{key}/sections/sync': {
      post: { tags: ['Obsada'], summary: 'Synchronizuj zajecia z programem i grupami (dryRun = podglad)', security: bearer, parameters: [termKey], responses: { 200: dataResp('Raport'), ...authErrors } },
    },
    '/api/terms/{key}/sections/carry': {
      post: { tags: ['Obsada'], summary: 'Obsada z poprzedniego roku (dryRun = podglad)', security: bearer, parameters: [termKey], responses: { 200: dataResp('Raport'), ...authErrors } },
    },
    '/api/sections/{id}/instructors': {
      put: { tags: ['Obsada'], summary: 'Obsada zajec (podzial godzin, NN)', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Zapisana'), 400: errResp('Za duzo godzin'), ...authErrors } },
    },

    // ─── Plan ────────────────────────────────────────────────
    '/api/terms/{key}/plan': {
      get: { tags: ['Plan'], summary: 'Plan rocznika: zajecia, umieszczenia, bilans godzin', security: bearer, parameters: [termKey, { name: 'cohortId', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: dataResp('Plan'), ...authErrors } },
    },
    '/api/terms/{key}/placements': {
      post: { tags: ['Plan'], summary: 'Umiesc zajecia (kolizje sprawdzane na datach)', security: bearer, parameters: [termKey], responses: { 201: dataResp('Umieszczone'), 400: errResp('Blad'), 409: errResp('Kolizje (lista dat)'), ...authErrors } },
    },
    '/api/placements/{id}': {
      put: { tags: ['Plan'], summary: 'Zmien umieszczenie', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Zapisane'), 409: errResp('Kolizje'), ...authErrors } },
      delete: { tags: ['Plan'], summary: 'Usun umieszczenie', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Usuniete'), ...authErrors } },
    },
    '/api/terms/{key}/generate': {
      post: { tags: ['Plan'], summary: 'Generuj terminy (dryRun = podglad); poprawki terminow zostaja', security: bearer, parameters: [termKey], responses: { 200: dataResp('Raport'), ...authErrors } },
    },
    '/api/terms/{key}/plan/carry': {
      post: { tags: ['Plan'], summary: 'Przenies plan z zeszlego roku (na zadanie, dryRun = podglad)', security: bearer, parameters: [termKey], responses: { 200: dataResp('Raport'), ...authErrors } },
    },
    '/api/terms/{key}/occurrences': {
      get: { tags: ['Plan'], summary: 'Terminy rocznika', security: bearer, parameters: [termKey], responses: { 200: dataResp('Terminy'), ...authErrors } },
      post: { tags: ['Plan'], summary: 'Termin reczny (zajecia dodatkowe)', security: bearer, parameters: [termKey], responses: { 201: dataResp('Dodany'), 409: errResp('Kolizja'), ...authErrors } },
    },
    '/api/occurrences/{id}': {
      put: { tags: ['Plan'], summary: 'Odwolaj / przenies / przywroc termin', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Zmieniony'), 409: errResp('Kolizja'), ...authErrors } },
    },
    '/api/terms/{key}/my-plan': {
      get: { tags: ['Plan'], summary: 'Moj plan (student/prowadzacy, tylko opublikowane)', security: bearer, parameters: [termKey, dateQ('from'), dateQ('to')], responses: { 200: dataResp('Terminy'), ...authErrors } },
    },

    // ─── Uzytkownicy ─────────────────────────────────────────
    '/api/users': {
      get: { tags: ['Uzytkownicy'], summary: 'Lista uzytkownikow (ADMIN)', security: bearer, responses: { 200: dataResp('Uzytkownicy'), ...authErrors } },
      post: { tags: ['Uzytkownicy'], summary: 'Utworz uzytkownika (ADMIN)', security: bearer, requestBody: jsonBody('UserCreate'), responses: { 201: dataResp('Utworzony'), 400: errResp('Blad walidacji'), 409: errResp('Email zajety'), ...authErrors } },
    },
    '/api/users/{id}': {
      put: { tags: ['Uzytkownicy'], summary: 'Aktualizuj uzytkownika (ADMIN)', security: bearer, parameters: [pathId()], requestBody: jsonBody('UserUpdate'), responses: { 200: dataResp('Zaktualizowany'), 404: errResp('Nie znaleziono'), ...authErrors } },
      delete: { tags: ['Uzytkownicy'], summary: 'Usun uzytkownika (ADMIN)', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Usuniety'), 400: errResp('Nie mozesz usunac siebie'), ...authErrors } },
    },
    '/api/users/{id}/impersonate': {
      post: { tags: ['Uzytkownicy'], summary: 'Podglad jako inny uzytkownik (ADMIN)', security: bearer, parameters: [pathId()], responses: { 200: dataResp('Token podgladowy'), 400: errResp('Nie mozesz podszyc sie pod siebie'), 404: errResp('Nie znaleziono'), ...authErrors } },
    },

    // ─── Dashboard ───────────────────────────────────────────
    '/api/dashboard/stats': {
      get: { tags: ['System'], summary: 'Statystyki dashboardu', security: bearer, responses: { 200: dataResp('Statystyki'), ...authErrors } },
    },
  },
};
