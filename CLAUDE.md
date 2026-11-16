# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Wskazówki dla Claude Code przy pracy w tym repozytorium. Szczegóły domenowe
(model danych, semantyka pól) są w `docs/model-danych.md` i w `README.md`.

## Czym jest projekt

Planista 10 — system układania planu zajęć dla uczelni. Nowa wersja rozwijana od kopii
planista9 (stan z 2026-11-15). planista9 wyrósł z planista8 (nowy model planowania: semestry,
programy, roczniki, obsada, plan) i dołożył **siatki godzin wydziałów** (każdy wydział:
stacjonarna i niestacjonarna, dni z oknem godzin, kolizje w minutach) oraz zajęcia online bez
sali. Porty są celowo inne niż w planista7 (4001/5434/5174), planista8 (4002/5435/5175) i
planista9 (4003/5436/5176), więc projekty mogą działać równolegle.

- **Backend:** Node.js + Express + TypeScript, ORM Prisma — port **4004**
- **Baza:** PostgreSQL 16 w Dockerze — tylko w sieci kontenerów (bez portu na hoście; `docker exec planista10-db-1 psql …`)
- **Frontend:** React 19 + Vite + TypeScript + Tailwind 4 + shadcn/ui — port **5177** (`strictPort`)

## Uruchamianie (dev)

```bash
# Trzy kontenery (katalog główny): db, backend (:4004), frontend (:5177) — kod montowany z dysku
make dev-build              # albo: docker compose up -d --build   (kolejne starty: make dev)
# Pierwszy start (pusty wolumen pgdata): baza wgrywa seed db/planista10-dump.sql.gz (db/README.md).
# Backend przy każdym starcie: prisma generate + prisma migrate deploy, potem tsx watch.
# Inna baza w tym samym Postgresie: PLANISTA_DB=planista10_pelne docker compose up -d backend
```

Zależności (`node_modules`) są tylko w kontenerach — `npm test`, `tsc` itp. uruchamiaj przez
`docker compose exec backend …` / `docker compose exec frontend …`.

Health-check backendu: `GET http://localhost:4004/health` (poza prefiksem
`/api`). Wszystkie właściwe endpointy są pod `/api/*` i wymagają tokenu JWT.

Port frontu jest ustawiony na sztywno (`strictPort`) — jeśli 5177 jest zajęty,
Vite zatrzyma się z błędem zamiast przejść na kolejny wolny port (inaczej łatwo
pomylić planista10 z uruchomioną obok planista9).

## Polecenia

**Backend** (`backend/`)
- `npm run dev` — serwer z hot-reloadem (`tsx watch`)
- `npm run build` — `tsc` (kompilacja do `dist/`)
- `npm run db:seed` — seed bazy (`prisma/seed.ts`)
- `npm run prisma:migrate` / `prisma:generate` / `prisma:studio`

**Frontend** (`frontend/`)
- `npm run dev` — Vite dev server
- `npm run build` — `tsc -b && vite build` (typecheck + build produkcyjny)
- `npm run lint` — `oxlint`
- `npm run preview` — podgląd builda

> **Brak jednego polecenia „test all".** Uruchamiaj polecenia w katalogu
> `backend/` lub `frontend/`, nie w katalogu głównym (root nie ma `package.json`).

## Testy

Testy jednostkowe stoją na **Vitest**, **osobno per pakiet** (root nie ma
`package.json`) — uruchamiaj `npm test` w `backend/` albo w `frontend/`, nie w
katalogu głównym. Wspólny jest tylko runner, nie konfiguracja.

- **Backend** (`backend/`): `npm test` / `npm run test:watch`. Config w
  `vitest.config.mts` (`environment: node`). Prisma jest **mockowana** przez
  `vi.mock('../lib/prisma')`, więc testy nie wymagają bazy ani zmiennych
  środowiskowych. Pliki `*.test.ts` są wykluczone z builda `tsc` (patrz
  `exclude` w `tsconfig.json`), więc nie trafiają do `dist/`. Pokryte czyste funkcje
  domeny (`lib/terms`, `holidays`, `teachingCalendar`, `groupTree`, `demand`,
  `materializer`, `scheduleTime`) i trasy API przez supertest (`*.api.test.ts`,
  `createApp()` bez nasłuchiwania na porcie).
- **Frontend** (`frontend/`): `npm test` / `npm run test:watch`. Config w
  `vitest.config.ts` (osobny od `vite.config.ts`, z tym samym aliasem `@`).
  Czysta logika bez DOM (`semester`, `navigation`, `calendarUtils`).

