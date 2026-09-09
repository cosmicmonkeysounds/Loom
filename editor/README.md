# loom-app (the Loom editor)

The user-facing **web IDE** for authoring `.loom` projects — a local-first
editor with a four-mode "Studio" shell: **Writing** (`⌘1`, screenplay text
editor + story-graph node editor side by side), **Run** (`⌘2`, one
rehearsal/moderation cockpit with a **Sim ⇄ Live** source switch),
**Integrations** (`⌘3`, game-engine targets — the Godot link, addon
install, and bank build), and **Deploy** (`⌘4`, the live event's
lifecycle, join codes/QR, and guest lookup).

This is the **authoring** surface. It is distinct from the participant
app ([`loom-play`](../play)), which is what guests and performers use
during a live event.

> Architecture, the Studio shell topology, the Run/Debug surfaces, and the
> play model are documented in [`CLAUDE.md`](./CLAUDE.md). This README is
> the quick "what is it / how do I run it".

## Stack

React 19 · TypeScript · Vite · Tailwind v4 · CodeMirror
(`@uiw/react-codemirror`) · `@xyflow/react` canvas · `allotment` ·
`@dnd-kit` · `zustand`.

## Install

The loom JS packages share one install — run it once from the repo root:

```bash
pnpm install
```

(`pnpm-workspace.yaml` covers `core`, `bank`, `play`, and `editor`.)

## Run

```bash
pnpm --filter loom-app dev        # Vite + HMR at http://localhost:5173
```

Play works out of the box with **no server and no account** — open a local
`.loom` folder (File System Access API) — the
[`examples/`](../examples) projects are a good start — hit `⌘2` (Run)
with the **Sim** source, and Start. For live events (accounts,
projects, launched events), run the TS event server alongside the editor:

```bash
pnpm --filter loom-app dev        # this app, HMR (:5173)
pnpm --filter @loom/core serve    # the event server (:7000)
```

(The legacy Rust relay — `cargo run -p loom-server --bin loom-relayd --
--cors permissive`, :7878 — is the older multi-workspace backbone; it
requires the Prism monorepo to build and is superseded by the TS server.)
See [`CLAUDE.md`](./CLAUDE.md).

```bash
pnpm --filter loom-app build      # → dist/ (a static SPA; the shipped
                                  #   stack serves it via the @loom/core
                                  #   event server)
```

## The engine under the editor

The editor's parse / lint / LSP / structural-edit surfaces run the
native TypeScript engine [`@loom/core`](../core) directly — **no wasm**.
`@loom/core/parser` backs highlighting, linting, the typed-AST
Properties tray, the static story graph, and the span-preserving beat
edits; `@loom/core/lsp` backs the Outline + References panels. The
former Rust→wasm bundle was removed. Runtime (play / collaboration)
lives in the sibling `core` server + `play` app, not the editor.
