# Loom for Godot

Play compiled Loom story banks (`.loombank`) in Godot 4 — dialogue,
choices, variables, hooks, and save/load. Pure GDScript: no
GDExtension, no native binaries, no build step.

This folder is the complete addon — copy it into your project's
`addons/` and enable **Loom** in *Project → Project Settings →
Plugins* (that registers the `.loombank` importer and the bank
inspector preview; the runtime nodes are plain `class_name` scripts
and need no plugin).

Banks are compiled from `.loom` sources with the `loom-bank` CLI from
the Loom repo, which also generates a `LoomIDs.gd` constants header:

```bash
# in a checkout of the Loom repo:
pnpm install
cd bank
npx tsx bin/loom-bank.ts build path/to/your/story -o YOUR_PROJECT/story --name main
```

Full node reference (LoomStory, LoomHook, LoomTrigger, LoomTypewriter,
LoomDialogueBox, …), demos, and the conformance harness live in the
Loom repository under `engines/godot/`. The bank format is specified
in `docs/loom-banks.md` there.

License: MIT (see LICENSE in this folder).