Weryfikacja zmian UI wciąż idzie przez uruchomienie aplikacji (skill `/verify`).

## Architektura

**Backend** — klasyczny podział warstwowy:
- `src/routes/*` — definicje tras Express (montowane pod `/api/*` w `index.ts`)
- `src/controllers/*` — obsługa żądań (walidacja wejścia, wywołanie logiki, odpowiedź)
- `src/services/*` — logika domenowa z bazą: `termCalendars`, `cohorts`, `sections`
  (synchronizacja zajęć, przenoszenie obsady), `staffing` (obsada wielu zajęć naraz i godziny
  jednej osoby — Obciążenia), `plan` (walidacja umieszczeń, dostępność,
  generowanie terminów), `occurrenceChanges` (przeniesienie / przywrócenie / termin ręczny z kontrolą
  kolizji — tylko planista), `carryPlan`, `staleness` (terminy nieaktualne per rocznik), `visibility`
  `planLock` (zapisy planu po kolei w obrebie semestru — kontrola kolizji i zapis bez wyscigu;
  na trasach zapisu middleware `planLocked`)
- `src/lib/*` — czyste funkcje domeny (bez bazy, testowane jednostkowo):
  - `prisma.ts` — **singleton PrismaClient**; nigdy nie rób `new PrismaClient()`, importuj `prisma` stąd
  - `isoDate.ts` — daty jako tekst `YYYY-MM-DD` (arytmetyka w UTC)
  - `terms.ts` — semestry (`2026-Z`/`2026-L`), `ordinal`, semestr programu rocznika
  - `holidays.ts` — święta ustawowe liczone (Wielkanoc, Boże Ciało, Wigilia od 2025)
  - `teachingCalendar.ts` — dni i tygodnie zajęć, zjazdy, `expandDates`
  - `groupTree.ts` — drzewo grup: reguła nakładania i nazwy liczone
  - `demand.ts` — zajęcia wynikające z programu i grup
  - `staffing.ts` — zasady listy obsady (`staffProblem`), godziny jednej osoby z ustępującym NN (`withPersonHours`)
  - `workload.ts` — obciążenia: osoba → przedmiot i forma w roczniku z grupami, stac./niestac., suma uczelni
  - `materializer.ts` — terminy z umieszczeń (limit godzin, wyjątki, kolizje)
  - `timeGrid.ts` — siatki godzin: walidacja bloków, bloki → minuty, przerwy, dni z oknem godzin, kolizje w minutach, zestaw siatek wydziału i trybu (podstawowa + siatki dnia, `gridSet.forDay`)
  - `scheduleTime.ts` — typy sal dla form zajęć
  - `facultyScope.ts` — zakres wydziału wywołującego (`assertFacultyScope`)
  - `occurrenceDiff.ts` — diff „Generuj terminy”: terminy z wzorca zachowują id (aktualizacja w miejscu)
  - `occurrenceSlot.ts` — ocena nowego miejsca terminu (blokada poza semestrem, ostrzeżenia do potwierdzenia)
- `src/middleware/authenticate.ts` — weryfikacja JWT; role w enumie `Role`
- `prisma/schema.prisma` — źródło prawdy o modelu danych (opis: `docs/model-danych.md`)

**Frontend** — React 19 + Vite:
- `src/pages/*` — strony (routing `react-router-dom`)
- `src/api/*` — klienci HTTP per zasób (axios, `src/lib/api.ts`)
- `src/store/*` — stan globalny współdzielony między stronami (**zustand**):
  `authStore`, `termStore` (ostatni semestr), `facultyStore`, `fieldFilterStore`
- Strony semestralne (`termScoped` w `lib/navigation.ts`) mają semestr w adresie
  (`/plan/2026-L`); `TermSelector` w nagłówku zmienia klucz, `useCurrentTerm` go czyta
- `src/lib/*` — logika czysta wielokrotnego użytku (`navigation`, `scheduleDisplay`, `labels`, `semester`)
- Dane serwera przez **TanStack Query**; formularze przez react-hook-form + zod;
  UI to shadcn/ui (preset `nova`, baza Radix)

### Reguły domenowe (nowy model)

- **Cztery osie czasu:** katalog (bez roku) · program (wersje, wiele roczników na wersję) ·
  rocznik (grupy idą z nim przez studia) · semestr kalendarzowy (jedyny kontekst planowania).
