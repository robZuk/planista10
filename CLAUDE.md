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
  jednej osoby — Obciążenia), `planStaff` (plan a obsada: zajęcia w planie z prowadzącym spoza obsady
  albo NN mimo pełnej obsady, przepięcie prowadzącego z kontrolą kolizji), `plan` (walidacja umieszczeń, dostępność,
  generowanie terminów), `occurrenceChanges` (przeniesienie / przywrócenie / termin ręczny z kontrolą
  kolizji — tylko planista), `carryPlan`, `staleness` (terminy nieaktualne per rocznik), `visibility`
  `planLock` (zapisy planu po kolei w obrebie semestru — kontrola kolizji i zapis bez wyscigu;
  na trasach zapisu middleware `planLocked`), `autoPlan` (samoczynne zmiany pod blokadą planu:
  zajęcia po zapisie naboru, grup, wersji programu i kalendarza — synchronizacja w trybie
  `additive`; terminy kalendarza w przygotowaniu po zmianie jego dat; publikacja z przeliczeniem terminów),
  `occupancyView` (zajętość sal i prowadzących w tygodniu — cała uczelnia, z tej samej zajętości co kolizje: `plan.occupancyWithScope`)
- `src/lib/*` — czyste funkcje domeny (bez bazy, testowane jednostkowo):
  - `prisma.ts` — **singleton PrismaClient**; nigdy nie rób `new PrismaClient()`, importuj `prisma` stąd
  - `isoDate.ts` — daty jako tekst `YYYY-MM-DD` (arytmetyka w UTC)
  - `terms.ts` — semestry (`2026-Z`/`2026-L`), `ordinal`, semestr programu rocznika
  - `holidays.ts` — święta ustawowe liczone (Wielkanoc, Boże Ciało, Wigilia od 2025)
  - `teachingCalendar.ts` — dni i tygodnie zajęć, zjazdy, `expandDates`
  - `groupTree.ts` — drzewo grup: reguła nakładania i nazwy liczone
  - `demand.ts` — zajęcia wynikające z programu i grup
  - `staffing.ts` — zasady listy obsady (`staffProblem`), godziny jednej osoby z ustępującym NN (`withPersonHours`)
  - `planStaff.ts` — rozjazd planu z obsadą (`staffMismatch`: FOREIGN / MISSING), podpowiedź osoby, kolizje prowadzącego
  - `workload.ts` — obciążenia: osoba → przedmiot i forma w roczniku z grupami, stac./niestac., suma uczelni; zajęcia łączone (`jointKey`) liczone raz
  - `materializer.ts` — terminy z umieszczeń (limit godzin, wyjątki, kolizje)
  - `timeGrid.ts` — siatki godzin: walidacja bloków, bloki → minuty, przerwy, dni z oknem godzin, kolizje w minutach, zestaw siatek wydziału i trybu (podstawowa + siatki dnia, `gridSet.forDay`)
  - `scheduleTime.ts` — typy sal dla form zajęć
  - `facultyScope.ts` — zakres wydziału wywołującego (`assertFacultyScope`)
  - `occurrenceDiff.ts` — diff „Generuj terminy”: terminy z wzorca zachowują id (aktualizacja w miejscu)
  - `occurrenceSlot.ts` — ocena nowego miejsca terminu (blokada poza semestrem, ostrzeżenia do potwierdzenia)
  - `externalBusy.ts` — zajętości zewnętrzne (zajęcia innych wydziałów ze zgłoszeń): sloty bez grupy do kolizji, walidacja, kolizje wpisu z planem
  - `occupancyView.ts` — zajętość sal i prowadzących: pozycje zasobu (zajęcia łączone raz, kolizje oznaczone w obrębie sali albo prowadzącego), tygodnie semestru do przeglądania
  - `planPrint.ts` — druk planu prowadzącego i sali: model stron (kolumny dni/dat, kafelki w minutach), tory zajęć równoległych, rytm, nazwa pliku; `planPdf.ts` — rysowanie PDF (pdfkit, A4 poziomo, czcionki z `pdfFonts.ts` — DejaVu z polskimi znakami)
  - `planSheet.ts` — arkusz planu dla studentów (układ arkuszy WM): kolumny z liści drzewa grup, dzień × bloki, scalanie poziome, ramki zajęć nie co tydzień, skróty nazw przedmiotów i kolory; `planSheetPdf.ts` — rysowanie arkusza
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
  akcje („Przenieś plan z zeszłego roku", „Kopiuj zjazd", obsada z poprzedniego roku)
  uruchamia planista i zawsze mają podgląd (`dryRun`).
