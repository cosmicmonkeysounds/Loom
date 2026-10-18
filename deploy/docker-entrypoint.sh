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
# LOOM_DB_WAIT=off (or 0) is the server's "don't wait for the database"
# switch (core/server/config.ts): here it means one probe and no wait loop —
# still nothing → exit 1 the same way. Any other value that isn't a whole
# number of seconds is named and read as the default 60.
#
# A database that answers but refuses us (a wrong POSTGRES_PASSWORD after
# a .env edit — pg 28P01 / 28000 — or no such database, 3D000) won't fix
# itself on a restart: say which, skip the wait and the migration, and run
# the event plane with the control plane off (it answers 503, and so does
# /api/health, which names the database) — the old behaviour.
set -e
cd "${LOOM_APP_DIR:-/app/core}"

if [ -n "$DATABASE_URL" ]; then
  wait_max="${LOOM_DB_WAIT:-60}" step="${LOOM_DB_WAIT_STEP:-2}" waited=0 refused=""
  case "$wait_max" in
    off|OFF|Off) wait_max=0 ;;
    ''|*[!0-9]*)
      echo "loom: LOOM_DB_WAIT=$wait_max is neither seconds nor off — waiting up to 60 s"
      wait_max=60 ;;
  esac
  case "$step" in ''|0|*[!0-9]*) step=2 ;; esac
  while :; do
    # The probe exits 0 (up), 2 (refused: credentials / no database) or 1.
    rc=0
    err="$(node -e "const{Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});c.connect().then(()=>c.query('select 1')).then(()=>c.end()).then(()=>process.exit(0),e=>{console.log((e.code?e.code+' ':'')+e.message);process.exit(['28P01','28000','3D000'].includes(e.code)?2:1)})" 2>&1)" || rc=$?
    [ "$rc" = 0 ] && break
    if [ "$rc" = 2 ]; then refused="$err"; break; fi
    if [ "$waited" -ge "$wait_max" ]; then
      if [ "$wait_max" = 0 ]; then
        echo "loom: database unreachable ($err; LOOM_DB_WAIT=${LOOM_DB_WAIT}: no wait) — exiting so the restart policy tries again"
      else
        echo "loom: database unreachable after ${waited} s ($err) — exiting so the restart policy tries again"
      fi
      exit 1
    fi
    [ "$waited" = 0 ] && echo "loom: waiting for the database ($err) …"
    sleep "$step"; waited=$((waited + step))
  done
  if [ -n "$refused" ]; then
    case "$refused" in
      3D000*) why="no such database" ;;
      *) why="the database refused the credentials — check POSTGRES_PASSWORD in .env" ;;
    esac
    echo "loom: $why ($refused) — starting with the control plane off (it and /api/health answer 503)"
  else
    [ "$waited" = 0 ] || echo "loom: the database answered after ${waited} s"
    echo "loom: migrating control-plane schema …"
    ./node_modules/.bin/tsx server/migrate.ts \
      || echo "loom: WARNING — migration failed; control plane will answer 503, event plane still runs"
  fi
fi

exec ./node_modules/.bin/tsx server/server.ts
