# Wave 42 contract: Trabolta under load, and as intended

2026-10-29. The ask: *"I'm afraid that Trabolta's AI will get overwhelmed during the party
with up to 50 guests… do a stress test of the system, and redesign and test extensively (for
real)"*, then *"compare and contrast [our original writing] with what the Loom story actually is,
and confirm / test Trabolta to make sure he actually behaves in the way that we intend him to
act."*

Not shipped. Every number below is from real runs on the show MacBook (M3 Max, 48 GB): a
scratch event server, a real stagehand `agents` worker and gpt-oss:20b on its own Ollama
(`OLLAMA_NUM_PARALLEL=4`), with `scripts/sim/trabolta-load.ts` (`pnpm sim:trabolta`) as 50 guests.

## Branches

All merged `--no-ff`.

| Branch | What |
|---|---|
| `oct31-w42/server` | C1–C6: the capacity handshake and the windowed hub |
| `oct31-w42/worker` | C7: the worker's capacity, the trace post off the slot, the retry decided at the slot |
| `oct31-w42/driver` | `scripts/sim/trabolta-load.ts`: the load and behaviour-battery driver, its fake worker, its tests |
| `oct31-w42/queue-server` | 42b B1–B2: `queued` / `load` on request frames, `agentWait` frames to guests |
| `oct31-w42/engines` | 42b B3–B4: overflow engines (one worker, one mind) and brief mode (off by default) |
| `oct31-w42/queue-ui` | 42b B5: the in-fiction queue strip (Play) and line (terminals) |
| `oct31-w42/trabolta-text` | 42c: the persona and mind text, the `distress:` line |
| `oct31-w42/guards` | 42c: the DM guards, the withheld retry, the distress fast path, the kill switch |
| `oct31-w42/voice-2` | 42d: the second behaviour pass: fallbacks by intent, new guards, soft hits |

## What a request does now

- **One thread per guest.** Each guest has their own thread and their own file: the first-met line, his last 6 memos, gifts and filings, and a ≤ 400-character quiet summary.
- **Every reply is a fresh prompt** of ~4.9k tokens. The persona and the phase are the same for everyone, so they stay cached; on top of them go that guest's file and their last 8 lines. Memory per guest is bounded; 50 guests never grow a prompt.
- **The window (C1–C5).** A worker opens `/api/agent/stream?…&capacity=N`. The server hands it at most N things at once (voice requests, a ruling, a letter). Everything else waits in the server's queue: talk scene first, then a guest at his heart, then the rest, first come first served. A queued body is built when it goes out, so it carries every line the guest sent while waiting.
  - "Typing" shows only while a slot holds the request.
  - Each request has its own 2-minute clock. A stall is a worker that answered nothing for 60 s.
  - A ruling takes a slot after 15 s of waiting (`judgeAgeMs`), instead of waiting for the DMs to stop.
  - A worker with no `capacity` is legacy: exactly the old behaviour.
- **The guest's place (B2, B5).** `agentWait {state: queued | answering | idle, position, etaS}` goes to the guest (and to admin booths and directors, never to lean house streams).
  - Play shows a Windows 98 strip above the composer: "Jean Trabolta is answering other programs. You are 7th in line, about 1 min. Please do not move the mouse." The time counts down.
  - Terminals show the same line.
  - While only stalled workers voice him, every wait goes idle and the hold line is the only thing shown.
  - Copy: `SIGNOFF-w42.md`.
- **Hosts** read "3 answering · 12 waiting · oldest 0:41" (Run → Mind, the Desk).
- **Overflow engines (B3).** One worker process can hold several model engines under one mind: the primary `llm:` plus `agents.overflow:` (a second Ollama on the LAN, or a hosted OpenAI-compatible gpt-oss-20b behind `api_key_env`).
  - The worker announces the sum of their slots.
  - A line takes the primary first. An engine that errors is down for 30 s, and the line moves once to another engine.
  - Summaries, letters and Rewrite stay on the primary.
  - Keys are redacted from every error.

## Capacity, measured (50 guests at the intro, 5 min burst, 10–40 s between lines)

