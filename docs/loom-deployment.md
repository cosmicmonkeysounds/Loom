# Loom — Production Deployment & Security

How to run the Loom event server (`@loom/core`) and the participant app
(`loom-play`) in production, and the security model they assume.

> **Scope.** This covers the shipped **TypeScript** stack:
> `core` (the SSE/REST event server + control plane) and
> `play` (the participant web app it serves). The older
> Rust `loom-server` / `loom-relayd` (`docs/loom-multiuser.md`,
> `docs/loom-web-shipping.md`) is a **separate, superseded**
> backbone — ignore it for a TS deployment.

---

## 1. Two planes, two trust models

The server hosts two independent planes (see `core/server/server.ts`):

| Plane | What it is | Auth | Needs a DB? |
|-------|------------|------|-------------|
| **Event plane** | Live `Sim` events under `/e/:eventId/*` + the served play app at `/` | Per-event **passcodes** → opaque **capability tokens** | No |
| **Control plane** | Author accounts + projects + launching events (`/api/auth/*`, `/api/projects/*`) | **BetterAuth** email/password session (cookie) | Yes (Postgres) |

The event plane runs with **zero configuration** on a trusted LAN: it
auto-generates the three passcodes, journals to disk, and recovers on
restart. The control plane is what needs Postgres and a real auth
secret; if the database is unreachable it disables itself (its routes
answer `503`) and the event plane keeps running — so a **LAN-only
event** needs no database at all.

### Roles and capabilities (event plane)

Three passcodes gate three roles (`core/server/auth.ts`):

- **Guest event code** → a party-goer registers and is issued an opaque
  **guest token**. The guest's public id (`g-xxxxxx`) is broadcast in
  rosters and is *not* a credential; every guest action and every guest
  read is authorized by the token, so no one can act as, or read the
  threads of, another guest.
- **Performer passcode** → a session token carrying a `character`
  capability (the identity they scan/speak as).
- **Moderator passcode** → a session token carrying the `admin`
  capability (open doors, moderate, god-view feed).

Capabilities are additive on one token (a performer who also enters the
mod code becomes performer+admin). Tokens are sent in the
`x-loom-token` header for POSTs and — because `EventSource` cannot set
headers — in the `?token=` query param for SSE/state reads.

**Author-as-moderator.** For an event launched from the editor, the
owning author moderates with their BetterAuth **session cookie** — no
mod passcode. This works for both the mod write routes (`/api/mod/*`)
and the gated mod reads (the SSE stream, `/api/state`, `/api/history`),
so Run/Deploy mode in the editor needs no code typed.

---

## 2. Environment variables

Read once at boot (`core/server/config.ts`, `core/server/server.ts`).

| Var | Default | Purpose |
|-----|---------|---------|
| `LOOM_PORT` | `7000` | Listen port |
| `LOOM_HOST` | `0.0.0.0` | Bind host |
| `LOOM_STATE_DIR` | `core/server/.loom-state/` | Journal/recovery root (**persist this**) |
| `LOOM_APP_DIST` | `../../play/dist/` | Built participant app to serve at `/` |
| `DATABASE_URL` | `postgres://127.0.0.1:5432/loom_dev` | Control-plane Postgres |
| `BETTER_AUTH_SECRET` | *(insecure dev default)* | **Session signing secret — set in prod** |
| `LOOM_BASE_URL` | `http://localhost:$LOOM_PORT` | Public origin (drives auth cookies + HSTS) |
| `LOOM_TRUSTED_ORIGINS` | *(none)* | Extra CORS/auth origins, comma-separated |
| `LOOM_TRUST_PROXY` | *(off)* | Set `1` to key rate limits on `X-Forwarded-For` (**only** behind a proxy you control) |
| `LOOM_EVENT_PASS` / `LOOM_MOD_PASS` / `LOOM_PRIME_PASS` | auto-generated | Pin the passcodes instead of generating them |

**Secret enforcement.** Author accounts are signed with
`BETTER_AUTH_SECRET`. Booting real accounts on the well-known dev
default would let anyone forge a session, so outside a localhost dev
setup (`LOOM_BASE_URL` non-local, or `NODE_ENV=production`) the control
plane **refuses to start** without a real secret. Generate one with:

```bash
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
```

The event plane is unaffected — it never uses this secret.

---

## 3. TLS, reverse proxy, and CORS

The server speaks **plain HTTP** and terminates no TLS itself. In
production, front it with a reverse proxy (nginx/Caddy) that terminates
HTTPS and forwards to `LOOM_PORT`. Set `LOOM_BASE_URL` to the public
`https://…` origin so auth cookies get the `Secure` attribute and an
`Strict-Transport-Security` header is emitted.

Because guest/performer/mod auth is a **bearer token** (not a cookie),
serve the play app **same-origin** with the API — the default. Then no
CORS is involved for participants at all. CORS is only reflected for
origins on the trusted list (the Vite dev servers plus
`LOOM_TRUSTED_ORIGINS`); an untrusted cross-origin request gets no
`Access-Control-Allow-Origin` and is blocked by the browser.

If the **editor** is hosted on a *different* origin than the event
server (rare — usually same origin), add that origin to
`LOOM_TRUSTED_ORIGINS` so the author's BetterAuth cookie flow and CORS
both accept it.

Caddyfile sketch:

```
events.example.com {
    reverse_proxy 127.0.0.1:7000
}
```

with `LOOM_BASE_URL=https://events.example.com` and, if the proxy is
the only route in, `LOOM_TRUST_PROXY=1` so per-IP rate limiting keys on
the real client rather than the proxy's socket.

### Hardening already in place

