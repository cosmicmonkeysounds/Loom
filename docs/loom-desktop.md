# Loom Desktop — the standalone app + game-engine integration

*Landed 2026-07-25.*

Loom is a standalone product: its own repo, its own MIT license, its
own JS + Rust workspaces (the only Prism tie left is the legacy
`server/` relay crate, excluded from the workspace). This doc covers
the piece that makes that standalone-ness tangible on a desk: the
**Tauri desktop app** (`desktop/`) and its **Wwise-style Godot
integration**.

## The model — Wwise, transplanted

Wwise's authoring model: sound designers work in a dedicated desktop
authoring tool; the tool *links* the game project; the engine side is
a thin runtime plugin; the artifact crossing the boundary is compiled
**banks** plus a generated ID header. Nothing about the game's build
knows the authoring tool exists.

Loom maps onto that one-to-one — the pieces already existed
(`@loom/bank` compiles `.loombank` + `LoomIDs.gd`; `engines/godot` is
the runtime addon; `docs/loom-banks.md` is the contract). The desktop
app is what connects them with a UI:

| Wwise                        | Loom                                              |
|------------------------------|---------------------------------------------------|
| Wwise Authoring (desktop)    | `desktop/` — the editor in a Tauri shell          |
| "Link game project"          | Deploy → **Game engine — Godot** → *Link project* |
| Engine integration plugin    | `addons/loom` (embedded in the app, installed in) |
| Generate SoundBanks          | *Build banks* → `loom/<name>.loombank`            |
| `Wwise_IDs.h`                | `loom/LoomIDs.gd`                                 |

## Architecture

```
desktop/
  package.json          # loom-desktop: dev/build via @tauri-apps/cli
  scripts/gen-icons.mjs # code-drawn icon set (PNG encoder + sips/iconutil)
  src-tauri/            # its OWN Cargo workspace (root stays lean)
    src/lib.rs          # builder + command registry
    src/fs_bridge.rs    # path-based fs commands (the editor's local backend)
    src/godot.rs        # link/validate/install/write + unit tests
    tauri.conf.json     # devUrl :5173, frontendDist ../../editor/dist
```

- **One frontend.** The desktop app *is* the `editor` Vite app —
  `beforeDevCommand` runs the editor's dev server, a bundled build
  serves `editor/dist`. No fork, no desktop-only frontend code paths
  beyond `isDesktop()` gates.
- **Filesystem via handle shims.** WKWebView has no File System Access
  API, so `editor/src/lib/desktop-fs.ts` implements the exact handle
  surface `lib/fs.ts` uses (entries / getFileHandle / getFile /
  createWritable / move / removeEntry / permissions) over the
  `fs_bridge` commands. `pickDirectory()` hands out a shim on desktop
  and a real handle in Chromium; everything downstream —
  `store/workspace.ts`, the LSP indexer's lazy `getFile()` reads, save,
  create, rename — is unchanged. Persisted roots survive restarts: the
  shim structured-clones into IndexedDB as `{kind, name, path}` and is
  rehydrated by path on boot (permissions are always `'granted'`;
  native paths have no permission dance).
- **Banks compile in the webview.** `@loom/bank` is pure TS (its one
  Node dependency, `node:crypto`, was replaced by a pure-TS SHA-256 in
  `bank/src/sha256.ts` — conformance goldens pin it byte-for-byte), so
  the editor compiles the indexed project exactly the way Run mode's
  Sim compiles it (`gatherLoomSources()` over the LSP workspace docs,
  spine file first) and hands finished artifact text to the host.
  The host (`godot.rs`) only validates paths and writes files.
- **The addon is embedded, not located.** `include_dir!` bakes
  `engines/godot/addons/loom` into the binary at compile time, so
  *Install addon* behaves identically in `tauri dev` and a bundled
  `.app`, with no resource-path resolution. Install also enables the
  plugin in `project.godot` (`[editor_plugins]` array edit, unit
  tested) — the runtime nodes are plain `class_name` scripts that work
  without it, but exported PCKs need the importer to pack `.loombank`
  assets.

## The reference integration

`examples/guard-patrol/godot/` is a checked-in, headlessly-verified
instance of the whole flow: the guard-patrol story compiled to
`loom/main.loombank` + `LoomIDs.gd`, the addon installed, the plugin
enabled, and a zero-script scene (`LoomStory` + `LoomDialogueBox`).
`test/verify.sh` imports the project and plays both branches through
the GDScript runtime (11 checks, runs in CI-less local dev with any
Godot 4 binary).

## Boundaries / follow-ups

- **Engines beyond Godot**: `godot.rs` is deliberately shaped as
  "validate project → install runtime → write artifacts"; a Unity or
  Unreal integration is the same three commands against a different
  project layout once `engines/unity` / `engines/unreal` exist
  (`LoomIDs.cs` / `LoomIDs.h` already generate).
- **File watching**: the browser `FileSystemObserver` doesn't exist on
  desktop; external edits currently need the sidebar refresh. A
  `notify`-based watcher emitting the same change records is the
  natural next step.
- **Locale banks** in the panel (the CLI's `--locale tag=file` flow)
  are not surfaced yet.
- **Auto-updater / signing** (`tauri-plugin-updater`) not wired.
