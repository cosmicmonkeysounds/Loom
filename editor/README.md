# loom-app (the Loom editor)

The user-facing **web IDE** for authoring `.loom` projects — a local-first
editor with a three-mode "Studio" shell: **Writing** (`⌘1`, screenplay
text editor + story-graph node editor side by side), **Run** (`⌘2`, the
control room for the project's one run — start a rehearsal or go live,
join codes/QR, moderate, and *be* any participant), and **Integrations**
(`⌘3`, game-engine targets — the Godot link, addon install, and bank
build).

This is the **authoring** surface. It is distinct from the participant
app ([`loom-play`](../play)), which is what guests and performers use
during a live event.

> Architecture, the stores, the Run pages and the gotchas are in
> [`CLAUDE.md`](./CLAUDE.md). This README is the quick "what is it / how do
> I run it". The in-app manual (⌘/ or F1) is built from
> [`docs/help/authoring/`](../docs/help/authoring).

## Stack

React 19 · TypeScript · Vite · Tailwind v4 · CodeMirror
(`@uiw/react-codemirror`) · `@xyflow/react` + `elkjs` canvas ·
`allotment` · `@dnd-kit` · `zustand` · Yjs (live co-editing).

## Install

The loom JS packages share one install — run it once from the repo root:

```bash
pnpm install
```

(`pnpm-workspace.yaml` covers `core`, `bank`, `play`, `terminal`, `house`,
`reinstall/web`, `editor`, and the rest of the JS packages.)

## Run

```bash
pnpm --filter loom-app dev        # Vite + HMR at http://localhost:5173
```

It works out of the box with **no server and no account**: open a local
`.loom` folder (File System Access API, so a Chromium browser, or the
[desktop app](../desktop)) — the [`examples/`](../examples) and
[`core/examples/`](../core/examples) projects are a good start — hit `⌘2`
(Run) and ▶ Start rehearsal. A local folder runs the in-browser `Sim`.

For accounts, server projects, live co-editing and launched events, run
the TS event server alongside the editor (`pnpm dev` at the repo root
does both, and more):

```bash
pnpm --filter loom-app dev        # this app, HMR (:5173)
pnpm --filter @loom/core serve    # the event server (:7000)
```

```bash
pnpm --filter loom-app build      # → dist/ (a static SPA; in the Docker
                                  #   stack Caddy serves it at /edit/)
pnpm --filter loom-app test       # vitest
pnpm --filter loom-app test:e2e   # Playwright
```

## The engine under the editor

The editor runs the native TypeScript engine [`@loom/core`](../core)
directly from source — **no wasm**. `@loom/core/parser` backs
highlighting, linting, the Properties tray, the story graph and its
span-preserving edits; `@loom/core/lsp` backs hover, completion,
definitions, references and project diagnostics; `@loom/core/sim` runs
a local rehearsal in the browser. Live events run on the `core` event
server; guests and performers use the [`play`](../play) app, which Run →
Players can embed side by side.
