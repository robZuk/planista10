# Model danych — planowanie zajęć (planista9)

Dokument referencyjny. Opisuje, jak dane zachowują się w czasie, i kluczowe decyzje
modelowe. Aktualizować przy zmianach `backend/prisma/schema.prisma`.

## 1. Cztery osie czasu

```
KATALOG (bez roku)      PROGRAM (wersje)             ROCZNIK (płynie w czasie)        SEMESTR (kontekst planowania)
Wydział, Kierunek,      Program ─▶ ProgramVersion    Cohort(program, startTerm)        AcademicTerm (2026/27 letni)
Specjalność, Przedmiot,     └▶ ProgramEntry          └▶ StudentGroup (drzewo)           └ TermCalendar (wydział × tryb × wariant)
Sala, Prowadzący, Bloki        (sem. N, godziny,      CohortTerm = rocznik w semestrze     ├ CalendarBreak / CalendarDay
                               specjalność?)                                               └ Zjazd
            ZAJĘCIA:  ClassSection (semestr, rocznik, pozycja programu, forma, grupa, godziny)
            OBSADA:   SectionInstructor (zajęcia, prowadzący | NN, godziny)
            PLAN:     Placement (dzień, bloki, sala, prowadzący, rytm) ─▶ Occurrence (terminy) + PlacementException
```

| Oś | Co zawiera | Jak zmienia się w czasie |
|---|---|---|
| Katalog | wydziały, kierunki, specjalności, przedmioty, budynki, sale, prowadzący, bloki | rzadko; brak pola roku |
| Program | program (kierunek + poziom + tryb) i jego wersje | nowa wersja tylko przy zmianie programu (klon poprzedniej) |
| Rocznik | nabór na program, grupy | tworzony raz; grupy idą z nim przez studia, korekty zakresem semestrów |
| Semestr | kalendarze, zajęcia, obsada, plan, terminy | co semestr; poprzednie przechodzą do archiwum |

## 2. Semestr i kalendarz

- `AcademicTerm(startYear, type)` — `2026-Z` = 2026/27 zimowy, `2026-L` = 2026/27 letni.
  `ordinal = 2·startYear + (SUMMER ? 1 : 0)` porządkuje semestry (`lib/terms.ts`).
- `TermCalendar(term, wydział, tryb, nazwa wariantu)` — rytm `WEEKLY` albo `ZJAZD`,
  status `PLANNING → PUBLISHED → ARCHIVED`. Archiwum = tylko odczyt.
- `CalendarBreak` (przerwy), `CalendarDay` (dzień wolny, „zajęcia wg planu dnia X",
  godziny rektorskie od bloku), `Zjazd` (numer + daty).
- `TimeGrid(wydział, tryb)` — **siatka godzin**: każdy wydział ma stacjonarną
  i niestacjonarną. `TimeBlock` o dowolnym starcie i długości (np. 08:00–08:45),
  numerowane `order` wg godziny; 1 blok = 1 godzina programu, przerwy = odstępy.
  `days` — dni zajęć z oknem godzin (np. niestacjonarne: czw i pt od 16:00, sob, nd);
  zastępują sztywną regułę trybu studiów przy walidacji umieszczeń. Bloki zablokowane,
  gdy wydział ma umieszczenia w tym trybie w semestrze spoza archiwum.
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
- **Obsada z poprzedniego roku:** te same zajęcia poprzedniego rocznika tego programu
  (przedmiot + forma + sygnatura grupy) w ostatnim semestrze tego samego typu.

## 6. Plan i terminy

- `Placement` — dzień, bloki `startOrder..endOrder` (siatki wydziału i trybu rocznika), sala albo **online**
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
  uczelni rozpisane na daty z naniesionymi przeniesieniami i odwołaniami oraz limitem godzin
  (to, co dałoby generowanie), terminy ręczne i terminy po usuniętych umieszczeniach; przy
  zmianie pojedynczego terminu dochodzą wygenerowane terminy. Używana przy zapisie umieszczenia,
  podświetleniu, przeniesieniu terminu, terminie ręcznym i generowaniu.
- **Zajęcia łączone między wydziałami** dzielą rzeczywisty czas: dołączenie wymaga tego samego
  dnia i godzin, zmiana przenosi pozostałe umieszczenia do ich siatek po godzinach.
- `Occurrence` — termin (bloki + rzeczywisty czas `startMinute/endMinute`). `DERIVED` powstają **tylko** przez „Generuj terminy"
  (`services/plan.ts → generate`, najpierw podgląd): godziny wyczerpywane w kolejności dat
  przez wszystkie umieszczenia zajęć, ostatni termin skracany, kolidujące pomijane i zgłaszane.
  W opublikowanym semestrze generowanie od wybranej daty.
- `PlacementException(placement, originalDate)` — odwołanie albo przeniesienie pojedynczego
  terminu; **przeżywa ponowne generowanie**. Wyjątek bez daty we wzorcu trafia do raportu.
- `Occurrence.kind = MANUAL` — odrobienia i terminy jednorazowe; liczą się do godzin, nie znikają.
- Zmiana wzorca po generowaniu → „kalendarz nieaktualny" (`TermCalendar.lastGeneratedAt`).

## 7. Widoczność i uprawnienia

- **ADMIN** — katalog, semestry, wszystko. **DEAN_OFFICE** — dane swojego wydziału
  (`assertFacultyScope`). **INSTRUCTOR / STUDENT** — „Mój plan" i dashboard tylko
  z kalendarzy `PUBLISHED`/`ARCHIVED`.
- Przełącznik semestru jest tylko na stronach semestralnych (kalendarz, roczniki,
  obsada, plan, przygotowanie, mój plan); semestr siedzi w adresie (`/plan/2026-L`).

## 8. Praca planisty w nowym semestrze

1. Kalendarz (z propozycji z zeszłego roku) → 2. Nowy nabór (struktura grup jak poprzedni)
→ 3. Korekty roczników → 4. Synchronizacja zajęć i obsada (z poprzedniego roku, CSV)
→ 5. Plan ręcznie (opcjonalnie „Przenieś plan") → 6. Generuj terminy → 7. Publikacja.
Strona „Przygotowanie semestru" pokazuje stan każdego kroku.

## 9. Skąd model się wziął

Stary model (planista7) trzymał rok akademicki w siatkach, grupach, wzorcach i kalendarzach,
kopiował siatki co rok i grupy per rok, a generator nadpisywał cały kalendarz wydziału.
Przebudowa w 7 etapach przeniosła dane (migracje `20261106…`) i usunęła stare tabele.
