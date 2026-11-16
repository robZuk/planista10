# Model danych — planowanie zajęć (planista10)

Dokument referencyjny. Opisuje, jak dane zachowują się w czasie, i kluczowe decyzje
modelowe. Aktualizować przy zmianach `backend/prisma/schema.prisma`.

## 1. Cztery osie czasu

```
KATALOG (bez roku)      PROGRAM (wersje)             ROCZNIK (płynie w czasie)        SEMESTR (kontekst planowania)
Wydział, Kierunek,      Program ─▶ ProgramVersion    Cohort(program, startTerm)        AcademicTerm (2026/27 letni)
Specjalność, Przedmiot,     └▶ ProgramEntry          └▶ StudentGroup (drzewo)           └ TermCalendar (wydział × tryb × wariant)
Sala, Katedra,                 (sem. N, godziny,      CohortTerm = rocznik w semestrze     ├ CalendarBreak / CalendarDay
Prowadzący, Bloki              specjalność?)                                               └ Zjazd
            ZAJĘCIA:  ClassSection (semestr, rocznik, pozycja programu, forma, grupa, godziny)
            OBSADA:   SectionInstructor (zajęcia, prowadzący | NN, godziny)
            PLAN:     Placement (dzień, bloki, sala, prowadzący, rytm) ─▶ Occurrence (terminy) + PlacementException
```

| Oś | Co zawiera | Jak zmienia się w czasie |
|---|---|---|
| Katalog | wydziały, katedry, kierunki, specjalności, przedmioty, budynki, sale, prowadzący, bloki | rzadko; brak pola roku |
| Program | program (kierunek + poziom + tryb) i jego wersje | nowa wersja tylko przy zmianie programu (klon poprzedniej) |
| Rocznik | nabór na program, grupy | tworzony raz; grupy idą z nim przez studia, korekty zakresem semestrów |
| Semestr | kalendarze, zajęcia, obsada, plan, terminy | co semestr; poprzednie przechodzą do archiwum |

## 2. Semestr i kalendarz

- `AcademicTerm(startYear, type)` — `2026-Z` = 2026/27 zimowy, `2026-L` = 2026/27 letni.
  `ordinal = 2·startYear + (SUMMER ? 1 : 0)` porządkuje semestry (`lib/terms.ts`).
- `TermCalendar(term, wydział, tryb, nazwa wariantu)` — rytm `WEEKLY` albo `ZJAZD`,
  status `PLANNING → PUBLISHED → ARCHIVED`. Archiwum = tylko odczyt.
- `CalendarBreak` (przerwy), `CalendarDay` (dzień wolny, „zajęcia wg planu dnia X",
  godziny rektorskie od bloku), `Zjazd` (numer kolejny + daty; w UI opisany „tydz. N” jak w arkuszu
  planu — numer tygodnia semestru z lukami na przerwy, `teachingCalendar.semesterWeekOf`).
- `TimeGrid(wydział, tryb)` — **siatka godzin**: każdy wydział ma stacjonarną
  i niestacjonarną (siatki podstawowe, `base`). `TimeBlock` o dowolnym starcie i długości
  (np. 08:00–08:45), numerowane `order` wg godziny; 1 blok = 1 godzina programu, przerwy = odstępy.
  `days` — dni zajęć z oknem godzin (np. niestacjonarne: czw i pt od 16:00, sob, nd);
  zastępują sztywną regułę trybu studiów przy walidacji umieszczeń.
- **Siatki dnia** — dodatkowe `TimeGrid` wydziału i trybu z własnymi blokami dla wybranych dni
  (np. piątek niestacjonarnych 16:00, 16:50, 17:40, 18:30 przy sobocie 8:00 … 15:25, 16:15, …).
  Dni siatek jednego wydziału i trybu są rozłączne (siatka dnia zabiera je podstawowej, usunięta
  oddaje); dzień spoza siatek liczy się wg podstawowej (`gridSet.forDay`). Jedną podstawową na
  wydział i tryb pilnuje częściowy unikalny indeks. Bloki siatki zablokowane, gdy w jej dniach są
  umieszczenia w semestrze spoza archiwum (dla podstawowej: we wszystkich dniach poza siatkami dnia).
