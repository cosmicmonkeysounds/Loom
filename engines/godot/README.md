# Loom for Godot

Play compiled Loom story banks (`.loombank`) in Godot 4 — dialogue,
choices, variables, hooks, and save/load — through the cross-engine
runtime API defined in
[`docs/loom-banks.md`](../../docs/loom-banks.md).

Pure GDScript. No GDExtension, no native binaries, no build step: drop
`addons/loom/` into your project and it works on every platform Godot
targets.

The addon follows the shape of the Wwise integrations: an
**engine-agnostic core** (`LoomRuntime`, the conformance-tested VM) plus
a **scene layer** of drop-in nodes — a bank host, story↔game event
bridges, and UI tools like a typewriter — so most day-to-day wiring
happens in the editor, not in code.

## Install

1. Copy `addons/loom/` into your project's `addons/`.
2. Enable **Loom** in *Project → Project Settings → Plugins*. This
   registers the `.loombank` importer (banks become real assets that ship
   inside your PCK) and the bank inspector preview. The runtime nodes
   themselves need no plugin — they are plain `class_name` scripts.
3. Build a bank from your `.loom` sources and drop it in `res://`:

```bash
cd bank
npx tsx bin/loom-bank.ts build path/to/story -o /path/to/game/story --name main
```

That writes `main.loombank` plus `LoomIDs.gd`, a generated header of
name→id constants so a renamed beat breaks your build instead of failing
silently at runtime.

## The scene layer

| Node | Direction | Role |
|------|-----------|------|
| `LoomStory` | — | Hosts a bank in the scene: bank slot in the inspector, `autoplay`, timer `auto_tick`, optional `auto_advance` pump with hold/release gating. Extends `LoomRuntime`, so the whole VM API is on it. |
| `LoomHook` | story → game | Filterable listener: pick a kind (directive / beat / line / variable write / `<fire:>` / choice / finished / error) and a name filter in the inspector, connect its `triggered(payload)` signal to anything. `<cue: thunder>` flashes a light with zero dispatch code. |
| `LoomTrigger` | game → story | Fires an authored `on <verb>` hook or starts a beat when something happens in the scene: on ready, on Area2D/3D overlap (put it under the Area), or manually via `trigger()` from any signal. `once` makes it one-shot. |
| `LoomTypewriter` | UI | Per-character reveal on any `RichTextLabel` (BBCode-safe), punctuation-aware pacing, `skip()`, and **raw signals** — `started` / `character_shown(index, char)` / `finished`. Attached to a story it plays every line automatically and holds the auto-advance while typing. Deliberately knows nothing about audio or animation. |
| `LoomBlip` | UI | Interprets `character_shown` as sound — the classic dialogue voice. Cadence, pitch randomisation, and a **pooled** `AudioStreamPlayer` set (`polyphony`), so a fast line never allocates. Drop it under a typewriter. |
| `LoomTalkAnimator` | UI | Interprets `started`/`finished` as talk/idle animation on an `AnimationPlayer` or `AnimatedSprite2D/3D`, and re-emits `talk_started`/`talk_stopped` for bespoke rigs. |
| `LoomDialogueBox` | UI | A **complete drop-in dialogue player**: speaker names, portraits, typewriter text, **pooled** choice buttons, continue indicator, two-tap input (reveal → advance), optional VN-style auto mode, `resume()` after a loaded save. Fully skinned by a `LoomStyle` resource — `demo/styled_demo.tscn` plays a whole story with **zero scripts**. |
| `LoomHistory` | UI | Dialogue backlog: records every line (speaker, text, beat) off the step stream, `as_bbcode()` dumps it into any label. |
| `LoomSaveSlots` | — | Named save slots over `save()`/`load_state`: one JSON per slot with a metadata header (beat, setting, timestamp, pending-choice flag) read from the query API, so a slot list renders without loading anything. |

The split is deliberate: the core emits **raw signals** (characters,
line boundaries, steps) and each effect — blips, mouth flaps, rumble,
particles — is a small node that interprets them. Skip the ones you
don't need; write your own against the same signals.

