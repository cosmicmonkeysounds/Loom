#!/bin/sh
# Entrypoint for the `server` image: when a database is configured, wait
# for it and run the (idempotent) control-plane migration, then exec the
# event server.
#
# A host reboot restarts every container at once — the Docker daemon
# ignores compose's `depends_on: service_healthy` — so loom can start
# before Postgres accepts connections. Wait up to LOOM_DB_WAIT seconds
# (default 60); still nothing → exit 1, so `restart: unless-stopped` tries
# again instead of serving a show whose event never comes back.
set -e
cd "${LOOM_APP_DIR:-/app/core}"

if [ -n "$DATABASE_URL" ]; then
  wait_max="${LOOM_DB_WAIT:-60}" step="${LOOM_DB_WAIT_STEP:-2}" waited=0
  until err="$(node -e "const{Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});c.connect().then(()=>c.query('select 1')).then(()=>c.end()).then(()=>process.exit(0),e=>{console.log(e.message);process.exit(1)})" 2>&1)"; do
    if [ "$waited" -ge "$wait_max" ]; then
      echo "loom: database unreachable after ${waited} s ($err) — exiting so the restart policy tries again"
      exit 1
    fi
    [ "$waited" = 0 ] && echo "loom: waiting for the database ($err) …"
    sleep "$step"; waited=$((waited + step))
  done
  [ "$waited" = 0 ] || echo "loom: the database answered after ${waited} s"
  echo "loom: migrating control-plane schema …"
  ./node_modules/.bin/tsx server/migrate.ts \
    || echo "loom: WARNING — migration failed; control plane will answer 503, event plane still runs"
fi

exec ./node_modules/.bin/tsx server/server.ts
