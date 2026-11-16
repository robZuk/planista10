# Seed bazy `planista10`

`planista10-dump.sql.gz` to spakowany zrzut bazy (schemat + dane). Kontener `db` wypełnia nim
bazę `planista10` **przy pierwszym starcie**, czyli przy pustym wolumenie `pgdata` (skrypt
`initdb/10-seed.sh`). Na nowym komputerze wystarczy sklonować repo i uruchomić trzy kontenery:

```bash
make dev-build        # albo: docker compose up -d --build  →  db, backend, frontend
# aplikacja: http://localhost:5177 (konta niżej)
```

Backend przy starcie generuje klienta Prisma i robi `prisma migrate deploy`, więc baza ze zrzutu
dostaje też migracje nowsze od zrzutu. Istniejącego wolumenu kontener nie rusza — dane, które już
masz lokalnie, zostają.

## Co zawiera

Pełna baza testowa (`planista10_pelne`, generator `backend/scripts/pelne-dane`): wydziały WE, WM, WN,
WZNJ, programy (prawdziwe plany studiów WN i WM, reszta generowana), sale, **fikcyjni prowadzący**,
roczniki z grupami, obsada i plan semestru zimowego 2026/27 z terminami. Model po migracji
`20261115210000_drop_cancellations`.

| Tabela | Wierszy | Co to jest |
|---|---|---|
| `Faculty` | 4 | wydziały WE, WM, WN, WZNJ |
| `Room` | 199 | sale w 11 budynkach |
| `Instructor` | 238 | prowadzący (fikcyjni) |
| `Program` | 34 | programy studiów |
| `Cohort` | 108 | roczniki (996 grup) |
| `ClassSection` | 4124 | zajęcia semestru (przedmiot × forma × grupa) |
| `Placement` | 4128 | umieszczenia zajęć w planie |
| `Occurrence` | 48129 | terminy zimy 2026/27 |
| `RefreshToken` | 0 | — |

Zrzut zrobiony `pg_dump --clean --if-exists --no-owner --no-privileges`, więc wgrywa się do
dowolnej bazy i sam usuwa to, co w niej zastanie.

## Konta

Hasła są przestawione na demonstracyjne (świeże sole bcrypt przy każdym zrzucie):

| Konto | Rola | Hasło |
|---|---|---|
| `admin@umg.edu.pl` | administrator | `Admin1234!` |
| `dziekanat.wm@umg.edu.pl` (też `.we`, `.wn`, `.wznj`) | dziekanat wydziału | `Dziekanat1234!` |
| `planista.wm@umg.edu.pl` | dziekanat WM | `Planista1234!` |
| `prowadzacy@umg.edu.pl` | prowadzący | `Prowadzacy1234!` |
| `student@umg.edu.pl` | student | `Student1234!` |

To są hasła demonstracyjne. **Nie stawiaj na tym zrzucie niczego wystawionego na świat**
bez wcześniejszej zmiany haseł.

## Ponowne wgranie (nadpisuje bazę)

```bash
gunzip -c db/planista10-dump.sql.gz | docker exec -i planista10-db-1 psql -q -U postgres -d planista10 -v ON_ERROR_STOP=1
```

Albo od zera — **kasuje wszystkie lokalne dane bazy**: `docker compose down -v && docker compose up -d`.

Pusta baza zamiast zrzutu (tak jak w CI): przy pustym wolumenie `PLANISTA_SEED=0 docker compose up -d`,
potem `docker compose exec backend npm run db:seed` (minimalne dane z `backend/prisma/seed.ts`).

## Katedry testowe

Zrzut powstał przed migracją `20261116120000_departments`, więc po wgraniu nie ma katedr
(prowadzący są bez katedry). Przykładowe katedry i przypisanie fikcyjnych prowadzących wg
przedmiotu, którego uczą najwięcej, dokłada skrypt — idempotentnie, bez ruszania reszty danych
(generator `scripts/pelne-dane` woła go sam):

```bash
docker exec planista10-backend-1 npx tsx scripts/pelne-dane/katedry.ts
```

## Odświeżenie zrzutu

```bash
bash db/make-dump.sh planista10_pelne   # bez argumentu: baza planista10
```

Skrypt kopiuje bazę źródłową (`pg_dump | psql` — backend może dalej działać), czyści kopię
(tokeny sesji, hasła → demonstracyjne), sprawdza ją, zrzuca do `planista10-dump.sql.gz`
i kasuje kopię. Konto spoza listy demonstracyjnej zatrzymuje skrypt (jego hasła by nie podmienił).

## Dlaczego nie zwykły `pg_dump`

`.gitignore` blokuje `backup.sql` i `*.sql.bak`, bo surowy zrzut niesie hashe haseł
i aktywne tokeny odświeżania. Ten plik przechodzi, bo jednego i drugiego jest pozbawiony.

## Wcześniejszy zrzut

Do 15.11.2026 w repo leżał `planista10-dump.sql` — import zimy 2024/25 (Wydział Mechaniczny)
przeniesiony ze starego modelu migracjami etapów 1–7. Jest w historii gita; lokalna baza
`planista10` z tym importem zostaje nietknięta.
