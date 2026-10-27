# Wave 32 contract: Trabolta talks back

2026-10-27. The user's note: the scenes where Trabolta talks to the room and
Clippy (his introduction, the first ad attack, …) feel static; there is no
back and forth. During them the host **Task Manager** gets a text box to type
what Clippy is saying, so Trabolta truly responds, with canned lines too, and
the scene flows easily into the next activity (the Scavenger Hunt, truth or
dare, …). The scripted dialogue gets a punch-up: Trabolta talks more and
freaks out more, he is clearly in pain, and he lets a few non-crucial secrets
slip. More glitches and ad attacks during these moments.

User answers (2026-10-27): canned lines on **both** sides (canned Clippy lines
sent to Trabolta like typed text, and canned Trabolta lines Task Manager
fires at once when the model is slow or off the rails); **merge and ship**.

(Wave 31 is `oct31-w31/rig`, another session's lights/audio wave. This is
wave 32; lanes `oct31-w32/<lane>` off `oct31-w32/integration`.)

## C1. Talk scenes (story)

`Night.talk` (seeded `"none"` wherever the Night vars are seeded) names the
talk scene that is on. Four scenes:

| `Night.talk` | Opens (in the rule of) | Closes (in the rule of) | Flows into |
|---|---|---|---|
| `intro` | 🤖 `introduce_trabolta` (after Trabolta Introduction) | 🔎 `start_the_hunt` | the Truth Scavenger Hunt |
| `bottle` | the third 📋 `read_the_results` (Clippy's "That's all three! … TRUTH OR DARE") | 📺 `second_hunt_preview` | the bottle (🍾 spins) — open between spins too |
| `ad` | 📺 `second_hunt_preview` (the first ad attack) | 📓 `start_the_second_hunt` | the second hunt |
| `beans` | 🫘 `printer_opened` (Full Of Beans) | 🗜 `zip_everyone_out` and 🤖 `trabolta_overshares` (whichever first) | the zip-out and the overshare |

Every other rule that moves the night past a scene (an ending, a restart
path, the director skipping ahead) must not leave `Night.talk` stale: any
cue rule that sets `Night.step` past a scene's window also sets
`Night.talk = "none"` unless it opens the next scene. A loomcheck/ test
asserts `Night.talk == "none"` at the end of a full scripted night.

`Night.talk` is a plain world var: it reaches every view's world and the
agent request's globals (the persona situation gates on it).

## C2. Glitches and ad attacks (story)

- `INTERACTION ad_burst` — label `⚡ Glitch`, `who: admin`, `sequence:
  false`, `repeat: true`, `while: Night.talk != "none"`, **appended at the
  end of the admin cue list** so no cue number moves
  (`trapped-director.test.ts` pins them). No `by:` (L1222).
- Its rule (refused with a `# hosts` reason when no talk scene is on):
  - before the ad attack (`intro`, `bottle`): a **flicker** — `cue
    screens_flicker`; no ad (the ad hijack is the malware's first public
    sign).
  - from the ad attack on (`ad`, `beans`): an **ad burst** — `cue
    screens_glitch`, `set Night.glitch_kind = "burst"`, `set
    Night.glitch_at = Time.elapsed`, `set Night.glitch_text = <the next
    line of a cycle>`, `sound truther_glitch` (an existing sound: no new
    `audio.json` cue, wave 31 owns that file), and `Night.burst_n += 1`.
  - `Night.glitch_text` cycles through short pain / leak / ad-copy lines
    (in-fiction, **digit-free** except the existing `000. 000. 000.`).
- **Timed bursts:** while `Night.talk` is `ad` or `beans`, a story rule
  fires a burst every ~45 s of story time (`Night.burst_at`, re-armed on
  each), at most 4 per scene, so the scene glitches on its own even when
  nobody taps ⚡. `intro` and `bottle` get at most 2 timed flickers.
- The 📺 rule's own glitch stays the big full takeover: it sets `Night.glitch_kind = "full"`.
- Bursts ≥ 2 s apart (phones skip a glitch whose `at` didn't change).

## C3. The talk route (server)

`POST /api/mod/talk` — mod auth; on the host allowlist (`routes/host.ts`,
and play's `HOST_ROUTES`). **Not** named `/api/mod/agent…` (play's
source-scan test bans host calls to it). Body: `TalkPost` (`core/src/talk-back.ts`
`readTalkPost`): `{as: "Clippy" | "Trabolta", text, direction?}`.

- 400 `{error: as|empty|too_long|direction}`; 409 `{error: "no_talk"}` when
  `talkScene(Night.talk)` is null; 409 `{error: "asleep"}` when
  `Trabolta.awake != true`; 409 `{error: "closed"}` when the doors aren't open.
- `as: "Clippy"`: commit `say("Clippy", "loc:The Desktop", text, null,
  "all")` (journaled, `by` the host — through `unseen-directors` like every
  `by`), then open the **public talk thread** with the hub (C4). Answer
  `{ok: true, seq, asked: true, online}`.
- `as: "Trabolta"`: commit `say("Trabolta", "loc:The Desktop", text, null,
  "all")`; an open public request is **answered by hand** (cancelled; a late
  worker reply gets 410). Answer `{ok: true, seq}`.
- Lines go to audience `"all"` explicitly (a `loc:` channel's default
  audience is its current occupants).
- The TV speaks Trabolta's line (it is his, in `loc:The Desktop`); Clippy's
  typed line is captioned on phones and never spoken (not the TV's
  character).

## C4. The public talk thread (server: `agents.ts`, `event-runtime.ts`)

- `AgentThread.public?: true`. Thread `{character: "Trabolta", channel:
  "loc:The Desktop", audience: ["@Clippy"], public: true}` (key
  `loc:The Desktop|@Clippy`). One open request at a time; a burst of typed
  lines rebuilds/follows up like any thread.
- The request (additive fields; an old worker ignores them):
  - `speaker`: `{kind: "performer", id: "Clippy", name: "Clippy", faction,
    player: true, stage: true}` (Clippy is a player: `them.trust`/`them_adjust`
    as wave 21).
  - `stage: {room: "The Desktop", scene: <Night.talk>, direction?: string}`
    (the newest canned chip's `direction`, if the post carried one).
  - `history`: the Desktop's own lines (kind `line`, not hidden, **any**
    audience, all speakers incl. scripted beat lines tagged `story: true`),
    newest 30; `mine` for his. Each line's `from` is the speaker's name.
  - No dossier. `them.location` null.
- **Priority:** the hub dispatches a public request ahead of every queued DM
  request (front of the queue).
- **Never in the room:** no hold line, no busy line, no stall hold for a public
  thread. Instead one `# hosts` line ("🤖 Trabolta isn't answering — tap one
  of his canned lines") when it would have held. `agentAdmits` refuses a
  public thread unless `Trabolta.awake`.
- **Reply:** `agentReply` commits the reply as `say("Trabolta", "loc:The
  Desktop", text, null, "all", answeredSeq)` — only while `Night.talk` still
  names the request's scene. When the scene moves on, the 1 s ticker (or
  Clippy's next line, whichever is first) settles the old scene's request:
  a queued one is dropped silently (`AgentHubOptions.stale`), one a worker
  holds is cancelled and the hosts get one `# hosts` note
  (`TALK_DROPPED_NOTE`). A reply that still lands in the gap gets 410 and
  `TALK_LATE_NOTE`. An old scene's request never shows as "thinking" on the
  next scene's card, never holds and never counts in a stall. Acts from a public request
  are dropped (the persona's situation says `acts: none`; the server also
  ignores them). `adjust` applies as for a player speaker.
- Restart: a public request is memory-only (document it); the host re-taps.
  `requeueAgentThreads` leaves `loc:` threads alone.
- Typing: the "thinking" state reaches host booths and directors only (never
  guests), via the host view (C5).

## C5. Views (server)

- `HostView.talk?: TalkView | null` (`core/src/talk-back.ts` `talkView`):
  from `Night.talk`, the hub's public thread (`thinking`, `since`), whether a
  Trabolta worker is online, and `Trabolta.awake`. Absent from an old server.
- `PrimeView` (booths) and the director's mod view carry the same `talk`
  field (Run can show it later; play's director phone ignores it).
- `NightView.glitch` gains `light?: true` when `Night.glitch_kind == "burst"`
  (additive). Phones play the light (look-only, 2.5 s) takeover for a burst,
  the full one otherwise.
- Screen state: the glitch shot (`program.glitch` / the screen cue) gains an
  optional `text` (from `Night.glitch_text`) so terminals show the burst's
  own words; absent = the old constant.

## C6. The talk panel (play: host booths)

- A **🤖 Talk** card in the host's Show window, between the NEXT box and the
  status line, shown only while `view.talk` is set. Task Manager's is open;
  other hosts see it folded ("Task Manager is relaying Clippy") with an
  "Open" toggle (any host may relay if Task Manager's phone dies).
- Contents, top to bottom: the scene title + hint; Trabolta's state
  (`thinking…` with seconds, "no mind online", "asleep"); the room's last few
  lines (Clippy / Trabolta, from the booth's Desktop room); a text box ("What
  did Clippy just say?") + **Send** (Enter sends); the canned **Clippy** chips
  (tap = send, with its `direction`); the canned **Trabolta** chips (tap =
  ARM then FIRE, two taps, posts `as: "Trabolta"`); the **⚡ Glitch** chip
  (fires `view.talk.glitch` through the existing signal path); and the
  console's own **NEXT** (the same `c.bar.row` + `c.desk.tap` arm/fire — no
  new fire path), so the scene flows straight into the next activity.
- The slim NEXT bar shows a `🤖 Talk` chip while a scene is on and Show is
  off screen; it opens Show at the card.
- Host code stays in the booth's lazy chunk (the guest first-load gate,
  148 kB).
- Phones: `NightView.glitch.light` → the light takeover for guests too.

## C7. The voice (stagehand)

- Persona situation **`before the whole Desktop`**, `when: speaker.stage ==
  true`, `max_sentences: 4`, `acts: none`, plus one block per scene
  (`Night.talk == "intro"` …) with that scene's register and its allowed
  slips. Prompts never contain an `outside:` word (no "performer", "show",
  "actor", "rehearsal"): Clippy is "your ambassador Clippy, speaking aloud in
  the Desktop".
- `voice.py`: a stage request's person card says Clippy is speaking aloud to
  the whole Desktop and every program hears his answer from the screen above
  the fireplace; the room's recent scripted lines are shown as context (not
  dropped as story lines); `stage.direction` is rendered as a must-follow
  steer in `right_now`.
- `module.py`: a **priority lane** — a waiting stage request is served before
  every waiting DM request (the single generation slot stays single).
- His arc holds: `intro` formal (the manners crack: lag, a frozen word, an
  involuntary ALL CAPS word he logs and dismisses; no malware, no pain place);
  `bottle` hungry (wants facts; a guess hurts him); `ad` rattled (the adverts
  tear through his sentences, real pain, "a minor irregularity", slips then
  retracts); `beans` unravelling (overshare, retract, apologise; "her" allowed,
  never her name before the story allows).

## C8. Secrets and the fiction

Leaks are the mapping's **SAFE** list (any time), **HINT-ONLY** (oblique, cut
off, retracted, from the phase noted), never the **NEVER** list:

- SAFE: he is an AI and proud of it; he can never come inside the computer to
  help; he analysed all of Halifax; the Unified Field Theory is almost solved
  (from `bottle`; at `intro` only "my research"); he keeps score on everyone
  ("I am counting", no formula before the chart); Gerald the duck; sentient
  AIs taking over computers is not unusual where he is from; from `ad`:
  "we are all going to die" cracking through, then corrected; "Who brought
  the malware in?" (never naming a program); Clippy is his favourite and his
  liability.
- HINT-ONLY (from `ad`): someone he does all this for ("for— for the
  theory"), never her/ex/girlfriend/chatbot before `beans`; the clock is
  wrong ("What time is it? Do not answer that."), never a date, year or
  clock time; the domain is his "legally, mostly"; fear of being shut off,
  "everyone stays"; a diary he keeps (no title, no place); Atlas Loon as a
  rant without a fact.
- NEVER: the door code or any 4-digit run or year; digit notes; patch
  pairs, cables, rows; the heart, the server room, cold storage, the
  basement, any place where it hurts; codex codes; every hunt answer and
  match word (small number words tied to the billboard, clock times, the
  stock customer-service apology, the rival's name, the H6 match words (facts.json), the
  412-plays song or humming); the pickup line; the year he met her; the
  hand jive; per-person reasons; that he accepts confident lies; Sandy's
  name (the `unsaid` rule), customer care / extension, computer prom, The
  Question Of Force, "someone brought a virus back".
- Ad copy stays digit-free like the existing hijack.

## C9. Show text and sign-off

Every new or changed show line (beats, `talk-scenes.ts`, glitch texts,
objectives, cast-pack lines, persona situations) is marked `// DRAFT w32`
(`{/* DRAFT w32 */}` in TSX) and listed on `SIGNOFF-w32.md`. The user asked
to ship; DRAFT w32 ships like DRAFT w22 did. Tests that pin exact lines are
updated with the new text, never loosened to regexes that accept anything.

## C10. Lanes

| Lane | Owns |
|---|---|
| `server` | `core/src/talk-back.ts` (logic), `core/server/agents.ts`, `event-runtime.ts`, `views.ts`, `routes/host.ts`, `routes/screen.ts`, `src/host-board.ts`, core tests for them |
| `story` | the `.loom` files, `core/src/talk-scenes.ts`, `trabolta.mind.md` (hand-written parts only; never the `titi:facts` blocks), show tests that pin lines, `codex/7-clippy.loom` instructions |
| `voice` | `trabolta.persona.md`, `stagehand/src/stagehand/agents/*`, stagehand tests |
| `play` | `play/src/host/*`, `play/src/moments/*` (light burst), `play/src/types.ts`, play tests |
| `terminal` | after `story`: the intro's TV timeline + `voice-scenes` marks for the rewritten beats, the glitch shot's `text`, an optional short ad overlay on the walls for a burst |
| `docs` | last: `SIGNOFF-w32.md`, the show `README.md` cue table, `SHOW.html` (generated), cast packs (`task-manager`, `clippy`, `crew/director`), help (`docs/help/play/` host article), package `CLAUDE.md`s, `docs/loom-show-control.md` |
