# loom-app (the editor)

The Loom authoring and show-control app. Authors sign in, manage
projects, write `.loom`, and run rehearsals and live events from the
browser. It also works on a local folder with no account, and it ships as
the Tauri desktop app (`../desktop`). The participant view (guests,
booths, hosts) is the separate [`play`](../play) app; the editor controls
and moderates a run, it never renders the guest chat itself except by
embedding play (Run → Players).

How each surface landed, wave by wave, is kept in
[`docs/history/editor-claude-2026-10.md`](../docs/history/editor-claude-2026-10.md).
The help articles the app ships are [`docs/help/authoring/`](../docs/help/authoring);
`43-run-mode.md` is the director-facing description of Run.

## Commands

Run from the repo root (`pnpm install` once covers every JS package).

| Command | What it does |
|---|---|
| `pnpm --filter loom-app dev` | Vite on `:5173` with HMR, proxying `/api` + `/e` to `LOOM_SERVER` (default the event server on `:7000`) so the BetterAuth cookie stays same-origin |
| `pnpm --filter loom-app build` | `tsc -b && vite build` → `dist/` (a static SPA; the Docker `proxy` image builds it with `--base=/edit/` and Caddy serves it at `/edit/`) |
| `pnpm --filter loom-app test` | vitest (unit tests only; `e2e/` is excluded) |
| `pnpm --filter loom-app typecheck` | `tsc -b` (predeploy runs it) |
| `pnpm --filter loom-app lint` | ESLint |
| `pnpm --filter loom-app test:e2e` | Playwright over `e2e/*.spec.ts` |
| `pnpm --filter loom-app test:e2e:live` | Playwright `e2e-live/` against a running server + database (opt-in) |
| `pnpm dev` (root) | builds play + terminal + reinstall, runs the server + this Vite; `--sync "<project>"` pushes an example folder into a server project |

For a server project you need the event server running
(`pnpm --filter @loom/core serve`). A local folder needs nothing else.

## Stack

React 19 + TypeScript + Vite, Tailwind v4, CodeMirror via
`@uiw/react-codemirror`, `@xyflow/react` + `elkjs` for the story graph,
`allotment` for the shell's regions, `@dnd-kit` for the BeatStrip,
`zustand` for state, Yjs + `y-codemirror.next` for co-editing.

## The app

`App.tsx` gates on the account: signed out → `AuthGate`; signed in with
no workspace → `ProjectsLaunchpad` (create / open server projects, the
*Shared with you* list, `ShareDialog` for members and invites); a project
or a local folder → the Studio shell.

The shell has three **modes**, switched from the bottom Mode Bar:

| Mode | Key | What it is |
|---|---|---|
| Writing | `⌘1` | A resizable editor ⇄ story-graph split (either pane snaps closed), the Files ⇄ Story Bin rail, the BeatStrip dock, the Properties tray |
| Run | `⌘2` | The control room for the project's one run (`components/run/`, `components/cockpit/`) |
| Integrations | `⌘3` | Engine targets: the Godot link, addon install and bank build (`components/integrations/`; desktop only in practice) |

Each mode is a fixed `allotment` layout (rail · stage · tray · optional
dock). `store/mode.ts` owns the active mode and region sizes, persisted to
`localStorage["loom.studio"]`; retired mode ids (`editing`, `sim`,
`operate`, `deploy`) migrate on load. Shell keys: `⌘B` rail, `⌘⌥B` tray,
`⌘\` the story-graph pane, `⌘/` or F1 Help, `⌘S` / `⌘⇧S` save; tab keys
`⌥W` / `⌥⇧T` / `⌥[` / `⌥]` / `⌥1..9`.

## Layout

```
src/
  App.tsx              auth gate → launchpad → Studio; binds the operate, terminals and house-audio stores
  components/
    studio/            StudioShell, ModeBar, TopBar, PropertiesTray, regions
    editor/            Editor (CodeMirror), Tabs, Breadcrumbs
    files/             Sidebar + FileTree
    graph/             the story-graph node editor
    run/               RunStage (header), RunPage (front of house), lifecycle, Print sheet, the Run cards
    cockpit/           the shared cockpit pages: Stage, Chat, Players, Roster, World, Director, Mind, Log, Inspector, Rail, Identity
    integrations/      GodotPanel, IntegrationsStage
    projects/ auth/ help/ runner/ shell/   launchpad, sign-in, Help overlay, References, palette + context menu + dialogs + settings
  store/               zustand stores (below)
  lib/                 language, lint, LSP glue, story-graph data, api, collab, terminals, print sheet, desktop shims, …