- **Nic nie układa planu automatycznie.** Planista umieszcza każde zajęcia sam; masowe
  akcje („Przenieś plan z zeszłego roku", „Kopiuj zjazd", synchronizacja zajęć, obsada
  z poprzedniego roku) uruchamia planista i zawsze mają podgląd (`dryRun`). Podgląd
  synchronizacji zajęć strona „Obsada” liczy sama przy wejściu i pokazuje komunikat tylko,
  gdy jest coś do zrobienia (`lib/syncNotice`) — zmiany stosuje się z okna podglądu.
- **Terminy powstają tylko z „Generuj terminy"** (`services/plan.ts → generate`). Zmiana
  wzorca NIE przelicza terminów — plan pokazuje wtedy „terminy nieaktualne".
  Ręczne poprawki terminów to `PlacementException` i przeżywają ponowne generowanie;
  terminy ręczne (`Occurrence.kind = MANUAL`, zajęcia dodatkowe) nie znikają i liczą się do godzin.
- **Kolizje sprawdzamy na konkretnych datach** w całej uczelni (sala, prowadzący, grupy wg
  `groupTree.groupsOverlap`) — jeden mechanizm dla umieszczeń i terminów.
- **Semestr programu rocznika** = `termOrdinal(term) − termOrdinal(startTerm) + 1`
  (działa dla naboru lutowego); nigdy z parzystości numeru.
- **Nazwy grup nie są zapisywane** — licz je `displayName` dla semestru.
- **Dziekanat** zmienia tylko dane swojego wydziału (`assertFacultyScope`); semestry w
  archiwum są tylko do odczytu.
- **Katedry** (`Department`, zakładka „Katedry” w „Wydziały i katedry”) to jednostki, które
  przysyłają obciążenia prowadzących; oznaczenie jak w zleceniach (`KEO-WE`), międzywydziałowe
  (SJO) bez wydziału. Katedra wydziałowa ustala wydział prowadzącego (`Instructor.facultyId` idzie
  za katedrą). Katedry i prowadzących zmienia tylko ADMIN.
- **Plan zmienia tylko planista** (ADMIN, DEAN_OFFICE) w „Układaniu planu”. Prowadzący i student plan
  tylko oglądają („Mój plan”). W planista10 **nie ma zgłoszeń zmian ani powiadomień w aplikacji**
  (usunięte migracją `20261115120000_drop_change_requests_notifications`) — nie dokładaj ich
  z powrotem bez decyzji użytkownika.
- **Nie ma odwołań ani odrobień** — ani na studiach stacjonarnych, ani na niestacjonarnych
  (migracje `20261115200000_drop_makeups` i `20261115210000_drop_cancellations`: bez strony
  „Odrobienia”, `makeupOfId`, `Occurrence.status` i `PlacementException.action`). Zajęcia, które
  mają się odbyć w innym dniu, planista **przenosi**; poprawka terminu to zawsze przeniesienie.
  Nie dokładaj odwołań ani odrobień z powrotem bez decyzji użytkownika.
- **Studia stacjonarne: ten sam plan w każdym tygodniu** + „Kalendarz roku akademickiego” Rektora
  (dni wolne, „zajęcia z innego dnia” = `CalendarDay`, przerwy). Pojedynczych terminów się nie
  przenosi — terminy stacjonarnych są **tylko do wglądu** (zakładka „Terminy” bez akcji, API → 409
  w `occurrenceChanges.assertPlanEditable`). Zmiana planu od tygodnia X = we wzorcu dotychczasowe
  umieszczenie „do tygodnia X−1”, nowe „od tygodnia X”, potem „Generuj terminy”. Do publikacji
  idzie plan tygodnia + kalendarz Rektora (druki — później).
- **Studia niestacjonarne: „Plan zjazdu”** — kalendarz zjazdów ma jeden widok na konkretny zjazd
  („tydz. N” z datami w nagłówkach, domyślnie trwający albo najbliższy), bez zakładki „Terminy”:
  plan różni się z weekendu na weekend (przedmioty blokami na wybranych zjazdach — `week.pdf`,
  zasady WM). Zajęcia dodane w zjeździe są tylko w nim (`LIST [N]`); zajęcia z kilku zjazdów
  zmienia się albo usuwa „tylko w tym zjeździe” (`POST /api/placements/:id/split` rozdziela
  umieszczenie) albo w całości. Pole „Zjazd” w oknie zajęć przenosi je do innego zjazdu (z jednego
  zjazdu — zmiana rytmu, z kilku — rozdzielenie z `toZjazd`; kolizje liczą się też z ich
  spotkaniem, które zostaje w zjeździe docelowym). Terminy powstają z „Generuj terminy”; pojedynczych terminów UI
  zjazdów już nie zmienia (przeniesienia i terminy ręczne zostały dla kalendarzy tygodniowych).

