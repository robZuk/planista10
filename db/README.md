# Zrzut bazy `planista8`

`planista8-dump.sql` to pełny zrzut bazy (schemat + dane) w **nowym modelu planowania**:
semestry i kalendarze, programy studiów, roczniki z grupami, zajęcia z obsadą, plan
(umieszczenia) i terminy. Dane pochodzą z importu zimy 2024/2025 (Wydział Mechaniczny),
przeniesionego ze starego modelu migracjami etapów 1–7. Plik jest **oczyszczony**, więc
może leżeć w repozytorium (zwykły `pg_dump` nie może — patrz niżej).

Zrzut zrobiony `pg_dump --clean --if-exists --no-owner --no-privileges`, więc
wgrywa się do dowolnej bazy i sam usuwa to, co w niej zastanie.

## Co zawiera

| Tabela | Wierszy | Co to jest |
|---|---|---|
| `Occurrence` | 3327 | terminy zimy 2024/25 (oba tryby) |
| `Placement` | 243 | umieszczenia zajęć we wzorcu |
| `ClassSection` | 413 | zajęcia semestru (przedmiot × forma × grupa) |
| `SectionInstructor` | 243 | obsada (z dawnych wzorców) |
| `ProgramEntry` | 304 | 3 programy po jednej wersji (zamiast 15 kopii rocznych) |
| `StudentGroup` | 90 | grupy 8 roczników (nabory 2021–2024) |
| `TermCalendar` | 48 | kalendarze 2023/24–2025/26 (archiwum) |
| `AcademicTerm` | 10 | semestry 2021/22 – 2026/27 |
| `RefreshToken` | 0 | — |

Semestry 2023–2025 są w archiwum (tylko odczyt). Zima i lato 2026/27 istnieją, ale bez
kalendarzy — od nich zaczyna się praca w nowym modelu.

`_prisma_migrations` jest w zrzucie, więc po wgraniu Prisma nie migruje od zera.
Gdyby zrzut był starszy niż katalog `backend/prisma/migrations/`, domigruj:

```bash
docker exec planista8-backend-1 npx prisma migrate deploy
```

## Czym różni się od stanu bazy roboczej

- **`RefreshToken` jest pusty.** Tokeny sesji to sekrety, nie trafiają do gita.
- **Hasła są przestawione na te z `backend/prisma/seed.ts`**, ze świeżymi solami bcrypt:

  | Konto | Hasło |
  |---|---|
  | `admin@umg.edu.pl` | `Admin1234!` |
  | `dziekanat@umg.edu.pl` (wydział WM) | `Dziekanat1234!` |
  | `prowadzacy@umg.edu.pl` | `Prowadzacy1234!` |
  | `student@umg.edu.pl` | `Student1234!` |

To są hasła demonstracyjne. **Nie stawiaj na tym zrzucie niczego wystawionego na świat**
bez wcześniejszej zmiany haseł.

## Odtworzenie

```bash
docker compose up -d
docker exec -i planista8-db-1 psql -U postgres -d planista8 -v ON_ERROR_STOP=1 < db/planista8-dump.sql
```

## Odświeżenie zrzutu

`make-dump.sh` kopiuje bazę roboczą, czyści kopię (tokeny, hasła), zrzuca ją i kasuje
kopię. Baza `planista8` pozostaje nietknięta. Kopia przez `TEMPLATE` wymaga, żeby nikt
nie był podłączony do bazy — zatrzymaj na chwilę backend:

```bash
docker compose stop backend && bash db/make-dump.sh; docker compose start backend
```

## Dlaczego nie zwykły `pg_dump`

`.gitignore` blokuje `backup.sql` i `*.sql.bak`, bo surowy zrzut niesie hashe haseł
i aktywne tokeny odświeżania. Ten plik przechodzi, bo jednego i drugiego jest pozbawiony.

## Skąd się wzięły dane (stary model)

Dawny zrzut `planista7-dump.sql` (siatki kopiowane co rok, wzorce tygodnia, stary
generator) został przeniesiony do nowego modelu migracjami `20261106090000` … `20261106130000`
oraz jednorazowymi skryptami przeniesienia zajęć i planu (etapy 4–5, usunięte po użyciu —
są w historii zmian). Migracja `20261106140000_drop_legacy_model` usuwa stare tabele i ma
bramkę: nie pozwoli ich skasować, jeśli stary plan nie został wcześniej przeniesiony.
