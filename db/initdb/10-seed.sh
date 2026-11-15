#!/bin/sh
# Seed bazy przy PIERWSZYM starcie kontenera db (pusty wolumen pgdata) — obraz postgres wykonuje
# skrypty z /docker-entrypoint-initdb.d tylko wtedy. Wgrywa db/planista10-dump.sql.gz (db/README.md).
# PLANISTA_SEED=0 (np. CI E2E): baza zostaje pusta — schemat nakladaja migracje, dane seed.ts.
# Bez `exit` i `set`: obraz moze ten plik wykonac albo wczytac (source) do swojego skryptu.
if [ "${PLANISTA_SEED:-1}" = "0" ]; then
  echo "planista10: seed pominiety (PLANISTA_SEED=0)"
else
  echo "planista10: wgrywam seed /seed/planista10-dump.sql.gz"
  gunzip -c /seed/planista10-dump.sql.gz | psql -q -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"
fi