Companion nodes find the nearest `LoomStory` automatically (closest
ancestor, then anywhere in the scene), so a working scene can be wired
entirely in the editor:

```
Level
├─ LoomStory            bank = main.loombank, autoplay ✓
├─ DialogueBox (your UI)
│  └─ LoomTypewriter    target = ../Text
├─ Lamp (Area3D)
│  └─ LoomTrigger       BODY_ENTERED → fire "lamp_lit"
└─ Thunder (LoomHook)   DIRECTIVE "cue" → _on_cue()
```

Clicking any imported `.loombank` in the FileSystem dock shows what is
inside — entry beat, every beat with a copy-name button, authored hooks,
compiler diagnostics — so `start_beat` calls and hook filters never carry
a typo'd name.

## Styling

Everything visual lives in a **`LoomStyle`** resource — panel StyleBox,
fonts, sizes, colors, padding, typewriter speed and punctuation pacing,
voice blip (stream / cadence / pitch range), choice-button styling, and
the continue indicator. Reskinning the game is editing one `.tres`;
`addons/loom/styles/default.tres` is the neutral starting point to
duplicate.

Per-character presentation is a list of **`LoomSpeakerStyle`** entries on
the style: match a speaker's display name (case-insensitive) to a pretty
name ("WREN" → "Wren"), a name color, a portrait, and a per-speaker blip.
`demo/demo_style.tres` shows the shape.

```gdscript
box.set_style(load("res://ui/night_theme.tres"))   # swap skins at runtime
```

The styling layer only touches the shipped UI nodes — a bespoke UI keeps
using `LoomRuntime`/`LoomTypewriter` directly and never sees it.

## Code-first use

The API is a **pull model**: the story advances only when you ask it to,
so a typewriter effect, voice line, or animation can gate each step
without the runtime knowing anything about it.

```gdscript
var loom := LoomRuntime.new()   # or a LoomStory node in the scene
add_child(loom)
loom.load_bank_file("res://story/main.loombank")
loom.start_entry()

func _step() -> void:
    while true:
        var step := loom.advance()
        match str(step["step"]):
            LoomOps.STEP_LINE:
                show_line(step.get("display", ""), step["text"])
                return                      # wait for the player
            LoomOps.STEP_CHOICE:
                present(step["options"])    # loom.choose(i) resumes
                return
            LoomOps.STEP_DIRECTIVE:
                play_cue(step["verbName"], step["positional"], step["named"])
            LoomOps.STEP_DONE:
                return
```

Signals are emitted alongside for hosts that prefer a push style —
`line_emitted`, `choice_presented`, `directive_emitted`,
`variable_changed`, `beat_entered`, `story_finished` — but `advance()` is
the normative surface, and it is what the conformance suite checks.

`LoomStory.auto_advance` turns the pull loop into a per-frame pump for
stories consumed entirely through signals and `LoomHook`s; any node can
`hold(self)` / `release(self)` the story to gate pacing (the typewriter
does this for you).

Two demos ship in `demo/`: `demo.tscn` is a hand-wired player showing the
code-first flow (typewriter, hooks, log), and `styled_demo.tscn` is the
zero-script version — a `LoomStory` and a styled `LoomDialogueBox`, no
GDScript at all.

### State: querying, reactivity, saving

```gdscript
loom.set_var("Wren.trust", 40.0)
loom.get_var("Wren.trust")
loom.signal_event("lamp_lit", "player")   # fires authored `on lamp_lit` hooks
loom.tick(delta * 1000.0)                 # drives `on every 30s` timers
                                          # (LoomStory does both automatically)

loom.current_beat()                       # "opening" — where the story is
loom.current_setting()                    # "Lighthouse" — the LOCATION
loom.is_waiting()                         # parked on a choice?
loom.pending_options()                    # …and which options, re-rendered
loom.is_finished()                        # nothing left to run at all
loom.has_played("lamp_room")              # ledger queries from the host side
loom.visits_of("lamp_room")
loom.world_snapshot()                     # every variable, for debug/quest UIs
loom.bank.beat_names()                    # every startable beat in the bank

var blob := loom.save()                   # all scalars — JSON-safe
loom.load_state(blob)
loom.save_to_file("user://save.json")     # LoomStory convenience
loom.load_from_file("user://save.json")   # then LoomDialogueBox.resume()
```

