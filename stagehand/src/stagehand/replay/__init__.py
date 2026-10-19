"""The replay harness (wave 12, CONTRACTS.md §C7): the same scripts fed
through today's mind and the new one, scored against the K-04 bars.

    uv run python -m stagehand.replay extract --trace <jsonl> --out <script.json>
    uv run python -m stagehand.replay live --mind classic|new --script <s.json> [--gap 30] [--port P] [--label L]
    uv run python -m stagehand.replay offline --trace <jsonl> --mind classic|new
    uv run python -m stagehand.replay score <run dir> [<run dir> …]

- `sources.py` — scripts (load, validate, placeholders), `extract` from a
  recorded trace, the persona's answer words, and the redactor every file a
  run writes goes through;
- `drive.py` — the Ollama lock, the rig check, a no-DB scratch server and a
  scratch worker (started and stopped by the PIDs the harness started), the
  mod-console mirror and the script driver; `offline` too;
- `score.py` — the eight K-04 bars and the extra numbers, pure functions over
  a run directory.

Runs land in `<tmp>/loom-replay/runs` and the Ollama lock is
`<tmp>/loom-replay/ollama.lock` (`tempfile.gettempdir()`), unless
`LOOM_REPLAY_RUNS` / `LOOM_REPLAY_LOCK` name other paths.

Secrecy (C0): no committed script carries a hunt answer — `{answer:<Q>}` and
`{near:<Q>}` are resolved from facts.json when a line is sent, and every text
a run writes (transcripts, `history.json`, `run.json`, `report.json`, and
`worker.log` / `server.log` once both children stop) is redacted first: an answer word becomes `‹aN›`, a `never` word `‹never›`. The
worker's own `minds/` (mind + trace) are the system under test and are left as
the worker wrote them; nothing from a run is committed.
"""
