# Loom v3 examples

Reference `.loom` projects. Each subdirectory is a self-contained
project rooted at `main.loom`. They double as authoring tutorials and
as fixtures for the Rust `loom-runtime` integration tests
(`runtime/tests/`), which load them directly. They are written in the
v3 surface, which Loom 4 keeps parsing; for the current surface, start
with `core/examples/glass-orchard` below.

- **`saltmere`** — the tutorial: a lighthouse two-hander in screenplay
  form (CHARACTER with `is` mixins, dialogue, choices, a reactive
  `let`).
- **`wren-simulacra`** — the simulacra layer: knowledge slots, goals,
  disposition thresholds (`on trust passes 80`), STATS + skill TREEs.
- **`bell-tower-live`** — the live-performance layer: COHORTs,
  LOCATIONs with capacity + ambient loops, improv beats, broadcasts.
- **`circuit-break`** — a full immersive-theatre piece for ~24
  audience: three cohorts, five locations, and beats that branch on a
  live `Tension` value and character dispositions.
- **`guard-patrol`** — SCENE coroutines: looping patrol / investigate
  state machines gated on `wait until` predicates — plus a playable
  two-beat harbor encounter, and **`godot/`**: a complete external
  Godot 4 project integrated with Loom the Wwise way (runtime addon
  installed, story compiled to `loom/main.loombank` + `LoomIDs.gd`,
  zero-script scene, headless `test/verify.sh`) — the reference output
  of the desktop app's Godot panel. See its
  [README](./guard-patrol/README.md).
- **`preview-night`** — spec §13 end to end: STATS classes, ROLE /
  PERSON / ROSTER declarations, `<load_roster:>` / `<cast:>` /
  `<recast:>` directives.

## The TypeScript engine's projects

Three multi-file projects live with the TS engine in
[`core/examples/`](../core/examples/), beside its loader
(`core/examples/load.ts`):

- **`trapped-in-the-internet`**: the Halloween 2026 show and the event
  server's default scenario. Its [README](../core/examples/trapped-in-the-internet/README.md)
  is the runbook; `SHOW.html` is the generated show book.
- **`glass-orchard`**: the **Loom 4 reference project** (a garden-party
  mystery: `Name:` dialogue, keyword statements, `when` hooks and
  watchers, `GROUP`s, spaced names; see [`docs/loom-4.md`](../docs/loom-4.md)).
- **`escape-the-internet`**: the earlier v3-surface party scenario that
  the server and chat suites still exercise.
