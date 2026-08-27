#!/bin/sh
# Entrypoint for the `server` image: run the (idempotent) control-plane
# migration when a database is configured, then exec the event server.
set -e
cd /app/core

if [ -n "$DATABASE_URL" ]; then
  echo "loom: migrating control-plane schema at $DATABASE_URL …"
  ./node_modules/.bin/tsx server/migrate.ts \
    || echo "loom: WARNING — migration failed; control plane will answer 503, event plane still runs"
fi

exec ./node_modules/.bin/tsx server/server.ts