- **Święta ustawowe są liczone**, nie przechowywane (`lib/holidays.ts`, 24.12 od 2025).
- **Numer tygodnia zajęć** liczony od poniedziałku tygodnia startu, z pominięciem
  tygodni w całości w przerwie — wspólna parzystość dla wszystkich dni (`lib/teachingCalendar.ts`).
- Nowy kalendarz startuje z **propozycji** z ostatniego semestru tego samego typu:
  daty semestru i przerw — ten sam dzień miesiąca, zjazdy — ten sam dzień tygodnia.

## 3. Program studiów

- `Program` — kierunek + poziom + tryb (kod np. `EDST-S1`).
- `ProgramVersion` — `DRAFT` / `APPROVED`, `totalSemesters`, `defaultStartType`.
  **Wersja obowiązuje wiele roczników**; zmiana programu = nowa wersja sklonowana
  z poprzedniej. Zatwierdzona wersja jest zablokowana do edycji.
- `ProgramEntry` — przedmiot w semestrze N, godziny W/C/L/P/S, ECTS, zaliczenie,
  `specializationId` (null = wspólny dla kierunku). Unikalność
  `(version, subject, semester, specialization) NULLS NOT DISTINCT` — raw SQL.
- Prowadzący nie należy do programu (to obsada).

## 4. Rocznik i grupy

- `Cohort(program, programVersion, startTerm)` — jeden nabór; `lectureMode`:
  wykłady przedmiotów wspólnych razem (`JOINT`) albo osobno per specjalność (`SEPARATE`).
- Semestr programu w danym semestrze: `n = ordinal(term) − ordinal(startTerm) + 1`
  (działa też dla naboru lutowego). `CohortTerm` pozwala wyjątkowo poprawić `n`
  i wskazać kalendarz (tydzień / wariant zjazdów).
- `StudentGroup` należy do rocznika: `partitionKey` (ROOT, SPEC, C, L, P, S, własny),
  `code`, rodzic, liczebność, `fromSemester`/`toSemester` (scalenia, podział na specjalności).
- **Nazwa jest liczona** (`displayName`): `{spec|kierunek}{-SN}-{semestr}-{W|C|L|P|S}{-kod}`.
- **Reguła nakładania** (`groupsOverlap`): grupy rozłączne, gdy ich ścieżki od korzenia
  rozchodzą się przez **ten sam podział**; inaczej kolidują (przodek/potomek albo różne
  podziały, np. P-A i L-A1). Grupy różnych roczników nie kolidują.
- Student należy do najmniejszych grup; zajęcia nadrzędnych grup wynikają z reguły nakładania.

## 5. Zajęcia i obsada

- `ClassSection` — przedmiot × forma × grupa w semestrze, godziny jako kopia z programu.
  Wyprowadzane przez `lib/demand.ts`: W → grupa wykładowa (rocznik / specjalność),
  C → C, L → L (brak → C), P → P (brak → C), S → S (brak → C), brak C → grupa wykładowa.
  Przedmiot specjalnościowy bez grupy specjalności jest **pomijany i zgłaszany**.
- **Synchronizacja** to idempotentny diff z podglądem: dodaje, poprawia godziny,
  usuwa zbędne bez obsady i bez umieszczeń/terminów, pozostałe zbędne oznacza `ORPHANED`.