- **Zajęcia semestru powstają same — tylko zmiany dodające.** Po zapisie naboru, grup (zakres
  semestrów), trybu wykładów, wersji programu rocznika, zatwierdzeniu wersji programu, zmianie
  ustawień rocznika w semestrze i po założeniu kalendarza synchronizacja w trybie `additive`
  (`services/autoPlan`, `syncSections`) od razu tworzy brakujące zajęcia, przywraca osierocone
  i poprawia godziny zajęć bez planu — tylko rocznikom z kalendarzem poza archiwum w danym
  semestrze. Usunięcia, osierocenia i zmiana godzin zajęć, które są w planie, czekają na podgląd:
  strona „Obsada” liczy go sama przy wejściu i pokazuje komunikat tylko, gdy jest coś do zrobienia
  (`lib/syncNotice`) — te zmiany stosuje się z okna podglądu. Zajęcia „puste” (bez obsady,
  umieszczeń i terminów — `sections.bareSection`) nie blokują usunięcia grupy, rocznika ani
  pozycji programu: odchodzą razem z nimi.
- **Terminy liczy generowanie** (`services/plan.ts → generate`). Dopóki kalendarz rocznika jest
  „w przygotowaniu”, terminy przeliczają się same po każdej zmianie planu: umieszczenia, terminy
  ręczne, przeniesienie planu, synchronizacja, daty kalendarza, ustawienia rocznika w semestrze
  (`refreshPlanningTerms`, pod blokadą planu; zajętość innych roczników tylko w salach i u
  prowadzących rocznika). Publikacja kalendarza przelicza je jeszcze raz przed zmianą statusu
  (`autoPlan.changeCalendarStatus`) — opublikowany plan nie bywa pusty ani nieaktualny. W
  **opublikowanym** kalendarzu zmiana wzorca NIE przelicza terminów — plan pokazuje „terminy
  nieaktualne” i trzeba „Generuj terminy” (od dnia, z podglądem); przycisk widać, gdy kalendarz
  jest opublikowany albo terminy są nieaktualne. Ręczne poprawki terminów to `PlacementException`
  i przeżywają ponowne generowanie; terminy ręczne (`Occurrence.kind = MANUAL`, zajęcia dodatkowe)
  nie znikają i liczą się do godzin.
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
  za katedrą). Katedry i prowadzących zmienia tylko ADMIN. Katedra formy przedmiotu
  (`ProgramEntryDepartment`, zlecenie wydziału) siedzi w pozycji programu — przypisuje ją planista
  w Obsada → „Zlecenia dla katedr”.
- **Plan zmienia tylko planista** (ADMIN, DEAN_OFFICE) w „Układaniu planu”. Prowadzący i student plan
  tylko oglądają („Mój plan”). W planista10 **nie ma zgłoszeń zmian ani powiadomień w aplikacji**
  (usunięte migracją `20261115120000_drop_change_requests_notifications`) — nie dokładaj ich
  z powrotem bez decyzji użytkownika.
- **Plan a obsada.** Umieszczenie niesie prowadzącego wybranego z obsady swojej grupy (`Placement.instructorId`;
  spoza obsady serwer odrzuca). Zmiana obsady planu **nie zmienia** — Obsada pokazuje zajęcia w planie z prowadzącym
  spoza obsady albo NN mimo pełnej obsady i „Pokaż i przepnij” (`services/planStaff`, `/api/terms/:key/plan-staff`):
  podgląd kolizji prowadzącego liczony na stanie po zmianach (zamiana osób między grupami równoległymi przechodzi
  w jednym kroku), zapis tylko zmian bez kolizji, terminy jak po każdej zmianie planu.
- **Plan jednego wydziału; zajęcia innych wydziałów to „zajętości zewnętrzne”** (`ExternalBusy`,
  strona „Zajętości zewnętrzne”): prowadzący i/lub sala, minuty i konkretne daty ze zgłoszeń
  mailowych. Liczą się tylko do kolizji (dokłada je `termOccupancy`; `BusySlot.groupId = null`), nie
  są zajęciami ani obciążeniem. Wpis kolidujący z ułożonym planem się zapisuje — lista pokazuje kolizje.
- **Zajętość sal i prowadzących** (strony „Zajętość sal” i „Zajętość prowadzących”,
  `GET /api/terms/:key/room-occupancy?week=` i `…/instructor-occupancy?week=`, `services/occupancyView`) —
  tylko do wglądu, dla planistów: cała uczelnia (sale i prowadzący są wspólni) na konkretnych datach tygodnia,
  z tej samej zajętości co kolizje (`termOccupancy`: wzorzec jak „Generuj terminy”, także przed generowaniem;
  terminy ręczne; zajętości zewnętrzne; `BusySlot.origin` mówi, skąd slot). Oba widoki różnią się tylko zasobem
  (`lib/occupancyView`, komponenty we `frontend/src/pages/occupancy`): sale — bez zajęć online, prowadzący — z
  online, bez NN. Tydzień: zasób × dni z paskami i zajętymi godzinami; dzień: oś godzin, szczegóły zajęć, sale
  albo prowadzący wolni w podanych godzinach (prowadzący: filtr wydziału, katedry, nazwiska). Zajęcia łączone raz;
  nakładające się pozycje tej samej sali / tego samego prowadzącego oznaczone jako kolizja — także zajęcia
  o wspólnym kluczu, które się nie scalają (inny prowadzący, NN), choć kontrola kolizji planu je przepuszcza.