For *reacting* to state instead of polling it, a `LoomHook` with kind
`VARIABLE` and a filter like `Wren.*` is the editor-first way to watch
writes.

`save()` captures the whole VM including a **suspended choice**: the
continuation is `(program, pc)` plus scalars, so a player can quit
mid-menu and resume exactly there. If the bank has been recompiled,
`load_state()` refuses with `{"ok": false, "reason": "bankChanged"}` —
instruction offsets are meaningless across a rebuild. Pass
`allow_migrate = true` to keep variables, visit counts, latches, and taken
choices while discarding position.

## Conformance & tests

Per-engine runtimes only stay in agreement because it is enforced
mechanically. The TypeScript reference interpreter in
[`bank/`](../../bank) defines the semantics; this runtime is diffed
against its golden traces:

```bash
./test/conformance.sh                     # the VM, byte-for-byte vs the reference
./test/addon.sh                           # the scene layer: nodes, importer, typewriter
```

Every conformance scenario (dialogue/choices, arithmetic, `<shuffle:>`
PRNG streams, locale switching) must match **byte for byte**, including
the SHA-256 digest of the save state after every command — so save/load
divergence is caught, not just output divergence.

If you change this runtime and a trace diverges, this runtime is wrong.

## Godot-specific hazards

Everything here exists because Godot's defaults differ from the spec, and
each one would have produced a silent, story-visible divergence:

- **`str(float)` truncates to 14 significant digits**, and `%g` / `%e` are
  not supported format characters at all. `LoomValue.format_number`
  implements ECMA-262 `Number::toString` from digits instead.
- **Integer `/` and `%`** do not give IEEE results. Loom is all-f64, so
  division by zero must yield `inf`/`nan` and `%` must be truncated
  remainder (`-7 % 3 == -1`). `LoomValue.apply_binary` handles both.
- **GDScript float *literals* lose precision** above 2^53 — a source
  literal `9007199254740991.0` parses as `...990`. `JSON.parse_string` does
  *not*, so values arriving from a bank are exact. Do not hand-write large
  float literals in tests.
- **`JSON.stringify` cannot be used for traces**: it preserves insertion
  order rather than sorting keys, and formats floats differently.
  `LoomCanonical.stringify` is the canonical serialiser.
- **A bank restored from Godot's resource cache** (the importer path every
  exported game takes) arrives with `data` but none of the derived lookup
  tables — `load_bank` indexes it. `load_bank_file` prefers the raw file
  (fresh in dev) and falls back to the imported resource (all a PCK has).
- **`class_name` globals need one project import** before
  `--headless --script` can resolve them; the test scripts do that on
  first run.

## Localisation

`<shuffle:>` and locale banks both landed 2026-07-25. Shuffle needs
nothing from you — variants pick via the spec'd xorshift64* stream,
deterministically enough that the conformance digests cover it, and the
per-site streams ride the save file.

Translations are sidecar banks:

```bash
loom-bank strings story/main.loombank -o strings.json   # translator template
# … translate the values, keep the {0} placeholders …
loom-bank build path/to/story -o story --name main --locale fr=fr.json
```

```gdscript
loom.load_bank_file("res://story/main.fr.loombank")  # register the sidecar
loom.set_locale("fr")                                # swap; "" = source
```

Untranslated lines fall back to the source per key, so partial
translations ship.

## What is not implemented

Out of scope, and diagnosed at compile time rather than silently
ignored: answer-slot fill at a divert call site, `improv` timing, and
the multi-participant LARP layer (chat channels, spaces, rosters,
capture/escape).