- `SectionInstructor` — prowadzący (albo NN) i godziny; podział godzin = kilka wierszy.
- **Katedra** (`Department`) — jednostka, która przysyła obciążenia swoich prowadzących
  (zakładka „Katedry” na stronie „Wydziały i katedry”). Oznaczenie jak w zleceniach wydziału:
  skrót katedry i wydziału (`KEO-WE`); jednostka międzywydziałowa (SJO, prowadzący zewnętrzni)
  nie ma wydziału i ma sam skrót. Skrót jest unikalny w wydziale (bez wielkości liter).
  Prowadzący ma najwyżej jedną katedrę (`Instructor.departmentId`); **katedra wydziałowa
  ustala wydział prowadzącego** (API prowadzących i skład katedry), przeniesienie katedry na inny
  wydział przenosi jej prowadzących. Katedry z prowadzącymi i wydziału z katedrami nie da się
  usunąć. Zmiany tylko ADMIN (jak prowadzący), dziekanat widzi listę.
- **Obsada z poprzedniego roku:** te same zajęcia poprzedniego rocznika tego programu
  (przedmiot + forma + sygnatura grupy) w ostatnim semestrze tego samego typu.
- **Strona „Obsada”** — te same dane z dwóch stron (`?widok=zajecia`):
  - **Obciążenia** — jak arkusze katedr: katedra → prowadzący → przedmiot i forma w roczniku
    z grupami („ćwiczenia, 3 gr. × 15 h = 45 h”), godziny na wydziale osobno stacjonarne
    i niestacjonarne oraz suma w uczelni (`GET /terms/:key/workload`, `lib/workload.ts`). Po
    wybraniu katedry widać też jej członków bez godzin — żeby dopisać im zajęcia z arkusza.
    „Dodaj zajęcia” ustawia **godziny jednej osoby** w wybranych grupach
    (`PUT /terms/:key/instructors/:id/staff`): obsada innych zostaje, **NN ustępuje**
    (`lib/staffing.withPersonHours`), godziny podpowiadają się jako wolne godziny grupy.
  - **Zajęcia** — pozycje przedmiot × forma z grupami i ich obsadą; tu widać braki (NN, wakaty,
    niepełne godziny). Okno pozycji zapisuje obsadę **wszystkich grup naraz**
    (`PUT /terms/:key/staff`, „Ustaw wszystkim grupom”) — wszystko albo nic.
  Zasady jednej listy obsady (dodatnie godziny, suma ≤ godziny zajęć, osoba raz) są wspólne dla
  wszystkich okien (`lib/staffing.staffProblem`); zakres liczy się po wydziale **zajęć**, więc
  dziekanat WM przypisze osobę z KEO-WE. Zajęcia łączone (`Placement.jointKey`) obciążenie
  liczy na razie dwa razy — obsada nie wie, że to jedne zajęcia.

## 6. Plan i terminy

- `Placement` — dzień, bloki `startOrder..endOrder` (siatki wydziału i trybu rocznika obowiązującej w tym dniu), sala albo **online**
  (`roomId = null`: bez sali, bez kolizji sal — grupy i prowadzący dalej sprawdzani), prowadzący z obsady (null = NN),
  rytm: `WEEK` (ALL / EVEN / ODD / LIST tygodni, od–do) albo `ZJAZD` (ALL / LIST zjazdów).
  Zajęcia łączone między kierunkami: wspólny `jointKey` (ten sam czas i sala, bez kolizji).
- **Nic nie układa planu automatycznie.** Planista umieszcza zajęcia ręcznie; opcjonalne
  „Przenieś plan z zeszłego roku" działa na żądanie, z podglądem, a każde przeniesione
  umieszczenie przechodzi tę samą walidację co ręczne.
- **Kolizje** sprawdzane na konkretnych datach (sala, prowadzący, grupy) w całej uczelni,
  **w minutach** — wydziały mają różne siatki godzin; odrzucenie zawiera listę dat.
  Typ i pojemność sali, dni i okno godzin z siatki.
