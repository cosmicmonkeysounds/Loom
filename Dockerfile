# syntax=docker/dockerfile:1
# Loom — the TS event server (@loom/core) + the built play, terminal,
# reinstall and editor apps.
#
# Targets (both built by docker-compose.yml):
#   server — the @loom/core event server, serving play/dist at `/`,
#            terminal/dist (the wall terminals) at `/terminal/` and
#            reinstall/web/dist (the web reinstallation game + the house
#            map editor) at `/reinstall/` (`/reinstall/map`)
#   proxy  — Caddy: static editor at /edit/, everything else → server
#
# The VR reinstallation game (reinstall/vr, a Godot project) is not part
# of any image — it is exported to the Quest headsets separately (see
# reinstall/vr/README.md) and talks to this server over the LAN.
#
# See docs/loom-docker-deploy.md for the full deployment walkthrough.

# ---- build: install the pnpm workspace, build play + terminal + reinstall + editor ----
FROM node:24-slim AS build
RUN npm install -g pnpm@10
WORKDIR /repo

# Manifests first so the dependency layer caches across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY core/package.json core/
COPY bank/package.json bank/
COPY play/package.json play/
COPY terminal/package.json terminal/
COPY house/package.json house/
COPY reinstall/web/package.json reinstall/web/
COPY editor/package.json editor/
COPY desktop/package.json desktop/
COPY invite/package.json invite/
RUN pnpm install --frozen-lockfile --filter '!loom-desktop'

# docs/ is bundled into both apps at build time (the in-app Help).
COPY docs docs
COPY core core
COPY bank bank
COPY play play
COPY terminal terminal
COPY house house
COPY reinstall/web reinstall/web
COPY editor editor
COPY invite invite

RUN pnpm --filter loom-play build
RUN pnpm --filter loom-terminal build
# Served under /reinstall/ (its vite.config sets the base).
RUN pnpm --filter loom-reinstall build
RUN pnpm --filter loom-invite build
# The editor ships under /edit/ behind the proxy. Its API calls are
# root-absolute (/api, /e), so they stay same-origin through Caddy —
# which is what lets the BetterAuth session cookie flow.
RUN pnpm --filter loom-app exec tsc -b \
 && pnpm --filter loom-app exec vite build --base=/edit/

# ---- server: the @loom/core event server + the built play / terminal / reinstall apps ----
FROM node:24-slim AS server
RUN npm install -g pnpm@10
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY core/package.json core/
COPY bank/package.json bank/
COPY play/package.json play/
COPY terminal/package.json terminal/
COPY house/package.json house/
COPY reinstall/web/package.json reinstall/web/
COPY editor/package.json editor/
COPY desktop/package.json desktop/
COPY invite/package.json invite/
# `@loom/core...` = core + its workspace dependencies, so @loom/house (the
# house map: validation, locate, duck spots) is linked for the spatial hub.
RUN pnpm install --frozen-lockfile --prod --filter '@loom/core...'

COPY core core
# Imported as TypeScript source under tsx at runtime, like core itself.
COPY house house
COPY --from=build /repo/play/dist play/dist
COPY --from=build /repo/terminal/dist terminal/dist
COPY --from=build /repo/reinstall/web/dist reinstall/web/dist
COPY deploy/docker-entrypoint.sh /usr/local/bin/loom-entrypoint
RUN chmod +x /usr/local/bin/loom-entrypoint

ENV NODE_ENV=production \
    LOOM_HOST=0.0.0.0 \
    LOOM_PORT=7000 \
    LOOM_STATE_DIR=/data \
    LOOM_APP_DIST=/app/play/dist \
    LOOM_TERMINAL_DIST=/app/terminal/dist \
    LOOM_REINSTALL_DIST=/app/reinstall/web/dist
VOLUME /data
EXPOSE 7000
ENTRYPOINT ["loom-entrypoint"]

# ---- proxy: Caddy with the editor + invite SPAs baked in ----
FROM caddy:2 AS proxy
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/editor/dist /srv/edit
COPY --from=build /repo/invite/dist /srv/invite
