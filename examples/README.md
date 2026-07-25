# Loom v3 examples

Reference `.loom` projects. Each subdirectory is a self-contained
project rooted at `main.loom`. They double as authoring tutorials and
as test fixtures: the TS suites (`@loom/core`, `@loom/bank`) and the
older Rust `loom-runtime` integration tests load them directly.

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
  state machines gated on `wait until` predicates.
- **`preview-night`** — spec §13 end to end: STATS classes, ROLE /
  PERSON / ROSTER declarations, `<load_roster:>` / `<cast:>` /
  `<recast:>` directives.

The flagship multi-file scenario, `escape-the-internet`, lives with the
TS engine at [`core/examples/`](../core/examples/) alongside its
project loader.