- **Jedna zajętość dla wzorca i terminów** (`services/plan.ts → termOccupancy`): wzorce całej
  uczelni rozpisane na daty z naniesionymi przeniesieniami oraz limitem godzin
  (to, co dałoby generowanie), terminy ręczne i terminy po usuniętych umieszczeniach; przy
  zmianie pojedynczego terminu dochodzą wygenerowane terminy. Używana przy zapisie umieszczenia,
  podświetleniu, przeniesieniu terminu, terminie ręcznym i generowaniu.
- **Zajęcia łączone między wydziałami** dzielą rzeczywisty czas: dołączenie wymaga tego samego
  dnia i godzin, zmiana przenosi pozostałe umieszczenia do ich siatek po godzinach.
- `Occurrence` — termin (bloki + rzeczywisty czas `startMinute/endMinute`). `DERIVED` powstają **tylko** przez „Generuj terminy"
  (`services/plan.ts → generate`, najpierw podgląd): godziny wyczerpywane w kolejności dat
  przez wszystkie umieszczenia zajęć, ostatni termin skracany, kolidujące pomijane i zgłaszane.
  W opublikowanym semestrze generowanie od wybranej daty.
- `PlacementException(placement, originalDate)` — przeniesienie pojedynczego
  terminu; **przeżywa ponowne generowanie**. Wyjątek bez daty we wzorcu trafia do raportu.
- `Occurrence.kind = MANUAL` — terminy ręczne (zajęcia dodatkowe, jednorazowe); liczą się do godzin
  (przy generowaniu wzorzec da o tyle mniej), nie znikają. Termin nie ma statusu (odwołań
  nie ma) — ręczny wyróżnia `kind`.
- Nowe miejsce terminu (przeniesienie, termin ręczny) jest oceniane
  względem kalendarza rocznika i okna godzin siatki (`lib/occurrenceSlot`): data poza semestrem
  blokuje, a święto, przerwa, dzień poza zjazdami czy godziny poza oknem wymagają potwierdzenia
  (`409 { code: 'SLOT_WARNINGS', warnings }` → ponowienie z `confirmWarnings: true`).
- **Stałe id terminów:** „Generuj terminy" robi diff (`lib/occurrenceDiff`) — termin o tym samym
  kluczu (umieszczenie + data z wzorca, unikalny indeks `Occurrence(placementId, originalDate)`)
  jest aktualizowany w miejscu i zachowuje id; nowe daty wzorca → nowe terminy, daty, których już
  nie ma (i terminy usuniętych umieszczeń) → usunięte. Zakres „od dnia" liczony jest po dacie z wzorca.
- Zmiana wzorca po generowaniu → „terminy nieaktualne" — liczone per rocznik od jego ostatniego
  generowania (`CohortGeneration`, nie od kalendarza, który dzieli wiele roczników);
  jedno źródło dla planu i „Przygotowania semestru" (`services/staleness.ts`).
  Powód „kalendarz" porównuje **odcisk** kalendarza zapisany przy generowaniu
  (`CohortGeneration.calendarKey`: kalendarz, semestr rocznika, daty) z obecnym — zmiana
  „tam i z powrotem" nie unieważnia terminów; stare generowania bez odcisku porównują czasy.