e2e/  e2e-live/        Playwright suites
```

Path alias `@/*` → `src/*`. Keep components small and put logic in pure
`lib/` or `store/` modules, which carry the unit tests.

## Stores

| Store | Role |
|---|---|
| `workspace.ts` | Open files and the tree; backend-aware (server project API or File System Access handle); `reflectCollabText` folds co-writers' text in |
| `mode.ts` | Mode + region sizes |
| `graph.ts` | Story-graph state: layouts, expanded cards, collapsed files, follow-cursor, the runtime overlay |
| `cockpit.ts` | The cockpit contract (`CockpitState`), `CockpitTab`, the lens, the story clock |
| `run.ts` | Picks the run backend from the workspace kind; the scratch lane |
| `operate.ts` | Server backend (mod SSE + `/e/:eventId/api/mod/*` + the control plane) |
| `sim.ts` | Local backend (an in-browser `@loom/core` `Sim`) |
| `players.ts` | Run → Players lineup, persisted per project |
| `terminals.ts` | Run → Terminals heartbeat list, chimes, the house map for the setup builder |
| `house-audio.ts` | The router status and *Stop house sounds* |
| `dialog.ts` | Promise-based `promptText` / `confirmAction` / `confirmTyped` / `notify` |
| `edit-journal.ts` | Undo / redo of structural story edits |
| `projects.ts` `auth.ts` `settings.ts` `focus.ts` `help.ts` `context-menu.ts` `godot.ts` | As named |

## Run: one run, two backends, one contract

`store/cockpit.ts` defines `CockpitState`: roster, factions, locations,
channels and messages, beats, named events, interactions, the selection,
every mod command (say, capture, setStat, fireBeat, fireSignal with an
`actor`, scanAs, reveal, broadcast, choose, addPersona, setVar, codex and
quest grants, wallet actions, re-pair, release, markGone, claimCaller, …)
**and the lifecycle**: `run` (`backend`, `mode` rehearsal | live,
`scratch`, `stale`, `codes`, `eventId`, `startedBy`), `startRun` /
`pause` / `resume` / `restart` (same snapshot) / `pushDraft` (current
text) / `goLive` (promotion in place: codes kept, story restarted) /
`end`, plus `lastRun`, `notice` and `lens`.

- **Server backend** (`operate.ts`), chosen when the workspace has a
  `projectId`. It runs the project's shared `preview` event, so every
  co-writer lands in the same run. It stays attached for the life of the
  open project (an effect in `App.tsx`), never per mode. The mod stream is
  `events?role=mod&delta=1`: a `snapshot` keyframe, then `snapshotPatch`
  frames applied with `@loom/core/mod-patch`. A co-writer's launch / go
  live / end reaches every console through the collab stream's `event`
  frames (30 s poll fallback). `lifecycle` frames drop the ledger and show
  a banner naming who did it.
- **Local backend** (`sim.ts`), chosen for a local folder. It compiles
  the indexed project and reuses the server's pure `@loom/core/chat` and
  `@loom/core/views`, so a folder rehearsal reads like the shared run.
  It cannot go live, and has no wallet, judge, terminals or Players.
- **Scratch run** (`run.ts` `useScratch`): on a server project whose run
  is live or has other directors, *Test draft privately* puts the local
  backend in the same cockpit.

Components read the cockpit only through `useCockpit(selector)`
(`cockpit/providers.tsx` `RunCockpit`). ESLint's `no-restricted-imports`
forbids importing `@/store/operate` or `@/store/sim` anywhere but the
provider, `store/run.ts`, `App.tsx` and tests. `store/lifecycle-contract.test.ts`
runs one `describe.each` over both stores.

Enums are const objects (`erasableSyntaxOnly` forbids TS `enum`):
`CockpitTab`, `RunBackend`, `RunMode`, `SelectionKind`, `CockpitPhase`,
`LensKind`.

### The Run stage and its pages

`run/RunStage.tsx` is the header on every Run page: the run pill
(`run-chrome.ts`), `LifecycleControls` (Pause / Resume, the ↺ Restart ▾
menu with push draft, go live and end; a live run's destructive actions
need the event code typed through `confirmTyped`), the page tabs, the
identity control, quick-fire, the ▶ NEXT pill, a decisions pill, and on
server runs **■ Stop house sounds**.

Tabs (`CockpitTab`): **Run · Stage · Chat · Players · Story · Roster ·
World · Director · Mind · Log**. Only Run and Story work with no run;
World, Director and Mind close under a lens.

- **Run** (`run/RunPage.tsx`, front of house only; a source test pins
  that it renders no lifecycle controls). The empty state (Start
  rehearsal, *Go live with real guests*, the last run's Export, the
  scratch offer). While running: **Join** (codes, join URL, QR, one
  sign-in row per performer part, *New performer + moderator codes*), the
  **🖨 Print sheet** (`run/PrintSheet.tsx` + `lib/print-sheet.ts`: join
  poster, door sign, codex posters by stack, room check-in signs, cast
  cards, invitations; QRs drawn in the browser), **Directing now**,
  **Terminals**, **House sound**, **House map** (when the event has a map:
  variants, the shared King, the 💡 lights row), **Wallet** (only with a
  `currency:` story), and **Look up a guest**.
- **Stage**, **Chat**, **Roster**, **World**, **Log** (`cockpit/`): the
  room map, the feed with a composer that can speak as anyone, the
  roster, the variable table, the ledger (`log-describe.ts` is exhaustive
  over `SimEventType`; a new event type breaks the build until it is
  described). The Log exports the run (`lib/run-export.ts`, paging the
  whole ledger off `/api/mod/log`).
- **Story**: the story graph read-only with the runtime overlay.
- **Players** (`cockpit/PlayersTab.tsx`): one embedded real play app per
  guest, persona or performer, side by side. Each pane mounts
  `@loom/play/embed` in a shadow root on its own session minted by `POST
  /api/mod/impersonate`. Server runs only.
- **Director** (`cockpit/director/`): the running order by act, the NOW
  card (NEXT, *then:*, countdowns, LAST and what the press did), On hand,
  arm-then-fire on every cue (`useArmed.ts` over core's arm model), the
  glance column (Needs you, the `watch:` board with secrets masked,
  People, the race, Cast, staff rooms), Calling / Watching tied to the
  show's caller claim, and the rare tools (fire event / beat / broadcast).
  Rows, acts and arm timing come from `@loom/core/cue-sheet`; NEXT / LAST
  are the server's `cueState`, so every console and the director phone
  agree. Keys (Calling only): Space arms / fires NEXT, Enter the cursor
  row, Esc disarms, j / k / ↑ / ↓, `/` filters.
- **Mind** (`cockpit/MindTab.tsx` + pure `cockpit/mind.ts`, server runs):
  the agent's mind as the stagehand worker mirrors it, the thought trace
  (`agentThought` frames + `/api/mod/agent/trace`), and the control panel
  (`/api/mod/agent/control`). Classic and story-mind workers render
  differently (`isNewMind`). The top card is **Judging**: the facts
  judge's `auto` / `review` mode (a journaled var), pending filings,
  ✅ / 😤 / 🤷 overrides on every judged filing, near misses, the judge
  queue, per-question tallies. In the editor, verdicts are shown only
  here; hosts also judge from Play's host dock (the Judge tab).

### Run → Terminals

`run/TerminalsCard.tsx` over `store/terminals.ts` and pure
`lib/terminals.ts`. Every wall terminal and the TV by last poll
(`/api/mod/screen/terminals`), red after 20 s silent with a chime that
repeats until *ack*. The store is bound from `App.tsx`, so it chimes from
any mode. Per row: the map spot, the room, **identify**, and badges off
the heartbeat:

| Badge | Source |
|---|---|
| 🔇 / 💤 / 🔋 / build | sound, visibility, battery, `__BUILD__` (amber *old build* beside a stamped majority) |
| ⛶ | not full screen (`fs=0`) |
| 🎤 | the voice link's mic (`mic=`) |
| 📢 | the terminal says house announcements (`ann=1`) |
| 🚪 | the door sensor (`doorBadges`): shut / open + level, fault, warning, *override* off `night.door_override` |
| 🔌 | the patch bay on the same M4 (`patchBadges`, wave 22): cable count, *✓* when complete, fault, *?* inputs between levels, *(silent)*, *buttons* off `night.patch_override` |

The 🚪 / 🔌 counts only; which cables are in is never shown. The store
reads `GET /api/screen/state` for the two override flags only while some
row reports a sensor. **🛠 Set up a terminal…** (`run/TerminalSetup.tsx`
+ pure `lib/terminal-setup.ts`) builds a `/terminal/?code=<mod>&…` link
and QR from selects over the house map, the views, the story's
LOCATIONs and the cast, including `announce=1`, `keys=0` and
`door=serial`.

### Being anyone: the identity lens

`perspective` is the Operator (god view) or a guest, persona or
character id. `setPerspective` resolves `lens`, that participant's own
projection: `guestView` / `primeView` computed locally, or `GET
/e/:id/api/state?role=guest|prime&as=<id>` on a server run.
`cockpit/rooms.ts` `buildRooms` then lists exactly that participant's
rooms; a character gets the booth (one thread per guest, the booth's
pinned rooms, its Inbox of readouts). Under a lens the Roster hides true
factions, editors are disabled, and Esc returns to the Operator. Speaking
as a real guest needs an explicit pick and a once-per-session confirm,
and carries a `via <director>` tag.

The **Inspector** (`cockpit/Inspector.tsx`) shows a guest's view, feed,
objectives, codex (grant), quests (start / update / complete / fail),
last seen, 👋 Went home, Restrict / Unrestrict, 🔁 Re-pair, and a
character's feed, readouts and ⏏ Release.

## Writing: the editor and the story graph

**Loom in CodeMirror.** The editor consumes `@loom/core` as TypeScript
source through aliases in `vite.config.ts` and `tsconfig.app.json`: no
wasm, no build step. The aliases are `parser`, `lsp`, `sim`, `runtime`
(for `@loom/bank`), `chat`, `views`, `mod-patch`, `cue-sheet`,
`host-board`, then bare `@loom/core`, plus `@loom/bank` and
`@loom/play/embed`.

- `lib/loom-language.ts`: the highlighter, built on the parser's keyword
  tables so it cannot drift. Reserved words light up only in expression
  contexts. Tested by `loom-language.test.ts`.
- `lib/loom-lint.ts`: project diagnostics from `Workspace.diagnosticsFor`
  (parser-only fallback when the whole project isn't indexed).
- `lib/lsp-client.ts`, `lsp-index.ts`, `use-lsp-index.ts`: one long-lived
  `Workspace`, whole-project indexing, and the `useLspIndexGen` counter
  that every derived view recomputes on.
- `lib/loom-lsp.ts`, `lsp-nav.ts`: hover, completion, go to definition
  (⌘-click, F12), find references (⇧F12), occurrence highlight.
- `lib/editor-menu.ts`: the editor's context menu; F2 renames the beat at
  the cursor workspace-wide (`Workspace.renameBeat`).

**The story graph** (`components/graph/`, data from `lib/story-graph.ts`
`useStoryGraph()` over `Workspace.storyGraph()`): the project map (beats
in collapsible per-file containers, divert / choice / tunnel / hook edges,
ghost nodes for unresolved targets) and a beat drill-in. ELK layout
(`graph/layout.ts`), manual drags persisted per project, word blocks that
expand a card to its full body, floating edges, a live filter, arrow-key
navigation, follow-cursor in both directions (`graph/follow.ts`). Every
canvas edit round-trips to `.loom` text through `@loom/core/parser`'s
span-preserving edit ops (`appendDivert`, `retargetDivert`,
`insertBodyLines`, `removeBodyItem`, `appendDeclaration`, …) via
`writePathContents`. Derived (trait-template) beats are read-only
projections.

**The edit journal** (`store/edit-journal.ts`): every structural edit is
one labelled multi-file entry. ⌘Z / ⌘⇧Z outside a text surface undo and
redo it; inside CodeMirror its own history applies. An entry applies only
while every file still holds the text it expects.

## Co-editing and persistence

- **Two backends only**: the SaaS API for server projects and File System
  Access handles for local folders (desktop: FSA-shaped shims). New
  persistence goes through `store/workspace.ts`.
- **Server files are live Yjs docs** (`lib/collab.ts`) over
  `/api/projects/:id/collab/*`: base64 updates over POST, one SSE stream
  per project. CodeMirror binds with `y-codemirror.next` (remote cursors,
  `Y.UndoManager`). Server files are never dirty. Graph edits and
  format-on-save fold in through a minimal-splice diff.
- **Dead streams reopen**: both the mod stream and the collab stream
  reopen on a 1 s → 15 s backoff (`lib/stream-retry.ts`). A restarted
  server rebuilds its docs; the editor detects the lost history and
  rebases instead of merging twice (`rebaseOntoServer`).

## Gotchas

- **Keep the editor view keyed per bound document**
  (`lib/editor-binding.ts` `editorViewKey`). `yCollab` captures its
  `Y.Text` at construction; rebinding in place sent keystrokes into the
  previous file's doc and overwrote it on the server.
- **Never use `window.prompt` / `confirm` / `alert`.** In the Tauri
  WKWebView they return null / false with no UI. Use `store/dialog.ts`;
  `e2e/studio.spec.ts` asserts no native dialog fires.
- **Alias order in `vite.config.ts`.** Subpath aliases must stay above
  the bare `@loom/core` one (Vite tries keys in order). `tsconfig.app.json`
  paths without `*` match exactly, so order does not matter there.
- **`node:crypto`.** `@loom/core/chat` reaches `node:crypto` through the
  server's wallet and identity modules. Outside vitest it is aliased to
  `src/lib/node-crypto-stub.ts` (its functions throw if called).
- **One React.** `resolve.dedupe` keeps one React for the embedded play
  app; play pins React 18, the editor 19.
- **Story clock.** Every applied mod view must update `storyClock`, or
  countdowns and the Log's story time stall.
- **Shared local copies.** `lib/map-variants.ts` copies
  `reinstall/web/src/map/project.ts`'s `variantLabel`; the lens's booth
  rooms mirror play's `buildPrimeChannels`. Change both sides together.
- **Panes clip to width 0** in the shell; in Playwright assert with
  `toBeInViewport`, not visibility.

## Tests

- Unit (vitest): next to the code (`*.test.ts`), e.g.
  `store/lifecycle-contract`, `store/sim`, `store/run`,
  `store/operate-{delta,stream,moved}`, `cockpit/{rooms,mind,wallet,…}`,
  `director/*`, `lib/{terminals,terminal-setup,print-sheet,collab,…}`,
  `graph/graph-pipeline` (core graph → flow → ELK over
  `escape-the-internet`), `lib/help-content` (help collection integrity:
  frontmatter, cross-links).
- Playwright `e2e/`: `studio` (modes, panes, dialogs), `qol`, `graph`,
  `sim` (Run on a local folder), `director`, `help`, `grants`,
  `booth-lens`.
- `e2e-live/` (opt-in, a running server + `loom_dev`): `live-collab`
  (launch, restart banner, push draft, go live, end) and `mind` (a real
  stagehand worker).

## Desktop

`lib/desktop.ts` `isDesktop()` gates desktop-only code, inert in the
browser. `lib/desktop-fs.ts` provides FSA-shaped handles over the Tauri
fs commands (no `FileSystemObserver`: external edits need a refresh).
`store/godot.ts` + `components/integrations/GodotPanel.tsx` link a Godot 4
project, install the runtime addon and build `.loombank` + `LoomIDs.gd`
with `@loom/bank` in the webview. See [`../desktop/README.md`](../desktop/README.md).
