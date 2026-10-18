# Loom

The Loom SaaS authoring app: sign in, manage projects, author `.loom`,
and run live events — all in the browser. Still works local-first on a
folder with no account.

## Intent
- **Author `.loom` two ways**: server-backed **projects** (BetterAuth
  account → the SaaS backend, `store/projects.ts` + `store/auth.ts`) OR a
  local folder via the File System Access API (no account). The workspace
  store is backend-aware (`OpenFile.backend`, `openServerProject`); saves
  route to the API or the on-disk handle accordingly.
- **One Run** (`⌘2`, 2026-09-10): the control room for the project's
  **single run**. "▶ Start rehearsal" is one action everywhere — on a
  **server project** it launches the project's shared `preview` event
  (every co-writer lands in the same run), on a **local folder** it
  compiles the in-browser `@loom/core` `Sim`. Codes are pinned across End
  → relaunch; the empty state's **New performer + moderator codes** box
  (`startRun(mode, {rotateStaff: true})` → launch `rotate: "staff"`)
  mints fresh staff codes and keeps the guest code. The backend is resolved
  from the workspace kind (`store/run.ts`), never picked by the user;
  both stores (`store/operate.ts`, `store/sim.ts`) implement the whole
  `CockpitState` contract, lifecycle included. The header carries the
  lifecycle (pause / restart / push draft / **go live** in place / end),
  the **identity control** (be the Operator, a persona, a real guest, or
  a character — an *exact* lens over the server's own `GuestView` /
  `PrimeView`), quick-fire, and pending decisions; the Run page is front
  of house (join codes + QR, directors, guest lookup). The former Deploy
  mode is folded in.
- **Ship into a game engine**: **Integrations** mode (`⌘3`,
  `components/integrations/`) is where the story leaves Loom for another
  runtime — today the Wwise-style Godot pipeline (link a project, install
  the runtime addon, build `.loombank` + `LoomIDs.gd`), kept apart from
  Run so *live events* and *engine builds* are separate destinations.
  Desktop-only in practice (linking writes into the game project); the
  browser build says so and lists the unwritten Unity / Unreal targets.
- **See structure visually** alongside code: Writing mode's center is a
  resizable split — the text editor AND the project-wide story-graph
  node editor, live over the same source at the same time.
- **Stay minimal**: a thin shell over CodeMirror + xyflow, with a small Zustand store as the single source of truth.

The app is gated in `App.tsx`: no workspace open → signed-out shows
`AuthGate`, signed-in shows `ProjectsLaunchpad`; opening a project (or a
local folder) enters the Studio shell. Dev talks to the backend
(`@loom/core` server, :7000) through the Vite proxy (`/api` + `/e`), so
the BetterAuth cookie flows same-origin. Override with `LOOM_SERVER`.

## Stack
- React 19 + TypeScript + Vite
- Tailwind CSS v4 (`@tailwindcss/vite`)
- `@uiw/react-codemirror` (one-dark theme, per-language extensions)
- `@xyflow/react` for the node-editor canvas + `elkjs` (layered
  compound layout for the story graph)
- `allotment` for the fixed modal-shell region splits (IDE redesign v2)
- `@dnd-kit` (core + sortable + utilities) for the BeatStrip clip reorder
- `zustand` for state
- `pnpm` for package management

## Install
This editor (`loom-app`) is part of the **repo-root pnpm workspace**
(`pnpm-workspace.yaml`, alongside `@loom/core`, `@loom/bank`, and
`loom-play`). One install covers all four: `pnpm install` at the repo
root. Run editor scripts with `pnpm --filter loom-app <script>` from
the repo root, or `pnpm <script>` from this directory.

## Layout
```
src/
  lib/        # fs (File System Access), language (CM extensions),
              #   loom-lint / lsp-client / loom-ast / story-graph (@loom/core)
  store/      # zustand stores: workspace (files), focus (projection bus),
              #   mode (modal shell), graph (node-editor state), settings,
              #   cockpit (the cockpit contract + context, incl. the
              #   run lifecycle), run (backend resolver + the scratch
              #   lane), sim (the local backend), operate (the server
              #   backend)
  components/ # studio/ (StudioShell + ModeBar + per-mode regions),
              #   graph/ (the story-graph node editor), files, editor,
              #   cockpit/ (shared cockpit surfaces + the identity
              #   control), run/ (RunStage header + RunPage front of
              #   house + lifecycle controls), runner (Outline/References),
              #   detail, shell
  App.tsx     # top bar + StudioShell + status bar + overlays
```

## Shell (v3 modal topology)

The IDE is one app with three **modes** — **Writing** / **Run** /
**Integrations** — switched from a bottom **Mode Bar** (`⌘1` … `⌘3`),
DaVinci-Resolve-style. Writing is the whole authoring surface: its
center stage is a resizable **editor ⇄ story-graph split** (either pane
snaps closed), so text and structure are visible at the same time. Run
(`components/run/RunStage.tsx`) is the control room for the project's
one run; see **The cockpit** below. Integrations
(`components/integrations/`) owns the engine targets — the Godot link /
addon install / bank build. Each mode is a fixed, resizable `allotment`
layout (left rail · center stage · right properties tray · optional
bottom Timeline dock) that composes the leaf panels; `store/mode.ts`
owns the active mode + per-mode region sizes, including Writing's center
`split` (persisted to `localStorage["loom.studio"]`; retired
`editing`/`sim`/`operate`/`deploy` mode ids migrate on load). The right
**Properties tray** (`components/studio/PropertiesTray.tsx`) is tabbed:
in Writing it follows the **canvas selection** (beat/entity/connection/
file inspector with editable contract + In/Out link lists), falling
back to the editor cursor (active-file AST via `lib/loom-ast.ts`); plus
a workspace References panel; in Run it is the cockpit Inspector. The
Mode Bar dots the Run tab while a run exists (amber rehearsal / emerald
live), from any mode. This replaced the old `dockview` activity-bar +
free-docking model, the v2 four-mode Writing/Editing/Sim/Run bar, and
the 2026-07 four-mode bar with a separate Deploy mode. Original design:
[`docs/loom-ide-redesign.md` Part II](../docs/loom-ide-redesign.md).

### The cockpit — one Run, two backends, one contract