- **Widoczność dla studentów i prowadzących** („Mój plan", panel główny) liczy się z kalendarza
  **rocznika**: tylko opublikowany albo w archiwum (`services/visibility.publishedCohortKeys`).
  Rocznik przypięty do wariantu „w planowaniu" nie pokazuje planu, choć wydział ma inne
  opublikowane kalendarze.

## 6a. Przeniesienia terminów i „Plan zjazdu”

- Plan zmienia **tylko planista** (ADMIN, DEAN_OFFICE swojego wydziału). Prowadzący i student plan
  tylko oglądają; powód przeniesienia (`Occurrence.note`) widać w ich „Moim planie”.
- **Kalendarz zjazdów (niestacjonarne): „Plan zjazdu”** — jeden widok na konkretny zjazd z datami,
  bez zakładki „Terminy”. Zajęcia dodane w zjeździe dostają rytm `LIST [N]`; zmiana albo usunięcie
  zajęć z kilku zjazdów „tylko w tym zjeździe” rozdziela umieszczenie: stare traci zjazd N (zostaje
  `LIST` pozostałych), a zajęcia w N dostają własne umieszczenie (`POST /api/placements/:id/split`,
  jedna transakcja, kolizje jak przy umieszczeniu; przeniesienia starego umieszczenia z dat zjazdu N
  są usuwane). Przeniesienie do innego zjazdu: pole „Zjazd” w oknie zajęć — zajęcia z jednego zjazdu
  zmieniają rytm (`LIST [M]`), z kilku są rozdzielane z `toZjazd` (nowe umieszczenie `LIST [M]`;
  gdy stare też jest w zjeździe M, jego spotkanie liczy się do kolizji). Pojedynczych terminów
  zjazdów UI już nie przenosi.
- **Kalendarz tygodniowy:** terminy przenosi, przywraca wg wzorca i dodaje ręcznie planista w zakładce
  „Terminy” (`services/occurrenceChanges`) — tylko poza studiami stacjonarnymi (te są do wglądu).
- **Odwołań ani odrobień nie ma** (ani na stacjonarnych, ani na niestacjonarnych) — usunięte
  migracjami `20261115200000_drop_makeups` (strona „Odrobienia”, `makeupOfId`, status `MAKEUP`)
  i `20261115210000_drop_cancellations` (`Occurrence.status`, `PlacementException.action`; dawne
  odwołania wróciły do planu). Zajęcia, które mają się odbyć w innym dniu, się **przenosi**.
- planista10 nie ma zgłoszeń zmian prowadzących ani powiadomień w aplikacji (tabele
  `ChangeRequest` i `Notification` usunięte migracją `20261115120000_drop_change_requests_notifications`).
- **Studia stacjonarne** — ten sam plan w każdym tygodniu, dni zajęć z kalendarza Rektora (dni wolne,
  zajęcia z innego dnia, przerwy). Pojedynczych terminów się nie przenosi: terminy rocznika
  stacjonarnego są tylko do wglądu (co było i co będzie, dni wolne, zamiany dni), API odrzuca ich
  zmiany (409, `assertPlanEditable`). Zmiana planu od tygodnia X to zmiana wzorca: umieszczenie
  „do tygodnia X−1” + nowe „od tygodnia X”, potem „Generuj terminy” — przeszłe tygodnie zostają,
  a kolizje nowego miejsca liczą się od tygodnia X.

## 7. Widoczność i uprawnienia

- **ADMIN** — katalog, semestry, wszystko. **DEAN_OFFICE** — dane swojego wydziału
  (`assertFacultyScope`). **INSTRUCTOR / STUDENT** — „Mój plan" i dashboard tylko
  z kalendarzy `PUBLISHED`/`ARCHIVED`.
- Przełącznik semestru jest tylko na stronach semestralnych (kalendarz, roczniki,
  obsada, plan, przygotowanie, mój plan); semestr siedzi w adresie (`/plan/2026-L`).

## 8. Praca planisty w nowym semestrze

1. Kalendarz (z propozycji z zeszłego roku) → 2. Nowy nabór (struktura grup jak poprzedni)
→ 3. Korekty roczników → 4. Synchronizacja zajęć i obsada (Obciążenia z arkuszy katedr, z poprzedniego roku, CSV)
→ 5. Plan ręcznie (opcjonalnie „Przenieś plan") → 6. Generuj terminy → 7. Publikacja.
Strona „Przygotowanie semestru" pokazuje stan każdego kroku.

## 9. Skąd model się wziął

Stary model (planista7) trzymał rok akademicki w siatkach, grupach, wzorcach i kalendarzach,
kopiował siatki co rok i grupy per rok, a generator nadpisywał cały kalendarz wydziału.
Przebudowa w 7 etapach przeniosła dane (migracje `20261106…`) i usunęła stare tabele.
