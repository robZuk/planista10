#!/usr/bin/env bash
# Odswieza db/planista10-dump.sql.gz — zrzut bazy (seed dla nowego komputera) pozbawiony
# tokenow sesji i z haslami przestawionymi na demonstracyjne (te z seed.ts i z generatora
# scripts/pelne-dane). Kontener `db` wgrywa ten plik sam przy pierwszym starcie (pusty wolumen).
#
# Czysci na KOPII bazy, zeby nie ruszyc zrodla. Uzycie:
#   bash db/make-dump.sh                    # zrodlo: planista10
#   bash db/make-dump.sh planista10_pelne   # zrodlo: pelna baza testowa
#   bash db/make-dump.sh planista10 ~/planista10-serwer.sql.gz   # zrzut poza repo (np. na serwer — scp)
set -euo pipefail

CONTAINER=planista10-db-1
BACKEND=planista10-backend-1
ZRODLO=${1:-planista10}
KOPIA=planista10_public
KATALOG="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WYJSCIE=${2:-"$KATALOG/planista10-dump.sql.gz"}

psql_kopia() { docker exec -i "$CONTAINER" psql -U postgres -d "$KOPIA" -v ON_ERROR_STOP=1 "$@"; }

sprzataj() {
  docker exec "$CONTAINER" psql -U postgres -d postgres \
    -c "DROP DATABASE IF EXISTS $KOPIA;" >/dev/null 2>&1 || true
}
trap sprzataj EXIT

# Hashe generujemy za kazdym razem od nowa (inna sol), zeby w repo nie siedziala na stale ta sama
# wartosc. Hasla jak w backend/prisma/seed.ts i backend/scripts/pelne-dane/generuj.ts. bcryptjs
# bierzemy z kontenera backendu (node_modules na hoscie jest puste — zaleznosci sa w kontenerze).
echo "==> generuje hashe hasel"
HASHE=$(docker exec "$BACKEND" node -e "
const bcrypt = require('bcryptjs');
const konta = {
  'admin@umg.edu.pl':          'Admin1234!',
  'dziekanat@umg.edu.pl':      'Dziekanat1234!',
  'dziekanat.we@umg.edu.pl':   'Dziekanat1234!',
  'dziekanat.wm@umg.edu.pl':   'Dziekanat1234!',
  'dziekanat.wn@umg.edu.pl':   'Dziekanat1234!',
  'dziekanat.wznj@umg.edu.pl': 'Dziekanat1234!',
  'planista.wm@umg.edu.pl':    'Planista1234!',
  'prowadzacy@umg.edu.pl':     'Prowadzacy1234!',
  'student@umg.edu.pl':        'Student1234!',
};
for (const [email, haslo] of Object.entries(konta)) {
  const hash = bcrypt.hashSync(haslo, 10).replace(/'/g, \"''\");
  console.log(\`UPDATE \\\"User\\\" SET password = '\${hash}' WHERE email = '\${email}';\`);
}")

echo "==> kopiuje $ZRODLO -> $KOPIA"
# Kopia przez pg_dump | psql (nie TEMPLATE) — backend moze zostac podlaczony do zrodla.
docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS $KOPIA;" \
  -c "CREATE DATABASE $KOPIA;" >/dev/null
docker exec "$CONTAINER" sh -c "pg_dump -U postgres -d $ZRODLO | psql -q -U postgres -d $KOPIA -v ON_ERROR_STOP=1" >/dev/null

echo "==> czyszcze kopie"
psql_kopia >/dev/null <<SQL
BEGIN;
DELETE FROM "RefreshToken";
$HASHE
COMMIT;
SQL

# Kontrola przed zrzutem — obie musza przejsc, inaczej plik nie moze trafic do repo.
echo "==> sprawdzam"

# 1. Zaden token sesji nie przetrwal.
TOKENY=$(psql_kopia -At -c 'SELECT count(*) FROM "RefreshToken";')
[ "$TOKENY" = "0" ] || { echo "BLAD: zostalo $TOKENY tokenow odswiezania"; exit 1; }

# 2. Kazde konto dostalo nowe haslo. Konto spoza listy (np. dodane recznie)
#    UPDATE pomija, wiec niesie prawdziwy hash z bazy roboczej.
OBCE=$(psql_kopia -At <<'SQL'
SELECT count(*) FROM "User" WHERE email NOT IN (
  'admin@umg.edu.pl', 'dziekanat@umg.edu.pl', 'dziekanat.we@umg.edu.pl', 'dziekanat.wm@umg.edu.pl',
  'dziekanat.wn@umg.edu.pl', 'dziekanat.wznj@umg.edu.pl', 'planista.wm@umg.edu.pl',
  'prowadzacy@umg.edu.pl', 'student@umg.edu.pl');
SQL
)
[ "$OBCE" = "0" ] || {
  echo "BLAD: $OBCE kont spoza listy demonstracyjnej — ich hasel skrypt nie podmienil."
  echo "      Dopisz je do listy 'konta' powyzej albo usun z bazy przed zrzutem."
  exit 1
}

echo "==> zrzucam do $WYJSCIE"
docker exec "$CONTAINER" pg_dump -U postgres -d "$KOPIA" \
  --clean --if-exists --no-owner --no-privileges | gzip -9 > "$WYJSCIE"

echo "gotowe: $(wc -c < "$WYJSCIE") bajtow (gzip), zrodlo: $ZRODLO"
