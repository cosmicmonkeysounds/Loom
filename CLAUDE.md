# Loom

All Loom v3 code lives here, split into sibling packages so devs can
take just the piece they need (the Godot addon, the TS engine, the
event server, …) without dragging the rest along. Repo license is MIT
(the one exception is `server/` — see the Rust workspace note below).

| Crate                  | Role                                                            |
|------------------------|-----------------------------------------------------------------|
| [`parser`](./parser)   | Lexer, AST, diagnostics, keyword table, span-preserving structural `edit` API for the `.loom` surface |
| [`runtime`](./runtime) | Bundle, resolver, playhead, ledger, reactive graph, scheduler, directive registry, multi-head play `session`, Luau bridge |
| [`lsp`](./lsp)         | Stdio JSON-RPC server backed by `loom-parser` + a workspace-wide name index |
| [`syntax`](./syntax)   | TextMate grammar generator (driven by `loom-parser::keywords`) + Zed / VSCode extension shells |
| [`server`](./server)   | Multi-user backbone — `loom-relayd` axum server hosting per-workspace Loro CRDTs over `prism-core::network::relay`. **Builds only inside the Prism monorepo** (depends on `prism-core`, stays GPL); excluded from this repo's Cargo workspace. See [`docs/loom-multiuser.md`](./docs/loom-multiuser.md). |
| [`editor`](./editor)   | React/Vite/CodeMirror web IDE — the author front end: a BetterAuth sign-in gate → projects launchpad → Studio shell with **three modes**: **Writing** (`⌘1`, text editor + story-graph node editor side by side), **Run** (`⌘2`, the control room for the project's **one run** — "Start rehearsal" is the shared server event on a server project / the in-browser `@loom/core` `Sim` on a folder; the header owns the lifecycle incl. **go live in place**; join codes/QR + directors + guest lookup on the Run page; an **identity control** to *be* any persona, guest, or character with the server's exact view of them), and **Integrations** (`⌘3`, engine targets — the Wwise-style Godot link / addon install / bank build). **Server-backed projects** or a local folder. |
| [`core`](./core)       | Native **TypeScript** port of Loom (no WASM, no Prism): parser (incl. authored **`SPACE`/`CHANNEL`** chatroom declarations) + a first-principles social-ecosystem `runtime/sim` + a parser-only **`lsp`** language surface (`@loom/core/lsp` — `Workspace` with completion / hover / definition / documentSymbols / references / diagnostics, the in-process replacement for the wasm `LspWorkspace`) + an SSE/REST **event server** (`pnpm serve`) that hosts a live `Sim` for LAN events, composing its `SimEvent` stream into server-authoritative, channel-routed chat (`server/chat.ts`) with spaces + Slack-style threads (`parentSeq`), **access control** (open / private-invite / faction / group / dm channel membership, journaled `inviteToChannel`/`leaveChannel`, guest↔guest invites) + a **pluggable channel-type registry** (`runtime/sim/channel-types.ts` — per-type post policy / threadability / broadcast routing / slow-mode / ephemeral, e.g. a read-only `announcement` feed), a scoped invite roster (`rosterFor`), history + moderation, and a journaled `say` command so participant-typed chat replays deterministically. Now a **multi-tenant SaaS backend**: BetterAuth author accounts + Postgres (`server/db/`, `server/auth-server.ts`), projects + files CRUD (`server/projects.ts`), event launch/lifecycle (`server/events-api.ts`, one live event per project), and a per-event `EventRuntime` + `EventRegistry` routed under `/e/:eventId` with a `resolve-code` bootstrap — the old single-event root paths still serve a default event. vitest-tested. |
| [`play`](./play)       | The **participant React app** (Vite, name `loom-play`) guests + performers use at a live event — a **two-pane MSN/Discord-style chat** (rooms sidebar + open room on wide screens, drill-in on phones; `theme: aol97` skins it as a 1997 chat room) with **presence** (the room you stand in first, who is in every place, a who's-here strip per room), Discord-style **spaces** (sidebar sections, incl. authored `SPACE`s), Slack-style **message threads** + avatar/name sender-run grouping, **hybrid typed chat** (a composer wired to `/api/*/say`), **cards** (`show captcha / image / poll` render from the `widgets.tsx` registry; answers fire `<kind> answered`), and **access-controlled rooms** (open/private/faction/group/dm with invite + leave) layered over the story-injected lobby + faction + DM channels (decisions docked per-thread, re-login history) on the `core` server's SSE/REST. Performers pick their character from the cast at sign-in and act on a guest through their **card**, never a panel under every room. Multi-event aware: a short code resolves via `/api/resolve-code` to its event, then every call is scoped to `/e/:eventId`. `pnpm dev` (:5174, proxies to the server on :7000) / `pnpm build` (served by the event server at `/`). |
| [`desktop`](./desktop) | The **Tauri 2 desktop app** — the `editor` React app in a native shell (own Cargo workspace at `desktop/src-tauri`, excluded from the root workspace to keep it lean; zero Prism deps). Adds what the browser can't: a path-based **fs bridge** (`fs_bridge.rs`) that the editor's local-folder backend runs on via FSA-shaped handle shims (`editor/src/lib/desktop-fs.ts` — WKWebView has no File System Access API), and **Wwise-style Godot integration** (`godot.rs` + the editor's Integrations mode, `⌘3`): link a Godot 4 project, install the embedded `addons/loom` runtime (`include_dir!` of `engines/godot/addons/loom`) + enable the plugin in `project.godot`, and build the open workspace into `<name>.loombank` + `LoomIDs.gd` inside the game project (banks compile in the webview via `@loom/bank`; the host only writes files). `pnpm --filter loom-desktop dev\|build`; `cargo test` in `src-tauri/` covers the integration logic. Reference output: [`examples/guard-patrol/godot`](./examples/guard-patrol/godot). Design: [`docs/loom-desktop.md`](./docs/loom-desktop.md). |
| [`bank`](./bank)       | **TypeScript** bank compiler + the **normative reference interpreter**. Lowers a project into `.loombank` — engine-agnostic 4×i32 instruction streams, RPN expressions, pre-split interpolation, pre-parsed directive args — plus generated `LoomIDs.{gd,cs,h}`. `<shuffle:>` runs on the spec'd xorshift64* PRNG (`src/prng.ts`, per-site streams persisted in the save), and **locale banks** are emitted (`loom-bank strings` template → `build --locale <tag>=<file>` → `<name>.<tag>.loombank` sidecar; `set_locale` swaps literals at render time, expressions stay live, per-key fallback). Hosts the scenario driver / golden-trace harness (incl. `loadbank` for locale sidecars) every per-engine runtime is conformance-tested against. See [`docs/loom-banks.md`](./docs/loom-banks.md). |
| [`engines/godot`](./engines/godot) | **GDScript** Loom runtime for Godot 4 — pure script, no GDExtension, no build step. `LoomRuntime` (pull-model `advance() -> Step`, plus signals), `LoomBank` + a `.loombank` import plugin, save/load that round-trips a suspended choice, and a headless conformance runner diffing the reference's goldens byte for byte. On top, a Wwise-integration-style **scene layer**: `LoomStory` (bank host node — autoplay, timer auto-tick, optional auto-advance pump with hold/release gating, save-file helpers), `LoomHook` (story→game: filterable directive/beat/line/varset/fire listener as an editor-connectable signal), `LoomTrigger` (game→story: fire an `on <verb>` hook or start a beat on ready/Area overlap/manual), `LoomTypewriter` (per-character RichTextLabel reveal, punctuation pacing, skip, story hold — **raw signals only**; effects are separate interpreter nodes: `LoomBlip` pooled pitch-randomised voice blips, `LoomTalkAnimator` talk/idle animation), `LoomDialogueBox` (complete drop-in player — speaker/portrait/pooled choice buttons/continue-indicator/two-tap input/auto mode/`resume()` — skinned by a `LoomStyle` resource with per-character `LoomSpeakerStyle` overrides; `demo/styled_demo.tscn` plays a story with zero scripts), `LoomHistory` (backlog), `LoomSaveSlots` (named slots with query-API metadata headers), a host-side state-query API (`current_beat`/`current_setting`/`pending_options`/`is_finished`/`has_played`/`world_snapshot`/`beat_names` + `save_to_file`/`load_from_file`), plus a `LoomBank` inspector preview (beats/hooks with copy-name) — covered by `test/addon.sh` (96 headless checks) alongside `test/conformance.sh` (4 scenarios incl. shuffle PRNG + locale switching). |
| [`examples`](./examples) | Reference `.loom` projects used by `loom-runtime` integration tests and as authoring tutorials |
| [`mind`](./mind)       | **Superseded (2026-09-16) by stagehand's `agents` module and awaiting deletion.** The old TS bridge (`@loom/mind`) watched the mod feed for DMs to a character and answered through Ollama. Its replacement works on explicit server requests. |
| [`stagehand`](./stagehand) | **Python** (uv-managed, not in the pnpm workspace) live-event bridge. It is **modular**: one daemon, one YAML per machine, and each top-level section enables a module (`module.py::REGISTRY`; modules share one authenticated `ModClient` and are supervised and restarted independently). **`show`** (the desktop): joins the mod SSE feed and turns story events (`<cue:>`/`<prop:>`/`<vibe:>`, `beatEntered`, `signal`) into OSC cues (TouchDesigner, with an NTP `t_exec` contract) plus MQTT prop commands. In reverse, MQTT sensor topics inject journaled `signal`/`beat`/`arrive` mutations. **`agents`** (the laptop): voices `mind: external` characters with a local OpenAI-compatible model (Ollama, `gpt-oss:20b`). It holds `GET /api/agent/stream` and answers each server-sent request (thread + speaker + both parties' state + codex) with `POST /api/agent/reply {say, adjust}`, using a persona file (frontmatter knobs incl. a `when:` gate) as the system prompt. `uv run pytest` (108 tests) / `uv run stagehand modules\|check\|run --config <machine>.yaml [--only agents]` / `stagehand ask` (chat with a persona, no server). Examples: `show.example.yaml`, `agents.example.yaml`. Design: [`docs/loom-show-control.md`](./docs/loom-show-control.md). |

**All Loom documentation lives in [`docs/`](./docs)** (moved from the
repo-root `docs/dev/` 2026-07-20): the canonical design spec
([`docs/loom-v3.html`](./docs/loom-v3.html)), the writer's guide
([`docs/writing-in-loom.md`](./docs/writing-in-loom.md)), the **bank
format + cross-engine runtime spec**
([`docs/loom-banks.md`](./docs/loom-banks.md) — normative for every
per-engine runtime), and the dev design docs (multiuser, deployment,
show-control, conversation model, IDE redesign, …). Per-crate `lib.rs` docstrings carry the module
roadmap and the spec section each module implements.

**Docker deployment** (2026-08-26): the repo root ships a multi-stage
`Dockerfile` (targets: `server` — the `@loom/core` event server under
`tsx` with `play/dist` baked in; `proxy` — Caddy serving the editor SPA
at `/edit/`, built with `--base=/edit/`, and reverse-proxying `/`,
`/api`, `/e` to the server) plus `docker-compose.yml` (Postgres +
server + Caddy, named volumes for pgdata / `LOOM_STATE_DIR` / certs,
migration run idempotently by `deploy/docker-entrypoint.sh`) and
`.env.example`. The `proxy` target also hosts [`invite/`](./invite)
(`loom-invite`, in the pnpm workspace) — the cryptic party-invitation
one-pager served on its own Caddy site address (`INVITE_ADDRESS`, the
apex domain, e.g. `mapsandducks.com`) while the app lives on a
subdomain (`SITE_ADDRESS`). VPS walkthrough incl. domain
transfer/DNS: [`docs/loom-docker-deploy.md`](./docs/loom-docker-deploy.md).

**In-app help** ships from [`docs/help/`](./docs/help): markdown
articles (frontmatter: `title` / `section` / `order` / `keywords` /
optional `role`) in two collections — `authoring/` (the editor's
manual: the whole language + editor usage) and `play/` (the
participant/performer guide) — parsed + searched by the shared
dependency-free engine [`docs/help/helpdoc.ts`](./docs/help/helpdoc.ts).
Both apps bundle their collection at build time via
`import.meta.glob(…, ?raw)`, so editing a `.md` here updates the apps'
Help on the next build (live under Vite dev). The editor renders it as
the `⌘/` / F1 **Help overlay**; play as the `?` **HelpSheet**. Content
integrity is tested (`editor/src/lib/help-content.test.ts` +
`play/test/help.test.ts` — well-formed frontmatter, resolving
cross-links, search entry points), so keep those green when adding
articles.

## Rust workspace (parser · runtime · lsp · syntax)

The repo-root [`Cargo.toml`](./Cargo.toml) is a standalone workspace —
`cargo build` / `cargo test` work from a fresh clone. `server/` is
excluded (prism-core dependency, see above). The Rust engine is the
original implementation and **lags the TS engine** (none of the
2026-06/07 trait/derived-beat slices or the story graph are ported);
the TS `core/` is the maintained implementation.

## JS/TS workspace (core · bank · play · editor · desktop)

The JavaScript packages share the repo-root **pnpm workspace**
([`pnpm-workspace.yaml`](./pnpm-workspace.yaml)). One install covers
them all; run scripts with `pnpm --filter <name>` (or `pnpm -r test`
from the root):

```bash
pnpm install            # core + bank + play + editor + desktop
pnpm --filter @loom/core test               # the TS engine suites
pnpm --filter @loom/bank test               # bank compiler + reference VM
pnpm --filter @loom/core serve              # the LAN event server (:7000)
pnpm --filter loom-play dev                 # participant app, HMR (:5174)
pnpm --filter loom-app  dev                 # the editor, HMR (:5173)
pnpm --filter loom-desktop dev              # the Tauri desktop app (drives :5173)
```

Each package has its own README: [`core`](./core/README.md) (engine +
event server), [`bank`](./bank/README.md) (the game-engine compiler),
[`play`](./play/README.md) (the participant app),
[`editor`](./editor/README.md). The Rust crates are built via Cargo, not
pnpm — they are not in this JS workspace. `engines/godot` is a Godot
project, not an npm package.

## SaaS control plane (TS stack)

The TS `core` server is multi-tenant. Authors sign up (BetterAuth,
email/password) and own **projects** (server-stored `.loom` files); each
project launches its own **event** (live, or a private server-hosted
**preview**), and party-goers still join by short passcode with no account.

- **Control plane** (needs Postgres via `DATABASE_URL`): `/api/auth/*`
  (BetterAuth), `/api/projects/*` (+ `…/:id/event` launch/pause/resume/end),
  access-scoped. `pnpm --filter @loom/core migrate` builds the tables. If
  the DB is unreachable the control plane stays disabled and the event plane
  still runs, so a LAN-only deployment needs no database.
- **Collaboration** (2026-08-27, invites 2026-09-09): a `project_member`
  table + `/api/projects/:id/members` (GET/POST/DELETE) let an owner share
  a project with another author **by email**. An existing account is added
  on the spot; any other address gets a **pending invite**
  (`project_invite` row + a tokened link, `?invite=<token>` into the
  editor) that becomes membership when they open the link or simply sign
  up with that address (claimed on every `/api/projects` listing). Either
  way the recipient is **emailed** via `core/server/mail.ts` — SMTP
  (`LOOM_SMTP_URL`) or Resend (`LOOM_RESEND_API_KEY`), else a console
  fallback — and the API reports `delivery` so `ShareDialog.tsx` can show
  the owner "emailed" or hand them the link to pass along. Members see the
  project under "Shared with you" in the launchpad (`ShareDialog.tsx`
  manages members + pending invites: resend / copy link / revoke,
  owner-only), can read/write its files, and can launch + moderate its
  events (`canModerateEvent` covers the whole writing team — run == admin);
  rename / delete / member management stay owner-only. Access resolution is
  `getProjectFor` / `listProjectsFor` in `db/queries.ts` — a project you
  can't access reads as 404. `/api/invites/:token` (GET, signed-out) feeds
  the sign-up screen's "X invited you to Y" card; `…/accept` (POST) joins.
  DB-gated tests in `core/test/db.test.ts`, mail in `core/test/mail.test.ts`,
  link parsing in `editor/src/lib/invite-link.test.ts`.
- **Real-time co-editing on the SaaS path** (2026-08-27): server-project
  files are live CRDT documents (**Yjs** — pure TS, no wasm). The server
  side is `core/server/collab.ts` (`CollabHub`: one authoritative `Y.Doc`
  per open file, seeded from `project_file`, merged text persisted back on
  a debounce + flushed before event launch) behind
  `/api/projects/:id/collab/{stream,sync,update,awareness}`
  (`collab-api.ts`, same owner-or-member access as the files API) — JSON
  POSTs of base64 Yjs updates fanned out over one SSE stream per project,
  no WebSocket, matching the event plane's transport. The editor side is
  `editor/src/lib/collab.ts` (singleton per open project) + a
  `y-codemirror.next` binding in `Editor.tsx` (remote cursors with author
  names; undo via `Y.UndoManager` so ⌘Z never swallows a co-writer's edit);
  non-editor write paths (story-graph ops, format-on-save) fold through a
  minimal-splice diff (`replaceIntoYText`), and remote text reflects into
  the LSP index so lint + the story graph track co-writers live. Server
  files are live-synced (never "dirty"); a plain `PUT /files` is adopted
  into the live doc, and everything degrades to the old files API if the
  stream is unavailable. **Server projects also gained full file CRUD** in
  the editor (create file/folder, delete, rename — previously "not
  supported yet"), with `files` SSE events reconciling every co-writer's
  tree. Tested in `core/test/collab.test.ts` (hub merge/fan-out/persist,
  no DB needed).
- **Per-event branding** (2026-08-27): nothing story-specific is baked into
  the `play` client anymore. `/api/resolve-code` (and `ResolvedCode`) carry
  the event's display `title` — `EventRuntime.title` = the authored `# Title`
  heading in the source (`titleOf` in `server/views.ts`, file-separator-aware)
  falling back to the project name — and the join screens/`document.title`
  render it (a `?code=` QR link resolves it pre-join). `GuestView.factions`
  lists the public factions so the side-chooser / defect buttons are driven
  by the story's declarations, not a hardcoded Mods/Chatters pair.
- **Event plane**: one `EventRuntime` per live event under `/e/:eventId` (the
  extracted single-event server), an `EventRegistry` that rehydrates every
  non-ended event on boot, and `POST /api/resolve-code {code}` so a
  guest/performer/mod bootstraps from just their code. Per-event journals stay
  on disk under `LOOM_STATE_DIR/<eventId>`.
- **Run == admin**: an event's `/e/:eventId/api/mod/*` routes accept either a
  mod token or the owning author's BetterAuth session, so the author moderates
  from the editor's Run mode with no code to type. The `/api/mod/*` surface now
  also covers `say` (post to any room, as Operator or a character), `set`
  (edit a guest's score/faction/location/captured), `beat` / `signal` / `scan`
  (fire narrative), and `reveal` (expose a hidden faction). The old standalone
  operator console (`/console`, the vanilla `server/public/index.html`) was
  removed 2026-07-01 — moderation is Run-panel-only; guests + performers use
  the `play` app.

The Rust `server` crate (see below) is the older, separate multi-workspace
backbone; the SaaS lives entirely in the TS stack.

## Status

**Run → Players landed 2026-09-16** (TS `core/` + `play` + `editor`): admins
run full rehearsals without leaving the editor — one embedded **real play
app** per guest/persona/performer, side by side, each on its own
`/api/mod/impersonate` session (exact, in-memory, journaled `by` the
director; cut by the same restarts as the real session). The play app gained
a host seam (`play/src/host.ts`) + `embed.tsx`/`embed-css.ts` so it runs
standalone or many-times embedded in shadow roots. Supersedes the deferred
"open the play app as X" design (no URL tokens, no shared localStorage).
Details: `editor/CLAUDE.md` → *Players*.

**The play app became a chat app + `show` cards landed 2026-09-16** (TS
`core/` + `play` + `editor`; help: `docs/help/play/{01,02,04,07}`,
`docs/help/authoring/36-widgets.md`; spec `loom-4.md` §6.1 / §11; guide
§11.12a). Found by playing the live *Trapped in the Internet* preview:
the lobby was titled `── main.loom ──` (the parser took the file
separator heading as the story title — `parseHeader` now skips
`isSeparatorHeading`), the Mud Room played to everyone including
performers (`start: Login` fired the per-guest beat un-addressed; the
show now opens on a house-wide `Power On` beat and `Login` only via
`when someone joins`), performers got a seven-button panel under every
room (the booth dispatched on id prefixes, so location rooms fell into
the guest-thread branch), the typewriter replayed on every room open,
and nothing said who was where. Now: `play` is a **two-pane MSN/Discord
shell** (`Shell` in `chat.tsx`, sidebar + stage ≥ 820px, drill-in on a
phone) with **presence** (`presence.ts`: `occupantsByLocation`,
`roomOrder` — the room you stand in first with a *you are here* tag,
"3 here / just you / empty" per place, a 👥 strip + people sheet in every
room header; `PersonCard.location` / `PrimeGuest.location` from
`views.ts`), Discord-style messages (avatar tile + name per sender run),
a **crawl-once typewriter** (`crawl` policy: never the backlog, never
twice), the performer's guest actions moved onto a **guest card** (⚡
Actions / tap a name / who's-here), a **cast picker** at performer
sign-in (`ResolvedCode.characters` from `EventRuntime.characterNames`),
and a dead-token check that confirms with `/api/state` before dropping
a session. **Widgets:** `show <kind> ["text"] [to scope] [with k: v]`
(`statements.ts` + `Sim.runShow` → `SimEvent.widget` → `ChatMessage.kind
"widget"` + `WidgetCard`, routed like a choice: the last speaker's DM,
else the setting's room) render through the `play/src/widgets.tsx`
registry (`captcha` — deterministic 3×3 grid per seq, `image`, `poll`);
an answer posts `POST /api/guest/widget {seq, result}` (one per guest per
card, result sanitised by `widgetResultArgs`) and fires the named event
`<kind> answered` with the result as arguments. The Mud Room now shows a
real CAPTCHA (`beats/login.loom` — solving it proves you're human:
INCORRECT, +10 humanity, again; any second answer is CORRECT). Tests:
core `sim-widgets` + `parser` (separator) + `server-chat` / `server-
interactions` / `registry` / `views` / `trapped-in-the-internet`; play
`presence` / `widgets` (grid, judge, crawl policy) / `spaces`. Gotcha:
`grep` skips `core/src/runtime/sim/sim.ts` as binary — use `grep -a`.

**Agent-voiced characters landed 2026-09-16** (TS `core/` + `play` +
Python `stagehand/`; Trabolta talks). A `CHARACTER … mind: external`
(`CharDef.mind`, plus `CharDef.ranges` from declared `lo to hi` slots)
has no performer. The event server's `AgentHub` (`core/server/agents.ts`,
transport-free) turns each conversation with it into an **agent
request**: a guest's `dm:<C>` (`/api/guest/say`), a performer's private
`cast:<C>` thread (`/api/prime/say` stores it as `dm:<C>` with audience
`@<Performer>`, visible only to that booth; `PrimeView.agents`), or a
director's persona (`/api/mod/say`). Requests stream to workers on
`GET /api/agent/stream?characters=&name=` (mod-gated SSE: `hello` /
`request` / `cancel` / `reset`). A request is self-contained: thread
history, speaker, both parties' vars and codex, ranges, world globals.
Workers answer `POST /api/agent/reply {id, worker, say, adjust}`: a
journaled `say` into the thread, plus `setVar` deltas clamped to the
declared range (undeclared names are ignored). The hub keeps one open
request per thread (a burst mid-reply → one follow-up), queues while
offline (10 min), re-dispatches on worker loss, times out at 2 min (one
retry), and cancels on restart. It sends `typing {channel, from, on,
audience}` to exactly the thread's parties. Presence: `CastSummary.agent`
+ `online`, `PersonCard.agent.online`. Play: `typing.ts` ("… is
typing"), the guest DM subtitle shows online/away, and the performer
booth has a **Cast** space. Worker = stagehand `agents` (see the table
row); `trabolta.persona.md` gates programs until `Trabolta.glitched`
while performers always get through. Tests: core `agents` (20), play
`agents` (4), stagehand `test_agents`. Verified live against
`gpt-oss:20b` (2–6 s per reply).

**Trapped in the Internet + the codex economy landed 2026-09-10** (TS
`core/` + `play` + new `mind/`; story: `core/examples/trapped-in-the-internet/`
— now the server's default scenario; its `README.md` is the runbook +
integration contract). The show as designed: Trabolta (a rogue AI voiced by
a local LLM) uploads guests as programs; Clippy runs Computer Bingo and the
Truth Scavenger Hunt; the Antivirus drag the corrupted through the Tube to
"the Internet" (a `prison: true` + `sealed: true` location; the VR station
releases them via `mod/signal {name: "the simulation completed", subject}`);
the glitch opens free roam; five endings (three keys → self-destruct →
Long Dark / Unplugged by quorum; Rogue at `Trabolta.untruth ≥ 80`; Trapdoor
at `truth ≥ 90 ∧ stance ≤ −60`; Unknown when spared). Language + engine:
**`CODEX name`** declaration (`about:` / `code:` / `known to:` / `text:`
block) — knowledge as a currency: holders (persons *and* characters), the
`unlock X for guest` statement, `Sim.unlock/redeem/share` (journaled
mutations), built-in triggers `learn` (`when guest learns X:`, `when learns
for guest:`) + `share` (`from` bound) + the named event `wrong code`, world
mirrors `who.codex` (count) / `who.codex.<slug>` (bool), `codexUnlocked` /
`codexMissed` events. Characters learn too (`when who learns X: if who ==
self:`) — feeding lore to Trabolta moves his stance. Routes:
`/api/guest/codex/{redeem,share}`, `/api/prime/codex/share`, `/api/mod/codex`
(hardware unlock), `/api/mod/codes` → `codex[]` with printable
`?code=&unlock=` QR links. **Directory + private threads:** `listed: true`
characters + `directory: everyone` (header) → `GuestView.people` (name +
exactly the entries about them the viewer holds); guest↔guest `pm:<a>:<b>`
threads (`Sim.pmChannel`); performer consoles now see **only their own
character's** `dm:` threads and no `pm:` (admins/mods see all —
`visibleToPrime`). **Alerts:** a broadcast cue starting with `!` sets
`ChatMessage.alert` → the play app chimes (synth), vibrates, banners.
`GROUP … joinable: false` (off the side chooser), `LOCATION … sealed: true`
(→ `GuestView.canEscape` false, no self-escape button). Play app: 📓 Codex
sheet (redeem box, entries by subject, Share… picker, `?unlock=` deep link),
👥 People sheet (💬 Message → pm/dm), performer "📓 Share lore…" + "what
your character knows". Engine fixes found by the show: `broadcast "…to…" to
scope` no longer splits inside the quoted cue; `capture/release X into/from
<Multi Word Place>` lower correctly; a ROLE's own alias (`program`) is
recognised as a beat's subject everywhere `guest` was. Gotchas recorded in
the example: event names must not start with a built-in verb word
(`release …` → `released`) or contain ` is ` (parsed as a mixin clause), and a
filler + one word (`the glitch`) collapses to the word — use two words.
Tests: core `codex` (20) + `trapped-in-the-internet` (20); play `codex`;
mind (14); help articles `play/08-codex.md`, `authoring/35-codex.md`; docs
`loom-4.md` §10.1, `writing-in-loom.md` §11.13.

**Run mode overhauled 2026-09-10** (TS `core/` + `editor` + `play`;
help: `docs/help/authoring/43-run-mode.md`): the Sim ⇄ Live source
switch and the separate **Deploy mode are gone** — three modes (Writing
⌘1 · Run ⌘2 · Integrations ⌘3; persisted `deploy` → `run`). Run is the
control room for the project's **one run**: the backend is resolved from
the workspace kind (`editor/src/store/run.ts` — server project → the
project's shared `preview` event via `store/operate.ts`, local folder →
the in-browser `Sim` via `store/sim.ts`), never picked by the user, and
both stores implement one `CockpitState` contract **including the
lifecycle** (`run: RunInfo`, `startRun` / `pause` / `resume` / `restart`
(same snapshot) / `pushDraft` (current text) / `goLive` / `end`,
`lastRun`, `notice`, `lens`). "Start rehearsal" spawns a persona named
after you and lands on Chat. The header owns the lifecycle (typed
event-code confirms on a live run); the Run page is front of house
(codes/QR/performer sign-in, directors, guest lookup). **Go live is a
promotion in place** (`POST /api/projects/:id/event/golive`,
`setEventMode`, `created_by_name` → `EventInfo.startedBy`): codes/QR
kept, story restarted fresh — and every `EventRuntime.restart()` is now
a real cut (guest tokens cleared + guest streams ended; `golive` also
signs performers out), announced as `lifecycle {kind, by, at}` which the
**play app now handles** (`play/src/lifecycle.ts`: drop the session,
explain on the join screen). **Being anyone is exact**: the identity
control resolves a participant's own `GuestView` / `PrimeView`
(`GET /e/:id/api/state?role=guest|prime&as=<id>`, mod-authorized;
computed locally on a folder) into `CockpitState.lens` — exact rooms
(`member`/`canPost`), hidden messages withheld, their choice docked,
their interactions as buttons, the performer's booth (per-guest threads,
scan readouts, interactions fired **as** the character via the new
`actor` on `/api/mod/signal`); World/Director/Inspector editors close
under a lens. Safety: `/api/mod/say` as a person enforces `canPost`,
rejects unknown speakers, and tags `ChatMessage.via` (director name,
stripped for guests); every mod mutation journals `by`; speaking as a
real guest is an explicit, once-confirmed act in the editor. Co-writers:
`CollabHub.notifyEvent` fans `event` frames on the collab stream so a
launch/go-live/end lands in every editor within a second (30 s poll
fallback); a 409 launch adopts the existing run; persona ownership is
runtime state (`personaOwners` → `ModPresence.owners` →
`RosterRow.owner`) so "yours" survives a reload; the operate store is
attached for the project's lifetime (`App.tsx`), not per mode. A guarded
**scratch run** (in-browser, same cockpit) is offered only when pushing a
draft would land on a live show or other directors. The Inspector gained
**Their view** / **Their feed**; the Log gained a participant filter;
Export works on a run that just ended. **Deferred on purpose:** "open
the play app as this guest" (a mod-minted impersonation token) — the
reviewed safe design is recorded in the session memory; the exact lens
covers the stated need. Tests: core `server-mod` / `server-interactions`
/ `views` / `collab` / `db`; editor `sim` / `run` /
`lifecycle-contract` / `rooms` / `log-filter` / `run-chrome` /
`run-export` / `mode`; play `lifecycle`; Playwright `sim` / `studio` /
`qol` + the opt-in live-stack spec (launch → restart banner → push draft
→ go live in place → end).

**Loom 4 — the human-first surface landed 2026-09-09** (TS `core/` +
`editor`; design: [`docs/loom-4.md`](./docs/loom-4.md), writer's guide
[`docs/writing-in-loom.md`](./docs/writing-in-loom.md), reference project
`core/examples/glass-orchard/`). Additive at the parser — every v3 form
still parses — and it changes how `.loom` is *written*:
**names are words** (`== The Bell Tower at Dawn`, `CHARACTER Ivo Marsh`,
`-> the bell tower at dawn`; matching folds case/`_`/`-`/spaces via
`parser/names.ts`; in an expression a multi-word name is written
`Ivo_Marsh.…` and the `World` folds path heads); **`Name:` dialogue**
(`Ivo: line`, `Ivo (quietly): line`, `Ivo:` block; ALL CAPS still a cue;
`Narrator:` is narration; speakers canonicalise to the declared
character, so `Wren` — not `WREN` — is the ledger speaker now);
**keyword statements** with no angle brackets (`set x = 5`, `if c:` /
`else:`, `match v:`, `each visit:`, `after c:`, `cue`, `sound`, `fire`,
`broadcast`, `reply`, `move`, `add`, `remove`, `reveal`, `do verb args`,
`return` — `parser/statements.ts` lowers each onto the existing
directive AST, so the sim, bank, and story graph are untouched; `<…>`
stays as the long form); **`when` as the one hook form** (`when scanned
by guest:`, `when guest arrives at The Cellar:`, `when lockdown:`,
`every 60s:` — filler words ignored, verb synonyms; `on …` still opens
a hook) plus **watchers** (`when self.heat >= 75:` — evaluated to a
fixpoint after every drain, edge-triggered, per participant on a ROLE);
`GROUP` = `FACTION`; `start:` = `entry:`; role hooks bind the role's
own name (`guest`); `fire x for subject`; the sim now plays
`each visit` and whole-line `cycle`/`shuffle`. The CodeMirror
highlighter follows. The v3 game verbs (`capture`/`escape`/`betray`/…)
are conveniences, not language — see spec §9.2 / §12. The help
collection and writer's guide are rewritten to the new surface.
**Slices 2–3 landed the same day:** story-level `when …:` rules (an
`Item` of kind `rule`, `model.rules`, ownerless hooks), event arguments
(`fire x for who with k: v`; `Sim.signal(name, subject, args, actor)`;
`/api/mod/signal` `args`), multi-word named events matched by folding,
additive group membership (`add` keeps others; `who.groups`), loose
rename, the `L1201 UnknownSpeaker` / `L1202 AmbiguousName` workspace
lints, and the **participant-app decoupling**: `INTERACTION name`
(`label:` / `who: performer|guest|admin`) is a declaration kind the
`play` client renders as buttons (`/api/prime/act` fires as the
performer's character only, via `Trigger.actor`; `/api/guest/act`),
every view carries the story's `title` + `theme`, the default space is
`story` and the lobby is titled after the story, `theme: plain` (new
neutral default) / `theme: aol97` (the old skin) select the client's
CSS variable set, and the client's `Faction` type / `internet` ids /
`.pill.Mods` rules are gone. The bank compiler diagnoses watchers and
story rules (`watcherIgnored` / `storyRulesIgnored`) rather than
dropping them.

**Live co-directing hardened 2026-09-09** (TS `core/` + `editor`):
the Run → Live cockpit is now a real shared control room. Server:
`EventRuntime.restart(source?)` backs `/api/mod/reset`, `/api/mod/load`,
and the new control-plane `POST /api/projects/:id/event/reload` (flush
collab → re-read the project → restart the running event on the current
text; the row's `scenario_source` follows) — each announces a
`lifecycle` SSE notice (`reset` / `reload`; `dispose` sends `ended`)
*before* the replay and re-sends every client a fresh `history` after
it, so no console (or guest) keeps a stale, seq-scrambled feed; a
restart keeps the doors open and replays the `entry:` beat.
`GET /api/projects/:id/event` carries `stale` (project text ≠ running
snapshot). Directors are named: the author session's name rides the mod
SSE client → `ModPresence.directors` / `ModView.directors`.
`EventRuntime.liveSim` is a read-only accessor for tests/tooling.
Editor (as of 2026-09-09; superseded by the 2026-09-10 overhaul above):
`store/operate.ts` handled `lifecycle` and retained the `sim` feed as
the cockpit `log`; a Live Setup page carried pause / resume / restart /
push current draft / end; the **Log** page gained **Export run**
(`loom-run/1` JSON), the Director page named-event **arguments**, and
Sim `choices` for every person. Covered by `core/test/server-mod.test.ts`
(lifecycle fan-out), editor unit tests, and a live-stack Playwright
check (`editor/e2e-live/`, `pnpm --filter loom-app test:e2e:live`
against a running server + `loom_dev`).

---

Phase 4 in progress: parser stitches headers / declarations
(structured CHARACTER / TRAIT / STATS / TREE bodies + raw fallback for
every other kind) / beats / dialogue / choices / diverts / fences /
conditional chains (`<if:>/<else if:>/<else>`) / block-opening
directives. Runtime plays the §16 worked example end-to-end with
`Bundle` + `Playhead`, resolves cross-file diverts, dispatches
directive calls (`sfx`/`cue`/`pause`/`anchor`/`fire`/`set`), evaluates
reactive `let` bindings against a `World` scope, runs `<if:>` arms,
expands inline `{expr}` substitutions inside action / dialogue text,
tracks sticky vs. once-only choice consumption, answers `played(name)`
/ `visits(name)` / `since(name)` ledger queries from expressions,
compiles CHARACTER / TRAIT bodies into a `CharacterStore`
(disposition, knowledge, `reacts` tags, goals, hooks), routes
`<set: Character.knows.X …>` and `<set: Character.trusts.Target …>`
mutations through the character store with goal-lifecycle +
threshold-cross hook bookkeeping, and compiles STATS / TREE
declarations into `StatsProfile` / `StatsInstance` / `Tree` with
attribute / axis (`xp_curve` + `narrative_trigger`) / pool (`max` /
`regen` / `cost` with `tick(dt, in_combat)`) / stat (lazy expression)
/ node (`requires` gate) primitives surfaced under dotted paths
(`Wren.strength`, `Wren.level`, `Wren.health`, `Wren.health.max`,
`Wren.damage`, `Wren.tree.armsman_1`).

Phase 5 (Luau bridge) landed 2026-05-25: `loom_runtime::LuauRegistry`
owns an `mlua::Lua` state with a `loom` global (read/write views into
`World` + `Ledger`) and dispatches every non-syntactic directive
(`sfx`, `cue`, `spawn`, `cancel`, `goal`, `broadcast`, `enroll`,
`goto`, `compose`, `heal`, `flash`) through a single Luau call
following the spec §14.1 argument convention (positional first,
single trailing table for named args). Extension authors write
`directive name(args) … end` in a `.luau` file and load it via
`LuauRegistry::load_extension`. The syntactic forms
(`if`/`else`/`match`/`for`/`each visit`/`after`/`otherwise`/
`anchor`/`let`/`set`/`fire`/`shuffle`/`cycle`) stay hand-handled in
the playhead — they affect playhead structure, not user-callable
side effects.

Live-performance layer landed 2026-05-25: `loom_parser` recognises
COHORT / LOCATION structured bodies (label, capacity, ambient,
contains) and the `(improv duration: …, advance on: …)` parenthetical
attached to dialogue cues (spec §13.3). `loom_runtime::LiveStage`
owns participants, cohorts, locations, and an `ImprovController`
with pluggable advancement (`all` / `any` / `quorum(N)`),
emitting `ParticipantJoined` / `ParticipantEnteredLocation` /
`CohortEnrolled` / `ImprovBeatStarted` / `ImprovBeatAdvanced`
ledger events. `BroadcastScope` is an algebraic expression
(`participant(X) | cohort(X) | location(X)` joined with `and` /
`but`) parsed from `<broadcast: …>` directive bodies and evaluated
against the stage's live membership. `broadcast` and `enroll` are
registered as core directive builtins.

SCENE / GENERATOR coroutines + tiered scheduler landed 2026-05-25:
`loom_parser` recognises top-level `SCENE name(params)` declarations
with labelled inner state blocks (lowered to `SceneBody.states`) and
top-level `GENERATOR` declarations with `tier:` / `priority:` / `on
boot` metadata (lowered to `GeneratorBody`). `loom_runtime::coroutine`
lowers both into a flat `Program` of opcodes (`YieldBark`, `YieldChance`,
`WaitUntil`, `WaitDuration`, `Goto`, `Return`, `LoopHead`, `ForBegin`/
`ForEnd`, `EmitLine`) and the three-tier `Scheduler` (focal ≈ 16ms,
active ≈ 100ms, ambient ≈ 2s budgets) drives them round-robin with
focal stealing from active/ambient under load. The bundle pre-lowers
every SCENE/GENERATOR into `bundle.scene_programs` / `generator_programs`
/ `bound_generators` (character-bound, qualified `Character.generator`).
Hook drain at playhead yield points + `spawn`/`run` directive wiring
remain TODO at `runtime/src/playhead.rs` (see follow-up
task).

LSP request loop landed 2026-05-25: `loom_lsp` runs a stdio JSON-RPC
loop backed by a `Workspace` index that reparses on every
`textDocument/didChange` and rebuilds project-wide indices
(characters, traits, beats, anchors, ```todo``` fences). Handlers:
`textDocument/completion` (divert targets / directives / `is` mixins
— spec §14.3), `textDocument/hover` (directive signature stubs,
character property summaries, beat cast+setting), `textDocument/
definition` (jump from divert / cue to declaration), `textDocument/
documentSymbol` (per-file outline). Diagnostics flow straight from
`loom_parser::Diagnostic` to `publishDiagnostics`.

Syntactic-form fillers landed 2026-05-25: `<match: expr>` dispatches
to the first bare-word arm matching the scrutinee's display form
(falls through silently when no arm matches); `<each visit>` picks
`first` / `then` / `finally` based on the enclosing beat's visit
count (1→first, 2→then, 3+→finally); `<after: cond> … <otherwise>`
latches the post-condition body to subsequent visits via per-beat
`Event::AfterLatched`; `<let: name = expr>` introduces an inline
scope-local binding into the surrounding world scope; `<shuffle: a |
b | c>` emits a deterministic pseudo-random variant (ledger-length
modulo until the workspace adds the `rand` crate); `<cycle: a | b |
c>` advances a per-anchor counter keyed by the directive's source
byte offset and emits variants in order.

Typed-slot grammar + ITEM/FACTION composition landed 2026-05-25:
`loom_parser` lifts every property line (`voice: any`,
`home: any of LOCATION`, `range 0 to 100 = 50`,
`unknown | suspects | confirmed`, `list of RUMOUR`,
`map of CHARACTER to int`, `text?`) into a structured `SlotType` on
the new `Property` carrier (spec §8). ITEM and FACTION are first-class
kinds now (`ItemBody` / `FactionBody`) with `is X, Y` inheritance
resolved by a shared `merge_properties`; `Bundle::items` /
`Bundle::factions` index the merged result. Beats split their
parameter list at parse time (`== ask_about(topic, NPC)` →
`Beat.params == ["topic", "NPC"]`) so diagnostics + LSP completion
have the declared param surface. Spec §8's required-hole rule is
enforced at materialisation: `Bundle::rebuild_simulacra` skips any
CHARACTER whose inherited + own typed slots leave an unfilled
`any`-shaped hole and reports
`ProjectDiagnostic::RequiredSlotUnfilled { character, slot }`.
Answer-slot fill at divert call sites (spec §7 + §16) is captured
into `Divert::To::slots` — an indented `<name>:` block under the
divert lowers as a `Vec<BodyItem>` keyed by slot name; the
matching beat-side `slot: <name>` line lands as
`BodyItem::SlotPlaceholder` ready for `<match:>` arm expansion
(playhead wiring is a follow-up — TODO at `lower_item`).

Expression + scoping closures landed 2026-05-25: list comprehensions
(`[c for c in Characters where c.faction == Player.faction]`, spec
§12.1) parse + evaluate through the native expression engine, with
virtual world collections (`Characters` / `Participants` / `Items`)
published via `World::set_collection`. Ledger queries grew the
scoped `since(scope, name)` form and `last(target, speaker)` lookup
(spec §12.2). Coroutines lower `at 6am` / `at noon` / `at 6:30am`
into a `Step::WaitUntilClock` opcode that polls `Time.hour` /
`Time.minute` (spec §10.5), and GENERATOR `start_when` is wired into
`Program.start_when` so the coroutine sits in `Waiting` until the
predicate clears. Multi-speaker cues (`DOCKHAND | FISHER`) split
into `DialogueBlock.speakers: Vec<String>` and ride alongside
`Event::Dialogue.speakers` so live booths can address every
performer. Beat-scope modifier `-> orientation as Participant`
parses into `Divert::To.scope_as` and the playhead overlays
`<scope>.<name>` aliases when evaluating expressions inside the
scoped beat (spec §13.1). Parser surface for `milestones:` on axis
declarations populates `AxisDecl.milestones`, which threads through
to `AxisState.milestones` at instance time.

Simulacra composition + hook coverage landed 2026-05-26: hook events
grew the symmetric `on <verb> drops below N` downward-cross kind, the
`on Participant exits LOCATION` pair to `enters`, and the top-level
`on participant joins` hook fed by `Event::ParticipantJoined`. The
exits derivation is synthesised at hook-drain time from consecutive
`ParticipantEnteredLocation` envelopes (the live stage owns the
state). CHARACTER / TRAIT inheritance learned `on <event>: none`
suppression (spec §9.5) and a `super` body marker (spec §9.4) — both
resolved at `Bundle::rebuild_simulacra` merge time so the runtime
hook list is already composed. Knowledge writes are schema-validated
at `apply_set` time: `bool` and sum (`unknown | suspects | confirmed`)
slots reject out-of-band values via `DirectiveError::BadArgs`, and a
new `Event::KnowledgeChanged { character, field, value }` envelope
replaces the generic `WorldSet` for `Character.knows.*` writes
(spec §10.2). Non-knowledge writes keep `WorldSet` so disposition
threshold crossings continue to fire.

Phase 8 closures (2026-05-26): the playhead now ticks the scheduler
at every yield boundary so `<spawn:>`-launched coroutines genuinely
interleave with the visible beat, and character-bound generators
(spec §10.5) auto-spawn at playhead startup. `<run:>` became a real
awaiting form (`Step::Awaiting { coroutine }`) — it spawns at focal
tier, surfaces ambient yields from the coroutine, and resumes the
surrounding beat once `SceneCompleted` lands; the return value is
stashed on `World["__last_run"]`. Answer-slot fill at divert call
sites (spec §7 + §16) wires through `Frame.slots` →
`Yield::SlotPlaceholder` → caller-body lowering at step time.
`<let:>` bindings are now scope-local (spec §12.1): each frame
captures prior values on first write and restores them when the
frame pops, so a tunnel-local `<let:>` no longer leaks past `<-`.
`<shuffle:>` picks via `rand::seq::SliceRandom::choose` instead of
ledger-length modulo. Booth live-patch substrate (spec §13.4) is in
place: `Playhead::booth_skip_beat` / `booth_force_directive` /
`booth_hot_reload` plus `LiveStage::recast`, with `BeatSkipped` /
`BundleReloaded` / `ParticipantRecast` ledger envelopes for audit.
Divert ambiguity now resolves by preferring a same-file candidate
(spec §18 heuristic) before erroring out. The editor's
`cm-loro.ts` applies remote Loro commits as a minimal
`(from, to, insert)` change (longest common prefix + suffix diff)
so local cursors and selections survive remote edits.

Client-side local play landed 2026-06-01: the multi-head session
engine moved out of `loom-server` into `loom_runtime::session`
(`PlaySession` + the `PlayStateSnapshot` / `HeadSnapshot` view structs),
so the server's `PlayHub` and the new wasm `LoomSession` drive the
*identical* loop and emit the *identical* `play-state` JSON. The editor
now plays any `.loom` workspace entirely in the browser with no relay
and no account (`store/session.ts` `kind: "local"`, `lib/local-play.ts`,
`lib/example-project.ts`); the relay path stays for collaboration
(`kind: "cloud"`). Because the Luau VM can't target
`wasm32-unknown-unknown`, `directives::Registry` runs in a `lenient`
mode on no-Luau builds: a Lua-defined directive or `.luau` extension
degrades to a logged `Event::Directive` envelope instead of aborting
the session (native `luau` builds stay strict). The narrative engine
itself — beats, choices, diverts, conditionals, world, characters,
stats, the core Rust directives (`set`/`sfx`/`cue`/`broadcast`/`cast`/…)
— is full-fidelity in the browser.

Functional-redesign Slice 1 landed 2026-06-30 (TS `core/` only so far):
the `is X, Y` inheritance merge is now actually run on the sim compile
path — `compileModel` calls `bundle.rebuildSimulacra()` and reads the
*merged* CHARACTER/ROLE body (previously the merge was dead code, only
ever invoked from a unit test, so every `is` clause was silently inert
at runtime). ROLEs are now exempt from the required-slot abstractness
drop (a role is a per-person schema, never an instance, so an
`any of FACTION` slot is not an unfilled hole) — so a ROLE can mix in a
trait. The `SELF`/`ME` dialogue speaker resolves to whoever `self` is
bound to on the frame (upper-cased to match explicit ALL-CAPS speakers),
letting a beat drop the line that restates its owner. `rebuildSimulacra`
is idempotent (clears `projectDiagnostics` too). Design +
roadmap: [`docs/loom-functional-redesign.md`](./docs/loom-functional-redesign.md).

Slice 2 landed 2026-06-30 (TS `core/` only): **parameterized traits**.
`TRAIT Scanner(beat)` takes params after its name (split off like SCENE onto
`CharacterBody.params`), referenced in the body as `self.<param>`, and applied
with args via the `is` clause — `CHARACTER Crawler is AlgoScanner(crawler_report)`.
`mergeCharacter` parses each `is` entry with `parseMixinRef` (positional + named
args) and runs `substituteParams`: it deep-clones the parent body
(`deepCloneCharacterBody`, so the trait cache is never mutated) and rewrites every
`self.<param>` token across hook events + bodies, method bodies/inline-exprs, and
property values. Forwarding (`is Scanner(beat), Algo` inside a trait) keeps a param
`self.`-qualified until a concrete character supplies it; at the leaf it always
resolves to the bare arg (`-> self.beat` → `-> crawler_report`), so no qualified-
divert resolution is needed yet. The lexer now splits the `is` clause on
*top-level* commas (`splitTopLevelCommas`, moved to `rust.ts`) so a multi-arg
application `CellWatch(loc: Internet, signal: lockdown)` stays one entry. Unfilled
params surface as a `requiredParamUnfilled` project diagnostic.
Part II Slice A + Slice 3 landed 2026-06-30 (TS `core/` only):

- **Class-owned beats + qualified diverts (Slice A).** A CHARACTER body may
  author `beat name(params)` sub-blocks (parsed like the `generator` block);
  they register in `model.beats` under `Owner.name`, so two props may each own a
  `main`/`greet` with no collision. `parseDivertTarget` splits a slash-free
  target on the first `.` into `{qualifier, name}` (`/` still outranks `.`), and
  the sim's new `resolveBeat` honors it: `self.`/`me.` resolve against the `self`
  binding, an explicit `Owner.` is taken as-is, a **bare name stays global**
  (existing `-> lockdown` diverts unchanged), a cross-owner `-> Owner.beat`
  rebinds `self` so the foreign beat's `SELF` speaks as its true owner, and an
  unresolved qualified divert emits a `diagnostic` event. `visits()` resolves the
  beat name owner-first too (`resolveBeatKey`).
- **Slice 3 niceties.** CHARACTER typed-slot defaults are seeded into the world
  (`CharDef.defaults`), so `self.captures` starts at `0` rather than
  implicitly-zero on first `+=`. An **inline opener divert** `on scan guest -> beat`
  is split into a synthetic body divert. A wrapped `is`-clause (trailing top-level
  comma / unbalanced parens) raises `L1008UnterminatedMixinClause`. *Deferred:*
  `UnresolvedTraitArg`, the `SELF`→`cast[0]` fallback, and LSP completion/hover
  (`RequiredParamUnfilled` already covers the missing-arg case).

**The `escape-the-internet` example is migrated** to the new surface:
`cast/kit.loom` holds the shared traits (`Scanner(beat)` + faction badges +
combined `<Faction>Scanner(beat)`); every scanner prop is a one-liner; `TheAdmin`
tallies on `self.captures`; `Sysadmin` and `Firewall_Terminal` **own** their beats
(`interrogation`/`firewall` moved out of `beats/prison.loom` onto the props,
reached via `-> self.beat`); several beats speak as `SELF`. The migration is
behavior-preserving — the full vitest suite stays green.

Part II Slice B (owned-beat forwarding — a trait param naming an owned beat stays
`self.`-qualified) landed alongside a review pass, so `is Scanner(myOwnedBeat)`
routes to the deriver's own beat; a trait can also ship a concrete `beat` block
that each deriver inherits namespaced to itself.

Part II Slice C landed 2026-07-01 (TS `core/` only): **derived beat templates.**
A `TRAIT` ships a `beat name(params)` whose varying lines are `slot: <name>`
holes; each deriving `CHARACTER` supplies `fill <name>` blocks of content. At
compile, `model.ts::fillSlots` splices the fill content in place of each
`slotPlaceholder` on the lowered tree (recursing through every nested
control-flow body), per deriver — so `Interrogation_Booth` and `Bouncer` sharing
one `confront` template get `Booth.confront` / `Bouncer.confront` with their own
lines and no cross-corruption. A hole with no matching `fill` raises
`unfilledDerivedSlot`; two distinct parents shipping a same-named beat raise
`derivedBeatConflict`; a child re-declaring a derived `beat` whole-overrides it.
The `slot:` placeholder keeps its colon (a bare `slot …` line stays prose);
`fill` is a class-body opener like `beat`/`generator`.

The remaining gaps landed 2026-07-01: **beat-level `super`** (a re-declared
owned beat splices its parent template at a `super` line); **`UnresolvedTraitArg`**
(a trait arg used only as a `-> self.<param>` divert that names no beat is flagged
at compile time — the divert-only analysis is transitive through forwarded/combined
traits); the **`SELF`→`cast[0]` fallback** (a `SELF` block with no `self` bound
speaks as the beat's first `cast:` member); and the **LSP batch** — trait hover
(params + shipped beats), completion inside `is Trait(…)` and after `-> self.` /
`-> Owner.`, `SELF`/`ME` reservation, and surfacing every project diagnostic
(`unresolvedTraitArg`, `unfilledDerivedSlot`, `derivedBeatConflict`,
`requiredParamUnfilled`, …) in the editor via `Workspace.diagnosticsFor`.

**The story-graph node editor landed 2026-07-01** (TS `core/` + `editor`):
Editing mode (`⌘2`) is now a **global node editor, 1:1 with Loom Lang**,
replacing the vacant per-file graphs (`runner/Graph.tsx`, `BeatTimeline.tsx`,
`lib/loom-story.ts` — all deleted).

- **Engine (`core/src/lsp/graph.ts`)**: `Workspace.storyGraph()` lifts every
  indexed document + the compiled model into one project graph — beats
  (top-level / class-owned / trait-derived, `structural:` tagged), narrative
  edges (divert / choice / tunnel / END / **hook** — `on scan guest` routings,
  incl. trait-inherited ones through param substitution) with choice labels,
  guard context (`<if:>`/match/visit arms), and **exact `targetRange` anchors**
  for rewiring; relationship overlay edges (cast/setting/member/is/owns/
  contains); shadowed same-name duplicates re-keyed `name~N`; static
  `resolveBeat` mirror (self./Owner./bare + cast[0] fallback, `dynamic`
  flagged). Cached per index rebuild (`Workspace.generation`); last-good
  compile survives mid-keystroke parse failures. `Workspace.beatBody(key)`
  serves drill-in bodies (file AST spans exact; owned via `lowerRawBody`
  line-remap; derived from the model).
- **Edit ops (`core/src/parser/edit.ts` + `core/src/lsp/rename.ts`)**:
  `replaceExact` (validated range splice — refuses stale anchors),
  `retargetDivert`, `appendDivert`, `appendChoice`, `appendBodyLines`,
  `removeBodyItem`, `renameBeatDecl`, and workspace-level
  `Workspace.renameBeat(key, newName)` → per-URI `TextEdit[]` batches
  (declaration + every resolved reference, `.`/`/`/`#knot` separators
  preserved, `entry:` header included; derived beats refused).
  `parseDivertTarget` is public now. **Lexer fix**: the tunnel call
  `(name) ->` was classified as prose (the parser's tunnel branch was
  unreachable) — it now lexes as a divert line.
- **Editor (`editor/src/components/graph/`)**: see `editor/CLAUDE.md` —
  ELK-laid-out project map (file containers, cross-file edges, ghost nodes,
  runtime overlay), beat drill-in flow, Files+Story-Bin rail, BeatStrip dock,
  graph-selection Properties tray, and full source round-trip (connect /
  rewire / create / rename / delete / inline text edits).
- **Run overlay**: the mod SSE stream now forwards the raw **`sim` feed**
  (`server/event-runtime.ts` fanout) — `beatEntered` lights the story map
  live in Run mode via the shared `RuntimeOverlay` contract.

**Sim mode + node-editor upgrades landed 2026-07-02** (TS `core/` +
`editor`): the Mode Bar grew a fourth mode — **Sim** (`⌘3`, Run moved
to `⌘4`) — an in-editor simulator that compiles the indexed project
into a real `@loom/core` `Sim` and drives it in-browser: personas the
writer acts as (choices resume the engine's saved continuations, incl.
unbound global menus), named events fired from anywhere (a **closed,
model-enumerated list** — `namedEvents(model)` / `BuiltinVerb` /
`SimEventType` const-object enums, new in `core`, plus a read-only
`Workspace.model()` accessor), a raw-ledger Log tab, and the story map
lighting up live (visit badges + current pulse + amber **edge
traversal**). Sim and Run share one cockpit — `store/cockpit.ts`
defines the contract + context, `components/cockpit/` holds the shared
chat / roster / world / director / rail / inspector — and Sim reuses
the server's pure `chat.ts`/`views.ts` projections verbatim (new
`@loom/core/chat` + `@loom/core/views` exports), so a rehearsal reads
exactly like the live event. The Editing canvas also got: **real node
dragging** (React Flow changes now apply to state — drags used to
snap back; `expandParent` grows file containers instead of clamping),
**word blocks** (every beat card expands to its full typed body —
`WordBlockKind` enum — and stretches to fit, feeding ELK sizes), and
**floating connectors** (project-view edges anchor to the closest node
border, so links survive any manual arrangement).

**The unified conversation model landed 2026-07-03** (TS `core/` +
`editor` + `play` mirrors; design:
[`docs/loom-conversation-model.md`](./docs/loom-conversation-model.md)):
every line of story now lands in exactly one room. **Locations are
rooms** — each `LOCATION` derives a `loc:<Id>` channel (kind
`location`, listed in every view; `member`/`canPost` = "standing
there", story narration `audience: "all"`, typed chat scoped to
occupants at send time). The executor threads the enclosing beat's
`setting:` + name through its frame stack (control-flow children
inherit; a divert swaps to the target's own setting or keeps the
caller's), so `dialogue`/`action` events carry `setting` + `beat` and
`beatEntered` carries `setting`. `composeGuestMessages` routes:
subject-bound dialogue → `dm:<SPEAKER>` (unchanged); **un-addressed
dialogue + `action` narration → the setting's `loc:` room (else
lobby), `from: "Narrator"` / `kind: "narration"`, `audience: "all"`**
(previously `action` was dropped and unbound dialogue landed in a
phantom empty-audience DM); `respond` → the scanner's lobby feed.
`EventRuntime.openDoors()` fires `model.entry` through the journaled
`fireBeat` on first open, so a live event opens exactly like a
rehearsal. Cockpit: a **perspective lens** (`CockpitState.perspective`
— Operator god view / any guest / any character) filters the rooms
rail + feed via the pure `buildRooms` model, an **act-as-anyone
composer** (Operator · Narrator · guests · cast, guest speech through
the journaled `say`, presence-gated in location rooms), kind-aware
message rendering (narration blocks, system notices, sender-run
grouping), a **decision tray** docking the lens persona's pending
choice in the room, and `⤷ beat` links from any scripted line to its
node on the story map. The Editing canvas also gained **collapsible
file containers** (edges re-route to the compact node, `N links`
aggregation), a **live filter** (dims non-matching nodes/edges,
Enter still jumps), and **arrow-key navigation** (nearest-node
selection walk, Enter drills in / expands).

**Run-mode choice answering + node-editor authoring parity landed
2026-07-03** (same session): `ModView.choices` carries every pending
choice (`Sim.allPendingChoices`, `__global` incl.), and
`POST /api/mod/choose` answers one on a guest's behalf through the
same journaled `choose` mutation as the guest's own tap — the
cockpit's decision tray + guest-Inspector `PendingChoice` now work
identically in Sim and Run. And **Editing mode is a full authoring
surface, 1:1 with the Writing screenplay format**: word blocks on
expanded beat cards carry exact source anchors
(`spanStart/spanEnd/topIndex` + pure `blockEditRange`) and
double-click-edit in place via `replaceExact`; block context menus
insert lines above/below (`insertBodyLines`, new in `parser/edit.ts`)
and delete items; card menus add lines/choices; file-container + pane
menus create beats and CHARACTER/LOCATION/FACTION declarations
(`appendDeclaration`, new) — every write flows through the
span-preserving `@loom/core/parser` edit ops, so nodes author the
same `.loom` text Writing mode shows.

**The three-mode shell landed 2026-07-06** (`editor` only): the Mode
Bar consolidated from four modes to three — **Writing** (`⌘1`) merges
the old Writing + Editing (the center stage is a resizable, snappable
**editor ⇄ story-graph split** with a persisted `split` size, the
EditingRail Files ⇄ Story Bin rail, the BeatStrip dock, and the
canvas-selection-first Properties tray); **Run** (`⌘2`) merges Sim +
Run behind a **Sim ⇄ Live source switch** (`store/run.ts` +
`components/run/RunStage.tsx` — one cockpit, `RunCockpit` provider
follows the switch, the mod-stream lifecycle rides the stage so
flipping sources never reconnects, quick-fire works on both sources);
and **Deploy** (`⌘3`, `components/deploy/`) is the live event's own
home — launch/lifecycle/codes/QR/guest-lookup (the old Event tab,
promoted; `CockpitTab.Event` deleted). Legacy persisted mode ids
migrate on load (`editing`→`writing`, `sim`/`operate`→`run`).

**Writing-mode QoL landed 2026-07-14** (`editor` only): the two Writing
panes now track each other — opening a beat on the canvas (double-click
/ Enter) also lines the text editor up on its declaration *without
stealing focus* (`pendingCursor.focus`), and a **follow** toolbar
toggle selects/centers the beat or entity enclosing the text cursor
(pure `graph/follow.ts::nodeAtLine`). The **text editor got its own
context menu** (`lib/editor-menu.ts` — go to definition / references /
rename / reveal-in-graph + clipboard; Shift+right-click = native menu)
and **F2 renames the beat at the cursor** workspace-wide; edges got a
context menu too. Shell keys: **⌘B** rail, **⌘⌥B** tray, **⌘\**
toggles the story-graph pane (`ModeUi.graphOpen`; `reveal` re-opens
it); `ContextMenuHost` gained keybinding hints + separators. The
Playwright e2e suite was refreshed to the three-mode shell and grew
`qol.spec.ts` (25 e2e tests green).

**The story edit journal + cockpit context menus landed 2026-07-14**
(`editor` only): structural edits (canvas connect/rewire/create/rename/
delete, word-block/BeatStrip/tray writes) journal as atomic, labelled
multi-file entries (`store/edit-journal.ts`) — **⌘Z/⌘⇧Z outside a text
surface** undo/redo them cross-surface (CodeMirror keeps its own
history inside the editor), conflict-guarded so a buffer that moved on
drops the stale entry instead of clobbering. Cockpit chat messages,
roster rows, and cast pills got real context menus (copy /
**reply-in-thread** with a composer chip + `parentSeq` / show-on-map /
inspect / view-as / hide).

**Banks + the Godot runtime landed 2026-07-24** (new `bank/` and
`engines/godot/`; spec: [`docs/loom-banks.md`](./docs/loom-banks.md)) — the
Wwise model for game engines: one compiler, banks + generated ID headers as
the artifact, a small native runtime per engine behind one contract.

- **`@loom/bank`** lowers a project (via `core`'s `compileModel`, so the
  `is`-merge / slot-fill / hook lowering is shared) into a `.loombank`:
  19 opcodes as fixed **4×i32 words**, one flat stream per beat *and* per
  hook body with nested bodies inlined as jumps — so a continuation is
  `(program, pc)` plus scalars. Speaker resolution and `<let:>` slot
  allocation move to compile time; expressions become flat **RPN** over a
  shared constant pool (a tree would mean a `Dictionary` per node in
  GDScript); `{expr}` interpolation is **pre-split**; directive args are
  **pre-parsed** per the stagehand convention, so no runtime sees a comma.
  IDs are **FNV-1a 64** (32-bit risks ~1.2% collision per project, and a
  collision reroutes a divert) with collisions a hard compile error.
- **`src/interp.ts` is normative.** `engines/godot`'s GDScript runtime is
  diffed against its golden traces byte for byte — including a SHA-256 of
  the save state after every driver command, so save/load divergence is
  caught, not just output divergence (`engines/godot/test/conformance.sh`,
  2 scenarios, 64 trace lines, currently matching).
- **Real save/load**, the thing that motivated the IR: a suspended choice
  round-trips through JSON, which the AST-walking executor structurally
  cannot do (see `core/server/store.ts`). A recompiled bank is refused
  unless the host opts into migration (positions die, structural keys
  survive).
- **A bank plays more of the language than `Sim` does**, deliberately and
  per-item tested: `-> END`/`<-`/tunnels work (in `Sim` the divert branch
  breaks its `switch`, not the loop, so `-> END` is inert), `<each visit>`
  runs `then`/`finally`, `<after:>` latches, once-only + suppressed choices
  are honoured, `match` compares typed values, `<let:>` is frame-local, and
  hook order is frozen rather than map-insertion. A `parity` suite pins the
  bank to `Sim` everywhere they *should* agree.
- **Two pre-existing engine bugs fixed on the way in:** `Sim.choose()`
  rebuilt continuation frames with only `items`/`index`/`bindings`, so every
  line after a choice lost its speaker (dialogue silently became narration)
  and its `setting` (routing to the lobby instead of the location room) —
  a live-event bug, now covered by `core/test/sim-choice-context.test.ts`.
  And the corpus contains authored `-> END`s that have been inert.
- Out of scope in v1, diagnosed rather than silently dropped: `<shuffle:>`
  (needs a spec'd PRNG to stay conformable), divert answer-slot fill,
  `improv` timing, locale banks, and the LARP layer. `engines/unity` and
  `engines/unreal` are unwritten — the spec and harness are what make them
  cheap.

**The desktop app became usable + an Integrations mode landed 2026-07-25**
(`editor` only):

- **Every create/rename/delete flow was dead in the desktop app.** They
  all called `window.prompt` / `window.confirm`, and wry's `WKUIDelegate`
  (`wry-0.55.1/src/wkwebview/class/wry_web_view_ui_delegate.rs`)
  implements only the file-open panel, media-capture permission, and
  new-window methods — none of WebKit's JS dialog panels. With no
  delegate method, WKWebView makes `prompt()` return null and
  `confirm()` return false *with no UI*, so "New file…", "+ beat",
  "Create the first beat", rename and delete looked like broken buttons
  in the Tauri shell (and were silently unreliable in the browser).
  Every call site now goes through one promise-based in-app dialog host
  (`store/dialog.ts` + `components/shell/DialogHost.tsx`, mounted at the
  App root so the launchpad + auth gate get it too): `promptText` /
  `confirmAction` / `notify`, callable from stores and context-menu
  handlers. `closeFile`/`closeOthers`/`closeAll` went async to await the
  discard confirmation.
- **Integrations is its own mode** (`⌘3`, before Deploy — Deploy moved to
  `⌘4`): the Godot panel moved out of Deploy's collapsed `<details>` into
  `components/integrations/`, so *shipping into a game engine* and
  *hosting a live event* are separate destinations. The browser build
  explains the desktop requirement and names the unwritten Unity/Unreal
  targets.

Everything in the TS engine is done and green (474 vitest tests in `core`
incl. the Loom 4 / Slice 2 / interaction-route / Glass Orchard suites,
+122 in the editor incl. the
graph-pipeline corpus, word-blocks, rooms-lens, flow-collapse,
navigation, filter, follow, edit-journal, sim-store, dialog, and
mode-store suites; 25 Playwright e2e). The only
remaining work is the **Rust mirror**
(parser + runtime crates), which is not yet updated for ANY of Slices
1/2/A/3/B/C, these gaps, or the story graph — the TS and Rust engines
will drift until it is ported. (Explicitly deprioritized by the user
for now.)

Still to come: a pure-Rust Lua VM (piccolo) so Lua-defined directives
and `.luau` extensions execute client-side instead of degrading; the
editor-side booth panel (UI scaffold on top of the new `booth_*`
runtime APIs); and the live SCENE / coroutine tracker view in the web
client.

## Multi-user (Phases 1–8 landed)

`loom-server` is the sibling crate that backs collaborative authoring
of `.loom` projects. It depends on `prism-core` from the Prism
monorepo, so **it builds only inside that monorepo** — it is excluded
from this repo's Cargo workspace and keeps its GPL-3.0-or-later
license (everything else here is MIT). Phases 1–5 cover the wire layer (module
wiring + `/api/health`, auth + multi-workspace REST + capability
tokens, WebSocket sync, presence fan-out, client glue), Phase 6 adds
the FSA export/import fallback, Phase 7 hosts the play loop server-side,
and **Phase 8** turns the relay into a single-binary deployment: it
serves the React editor's `dist/` alongside the API / WS routes, and
the editor defaults to `window.location.origin` when same-origin. Full
roadmap: [`docs/loom-multiuser.md`](./docs/loom-multiuser.md).

### Self-hosting the editor (Phase 8 — monorepo-only)

A complete relay deployment is one binary (built inside the Prism
monorepo, where `loom-server` compiles):

```
pnpm --filter loom-app build
cargo run -p loom-server --bin loom-relayd -- --editor-dist editor/dist
# → open http://127.0.0.1:7878 in any browser, register, author
```

Useful flags on `loom-relayd`:

- `--bind 0.0.0.0:7878` — accept connections from the LAN.
- `--editor-dist <path>` — path to the editor's Vite `dist/`.
- `--cors permissive` — opt in to cross-origin requests (only needed
  when driving the relay from the Vite dev server on `:5173`).

Note the **shipped SaaS stack does not use this**: the TS `@loom/core`
event server hosts projects, events, and the built apps (see
`docs/loom-deployment.md`).

### Dev-loop (no relay)

The editor consumes the Loom engine as TypeScript (`@loom/core`), so
parser / lsp changes are picked up live by Vite with no build step:

```
pnpm --filter loom-app dev      # Vite at :5173 (HMR)
pnpm --filter @loom/core serve  # event server at :7000 (for Run on a server project)
```

Collaborative relay mode is the monorepo-only two-process equivalent:

```
pnpm --filter loom-app dev    # Vite at :5173 (HMR)
cargo run -p loom-server --bin loom-relayd -- --cors permissive
                              # API + WS at :7878
```

### Editor — the SaaS author app (wasm removed 2026-06-30)

The React editor under `editor` is the author front end:
file editing, syntax highlighting, lint, LSP (Outline / References /
completion / hover / definition / symbols), structural beat edits, and
the static entity Graph + beat-flow views — all driven by the
**TypeScript** `@loom/core` engine (parser + `lsp`), **no wasm**.

`App.tsx` gates on the author account: a **BetterAuth sign-in gate** →
a **Projects launchpad** (create/open server projects) → the modal
**Studio** shell. Storage is backend-aware (`store/workspace.ts`): a
server project's `.loom` files load/save over the control-plane API,
while a **local folder** (File System Access) still works with no
account. The Mode Bar has **three** modes — **Writing** (`⌘1`),
**Run** (`⌘2`), and **Integrations** (`⌘3`). Writing's center is a
resizable **editor ⇄ story-graph split**, so the screenplay text and
the node editor are visible (and editable) at the same time. Run
(`components/run/` + `store/run.ts`) is the control room for the
project's **one run**: the backend is resolved from the workspace kind
— a server project runs the project's shared event (`store/operate.ts`,
over the mod SSE + `/e/:eventId/api/mod/*`, authorized by the author's
session — see **Run == admin** above), a local folder runs the
in-browser `Sim` (`store/sim.ts`) compiled from the indexed project —
and both implement one `store/cockpit.ts` contract, lifecycle included.
The header owns the lifecycle (pause / restart / push draft / go live in
place / end) and the **identity control** (be the Operator, a persona, a
real guest, or a character — an exact lens over the server's own
`GuestView` / `PrimeView`); the Run page is front of house (join codes
+ QR, directors, guest lookup); the shared `components/cockpit/` chat /
roster / world / director / rail / inspector pages are swapped via a
provider, and the local backend reuses the server's pure `chat.ts` /
`views.ts` projections so a rehearsal reads exactly like the live
event. The participant chat itself stays in `play`; the editor controls
+ moderates, it does not render the guest view.

The former in-editor runtime — multi-head branching play, the
Transcript / Ledger / Timeline / World / Cast / Booth surfaces, and
relay-backed cloud collaboration (Loro CRDT) — was removed with the
`wasm` crate; **Run mode on a folder is its native-TS successor for local
play**, while **the live runtime lives in the sibling packages**: the
`core` event server + the `play` participant app. See
[`docs/loom-ide-redesign.md` Part II](./docs/loom-ide-redesign.md)
for the shell design.
