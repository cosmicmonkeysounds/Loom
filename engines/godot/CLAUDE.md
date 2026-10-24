# engines/godot (the Loom runtime for Godot 4)

A pure-GDScript runtime that plays `.loombank` files compiled by
[`bank/`](../../bank): no GDExtension, no native code, no build step. It
is a Godot project, not an npm package. The shipped part is
`addons/loom/`; `demo/` and `test/` exist to develop and check it. The
live show does not use it.

Read [`README.md`](./README.md) for installing the addon, the scene-layer
nodes, the code-first API, styling, localisation and the
Godot-specific numeric hazards. The format and runtime contract are
[`docs/loom-banks.md`](../../docs/loom-banks.md).

## Layout

| Path | What |
|---|---|
| `addons/loom/loom_runtime.gd` | `LoomRuntime`: the VM (pull-model `advance() -> Step`, signals, save / load) |
| `addons/loom/loom_bank.gd`, `loom_import.gd`, `loom_bank_inspector.gd`, `loom_plugin.gd` | the bank resource, its `.loombank` importer and inspector preview, the editor plugin |
| `addons/loom/loom_value.gd`, `loom_canonical.gd`, `loom_hash.gd`, `loom_ops.gd` | value semantics and number formatting, canonical JSON, FNV-1a, opcodes |
| `addons/loom/loom_story.gd`, `loom_hook.gd`, `loom_trigger.gd` | the scene layer: the bank host node, story → game and game → story bridges |
| `addons/loom/loom_typewriter.gd`, `loom_blip.gd`, `loom_talk_animator.gd`, `loom_dialogue_box.gd`, `loom_style.gd`, `loom_speaker_style.gd`, `loom_history.gd`, `loom_save_slots.gd` | UI tools and the drop-in dialogue box |
| `demo/` | `demo.tscn`, `styled_demo.tscn` (a story played with zero scripts) |
| `test/conformance.sh`, `run.gd` | the VM diffed byte for byte against the reference interpreter |
| `test/addon.sh`, `addon.gd` | headless checks of the scene layer and the importer |

## Commands

```bash
engines/godot/test/conformance.sh [path-to-godot]   # rebuilds bank fixtures, traces them, diffs
engines/godot/test/addon.sh [path-to-godot]
```

Both find `godot` on `PATH` or `/Applications/Godot.app`, and both
import the project first so `class_name` globals resolve.
`conformance.sh` calls the bank CLI through `npx tsx`, so it needs the
pnpm install.

## Rules

- **The reference interpreter wins.** If a conformance trace diverges,
  this runtime is wrong. Every scenario (`lighthouse`, `arith`, `shuffle`,
  `locale`) must match byte for byte, including the SHA-256 of the save
  state after every command.
- **The addon is copied in two places.** The desktop app embeds
  `addons/loom/` at compile time (`include_dir!` in
  `desktop/src-tauri/src/godot.rs`) and installs it into linked Godot
  projects, and `examples/guard-patrol/godot/addons/loom/` holds an
  installed copy (identical today) with its own `test/verify.sh`. After
  changing the addon, refresh that copy and rebuild the desktop app.
- **Don't trust Godot's defaults for numbers.** `str(float)`, integer
  `/` and `%`, float literals above 2^53 and `JSON.stringify` all differ
  from the spec; use `LoomValue` and `LoomCanonical` (README, *Godot-specific
  hazards*).
- Not implemented, and diagnosed by the compiler instead: divert
  answer-slot fill, `improv` timing, the live-event layer.

This runtime is unrelated to the Quest 3 reinstallation game in
[`reinstall/vr/`](../../reinstall/vr), which is its own Godot project.