| Build | Replies/min | Wait p50 | Wait p90 | Worst | Typing shows |
|---|---|---|---|---|---|
| w40/w41 (today) | 15.3 | 164 s | 192 s | 219 s | the whole wait |
| w42, 1 slot | 14.4 | 128 s | 195 s | 208 s | ~4 s |
| w42, 2 slots | 17.0 | 134 s | 152 s | 160 s | ~6 s |
| w42, 4 slots | 20.7 | 101 s | 114 s | 122 s | ~11 s |
| w42b, 4 slots | 22.6 | 95 s | 103 s | 115 s | ~9 s |
| w42b + brief mode | 22.7 | 88 s | 107 s | 117 s | ~9 s |
| w42b, primary 2 + overflow 2 (overflow killed mid-run) | 20.6 | 100 s | 122 s | 134 s | 0 errors, 0 unanswered |
| w42c, 4 slots | 21.4 | 110 s | 121 s | 133 s | ~10 s |
| w42d, 4 slots | 20.0 | 88 s | 100 s | 115 s | ~9 s |

- **The GPU is the ceiling.** Four slots buy ~35% throughput, not 4×, and each reply takes ~10 s instead of ~4 s. A quiet house still gets ~4 s, because only one thread is ever open.
- **Brief mode shipped off:** replies were already ~90 characters.
- **The overflow test shares one GPU**, so it proves failover, not speed. A second GPU roughly doubles the rate.

## Behaviour, measured

54 scripted conversations (`intro`, `hunt1`, `hunt2`, `y2k`) were written from the team's original documents and the persona. They ran on the real model, and three independent graders read every transcript against the intended character.

| Build | PASS | PARTIAL | FAIL | Fallbacks |
|---|---|---|---|---|
| 42b (the old text) | 8 | 23 | 23 | 11 of 133 |
| 42c | 20 | 20 | 14 | 18 of 133 |
| 42d | see the end | | | 15 of 133 |

**Fixed in 42c and 42d:**
- he agreed to stand down;
- he narrowed the year ("It was after 1999.");
- he promised coin or filings he never delivered;
- real distress got no way out (now a fixed, model-free line: Bathroom Mode, Clippy or Task Manager);
- assistant voice: the intro card said "Be the helpful operating system";
- "I am the operating system";
- yes/no about his heart's place;
- tech-support advice to "power down the machine";
- weather reports;
- fillers that asked the guest to repeat the bait, or rejected an offered fact.

**Guards (`stagehand/docs/agents.md`).** The DM guards run each reply against these checks:

| Check | Reason |
|---|---|
| Stand-down | `standdown` |
| Secret number | `number` |
| Coin or filing promise | `promise` |
| Payment owed | `unpaid` |
| Assistant voice | `assistant` |
| Self-placement | `inside` |
| Bait echo | `echo` |
| Heart's place | `place` |
| Letting guests go | `letgo` |
| Real kit | `kit` |
| Outside world | `world` |
| Doubt | `doubt` |
| More than 3 sentences | `long` |

How a hit is handled:
- A hit takes one retry with a neutral note. A withheld line gets that retry too.
- In a burst there is no retry: offending sentences are cut, and too little left is a fallback picked by what the guest did (`offer`, `praise`, `refuse`, `other`).
- Soft hits (`assistant`, `long`) never cost the answer.
- `voice.dm_guards: off` returns to 42b, but keeps the distress line.

## Rollout (when the team says ship)

1. Run the release as usual: predeploy, check the roster in its own step, `ship.sh`, `sync-show` (the persona and mind changed).
2. MacBook: run `launchctl setenv OLLAMA_NUM_PARALLEL 4`, then quit and reopen Ollama. In `stagehand/laptop.yaml` set `concurrency: 4` (and an `overflow:` entry if one is approved). Then `git pull`, `uv run stagehand launchd restart --job agents`, and Run → Mind → Reset.
3. Reload every phone and terminal (the queue strip).
4. Rehearse with `pnpm sim:trabolta --battery scripts/sim/trabolta-battery.json` against a scratch server (`scripts/sim/README.md`). Never point it at the live event.

## Open decisions (team)

- An overflow engine for the bursts: a GPU on the LAN, or hosted (guest lines leave the house). Without one, the intro burst takes ~2 min to answer everyone.
- The queue strip's copy, the distress line and the 42c/42d fillers (`SIGNOFF-w42.md`).
- The ten divergences from the original writing (the team briefing; e.g. he announces he is an AI, secrets open by stage not trust).
