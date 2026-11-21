# Deploy na Mikrus 3.5

Runbook wdrożenia Planisty 10 na serwer Mikrus 3.5 (4 GB RAM / 25 GB, LXC). Aplikacja jedzie w trzech
kontenerach z `docker-compose.prod.yml`: `db` (Postgres 16, baza `planista10`), `backend` (Node, port
wewnętrzny 4001) i `frontend` (nginx — podaje SPA i przekazuje `/api` oraz `/health` do backendu). Na zewnątrz
wystawiony jest **tylko** nginx frontu, na porcie `WEB_PORT`.

> Miejsca oznaczone **[PANEL]** wymagają danych z panelu Mikrusa — adres i port SSH, przydzielone porty,
> subdomena.

Kod: `github.com/robZuk/planista10` (gałąź `main`). Obrazy buduje workflow `Deploy` (`.github/workflows/deploy.yml`)
przy każdym pushu do `main` i wypycha do GHCR: `ghcr.io/robzuk/planista10-backend:latest`,
`ghcr.io/robzuk/planista10-frontend:latest` (publiczne — `docker pull` bez logowania).

## 1. SSH na serwer
```bash
ssh -p PORT_SSH root@srvXX.mikr.us          # [PANEL] adres i port SSH
```
Najlepiej z kluczem: `ssh-copy-id -p PORT_SSH root@srvXX.mikr.us`.

## 2. Docker + compose
```bash
curl -fsSL https://get.docker.com | sh       # Docker Engine + plugin compose
docker compose version
docker info | grep -i "Storage Driver"
```
> **Uwaga LXC:** jeśli Docker nie wstaje albo storage-driver zgłasza błąd, pomaga `fuse-overlayfs`:
> `apt-get install -y fuse-overlayfs`, w `/etc/docker/daemon.json` ustaw
> `{"storage-driver":"fuse-overlayfs"}` i `systemctl restart docker`.

## 3. Klon repo
Katalog `/srv/planista` — tego samego używa automatyczny deploy (krok 11).
```bash
git clone https://github.com/robZuk/planista10.git /srv/planista
cd /srv/planista
```

## 4. Sekrety backendu (`.env.prod`)
```bash
cp .env.prod.example .env.prod
sed -i "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env.prod
sed -i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env.prod
sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=https://SUBDOMENA|" .env.prod    # [PANEL] docelowy adres
chmod 600 .env.prod
```

## 5. Port i hasło bazy (`.env`)
Compose czyta plik `.env` obok `docker-compose.prod.yml` sam — także przy automatycznym deployu, który robi
zwykłe `docker compose up -d`. Dlatego `WEB_PORT` **nie** ustawiaj przez `export`, tylko tutaj.
```bash
cat > .env <<EOF
WEB_PORT=XXXXX
DB_PASSWORD=$(openssl rand -hex 24)
EOF
chmod 600 .env
```
- `WEB_PORT` — jeden z **przydzielonych portów** Mikrusa **[PANEL]**.
- `DB_PASSWORD` — hasło Postgresa (tylko znaki hex, bo trafia też do `DATABASE_URL`). Baza nie ma portu na
  hoście — dostęp jest tylko z sieci kontenerów. Hasło ustala się przy **pierwszym** starcie bazy (pusty
  wolumen). Późniejsza zmiana w `.env` wymaga też `ALTER USER postgres PASSWORD '…'` w bazie.

## 6. Uruchomienie
```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps          # backend: healthy
```
Backend na starcie robi `prisma migrate deploy`, więc w pustej bazie powstaje schemat. Gdyby obrazy z GHCR
były niedostępne, zbuduj je na miejscu: `docker compose -f docker-compose.prod.yml up -d --build` (4 GB RAM
wystarcza).

## 7. Dane
Nowa baza ma sam schemat. Wgraj zrzut. Zrzut **dzisiejszej bazy roboczej** rób lokalnie skryptem, który
usuwa tokeny sesji i przestawia hasła na demonstracyjne — plik zapisuj **poza repo** (repo jest publiczne,
a robocza baza ma prawdziwe nazwiska prowadzących z opublikowanych planów):
```bash
# lokalnie
bash db/make-dump.sh planista10 ~/planista10-serwer.sql.gz
scp -P PORT_SSH ~/planista10-serwer.sql.gz root@srvXX.mikr.us:/srv/planista/
```
Na serwerze:
```bash
cd /srv/planista
gunzip -c planista10-serwer.sql.gz | docker compose -f docker-compose.prod.yml exec -T db \
  psql -q -U postgres -d planista10 -v ON_ERROR_STOP=1
docker compose -f docker-compose.prod.yml restart backend    # dogoni migracje nowsze od zrzutu
rm planista10-serwer.sql.gz
```
Zamiast bazy roboczej można wgrać zrzut z repo `db/planista10-dump.sql.gz` (fikcyjni prowadzący) tym samym
poleceniem.

