# Guard Patrol

A small Loom project that exists twice on purpose:

- **`main.loom`** — the story: a night-harbor encounter with Marlow of
  the Watch (two beats' worth of dialogue, a suspicion stat, a branch
  that either waves you through to Warehouse Nine or ends at the
  bell-rope), plus the SCENE / GENERATOR coroutine examples
  (`patrol` / `investigate` / `HarborChorus`) that
  `loom-runtime`'s integration tests exercise.
- **`godot/`** — a complete external **Godot 4 game integrated with
  Loom the Wwise way**. This is the reference for what the desktop
  app's *Deploy → Game engine — Godot* panel produces when you link a
  Godot project:
  - `addons/loom/` — the runtime addon, installed verbatim from
    `engines/godot/addons/loom` (what "Install addon" writes).
  - `project.godot` — plugin enabled under `[editor_plugins]` (what
    "Install addon" edits; needed so exported PCKs pack imported
    `.loombank` assets — the runtime nodes work without it).
  - `loom/main.loombank` + `loom/LoomIDs.gd` — the compiled story
    (what "Build banks" writes; equivalently
    `loom-bank build examples/guard-patrol -o godot/loom --name main`).
  - `guard_patrol.tscn` — a **zero-script scene**: `LoomStory` with
    `bank_path` + `LoomDialogueBox` with `auto_start`. Open the project
    in Godot and press play.
  - `test/verify.sh` — headless smoke test (imports the project, plays
    both branches through the real GDScript runtime, 11 checks).

To rebuild the bank after editing `main.loom`, use the desktop app's
Godot panel, or from `bank/`:

```bash
pnpm exec tsx bin/loom-bank.ts build ../examples/guard-patrol -o ../examples/guard-patrol/godot/loom --name main
# (only main.loombank + LoomIDs.gd need to land in godot/loom)
```
