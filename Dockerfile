# syntax=docker/dockerfile:1
# Loom — the TS event server (@loom/core) + the built play + editor apps.
#
# Targets (both built by docker-compose.yml):
#   server — the @loom/core event server, serving play/dist at `/`
#   proxy  — Caddy: static editor at /edit/, everything else → server
#
# See docs/loom-docker-deploy.md for the full deployment walkthrough.

# ---- build: install the pnpm workspace, build play + editor ----
FROM node:24-slim AS build
RUN npm install -g pnpm@10
WORKDIR /repo

# Manifests first so the dependency layer caches across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY core/package.json core/
COPY bank/package.json bank/
COPY play/package.json play/
COPY editor/package.json editor/
COPY desktop/package.json desktop/
COPY invite/package.json invite/
RUN pnpm install --frozen-lockfile --filter '!loom-desktop'

# docs/ is bundled into both apps at build time (the in-app Help).
COPY docs docs
COPY core core
COPY bank bank
COPY play play
COPY editor editor
COPY invite invite

RUN pnpm --filter loom-play build
RUN pnpm --filter loom-invite build
# The editor ships under /edit/ behind the proxy. Its API calls are
# root-absolute (/api, /e), so they stay same-origin through Caddy —
# which is what lets the BetterAuth session cookie flow.
RUN pnpm --filter loom-app exec tsc -b \
 && pnpm --filter loom-app exec vite build --base=/edit/

# ---- server: the @loom/core event server + the built play app ----
FROM node:24-slim AS server
RUN npm install -g pnpm@10
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY core/package.json core/
COPY bank/package.json bank/
COPY play/package.json play/
COPY editor/package.json editor/
COPY desktop/package.json desktop/
COPY invite/package.json invite/
RUN pnpm install --frozen-lockfile --prod --filter @loom/core

COPY core core
COPY --from=build /repo/play/dist play/dist
COPY deploy/docker-entrypoint.sh /usr/local/bin/loom-entrypoint
RUN chmod +x /usr/local/bin/loom-entrypoint

ENV NODE_ENV=production \
    LOOM_HOST=0.0.0.0 \
    LOOM_PORT=7000 \
    LOOM_STATE_DIR=/data \
    LOOM_APP_DIST=/app/play/dist
VOLUME /data
EXPOSE 7000
ENTRYPOINT ["loom-entrypoint"]

# ---- proxy: Caddy with the editor + invite SPAs baked in ----
FROM caddy:2 AS proxy
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/editor/dist /srv/edit
COPY --from=build /repo/invite/dist /srv/invite
