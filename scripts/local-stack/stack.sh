#!/usr/bin/env bash
# Lightweight Supabase-compatible stack for local development and tests when Docker /
# `supabase start` is unavailable: Postgres 16 + Supabase Auth (GoTrue) + PostgREST + a tiny gateway.
#
#   scripts/local-stack/stack.sh download   # fetch auth + postgrest binaries from GitHub releases
#   scripts/local-stack/stack.sh start      # init db (first run), migrate, start services
#   scripts/local-stack/stack.sh migrate    # apply supabase/migrations/*.sql not yet applied
#   scripts/local-stack/stack.sh seed       # load demo data (see supabase/seed/demo.sql)
#   scripts/local-stack/stack.sh stop | reset | status | keys
#
# If you have Docker, prefer the official Supabase CLI: `npx supabase start` uses the same migrations.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STACK="$ROOT/.local-stack"
BIN="$STACK/bin"
PGDATA="${PGDATA_DIR:-$STACK/pgdata}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PGPORT=54322
JWT_SECRET="${LOCAL_JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}"
AUTH_VERSION=v2.177.0
POSTGREST_VERSION=v12.2.3
RUN_AS="${STACK_RUN_AS:-}"   # set to a non-root user when running as root (initdb refuses root)

psql_admin() { psql -h localhost -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
as_pg_user() { if [ -n "$RUN_AS" ]; then su "$RUN_AS" -c "$*"; else bash -c "$*"; fi; }

cmd_download() {
  mkdir -p "$BIN"
  if [ ! -x "$BIN/postgrest" ]; then
    curl -fsSL -o "$STACK/postgrest.tar.xz" "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/postgrest-$POSTGREST_VERSION-linux-static-x64.tar.xz"
    tar -xf "$STACK/postgrest.tar.xz" -C "$BIN" && rm "$STACK/postgrest.tar.xz"
  fi
  if [ ! -x "$BIN/auth" ]; then
    mkdir -p "$STACK/auth-dl"
    curl -fsSL -o "$STACK/auth.tgz" "https://github.com/supabase/auth/releases/download/$AUTH_VERSION/auth-$AUTH_VERSION-x86.tar.gz"
    tar -xzf "$STACK/auth.tgz" -C "$STACK/auth-dl" && rm "$STACK/auth.tgz"
    mv "$STACK/auth-dl/auth" "$BIN/auth"
    rm -rf "$STACK/auth-migrations" && mv "$STACK/auth-dl/migrations" "$STACK/auth-migrations" && rm -rf "$STACK/auth-dl"
  fi
  echo "binaries ready in $BIN"
}

cmd_keys() {
  node "$ROOT/scripts/local-stack/keys.mjs" "$JWT_SECRET"
}

start_postgres() {
  if [ ! -d "$PGDATA/base" ]; then
    mkdir -p "$PGDATA"; [ -n "$RUN_AS" ] && chown -R "$RUN_AS" "$PGDATA"
    as_pg_user "$PGBIN/initdb -D '$PGDATA' -U postgres --auth=trust >/dev/null"
  fi
  if ! "$PGBIN/pg_isready" -h localhost -p "$PGPORT" >/dev/null 2>&1; then
    as_pg_user "$PGBIN/pg_ctl -D '$PGDATA' -o '-p $PGPORT -k /tmp -c listen_addresses=localhost' -l '$PGDATA/server.log' start >/dev/null"
    for _ in $(seq 1 30); do "$PGBIN/pg_isready" -h localhost -p "$PGPORT" >/dev/null 2>&1 && break; sleep 0.5; done
  fi
}

auth_env() {
  export GOTRUE_DB_DRIVER=postgres
  export DATABASE_URL="postgres://supabase_auth_admin:postgres@localhost:$PGPORT/postgres"
  export GOTRUE_DB_DATABASE_URL="$DATABASE_URL"
  export GOTRUE_DB_MIGRATIONS_PATH="$STACK/auth-migrations"
  export GOTRUE_DB_NAMESPACE=auth
  export GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
  export GOTRUE_JWT_ADMIN_ROLES=service_role
  export GOTRUE_SITE_URL="${SITE_URL:-http://localhost:5173}" GOTRUE_URI_ALLOW_LIST="http://localhost:5173/**,http://localhost:4173/**"
  export API_EXTERNAL_URL=http://localhost:54321
  export GOTRUE_API_HOST=localhost PORT=9999
  export GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_DISABLE_SIGNUP=false
  export GOTRUE_LOG_LEVEL=warn
}

cmd_migrate() {
  psql_admin -c "create table if not exists public._local_migrations (name text primary key, applied_at timestamptz default now())" \
             -c "revoke all on public._local_migrations from anon, authenticated"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    name="$(basename "$f")"
    if [ -z "$(psql_admin -tAc "select 1 from public._local_migrations where name = '$name'")" ]; then
      echo "applying $name"
      psql_admin -c "set client_min_messages = warning" -f "$f"
      psql_admin -c "insert into public._local_migrations (name) values ('$name')"
    fi
  done
}

cmd_start() {
  [ -x "$BIN/auth" ] && [ -x "$BIN/postgrest" ] || cmd_download
  mkdir -p "$STACK/logs"
  start_postgres
  psql_admin -f "$ROOT/scripts/local-stack/bootstrap.sql"
  auth_env
  "$BIN/auth" migrate >"$STACK/logs/auth-migrate.log" 2>&1
  psql_admin -c "grant execute on all functions in schema auth to anon, authenticated, service_role"
  cmd_migrate

  if ! curl -fs http://localhost:9999/health >/dev/null 2>&1; then
    nohup "$BIN/auth" serve >"$STACK/logs/auth.log" 2>&1 & echo $! >"$STACK/auth.pid"
  fi
  if ! curl -fs http://localhost:3000/ >/dev/null 2>&1; then
    PGRST_DB_URI="postgres://authenticator:postgres@localhost:$PGPORT/postgres" PGRST_DB_SCHEMAS=public \
    PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$JWT_SECRET" PGRST_SERVER_PORT=3000 PGRST_LOG_LEVEL=warn \
      nohup "$BIN/postgrest" >"$STACK/logs/postgrest.log" 2>&1 & echo $! >"$STACK/postgrest.pid"
  fi
  if ! curl -fs http://localhost:54321/health >/dev/null 2>&1; then
    nohup node "$ROOT/scripts/local-stack/gateway.mjs" >"$STACK/logs/gateway.log" 2>&1 & echo $! >"$STACK/gateway.pid"
  fi
  for _ in $(seq 1 40); do curl -fs http://localhost:54321/auth/v1/health >/dev/null 2>&1 && break; sleep 0.5; done
  echo "Local stack running:"
  echo "  API      http://localhost:54321   (auth: /auth/v1, data: /rest/v1)"
  echo "  Postgres postgres://postgres@localhost:$PGPORT/postgres"
  cmd_keys
}

cmd_seed() {
  start_postgres
  psql_admin -f "$ROOT/supabase/seed/demo.sql"
}

cmd_stop() {
  for svc in gateway postgrest auth; do
    if [ -f "$STACK/$svc.pid" ]; then kill "$(cat "$STACK/$svc.pid")" 2>/dev/null || true; rm -f "$STACK/$svc.pid"; fi
  done
  if "$PGBIN/pg_isready" -h localhost -p "$PGPORT" >/dev/null 2>&1; then
    as_pg_user "$PGBIN/pg_ctl -D '$PGDATA' stop -m fast >/dev/null" || true
  fi
  echo "stopped"
}

cmd_reset() {
  cmd_stop
  rm -rf "$PGDATA"
  cmd_start
}

cmd_status() {
  "$PGBIN/pg_isready" -h localhost -p "$PGPORT" || true
  curl -fs http://localhost:54321/auth/v1/health && echo || echo "auth: down"
  curl -fs -o /dev/null -w "rest: %{http_code}\n" http://localhost:54321/rest/v1/ || echo "rest: down"
}

case "${1:-}" in
  download) cmd_download ;;
  start) cmd_start ;;
  migrate) start_postgres; cmd_migrate ;;
  seed) cmd_seed ;;
  stop) cmd_stop ;;
  reset) cmd_reset ;;
  status) cmd_status ;;
  keys) cmd_keys ;;
  *) echo "usage: $0 {download|start|migrate|seed|stop|reset|status|keys}"; exit 1 ;;
esac