## Konwencje

- **Język:** komentarze, komunikaty i wiadomości commitów po polsku, zwykle
  **bez znaków diakrytycznych** (`walidacja`, `konflikt`, `poludnie UTC`).
- **Commity:** format `Obszar: opis` (np. `Kalendarz: usuwanie terminu honoruje
  zakres serii (ONE/ALL)`). Po polsku, bez diakrytyków.
- **Praca na gałęziach:** nie commituj bezpośrednio na `main` — załóż gałąź.
- **Scalanie (zasada hybrydowa):** sposób merge'a zależy od liczby commitów na gałęzi:
  - **jeden commit** → fast-forward albo rebase na `main` (bez merge-commita) —
    historia zostaje liniowa, bez pustych `Merge branch 'x'`.
  - **kilka commitów tworzących jeden feature** → `--no-ff` (merge-commit grupuje
    całość, umożliwia `revert -m`), albo `--squash` gdy ma zostać jeden wpis w `main`.
- **Czas w planie:** każdy wydział ma **siatkę godzin podstawową** stacjonarną i niestacjonarną
  (`TimeGrid.base`) — bloki o dowolnym starcie i długości (1 blok = 1 godzina programu,
  przerwy to odstępy) oraz dni zajęć z oknem godzin (np. czwartek od 16:00) — i opcjonalnie
  **siatki dnia**: własne bloki dla wybranych dni (np. piątek niestacjonarnych 16:00, 16:50…
  przy innych blokach w sobotę). Dni siatek jednego wydziału i trybu są rozłączne; dzień spoza
  siatek liczy się wg podstawowej (`lib/timeGrid.ts → gridSet.forDay`). Umieszczenia wskazują
  bloki (`startOrder..endOrder`) siatki obowiązującej w ich dniu. **Kolizje liczymy w minutach**
  (`lib/timeGrid.ts → minutesOverlap`, przedziały półotwarte), bo wydziały i dni mają różne
  siatki; terminy niosą rzeczywisty czas (`Occurrence.startMinute/endMinute`). Bloków siatki nie
  zmienia się, gdy w jej dniach jest plan bieżącego semestru (siatkę dnia zakłada się przed
  ułożeniem planu w tych dniach), a dni i okien godzin — gdy wyrzuciłyby poza siatkę ułożone już
  zajęcia (`slotsOutsideDays`).
- **Daty:** dni jako tekst `YYYY-MM-DD` (`lib/isoDate.ts`), kolumny `@db.Date`; nigdy
  arytmetyka na `Date` w strefie lokalnej.
- **TypeScript:** `strict` po obu stronach; backend CommonJS, frontend ESM.

### Logowanie

Backend loguje przez **pino** (`src/lib/logger.ts`), nie przez `console.*`.

- **W obrębie żądania używaj `req.log`** — niesie `request-id`, więc logi jednego
  żądania są powiązane (jest otypowany na `Request`). **Poza żądaniem** (start serwera,
  skrypty, zadania w tle) → `import { logger } from '.../lib/logger'`.
- **Kolejność argumentów pino: obiekt PIERWSZY, wiadomość DRUGA** —
  `req.log.info({ userId }, 'zalogowano')`, nie `('zalogowano', { userId })`.
- **Błędy loguj jako `{ err }`** (`req.log.error({ err }, '...')`) — pino serializuje stack.
  Nieobsłużone 500 loguje już `errorHandler`; ręcznie dokładasz tylko kontekst domenowy.
- **Poziomy:** `debug` (dev), `info` (zdarzenia biznesowe), `warn` (podejrzane / 4xx),
  `error` (500 / wyjątek). Próg z `LOG_LEVEL` (prod domyślnie `info`, dev `debug`, test `silent`).
- **Nigdy nie loguj sekretów** (hasła, tokeny, całe wrażliwe ciała żądań).
- **`pino-http` loguje każde żądanie automatycznie** (metoda/URL/status/czas) — ręczne
  `req.log.*` dodajesz tylko dla dodatkowego kontekstu. `pino-pretty` jest **tylko w dev**
  (devDependency); prod (`NODE_ENV=production`) daje surowy JSON.

## Uwaga o strefie sieci

Aplikacja wymaga zalogowania (JWT). Endpointy `/api/*` bez ważnego tokenu zwracają
401 — dlatego ręczny `curl` do API bez nagłówka `Authorization` zawsze da
„Brak tokenu uwierzytelniajacego". Do weryfikacji przechodź przez UI (które loguje).
