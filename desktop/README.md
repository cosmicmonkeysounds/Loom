# loom-desktop

The Loom author IDE as a native desktop app — the `editor` React app in
a Tauri 2 shell, plus what the browser can't do: **Wwise-style game
engine integration**. Loom is fully standalone here: no Prism
dependency anywhere in the desktop stack.

```bash
pnpm install                      # once, at the repo root
pnpm --filter loom-desktop dev    # dev app (spawns the editor's Vite dev server)
pnpm --filter loom-desktop build  # bundled .app / installer
```

The Rust side is its own Cargo workspace (`src-tauri/`) so the repo
root's `cargo build` / `cargo test` stay lean; `cargo test` in
`src-tauri/` covers the integration logic.

## What the shell adds

- **Native local projects** — WKWebView has no File System Access API,
  so the shell exposes a small path-based fs command surface
  (`src-tauri/src/fs_bridge.rs`) and the editor runs its local-folder
  backend on handle-shaped shims over it
  (`editor/src/lib/desktop-fs.ts`). Open-folder, save, create, rename,
  delete, and the persisted last-project all work as in Chromium.
- **Godot integration** (`src-tauri/src/godot.rs`, surfaced in the
  editor's **Deploy → Game engine — Godot** panel):
  - *Link* a Godot 4 project (validated by `project.godot`).
  - *Install addon* — the `engines/godot/addons/loom` runtime is
    embedded in the binary at compile time (`include_dir`) and written
    into the game project's `addons/loom/`; the editor plugin is
    enabled in `project.godot` (exports need it to pack `.loombank`
    assets — runtime nodes work either way).
  - *Build banks* — the webview compiles the open workspace with
    `@loom/bank` (`compileSources` + `gdscriptHeader`) and the host
    writes `<name>.loombank` + `LoomIDs.gd` into the project (default
    folder `loom/`).

The reference result of this flow is checked in at
`examples/guard-patrol/godot/` (with a headless `test/verify.sh`).

## Regenerating icons

`pnpm --filter loom-desktop icons` — draws the woven-thread mark in
code and rebuilds the PNG set + `.icns` (macOS `sips`/`iconutil`).