## 8. Hasła — PRZED wystawieniem na świat
Zrzut ma hasła demonstracyjne z publicznego `README.md`. Zanim podepniesz subdomenę, nadaj kontom nowe hasła —
w aplikacji (Administracja → Użytkownicy → edycja) albo od razu wszystkim, losowo:
```bash
docker compose -f docker-compose.prod.yml exec -T backend node -e '
const bcrypt = require("bcryptjs"), crypto = require("crypto");
for (const e of ["admin@umg.edu.pl","planista.wm@umg.edu.pl","dziekanat.wm@umg.edu.pl","dziekanat.we@umg.edu.pl",
  "dziekanat.wn@umg.edu.pl","dziekanat.wznj@umg.edu.pl","prowadzacy@umg.edu.pl","student@umg.edu.pl"]) {
  const p = crypto.randomBytes(9).toString("base64url");
  console.error(e + "  " + p);
  console.log(`UPDATE "User" SET password = $$${bcrypt.hashSync(p, 12)}$$ WHERE email = $$${e}$$;`);
}' 2>hasla.txt | docker compose -f docker-compose.prod.yml exec -T db psql -q -U postgres -d planista10
cat hasla.txt && rm hasla.txt          # zapisz hasła w menedżerze haseł
```

## 9. Weryfikacja (na serwerze)
```bash
curl -s localhost:$(grep WEB_PORT .env | cut -d= -f2)/health                       # {"data":{"status":"ok",...}}
curl -s localhost:$(grep WEB_PORT .env | cut -d= -f2) | grep -o '<title>[^<]*</title>'
docker compose -f docker-compose.prod.yml logs --tail 50 backend
```

## 10. Subdomena + HTTPS
**[PANEL]** Podepnij subdomenę (albo integrację Cloudflare) do portu `WEB_PORT`. HTTPS załatwia Mikrus /
Cloudflare — aplikacja nie potrzebuje certyfikatów. Front woła `/api` relatywnie, więc nigdzie nie trzeba
wpisywać adresu backendu. Upewnij się, że `CORS_ORIGIN` w `.env.prod` to finalny adres, i po zmianie:
`docker compose -f docker-compose.prod.yml up -d`.

## 11. Aktualizacje
**Automatycznie (CD):** workflow `Deploy` po zielonych testach buduje obrazy i — gdy w repo są sekrety — loguje
się przez SSH i robi w `/srv/planista`: `git pull --ff-only`, `pull`, `up -d`, `image prune`. Sekrety
(Settings → Secrets and variables → Actions):

| Sekret | Wartość |
|---|---|
| `MIKRUS_HOST` | `srvXX.mikr.us` **[PANEL]** |
| `MIKRUS_PORT` | port SSH **[PANEL]** |
| `MIKRUS_USER` | `root` |
| `MIKRUS_SSH_KEY` | klucz prywatny osobnej pary (publiczny w `~/.ssh/authorized_keys` serwera) |

Dopóki nie ma `MIKRUS_HOST`, workflow tylko buduje i wypycha obrazy.

**Ręcznie:**
```bash
cd /srv/planista && git pull --ff-only
docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
```
Dane zostają w wolumenie `planista_pgdata`.

## 12. Kopia zapasowa bazy
```bash
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U postgres -d planista10 -Fc > ~/planista10-$(date +%F).dump
# odtworzenie: docker compose -f docker-compose.prod.yml exec -T db pg_restore -U postgres -d planista10 --clean --if-exists < plik.dump
```

## Uwagi
- **Rate-limit** logowania i `trust proxy` są w kodzie.
- **Restart serwera:** `restart: unless-stopped` — kontenery wstają same.
- **Błędy:** `SENTRY_DSN` w `.env.prod` włącza error-tracking backendu (Better Stack); pusty = wyłączony.