Baseline security headers (`X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, plus HSTS on
https and a strict `Content-Security-Policy` on served HTML) are set on
every response. Request bodies are capped (4 MB → `413`). Login /
register / `resolve-code` / QR endpoints are **rate-limited per IP**
(the passcodes are short and speakable by design, so throttling online
guessing is what protects them). 500s never echo internals to the
client.

---

## 4. Persistence & backups

Per-event state lives under `LOOM_STATE_DIR` (`core/server/store.ts`):

```
<LOOM_STATE_DIR>/
  codes.json          # the three passcodes (root = the default event)
  meta.json           # scenario name + source + phase
  journal.ndjson      # append-only event-sourced mutation log
  sessions.json       # live performer/mod tokens
  guests.json         # guest capability tokens
  hidden.json         # moderator-hidden message seqs
  <eventId>/…         # one sub-dir per non-default event, same files
```

The `Sim` is fully deterministic, so live state is **rebuilt by
replaying `journal.ndjson`** on boot — never serialized directly. To
back an event up, snapshot its directory; to migrate a host, copy
`LOOM_STATE_DIR` across. The journal grows for the life of an event; a
`reset` (or a new scenario `load`) truncates it. Put `LOOM_STATE_DIR`
on a persistent volume — losing it loses in-flight events.

Postgres (control plane) holds `project` / `project_file` / `event`
plus the BetterAuth tables. Back it up with your normal Postgres
routine. Build the schema once:

```bash
DATABASE_URL=postgres://…/loom pnpm --filter @loom/core migrate
```

---

## 5. Deploying

### Docker (recommended for a VPS)

The repo root ships a `Dockerfile` + `docker-compose.yml` that stand up
the whole stack — Postgres, the event server (play app baked in), and
Caddy fronting it (editor served at `/edit/`, automatic HTTPS with a
domain). Step-by-step VPS walkthrough:
[`loom-docker-deploy.md`](./loom-docker-deploy.md).

### LAN-only event (no accounts, no database)

The zero-config path — one laptop on the venue wifi:

```bash
cd <repo checkout>                     # the repo root
pnpm install
pnpm --filter loom-play build          # build the participant app → play/dist
pnpm --filter @loom/core serve         # boots on 0.0.0.0:7000
```

The boot banner prints the three passcodes and the LAN URLs (phones
join at `http://<lan-ip>:7000`). Pin the codes with
`LOOM_EVENT_PASS`/`LOOM_MOD_PASS`/`LOOM_PRIME_PASS` if you want stable,
pre-printed cards. Moderate from the editor's Run panel, or with the
mod passcode.

### Full multi-tenant SaaS (accounts + Postgres + TLS)

```bash
pnpm install                           # at the repo root
pnpm --filter loom-play build
pnpm --filter loom-app  build          # if hosting the editor here too

export DATABASE_URL="postgres://user:pass@db-host:5432/loom"
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
export LOOM_BASE_URL="https://events.example.com"
export NODE_ENV=production

pnpm --filter @loom/core migrate       # once
pnpm --filter @loom/core serve         # behind the TLS proxy
```

`serve` runs `server/server.ts` under `tsx` (both `tsx` and `qrcode`
are runtime dependencies). Run it under a process supervisor so it
restarts on crash and boot — journal replay makes restarts transparent
to the room.

### systemd unit

```ini
# /etc/systemd/system/loom-events.service
[Unit]
Description=Loom event server
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/srv/loom/core
Environment=NODE_ENV=production
Environment=LOOM_HOST=127.0.0.1
Environment=LOOM_PORT=7000
Environment=LOOM_STATE_DIR=/var/lib/loom/state
Environment=LOOM_BASE_URL=https://events.example.com
Environment=LOOM_TRUST_PROXY=1
EnvironmentFile=/etc/loom/secrets.env      # DATABASE_URL, BETTER_AUTH_SECRET
ExecStart=/usr/bin/pnpm --filter @loom/core serve
Restart=on-failure
RestartSec=2
# Harden the unit — the server only needs its state dir writable.
ProtectSystem=strict
ReadWritePaths=/var/lib/loom/state
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Keep `/etc/loom/secrets.env` at mode `600`.

---

## 6. Pre-flight checklist

- [ ] `BETTER_AUTH_SECRET` set to a random 32+ byte value (control plane refuses to boot without it in prod).
- [ ] `LOOM_BASE_URL` is the public **https** origin.
- [ ] TLS terminated by a reverse proxy in front of `LOOM_PORT`; `LOOM_TRUST_PROXY=1` if the proxy is the sole route.
- [ ] `LOOM_STATE_DIR` on a persisted volume; backups scheduled.
- [ ] Postgres reachable via `DATABASE_URL`; `migrate` run once.
- [ ] Play app built (`play/dist` present) so `/` serves the client.
- [ ] Editor origin, if separate, added to `LOOM_TRUSTED_ORIGINS`.
- [ ] Passcodes pinned (`LOOM_*_PASS`) if you pre-print join cards.

---

## 7. Security model summary

- **Guests** hold an opaque token bound to their identity at
  registration; the public id is not a credential. No guest can act as
  or read another guest.
- **Performers/mods** hold capability tokens (or, for the author, a
  BetterAuth session). The mod feed — full god view, every DM, hidden
  factions — is refused without the `admin` capability or the owning
  author's session.
- **Short passcodes** are protected by per-IP rate limiting, not by
  entropy; run behind a proxy that preserves the client IP.
- **Authors** are BetterAuth sessions over TLS; the signing secret must
  be real in production.
- **Transport**: same-origin bearer tokens + TLS at the proxy; strict
  CSP + security headers on served pages; bounded request bodies.

Known limitation: `/api/history` uses application-layer chat visibility
(`historyFor`) rather than a token per thread; a moderator can read any
participant's threads by design (that is the moderation tool), and
guests are scoped to their own token. See `core/test/server-security.test.ts`
for the enforced invariants.