- **Druk planu (PDF)** — `GET /api/terms/:key/plan/pdf` (`services/planPrint`).
  **Rocznik = arkusz dla studentów w układzie arkuszy WM** (`~/Desktop/plany`: sd_r1–r4, week; `lib/planSheet`):
  stacjonarne — A4 pionowo, rok studiów i stopień ze wszystkimi kierunkami wydziału obok siebie (te same tryb,
  stopień i semestr programu), wiersze dzień × blok, komórka „skrót przedmiotu forma / sala / nazwisko”, kolor wg
  przedmiotu, zajęcia nie co tydzień w czerwonej ramce z przekątnymi + przypis z rytmem; niestacjonarne — A4
  poziomo, wszystkie lata stopnia, wiersze na każdy dzień zjazdów („tydz: N”, data) z tym, co dałoby „Generuj
  terminy” (materializer) + terminy ręczne, kolumna bez zajęć w dniu szara. Inne roczniki trafiają na arkusz, gdy
  mają coś w planie; filtr grupy — tylko wybrany rocznik i kolumny grupy. Skróty nazw liczone przy rysowaniu
  (bez numeracji „I, II”, potem „Podst.Konst.Masz.”, „Pod.Kon.Masz.”). Prowadzący i sala — plan na osi czasu
  (`lib/planPrint`): stacjonarne tydzień z wzorca, niestacjonarne strony po tygodniach; w wąskim kafelku sala bez
  budynku i prowadzący z inicjałem. Przyciski: Układanie planu (rocznik / filtr grupy), Prowadzący, Budynki i sale
  (semestr ostatnio używany) — otwierają podgląd w oknie aplikacji (`PlanPdfDialog`), z którego plik się pobiera
  albo drukuje.
- **Nie ma odwołań ani odrobień** — ani na studiach stacjonarnych, ani na niestacjonarnych
  (migracje `20261115200000_drop_makeups` i `20261115210000_drop_cancellations`: bez strony
  „Odrobienia”, `makeupOfId`, `Occurrence.status` i `PlacementException.action`). Zajęcia, które
  mają się odbyć w innym dniu, planista **przenosi**; poprawka terminu to zawsze przeniesienie.
  Nie dokładaj odwołań ani odrobień z powrotem bez decyzji użytkownika.
- **Studia stacjonarne: ten sam plan w każdym tygodniu** + „Kalendarz roku akademickiego” Rektora
  (dni wolne, „zajęcia z innego dnia” = `CalendarDay`, przerwy). Pojedynczych terminów się nie
  przenosi — terminy stacjonarnych są **tylko do wglądu** (zakładka „Terminy” bez akcji, API → 409
  w `occurrenceChanges.assertPlanEditable`). Zmiana planu od tygodnia X = we wzorcu dotychczasowe
  umieszczenie „do tygodnia X−1”, nowe „od tygodnia X”, potem (w opublikowanym kalendarzu)
  „Generuj terminy”. Do publikacji idzie plan tygodnia + kalendarz Rektora (druki — później).
- **Studia niestacjonarne: „Plan zjazdu”** — kalendarz zjazdów ma jeden widok na konkretny zjazd
  („tydz. N” z datami w nagłówkach, domyślnie trwający albo najbliższy), bez zakładki „Terminy”:
  plan różni się z weekendu na weekend (przedmioty blokami na wybranych zjazdach — `week.pdf`,
  zasady WM). Zajęcia dodane w zjeździe są tylko w nim (`LIST [N]`); zajęcia z kilku zjazdów
  zmienia się albo usuwa „tylko w tym zjeździe” (`POST /api/placements/:id/split` rozdziela
  umieszczenie) albo w całości. Pole „Zjazd” w oknie zajęć przenosi je do innego zjazdu (z jednego
  zjazdu — zmiana rytmu, z kilku — rozdzielenie z `toZjazd`; kolizje liczą się też z ich
  spotkaniem, które zostaje w zjeździe docelowym). Terminy liczy generowanie (w przygotowaniu — samo,
  po publikacji — „Generuj terminy”); pojedynczych terminów UI
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