`store/cockpit.ts` defines the **cockpit contract** (`CockpitState`):
the state + action surface behind both run backends — roster, factions/
locations, channels + messages, beats, named events, **interactions**,
selection, the whole mod-command vocabulary (say / capture / setStat /
fireBeat / fireSignal(…, `actor`) / scanAs → readouts / reveal /
broadcast / choose / addPersona / setVar), **and the run lifecycle**:
`run: RunInfo | null` (`backend` local|server, `mode` rehearsal|live,
`scratch`, `scenario`, `stale`, `codes`, `joinUrl`, `eventId`,
`startedAt`, `startedBy`), `busy`, `me` (this console's director name),
`startRun(mode)` / `pause` / `resume` / `restart` (same snapshot) /
`pushDraft` (the project's current text) / `goLive` / `end`, plus
`lastRun` (the run that just ended, for Export + the empty state; an End
from this console first pages the whole ledger off `/api/mod/log` — 5 s
budget — and keeps it on `lastRun` whichever announcement of the end lands
first),
`notice` (a dismissable header banner) and the identity **`lens`**
(below). Shared components read it through `useCockpit(selector)`,
resolved from `CockpitContext`; `components/cockpit/providers.tsx`'s
`RunCockpit` picks the store from the workspace kind (`store/run.ts`
`useRunBackend`: `projectId !== null` → server, else local) — or the
local store while a **scratch run** is active. An ESLint
`no-restricted-imports` rule forbids importing `@/store/operate` /
`@/store/sim` anywhere else (allowlist: providers, `store/run.ts`,
`App.tsx`, tests), so the Sim/Live fork cannot creep back into
components.

- **Server backend** → `store/operate.ts` — the mod SSE +
  `/e/:eventId/api/mod/*` + the control plane. **Attached for the life
  of the open server project** (an effect in `App.tsx` on
  `useWorkspace.projectId` calls `attach` / `detach`), never per mode:
  a Writing ⇄ Run hop keeps the feed, ledger, selection, personas. A
  co-writer's launch / go-live / end / push reaches this console within
  a second through the project's collab stream (`lib/collab.ts`
  `onCollabEvent` ← the server's `CollabHub.notifyEvent` `event`
  frames); a 30 s status poll is the fallback. `startRun(Rehearsal)` =
  `launch('preview')` (a 409 "already active" **adopts** that run with
  an info notice) → `addPersona(me)` → Chat/lobby; `goLive` →
  `POST …/event/golive` (promotion in place: codes kept, story
  restarted fresh, rehearsal guests/personas/performer sign-ins cut).
  `lifecycle` SSE notices (`reset` / `reload` / `golive` / `ended`, with
  `by` + `at`) drop the ledger + overlay, re-spawn your persona on a
  rehearsal restart, show a **banner naming who did it** when it wasn't
  you, and on `ended` move the run into `lastRun` instead of zeroing it.
  `personas` is server truth: roster rows whose `owner === me`
  (`RosterRow.owner` from the runtime's persona-owner map, persisted in
  the event meta — so "yours" survives an editor refresh and a server
  restart; every `restart()`, push-draft `reload` and go-live included,
  clears them and re-spawns your persona only if you had one). `stale` is
  real state: the server's flag OR the Workspace generation moving past
  `compiledAt` (`useLspIndexGen` is only the trigger); a co-writer's
  `reload` re-bases `compiledAt` so every console's "draft changed"
  clears. Requests are fenced on `projectId` (a slow status reply from a
  project you left is dropped).
- **Local backend** → `store/sim.ts` — a real `@loom/core` `Sim`
  compiled from the indexed project and driven entirely in the
  browser. Message composition + snapshots reuse the event server's pure
  modules (`@loom/core/chat`, `@loom/core/views`) so a local run reads
  exactly like the shared one. `restart()` rebuilds from the sources
  captured at `startRun` (`compiledAt` unchanged); `pushDraft()`
  re-reads the index; `stale` flips the moment `useLspIndexGen` moves.
  `startRun(Live)` / `goLive` set `error` — a live event needs a server
  project. `me` is `'Writer'`. A 1 s ticker drives `Sim.tick` while open.
- **Scratch runs** (`store/run.ts` `useScratch`): on a server project
  whose shared run is **live** or has **other directors**
  (`scratchAllowed`), the header offers "⚗ Test draft privately" — the
  local backend in the same cockpit (violet chrome, `scratch · this
  browser`), with one "← Back to the shared run" exit; also offered by
  the empty state when the control plane is unreachable. Session-only,
  never auto-selected.

**The Run stage** (`components/run/RunStage.tsx`): a header on every
page — the **run pill** (`run-chrome.ts` `runStatusText`: `no active
event` · `local · in-browser` · `scratch · this browser` · `shared
rehearsal` · `live event`, tone-coloured violet / amber / emerald),
`LifecycleControls.tsx` (Pause/Resume · a **↺ Restart ▾** menu with
*restart this draft* / *⇪ push current draft* (surfaced as an amber
button when `stale`) / *go live…* / *■ end* · the scratch enter/leave
buttons; live-run destructive actions need the event code typed via
`promptText`), the page tabs (Run · Stage · Chat · Players · Story · Roster ·
World · Director · Mind · Log — only Run + Story usable with no run; World,
Director + Mind closed under a lens), the **identity control**
(`cockpit/Identity.tsx`), quick-fire, and a ⏳ decisions pill;
`LifecycleBanner.tsx` below it shows `notice`. **`RunPage.tsx`** is
front of house only: the empty state ("Rehearse <project>" · ▶ Start
rehearsal · *Go live with real guests →* on a server project · the last
run's Export line · the scratch offer on a control-plane error) and,
while running, **Join** (three codes with copy, join URL, QR, a
performer sign-in row per **part** — pure `cockpit/parts.ts`
`performerParts` off `ModView.cast`'s `part` / `held`, every non-agent row
on an older server; a held part with no stream reads amber *signed in ·
phone offline*, the same `partPresence` the Stage cast strip and the
Inspector use; `castPresence` gives an agent row its own sky dot, Voiced
/ Unvoiced, never a signed-in performer — and **🖨 Print
sheet…** — K-12, `run/PrintSheet.tsx` + pure `lib/print-sheet.ts`: a
full-screen sheet over the editor built from `/api/mod/codes` (join
poster, the door sign `D1` worded by `doorWording(homescreen)` off
`GET /api/push/config`'s `homescreen` — absent / false = *Scan to join*,
on = play's own order (join in Safari, then Add to Home Screen, open the
icon, 🔔), never a show name —
a poster per codex entry with its typed code, sorted by the server's
`stacks` (codex id → `{colour, stack, where}` from `facts.json`, gold →
green → blue → red → the rest) with a coloured band + the pile as text, a
check-in sign per room with QR + name only, and a cast card `P01…` per
`cast[]` part with `?code=<primePass>` — a prime code's link opens the
performer sign-in pre-filled (play's `roleForBrand`), so the card says
"Scan, then pick <name>."), QRs drawn in the browser as SVG
(`qrcode`; a 60–80 card sheet would trip `/api/qr`'s 60/min), sections /
skip a card / 1-2-4-8 per Letter page (cast cards always `.pp-8` business
cards on their own page), `@media print` hides the editor), **Directing now**
(names, `(you)`, started-by + age), **Terminals** (K-29,
`run/TerminalsCard.tsx`: every wall terminal + the TV by last poll, red
after 20 s silent with a chime — again each minute until *ack* — the
editor's own memory of terminals a restarted server forgot, the TV-voice
mute, per-row device badges (SW-SCR-21 `terminalBadges` / `majorityVersion`:
🔇 / 💤 / battery / build, an unstamped row beside a stamped majority =
amber *old build*), a room terminal's `room X` (amber off the
`server-room` spot, `strayRoom`: a tablet that was the TV once and kept
its room) and an **identify** button
(`POST /api/mod/screen/identify`); a `📟 N/N` header pill; `store/terminals.ts` is bound from `App.tsx`
to the server run so it chimes from any mode, rules in pure
`lib/terminals.ts`, sound in `lib/chime.ts`), **Wallet** (wave 5 E2,
`run/WalletCard.tsx` + pure `cockpit/wallet.ts`; only when the story has a
`currency:`: approver / minter / stimulus uses + **💰 Pay stimulus**, every
open transfer with Approve / Deny / Cancel as the server allows and a
countdown off `CockpitState.storyClock` (← `ModView.clock`; a held one
auto-approves after 5 min), **✓ Approve all held** (`/api/mod/wallet/
approve-held`, falling back to one approve each on an older server), open
requests / offers with Cancel, the minter's freezes in force with **☀ Lift**
(`/api/mod/wallet/unfreeze {id}`) and her 🎁 grants count, balances; all through
`CockpitState.walletAct` ← `CockpitState.wallet` = `ModView.wallet`; the
local backend has no WalletBook and says so), **House map** (wave 5 E9,
`run/HouseMapCard.tsx` + pure `lib/map-variants.ts`, a local copy of
`reinstall/web/src/map/project.ts`'s `variantLabel` — keep them in step:
one button per `GET /api/mod/spatial/variants` variant, Tent | Shed for
the show, always confirmed off a list re-read at the press (`freshTarget`,
so a save made since the card loaded still warns), warns on `edited`, then `mapApi.switchVariant`
→ `POST /api/mod/spatial/variant {file, base}` (`switchBase`: the re-read list's `version`, so a switch or save made while the confirm was open is refused with a 409 and the list reloads); hidden when the
event has no map or the server lacks the route), **Look up a guest** (camera QR /
manual id → Inspector); a local run gets one explainer card. A source
test pins that `RunPage.tsx` renders none of the lifecycle testids.
**Director** opens on the **cue sheet** (`cockpit/CueSheet.tsx` + the pure
rows in `@loom/core/cue-sheet` = `core/src/cue-sheet.ts` (aliased in
`vite.config.ts` + `tsconfig.app.json`), shared with the play app's phone
cue page, W-26, K-21): the `who: admin` INTERACTIONs in declared order,
the label's leading code (`C1/V1 · …`) split off, one click fires the
cue (one in flight at a time), the **LAST** cue amber + the next one
tagged **NEXT** + ✓ on fired ones — all from `CockpitState.cues`
(`ModView.cues` = core `cueState(sim)` off the sim log, so every
director's sheet agrees and survives a reload) — `Night.phase` in the
header, and a word filter. NEXT is the first unfired in-sequence row after
LAST whose `while:` holds (`InteractionSummary.live`), or LAST itself for a
`repeat: true` cue while it is live; a press the story refused (only a staff-room line)
never becomes LAST or ticks, and a repeat of an earlier cue never moves
LAST back. The local backend notes each press (`notePress`) so a folder
rehearsal judges refusals exactly like the server. On a phone, `play`'s `?role=director` page
(`play/src/director.tsx`) fires the same rows. A cue whose
`InteractionSummary.subject` is set (every hook that hears it binds a
person — the ceremony's awards, K-25) shows a **who?** picker over the
roster plus an optional **value** box (`cueValueArgs` → `{value}`), and
fires with that person as the subject; it stays disabled until one is
picked. On a server run the award rows take **suggestions** off the K-26
recap (wave 5 E6 / W-24, pure `cockpit/award-suggest.ts`:
`AWARD_SOURCES` maps each `award_*` cue to a recap list, `awardSuggestion`
skips personas, lists ties, reads Least Trusted off the bottom and gives
nobody a count award at 0; `fillAwards` fills only empty fields or its own
earlier guess; `pickWinner` — a director's pick — clears a value box
still holding the suggested winner's number and makes the row theirs): `modApi.recap` (`GET /api/mod/recap`) is fetched once
`Night.ended` is true and on **↻ awards**, a `suggested: X (n) · tied: …`
hint sits under each row, and **Copy recap** copies `recap.text`. An off-sequence cue (`sequence: false` on the INTERACTION →
`InteractionSummary.sequence === false`: the duck game, door contact,
printer, patch bay) gets its ✓ but is never LAST (core skips it) or
NEXT (`cueRows` suggests the next in-sequence row). Under it, the
broadcast form's **🔔 Alert** box (`cockpit/broadcast.ts` `alertCue`)
prefixes the cue with `!`, so it banners, chimes and buzzes every phone
and booth it reaches (K-06 / N-07).

**Being anyone — the identity lens.** `perspective` is `OPERATOR_LENS`
(god view) or a guest/persona/character id; `setPerspective` resolves
**`lens`** = that participant's own projection — `guestView` /
`primeView` computed locally, or fetched from
`GET /e/:id/api/state?role=guest|prime&as=<id>` (mod-authorized) and
refreshed on every snapshot. `cockpit/rooms.ts` `buildRooms` then lists
**exactly** the lens's channels (real `member` / `canPost` /
`threadable`), the lobby, their faction room, their folded DM threads —
or, for a character, the performer's booth (one `guest:<gid>` thread per
guest, kind `guest`, `roomMessages` = everything addressed to them —
plus the booth's own pinned rooms as play's `buildPrimeChannels` lists
them: Quest Log (`questTotal > 0`), Codex (`codexTotal > 0`), Wallet
(`view.wallet` set) and Inbox (`dm:<Character>`, kind `inbox`), keyed
`<channel>#@<Character>` with `dmGuest: '@<Character>'` so they hold only
the `@<Character>` rows, sorted right after the lobby (`Room.order`)).
`isPinnedRoom` covers `codex` / `quests` / `wallet`, so the operator lens
splits wallet rows per person (`Wallet · Ada`, `Wallet · CRA Agent
Software` for the approver booth). `READ_ONLY_ROOMS` (codex / quests /
wallet / inbox) closes the composer; a `kind: 'wallet'` row renders as a
compact card (`cockpit/wallet.ts` `walletCardTag`: kind · step · from →
to · amount), read-only — Approve / Deny stay on Run's Wallet card. A
guest lens never sees a hidden message (`messageInLens`). Chat's
composer defaults to the persona (`isPersonaId`, a `p…` id) or the
character; speaking as a **real** guest defaults to the Operator, needs
an explicit pick + a once-per-session `confirmAction`, obeys the
server's `canPost` for that person, and shows a **`via <director>`**
badge (`CockpitMessage.via`, stripped for guest clients). Under a guest
lens Chat shows their `who: guest` interactions as buttons; under a
performer lens the open guest thread gets **📡 Scan** (`scanAs` →
inline readouts) and the performer/admin interactions fired **as** the
character (`fireSignal(id, gid, null, character)`). The Roster hides
`trueFaction`, the Stage disables dragging, World/Director render a
`LensGate`, and the Inspector's editors (`VarTable` included) are
disabled under any non-Operator lens. `Esc` outside a text field returns
to the Operator.

**Players — a full rehearsal from one screen** (`cockpit/PlayersTab.tsx`,
2026-09-16). Every pane is the **real participant app** — `@loom/play/embed`
(`play/src/embed.tsx`, aliased to source; `resolve.dedupe` keeps one React)
mounts the play app's own `GuestApp` / `PerformerApp` into a **shadow root**
on that participant's **own session**: `openPlayer(role, id)` →
`POST /e/:id/api/mod/impersonate` (a token in the response body, never a
URL; exact capabilities — a booth is never a moderator; in server memory
only; every action journals the director as `by`, guest `say` carries
`via`). So CAPTCHAs, codex, DMs/pm, threads, invites, scans and card
actions all work exactly as on a phone, side by side. The play app runs
through a **host seam** (`play/src/host.ts` `PlayHost`: per-pane memory
storage, crawl memory, theme root, key target, `wide` from the pane's own
width, `onEnded`); `embed-css.ts` re-scopes `styles.css` (`:root`/`body` →
`.play-root`, `vh` → `cqh`, viewport size `@media` → `@container`). The
**lineup** (`store/players.ts`, persisted per project) outlives sessions:
a restart cuts guest sessions → the pane re-seats onto a same-named persona
(`reseatTarget` — reuses the one the cockpit re-spawned, else
`addPersona`, rehearsal only); booths survive reset/reload and re-open
after go-live; a real guest needs a confirmed `usePlayAs` and shows as
*gone* after a restart. Panes stay mounted (hidden) while anyone is seated,
so tab hops keep sessions; closing a pane calls `closePlayer` →
`…/impersonate/end`. Entry points: the toolbar (+ New guest · + Guest… ·
+ Performer… · Seat the cast · phone/tablet/wide), the guest context menu
(▶ Play), Inspector ▶ Play. **Server runs only** — the local backend's
`openPlayer` resolves null and the page explains (the Being lens still
works there). `addPersona` now resolves to the new id. Tests:
`store/players.test.ts`; server `core/test/server-impersonate.test.ts`;
play `embed-css.test.ts`. Verified live in Chrome (guest CAPTCHA + chat
from a pane, Clippy's booth beside it, restart re-seat, wide two-pane).

**Mind — the agent debugger + control panel** (`cockpit/MindTab.tsx`
+ pure `cockpit/mind.ts`, 2026-09-18; operator-only, server runs). Left:
the mind as the stagehand worker last mirrored it (`CockpitState.minds`
← `ModView.minds`, the full `AgentMindReport`): the arc stepper (click a
later stage → `set stage` with a why), brief (Edit), drives as sparklines
over the revision log with sliders, policy select, questions, notes,
learned, files on people (set trust / forget), thread summaries, the
revision log (→ the thought that made it). Right: the trace
(`CockpitState.thoughts` — `agentThought` SSE frames merged by id + the
paged `GET /api/mod/agent/trace` on open, `loadThoughts`), filterable by
kind / person / text; a thought opens to Input / Reasoning / Raw output /
Parsed / Mind diff + **Re-run**. Header: worker + both model chips, the
control panel (`mindControl` → `POST /api/mod/agent/control`: nudge,
survey now, pause/resume, mind reasoning on/off, voice effort, reset with
confirm). Colours are the reference dark categorical slots in fixed order
(voice / lookup / reflect / survey / re-run); every badge carries its
label. Tests: `cockpit/mind.test.ts`; live: `e2e-live/mind.spec.ts`.

**Judging — the facts judge** (the top card on Mind, Oct 31 wave 4,
U10; `JudgingCard` in `MindTab.tsx` + pure `judgeModeOf` /
`pendingFilings` / `questionTallies` in `cockpit/mind.ts`). Reads
`CockpitState.facts` (← `ModView.facts`, the server's `FactsWatch`
ledger off `do fact_filed` / `do fact_judged`; null = the project has no
`facts.json`, and the local backend adds that judging runs on the event
server). The **mode** (`auto` / `review`) is a journaled world var
(`facts.modeVar`, `Night.judge_mode` by default) written through
`setVar`, the same `/api/mod/var` path as the World page. The pending
list shows each filing's proposed verdict with **accurate / lie /
uncertain** buttons → `fireSignal(<judge.confirm event>, person,
{question}, null)` — the same `fact_accurate` / `fact_lie` /
`fact_uncertain` names the hosts' booth buttons fire — and a per-question
tally table follows; **▸** on a row expands that question's filings
(wave 5 E8 / SW-ADM-13, pure `questionFilings`: oldest first, *seen* time
= `FactsFiling.at` (re-stamped by a restart), who / answer / confidence /
proposed / outcome, `how` from the server's `FactsFiling.how` / `by`
(`auto` | `confirmed` | `overridden` (↺) | `settled` | `marked`, worked
out by `FactsWatch` from the journal's steps, so a restart keeps it —
e.g. "accurate (confirmed by Ada)"; an older server without `how` falls
back to kept / overridden off the proposal). **Wave 9 D5:** every filing
row but a `marked` one carries the same ✅ / 😤 / 🤷 buttons in both modes
(pure `filingButtons` — the current verdict outlined, its button greyed
once judged — and `verdictCall`, which always names the question, so it
judges that filing, never the program's latest), so an auto-mode verdict
the key got wrong is one tap to fix. The verdict never reaches a phone or the voice
worker; this card is the only place it is shown. Tests: the judging
cases in `cockpit/mind.test.ts`.

**The super-admin's peek** (`cockpit/Inspector.tsx`): a guest shows
**Their view** (side / where / score / deciding / rooms / can — exact
when they are the lens), **Their feed** (the last 60 messages
`visibleTo` them, hidden greyed), story position + trail, variables, and
a **👁 Be <name>** button; a character shows **Their feed** (lines they
spoke + `dm:` threads) plus their **scan readouts** (`respond` ledger
events), variables, owned beats. A guest also gets **Codex · N/M held**
(a "grant codex entry…" picker over the entries they don't hold →
`CockpitState.grantCodex` → `POST /api/mod/codex` / `Sim.unlock`) and
**Quests** (every declared QUEST with their status; Start a new one,
Update… / Complete / Fail an active one, each asking for the thread line
— required for an update — → `stepQuest` → `POST /api/mod/quest` /
`Sim.quest`), both off `CockpitState.codex` / `quests` (`ModView.codex`
/ the new `ModView.quests` with per-person status); pure rules in
`cockpit/grants.ts` (OCT31 S4). Server runs add the lost-phone fixes:
a guest's **🔁 Re-pair** (`RePair` → `CockpitState.pairGuest` →
`POST /api/mod/guest/pair`, a QR of the returned `?code=&pair=` link — a
single-use code good for ten minutes —
plus **Sign out old phones** = `revokeOthers`; not shown for personas,
which the server refuses anyway) and a character's **⏏ Release**
(`CockpitState.releasePart` → `POST /api/mod/prime/release`, confirmed);
the local backend refuses both with an explanation. A guest's **Restricted**
field (wave 5) is **Restrict / Unrestrict** → `setStat(id, 'restricted',
…)` (`/api/mod/set restricted` / `Sim.restrict`/`unrestrict`, a plain
restrict with no places — not the story's own mark event, whose flags and
pins it leaves alone), confirmed for a real guest on a live run;
`RosterRow.restricted` drives a ⛔ beside 🔒 on the Stage, the rail and
the Roster. The **Log** page (`cockpit/LogTab.tsx`) renders each event
through the pure, exhaustive `log-describe.ts` `describeEvent` (a `never`
guard: a new `SimEventType` breaks the build), filters to one participant (`log-filter.ts`
`eventMentions`, generic over every string field of a `SimEvent`), says
how many ledger events predate this console (`missingEvents`, in the
header and the empty state), and exports the run (`lib/run-export.ts`
reads `run ?? lastRun`; `source: local|server`, `mode`, `startedBy`,
`endedBy`). A server export pages the whole ledger through `GET
/api/mod/log?after=&limit=` (`fetchWholeLedger`, `complete: true`); when
the route is missing or refuses, it keeps the console's rows with a
`warning` and tells the director it is partial. A back-filled row carries
no `ts` (the Log shows a dash). A GROUP's derived room beside a declared
room of the same name is labelled `#hosts (side)` (`rooms.ts`
`labelTwinSides`). A live run's End / Restart / Push draft confirm with
`confirmTyped` (`store/dialog.ts`): a wrong code opens *Nothing changed*.

**The rail** (`cockpit/Rail.tsx`): the world badge (`format.ts`
`worldBadge`: ◦ Local run · ⚗ Scratch run · ◉ Shared rehearsal · ● Live
event, `run-backend` testid), phase, stats (guests / online / events /
decisions / directors), the **Guests** section with owner chips ("you"
/ "Ana") + presence + ⏳/🔒 + an inline persona spawner + the guest
context menu (`guest-menu.ts`: Inspect / Be / Open DM / Capture-Release
— the last only for the Operator), and the **Rooms** navigator (🔇 on a
room the lens identity can't post in).

Everything is **enum-driven** (const-object enums — `erasableSyntaxOnly`
forbids TS `enum`): `CockpitTab`, `RunBackend`, `RunMode`,
`SelectionKind`, `CockpitPhase`, `LensKind`, plus the core-side
`SimEventType` / `BuiltinVerb`. Tests: `store/sim.test.ts`,
`store/run.test.ts`, `store/lifecycle-contract.test.ts`
(`describe.each` over both stores against a mocked control plane),
`cockpit/rooms.test.ts` (exact lens rooms, hidden rule, performer
threads), `cockpit/log-filter.test.ts`, `components/run/run-chrome.test.ts`,
`lib/run-export.test.ts`; Playwright `e2e/sim.spec.ts` (local backend:
start / choices / quick-fire / scan / identity lens / log filter / end)
+ `e2e/studio.spec.ts` (three modes, the server empty state under a
stubbed status route) + the opt-in `e2e-live/live-collab.spec.ts`
(co-writer launch / restart banner / push draft / go live in place /
end against the real stack).

### The story-graph node editor (`components/graph/`)

Writing's canvas pane is a **global node editor over the whole
project**, 1:1
with Loom Lang (Articy-Draft-style nesting, Pixel-Crushers-style
dialogue flows). Data comes from `@loom/core/lsp`'s
`Workspace.storyGraph()` (every indexed `.loom` file — never just the
active buffer) via `lib/story-graph.ts`'s `useStoryGraph()`
(recomputes on the `useLspIndexGen` counter).

- **Center — `StoryGraphPanel`.** Two nested levels: the **project
  map** (beats as cards inside collapsible per-file containers; divert /
  choice / tunnel edges cross files; `on <event>` **hook** edges from
  character pills; red **ghost nodes** for unresolved targets; ▶ entry
  badge, END terminal) and the **beat drill-in** (double-click a beat:
  its body as a top-down flow — dialogue cards, choice fan-outs that
  re-merge past the menu, `<if:>`/`<match:>`/`<each visit>`/`<after:>`
  branch heads with labeled arms, divert exit pills that double-click
  through to their target). Breadcrumb (`Story map › beat`) navigates
  back. ELK (`elkjs`) layered layout with compound containers
  (`graph/layout.ts`); manual drags persist per project
  (`localStorage["loom.graph.layouts"]`, `store/graph.ts`).
- **Nodes genuinely move**: `onNodesChange` applies React Flow's
  changes back into the positioned state (`applyNodeChanges`), so drags
  stick across decoration re-renders (they used to snap back on the
  next selection/runtime update), work in the drill-in too
  (session-local there), and children use `expandParent` — dragging a
  beat past its file container's edge grows the container instead of
  clamping at it.
- **Word blocks** (`graph/word-blocks.ts`): every beat card expands
  (header ▸/▾ chevron, context menu, or the toolbar `blocks`
  expand-all toggle) to show its full body as typed blocks — prose,
  dialogue, directives, choices, branch arms, diverts, slots
  (`WordBlockKind` enum), nesting rendered as indent — and the card
  stretches to fit (the block list drives the ELK size estimate;
  `expanded` lives in `store/graph.ts`). Collapse restores the compact
  3-line preview. **Word blocks author source 1:1**: each block
  carries exact anchors (`spanStart`/`spanEnd`/`topIndex`, pure
  `blockEditRange`) — on a file beat, double-click edits the block's
  literal source lines in place (`replaceExact`, shared `InlineEdit`
  textarea; dialogue = cue + merged prose, choice = its `* text` line,
  branch heads display-only); right-click inserts a line above/below
  (`insertBodyLines`) or deletes the item (`removeBodyItem`); the card
  menu adds lines/choices; file-container + pane menus create beats
  and CHARACTER/LOCATION/FACTION declarations (`appendDeclaration`) —
  so whole stories can be written from the canvas and read back
  identically in Writing mode.
- **Floating connectors** (`graph/FloatingEdge.tsx`): project-view
  edges anchor to the closest border point of each node instead of
  fixed left/right handles, so links stay sensible however the map is
  rearranged. Drill-in body flows keep fixed top/bottom ports (that
  layout is strictly top-down).
- **Edits round-trip to `.loom` source** through `@loom/core/parser`'s
  span-preserving `TextEdit` ops (`lib/story-graph.ts` applies per-URI
  batches via `writePathContents` — opens the file as a dirty tab +
  `syncBuffer`s the LSP so the graph re-derives instantly): drag a
  connection between beats → `appendDivert`; drag an edge end onto
  another beat → `retargetDivert` against the edge's exact
  `targetRange`; `+ beat` / context-menu delete → `insertBeat` /
  `removeBeat`; **Rename…** → `Workspace.renameBeat` (declaration +
  every cross-file reference + `entry:`); right-click a body node →
  Edit text… (`replaceExact`). Owned beats retarget only; derived
  (trait-template) beats are honest projections — edit the template.
- **Left rail — `EditingRail`** (Writing's rail): Files (`Sidebar`) ⇄
  **Story Bin** (`StoryBin`, the project-wide navigator: beats grouped
  by file + every declared entity, filterable; click selects on canvas,
  double-click jumps to source).
- **Bottom dock — `BeatStrip`**: the selected beat's body as linear
  clips; drag-reorder → `moveBodyItem`, right-click delete →
  `removeBodyItem`, composer appends raw lines (`appendBodyLines`).
- **Runtime overlay**: the same canvas mounts in Run mode's Story tab
  (`variant="run"`, read-only, on both sources) and lights up from
  `store/graph.ts`'s `RuntimeOverlay` — visit badges, current-beat
  pulse, and amber **traversal heat** on the edges a run actually took
  (`traversed`, best-effort beat→beat hops). The server backend feeds it
  from the mod SSE `sim` feed; the local backend from the in-browser
  engine — the identical contract. In a run canvas, right-clicking a beat offers
  **Fire beat ▶** straight into the hosting cockpit.
- **Ergonomics** (all in `StoryGraphPanel` + `store/graph.ts`):
  - **Hover tooltips** on every node + edge (beat preview + `file:line`,
    entity summary, edge kind/text/guard/route), 220 ms delay; node
    hover also feeds the **focus bus** (`useFocus.setHover`).
  - **Edges are selectable** — clicking one (label included) opens the
    tray's **connection inspector**: route (jump either end), choice
    text/stickiness, guard, plus a **Rewire to** beat picker that
    rewrites the divert target in source. File containers select too
    (file inspector: beats/declarations, Open in Writing).
  - **`reveal(id)` centering** — Story Bin rows, tray link lists, and
    toolbar search all center+zoom the canvas on the target, retrying
    across relayouts, auto-enabling the entity overlay (or popping out
    of a drill-in) when the target is hidden.
  - **True inline editing** in the drill-in: double-click (or context
    menu → Edit in place) a prose/dialogue/choice/directive node to get
    an in-node textarea over the item's **raw source slice** — Enter
    commits via `replaceExact`, Shift+Enter newline, Esc cancels.
  - **Fit-to-content layout**: after first paint, React Flow's measured
    node sizes feed a second ELK pass (`onNodesChange` dimension
    changes → one re-layout per flow), so boxes always fit their text.
  - **MiniMap** (project view, pannable/zoomable); selecting a node
    **emphasises its connections** and dims the rest; **ghost nodes
    double-click to create the missing beat** (every dangling divert
    then resolves); file-container double-click opens the file (or
    expands a collapsed one).
  - **Collapsible file containers**: the header chevron / context menu
    folds a file to a compact leaf — its beats hide, every edge with a
    hidden endpoint re-routes to the file node (parallel edges merge
    into one `N links` aggregate; pure `collapseFlowEdges` in
    `flow.ts`), the runtime pulse lands on the collapsed node when the
    current beat is inside, and `reveal` auto-expands. Session-local
    (`collapsedFiles` in `store/graph.ts`).
  - **Live filter**: the toolbar input dims non-matching nodes (and
    edges between them) as you type — beat key / owner / entity / file
    path substring (`graph/filter.ts`); Enter still jumps to the first
    hit, Esc clears.
  - **Keyboard**: arrow keys walk selection to the geometrically
    nearest node (`graph/navigation.ts`), centering it; Enter drills
    into a beat / expands a collapsed file; Esc backs out of a
    drill-in / clears selection; F2 renames the selected beat; Delete
    removes it (file beats).
- **Two-way pane sync** (Writing): opening a beat on the canvas
  (double-click / Enter / exit-pill follow) also lines the text pane up
  on its declaration **without stealing keyboard focus**
  (`openBeatSynced` → `revealAt(..., { focus: false })` — the
  `pendingCursor.focus` flag), so Esc still backs out of the drill-in;
  and the reverse — the **follow** toolbar toggle (`followCursor` in
  `store/graph.ts`, default on) selects + gently centers the
  beat/entity enclosing the text cursor (`graph/follow.ts`'s pure
  `nodeAtLine` — nearest section start over beats ∪ entities;
  `revealGentle` keeps the current zoom and never mutates visibility).
- **Edge context menu**: right-click a connection → go to either end,
  show source, or "Rewire in Properties…" (selects the edge + opens
  the tray).
- Pipeline regression test: `components/graph/graph-pipeline.test.ts`
  (core graph → flow projection → ELK + collapsed-container coverage,
  over `escape-the-internet`); pure-logic suites in
  `flow-collapse.test.ts`, `navigation.test.ts`, `filter.test.ts`,
  `follow.test.ts`.

## Conventions
- Path alias `@/*` → `src/*`.
- Keep components small; put logic in `lib/` or `store/`.
- Two persistence backends: the SaaS API (server projects) and FS handles (local folders). New persistence goes through `store/workspace.ts`'s backend-aware paths, not a third mechanism.
- Browser support: Chromium-based (File System Access API) — or the
  Tauri desktop app (`desktop/`), where the same local-folder backend
  runs on FSA-shaped handle shims (see **Desktop shell** below).

## Desktop shell (Tauri)

The app also ships as `loom-desktop` (`../desktop`). Desktop-only code
is gated on `lib/desktop.ts`'s `isDesktop()` and inert in the browser:

- `lib/desktop.ts` — detection + typed bindings for the shell's
  commands (`desktopFs`, `desktopGodot`).
- `lib/desktop-fs.ts` — `DesktopDirectoryHandle` / `DesktopFileHandle`,
  FSA-shaped shims over the native fs commands. `lib/fs.ts`'s
  `pickDirectory()` hands them out on desktop, so `store/workspace.ts`
  and the LSP indexer work unchanged; persisted roots rehydrate by
  path in `restoreRoot` (no permission dance — always `'granted'`).
  No `FileSystemObserver` on desktop: external edits need the sidebar
  refresh.
- `store/godot.ts` + `components/integrations/GodotPanel.tsx` — the
  Wwise-style Godot integration (Integrations mode, desktop only): link a
  Godot project, install/update the runtime addon, and build the
  indexed workspace into `.loombank` + `LoomIDs.gd` via `@loom/bank`
  (aliased to `../bank/src` like `@loom/core`) — compile in the
  webview, write through the host.

### Editor QoL — context menu, rename, shell keys

- **The text editor has its own contextual menu** (`lib/editor-menu.ts`,
  wired in `Editor.tsx` for every file type): right-click → Go to
  definition (F12) / Find references (⇧F12) / Rename beat (F2) /
  **Reveal in story graph** (LSP group, `.loom` only) above the
  clipboard basics (Cut/Copy/Paste/Select all). Shift+right-click keeps
  the native browser menu. **F2 in the text editor renames the beat at
  the cursor** (exact key under the cursor — `Owner.name` qualified
  included — else the enclosing beat) through the same workspace-wide
  `Workspace.renameBeat` the canvas uses.
- `ContextMenuHost` supports right-aligned keybinding `hint`s and
  `{ separator: true }` divider rows (`store/context-menu.ts`'s
  `ContextMenuEntry`).
- **Shell keys** (`StudioShell`): ⌘1..⌘3 modes, **⌘B** toggle left
  rail, **⌘⌥B** toggle properties tray, **⌘\** toggle the Writing
  story-graph pane (`ModeUi.graphOpen`; an explicit `reveal` re-opens
  it). All three also live in the command palette. Tab keys stay
  ⌥W / ⌥⇧T / ⌥[ / ⌥] / ⌥1..9 (`Tabs.tsx`); ⌘S / ⌘⇧S save.
- **In-app Help** (`components/help/HelpOverlay.tsx` + `store/help.ts`
  + `lib/help-content.ts`): a searchable manual overlay — sectioned
  sidebar TOC, fuzzy full-text search with snippets, markdown articles
  with cross-links. Opens via **⌘/** / F1, the TopBar `?` button, or
  the palette (`Help: …` commands, incl. deep links to Shortcuts and
  the Cheat Sheet). Content is the shared markdown collection at
  `docs/help/authoring/*.md`, parsed by
  `docs/help/helpdoc.ts` (also used by the play app) and
  bundled via `import.meta.glob(?raw)`. Tests:
  `src/lib/help-content.test.ts` (engine + collection integrity —
  cross-links must resolve), `e2e/help.spec.ts`.
- **The story edit journal** (`store/edit-journal.ts`): every
  structural edit that flows through `lib/story-graph.ts`'s write path
  (`writePathContents` / `applyEditMap` / `applyEditsToUri` — canvas
  connect/rewire/create/rename/delete, word-block + BeatStrip edits,
  tray field writes, context-menu rename) records an atomic multi-file
  `{path, before, after}` entry with a human label. **⌘Z / ⌘⇧Z outside
  a text surface** undo/redo through it (focus in CodeMirror keeps CM's
  own history); the palette shows the top entry's label ("Edit: Undo
  Story Edit — Connect a → b"). Application is **conflict-guarded**: an
  entry only applies while every file still holds the text it expects —
  a buffer that moved on (typed edits, a CM undo of the same change)
  drops the stale entry instead of clobbering. Outcomes surface on the
  graph toolbar status line; the journal clears on project switch.
  Unit-tested in `edit-journal.test.ts`.
- **In-app dialogs, never `window.prompt`** (`store/dialog.ts` +
  `components/shell/DialogHost.tsx`, mounted at the App root above every
  branch): promise-based `promptText` / `confirmAction` / `notify`,
  callable from stores and context-menu handlers. **This is load-bearing
  on desktop**: wry's `WKUIDelegate` implements only the file-open panel,
  so in WKWebView `prompt()` returns null and `confirm()` returns false
  with no UI — every "New file…" / "+ beat" / rename button silently did
  nothing in the Tauri app. One host means one behaviour in both runtimes
  (and it's themable + testable). Requests queue by id; the host keys its
  view on that id so each dialog seeds its input at mount. Unit-tested in
  `store/dialog.test.ts`; e2e-guarded in `studio.spec.ts` (a test asserts
  no native dialog ever fires). `closeFile`/`closeOthers`/`closeAll` are
  async for the same reason.
- **Cockpit context menus** (`cockpit/tabs.tsx`): right-click a chat
  message → Copy text / **Reply in thread** (Slack-style — the
  composer grows a reply chip and `say` passes `parentSeq`, rooted at
  the thread parent) / Show beat on story map / Inspect sender / View
  as sender / Hide-Show message; right-click a roster row or cast pill
  → Inspect / View as / Capture-Release.
- Playwright e2e: `e2e/studio.spec.ts` (mode bar incl. Integrations,
  pane toggles — panes clip to width 0, so assert with `toBeInViewport`
  — plus the dialog-driven beat creation regression; `answerDialog` /
  `cancelDialog` in `e2e/helpers.ts`), `e2e/qol.spec.ts`
  (drill-in text sync, follow-cursor, editor context menu, ⌘Z journal
  roundtrip, chat message menus), `e2e/graph.spec.ts` (canvas),
  `e2e/sim.spec.ts` (Run mode on a local workspace).

## Loom integration

`.loom` files are first-class. The editor consumes the Loom engine as
**native TypeScript** from `@loom/core` — **no wasm**. (`@loom/core` is
wired in via path aliases in `vite.config.ts` + `tsconfig.app.json`:
`@loom/core/parser`, `@loom/core/lsp`, `@loom/core/sim` (the ecosystem
runtime behind Run mode on a folder), and the server's pure projection modules
`@loom/core/chat` + `@loom/core/views`, plus `@loom/core/mod-patch` (wave
9: `applyModPatch` for the director console's keyed patches; in
`vite.config.ts` its alias line must stay **above** the bare `@loom/core`
one, since Vite tries the keys in order and `@loom/core` also matches
`@loom/core/…`; in `tsconfig.app.json` a `paths` key with no `*` is an
exact match, so the order there doesn't matter), all resolving straight to `.ts`
source.) Everything here is synchronous; there is no bundle to load or
rebuild.

- `src/lib/loom-language.ts` — CodeMirror `StreamLanguage` mirroring
  the parser's line classifier. It **imports the keyword tables straight
  from `@loom/core/parser`** (`DECLARATIONS`, `SYNTACTIC_DIRECTIVES`,
  `CONTRACT_KEYS`, `RESERVED_INLINE`, `LIVE_KEYWORDS`,
  `SIMULACRA_KEYWORDS`, `MERIDIAN_KEYWORDS`) so the highlighter can never
  drift from the language (`keywords.ts` is the single source of truth for
  the parser AND every editor surface). It is a small per-line state
  machine: each line is classified into a `mode` (prose / value / expr /
  hook / decl / knot / divert) and `<…>` / `{…}` push a nested `ctx`; the
  key invariant is that reserved words (`is`/`with`/`END`/`self`/…) light
  up **only in expression contexts, never in prose/dialogue**. Token names
  map through a `tokenTable` to precise `@lezer/highlight` tags the
  one-dark theme colours reliably (kw→violet, type→yellow, label→blue,
  fn→blue, prop→coral, num→yellow, str→green, atom/speaker/interp→orange).
  Covered by `loom-language.test.ts` (`pnpm --filter loom-app test`),
  which drives the raw `loomStreamParser` over real corpus lines. The Rust
  `loom_syntax::emit_tmgrammar` TextMate grammar (Zed/VSCode) is the
  sibling surface and is behind on hooks / live-keywords (Rust
  deprioritized).
- `src/lib/loom-lint.ts` — CodeMirror `linter()` extensions. `loomLint()`
  is the parser-only fallback (`parse(source)` → CM spans; UTF-16 offsets,
  no remap). `loomLintProject(path)` is the default: it sources
  `Workspace.diagnosticsFor(uri)` so the gutter shows **cross-file project
  diagnostics** (`requiredSlotUnfilled` / `unresolvedTraitArg` /
  `derivedBeatConflict` / …), not just parser errors. `Editor.tsx` picks
  the project linter only when **both** `projectDiagnostics` **and**
  `indexWholeProject` are on (a partial index would emit false cross-file
  errors).
- `src/lib/lsp-client.ts` — the long-lived singleton `Workspace` from
  `@loom/core/lsp` (`lspWorkspaceSync()` / async `lspWorkspace()`), plus
  `uriFor` / `pathForUri` (per-segment encode/decode) and `docText(uri)`.
- `src/lib/loom-lsp.ts` — **the CodeMirror ⇄ LSP glue** — the IDE layer
  that makes CodeMirror behave like VSCode for `.loom`. `loomLspExtensions(path, opts)`
  composes: markdown **hover** tooltips (safe `textContent` render;
  `hoverDelayMs` delay, instant on ⌘/Ctrl-hover), LSP **completion**
  (`autocompletion` override → `completionAt`, replacing only the trailing
  identifier so owner-qualified diverts keep their `self.`), **go-to-definition**
  (⌘/Ctrl-Click + F12, cross-file) with a ⌘/Ctrl-hover **link underline**,
  **find-references** (Shift-F12 → focus bus → References panel), and
  **occurrence highlight**. All read live Workspace/store state at event
  time via getters, so the extension array stays stable across keystrokes
  (`Editor.tsx` memoizes on `file.path`, never the per-keystroke `file`).
- `src/lib/lsp-nav.ts` — position mapping (`offsetToLsp` / `lspToOffset`,
  0-based LSP ↔ CM offset) + cross-file nav: `navigateToLocation(loc)`
  (same-file `revealActive` vs. sibling `revealAt`), `findFileEntryByPath`,
  `firstLocation`.
- `src/lib/lsp-index.ts` + `src/lib/use-lsp-index.ts` — **whole-project
  indexing**. `indexProjectTree` walks the `root` FsEntry tree and pushes
  every `.loom` into the Workspace (server `.content` inline; local read
  lazily, mtime-gated), diffed via a text/mtime cache and batched through
  `Workspace.updateMany` (one rebuild). `syncBuffer` keeps the active
  unsaved buffer live; `dropIndexedPath` / `resetIndexCache` drop docs on
  delete/rename/project-switch (wired from `store/workspace.ts`). A
  `useLspIndexGen` counter bumps whenever indexed text changes, so the
  References panel + Command-Palette symbol lists recompute when async
  indexing lands. `useLspProjectIndex()` (mounted once in `StudioShell`)
  owns the reindex-on-`root` + buffer-sync effects.
  These drive the Outline + References panels **and** the in-buffer LSP
  features above; go-to-symbol lives in the Command Palette (`@` file /
  `#` workspace, `⌘⇧O`). Toggles + `hoverDelayMs` live in Settings
  (`store/settings.ts`, "Loom IDE" section).
- `src/lib/loom-ast.ts` — author-time typed-AST access for the
  Properties tray, plus `useLoomEdit` wrapping `@loom/core/parser`'s
  `applyBeatProperty` / `applyMoveBeat` / `applyInsertBeat` /
  `applyRemoveBeat` structural edits (editable tray fields + beat-flow
  drag rewrite `.loom` source).
- `src/lib/story-graph.ts` — the node-editor data layer:
  `useStoryGraph()` (the project-wide `Workspace.storyGraph()`, memoized
  on the index generation), `writePathContents` / `applyEditMap` (the
  graph-edit write path: open-as-tab + `updateContents` + `syncBuffer`),
  `writtenTargetFor` / `beatPath`. Replaced the old per-file
  `loom-story.ts` (and `runner/Graph.tsx` + `studio/BeatTimeline.tsx`,
  both deleted) — see **The story-graph node editor** above for the
  `components/graph/` surface it feeds.

## Local play is Run mode on a folder; server projects co-edit live

The editor is an authoring tool with a **local rehearsal runtime**:
open a folder, edit, highlight, lint, full **in-buffer LSP** (hover /
go-to-definition on ⌘/Ctrl-Click + F12 / completion / find-references
on ⇧F12 / occurrence highlight / project diagnostics, plus the Outline
/ References panels and go-to-symbol), structural beat edits, the
story-graph node editor beside the text, and Run mode (`⌘2`) — on a
folder, the `@loom/core` TS `Sim` running in-browser (no wasm; the old
wasm `LoomSession` stayed dead — this is the native-TS successor).

**Dead streams reopen (wave 9, C8).** A non-200 on an `EventSource`
(Caddy's 502 while the server restarts) closes it for good. The operate
store's mod stream and the collab stream both watch for `readyState`
CLOSED and reopen on a capped backoff (1 s doubling to 15 s; pure
`lib/stream-retry.ts`): the mod stream through `refresh` (the event's
control-plane status — reconnects a closed stream on a live event, finds
an ended one ended; the 30 s poll and Resume reconnect a closed stream
too), the collab stream after probing `GET /api/projects/:id/event`
(2xx reopens + resyncs every doc, 401 / 403 / 404 stops). A restarted
server rebuilt every doc from its stored row — a new Yjs history of the
same text, which a state-vector merge keeps twice — so a resync whose
server state vector lost a client it reported before (`serverLostHistory`)
rebases instead (`rebaseOntoServer`: the server's whole doc, this editor's
text folded in as one splice, nothing from the old history sent; the
store's `onRebind` bumps `collabGen` to remount the view; the undo stack
starts over). Tested against a fake hub in `lib/collab.test.ts`. A server run's
Log rows are stamped in story time (`storyNow` in `store/cockpit.ts`, off
the snapshot clock, never run on through a pause; the column is
`logClock` in `log-describe.ts`), like a folder run's. Tested through the
store with a fake `EventSource` in `store/operate-stream.test.ts`.

**Keyed snapshot patches (wave 9, C7).** The operate store opens
`events?role=mod&delta=1`: a `snapshot` frame (a keyframe, numeric
`_frame`) goes through the local `applySnap`, and an `event:
snapshotPatch {base, frame, patch}` is applied with `applyModPatch` onto
the last keyframe or patch it holds. A patch before any keyframe is
ignored; one on the wrong base reopens the stream via `connect(eventId)`
(a full snapshot follows; it also resets the story-graph overlay, and
never fired in testing). Every applied view must set `storyClock` to
`{ms, at: Date.now()}` when the clock moves, or the Log's story time
stalls. ≈ 0.11 Mbit/s per console at 45 guests against 5.9 for a whole
view each frame. Tested in `store/operate-delta.test.ts`.

**Server projects co-edit in real time** (2026-08-27, `lib/collab.ts` —
the native-TS successor to the removed Loro relay path): every
server-backed file is a shared **Yjs** doc synced through the `@loom/core`
server's `/api/projects/:id/collab/*` routes (base64 updates over JSON
POST + one SSE stream per project — same transport idiom as the event
plane). CodeMirror binds via `y-codemirror.next` (co-writers' cursors +
names inline; undo via `Y.UndoManager`, CM history off for live files).
**The view is keyed per bound document** (`lib/editor-binding.ts`'s
`editorViewKey`, unit-tested) so switching tabs *remounts* CodeMirror:
`yCollab`'s ViewPlugins capture their `Y.Text` at construction and
survive a `reconfigure`, so rebinding one in place made every keystroke
land in the *previously* open file's doc — which round-tripped through
`reflectCollabText` and overwrote that file (and its server copy) with
the on-screen text, leaving a switch back showing the wrong file. Never
drop that key. Graph edits and format-on-save fold in through `collabWrite`'s
minimal-splice diff; remote text reflects into the store + LSP index
(`reflectCollabText` in `store/workspace.ts`), so lint and the story
graph follow co-writers keystroke-by-keystroke. Server files are
live-synced — never "dirty" — and everything falls back to the plain
files API when the stream is unavailable. Server projects also have
full file CRUD (create/rename/delete files + folders) with `files` SSE
events reconciling every co-writer's tree (`reconcileServerTree`).
A local **folder** stays single-author (no relay), and **live events
run in the sibling packages**: `core/` (the TS engine + SSE/REST event
server) and `play/` (the participant app). The editor does not render
the guest chat; Run mode on a server project *hosts and moderates* the
project's run on that server (launch, go live, codes/QR, lifecycle,
being anyone) — the participant view stays in the `play` app. The Mode
Bar is three modes — **Writing** (`⌘1`), **Run** (`⌘2`),
**Integrations** (`⌘3`).

## Hosting

- **`pnpm dev`** — Vite at `http://localhost:5173`, with HMR.
- **`pnpm build`** — produces `dist/` (a static SPA; the engine is
  bundled in, no wasm asset). Serve `dist/` from any static host.
