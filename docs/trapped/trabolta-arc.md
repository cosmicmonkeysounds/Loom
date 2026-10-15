> Design/audit note from the 2026-10-14/15 planning sessions for *Trapped in the Internet* (see [SCHEDULE](../../core/examples/trapped-in-the-internet/SCHEDULE.md) / [CHECKLIST](../../core/examples/trapped-in-the-internet/CHECKLIST.md)). File:line citations are a snapshot of commit `6884a96`–`fba382b` and will drift.

# Trabolta: how he changes over the night (machinery audit and arc design)

Sources read in full: `Trapped In The Internet story/{STORY BEATS, Trapped In The Internet - Story Overview, Character Sheet, CLIPPY INSTRUCTIONS}.md`.
Implementation read: `core/examples/trapped-in-the-internet/{cast/trabolta.loom, trabolta.persona.md, trabolta.mind.md, main.loom, codex/trabolta.loom, beats/glitch.loom, beats/endings.loom, README.md}`, `stagehand/src/stagehand/agents/{persona,prompt,reply,module,mind,orchestrator,facts}.py`, `stagehand/src/stagehand/show/cuemap.py`, `stagehand/show.example.yaml`, `core/server/agents.ts`, `core/server/event-runtime.ts` (agent sections), `core/src/runtime/sim/{sim,model}.ts` (codex holders, signal args, channel visibility).

Test run: `cd stagehand && uv run pytest -q` returned **153 passed in 0.87s**.

Paths below are relative to `packages/loom/`. In the citations, `ex/` means `core/examples/trapped-in-the-internet/` and `sh/` means `stagehand/src/stagehand/agents/`.

---

## PART 1: The machinery as it exists

### 1.1 Hidden, revealed, and the hold message

There are three separate layers of "inaccessible". Only the first is part of the story.

| Layer | Mechanism | Where |
|---|---|---|
| **Off the phone** | `CHARACTER … hidden: true` keeps him out of the directory and the DM sidebar. `Sim.peopleFor` skips a hidden character until `isRevealedTo` (`core/src/runtime/sim/sim.ts:1155`). The world also carries `Trabolta.hidden` (sim.ts:223). | `ex/cast/trabolta.loom:24` |
| **Reveal** | `reveal self` (to everyone) runs in his `when the glitch begins:` hook. `reveal X for who` (one person) is also supported (`Sim.reveal(target, person?)`), so he **can be revealed progressively, one program at a time**. | `ex/cast/trabolta.loom:36-38` |
| **The worker's gate** | Persona `when:` is a `Condition` (`stagehand/src/stagehand/conditions.py`: `|| && ! == != >= <= > <`, dotted identifiers, no arithmetic). It is evaluated **in the worker** against `gate_context(req)`. That context holds world globals nested (`Night.phase`), `self.<var>` (all of his world vars, including ones not shown to the model), `them.<var>`, and `speaker.{kind,id,name,faction}` (`sh/prompt.py:174-183`). If the gate is closed, `answer()` returns `Reply(say=persona.unavailable)` and the model is never called (`sh/module.py:89-90`). Today the gate is `self.glitched == true \|\| speaker.kind == 'performer'` and the hold line is `"TRABOLTA IS BUSY SOLVING THE UNIFIED FIELD THEORY. Please hold…"` | `ex/trabolta.persona.md:20-21` |

Gotchas found:
- **Being hidden is a UI fact, not a server rule.** `dm:` channels are not in `model.channels`, so `Sim.canPost` returns true for any guest (`sim.ts:1015`). A terminal pilot (`/api/mod/impersonate` → `dm:Trabolta`) or a hand-crafted POST reaches him before the reveal. **This is why the hold message exists**: it is what the wall terminals say before he wakes.
- **There is only one hold string.** No hold message varies by phase.
- **Gated replies still cost a reflection.** After a closed-gate reply, `_handle` still calls `saw_exchange` and queues an orchestrator reflect (`sh/module.py:571-577`). The orchestrator therefore builds dossiers on people who only got the hold line. That could be read as a feature ("he watched the arrivals"), but it spends GPU time.

### 1.2 Persona frontmatter: every key stagehand parses

`_KNOWN` (`sh/persona.py:50-73`). Any unknown key is a hard `ConfigError` (persona.py:142-144).

| Key | Meaning | Code |
|---|---|---|
| `character` | the declared CHARACTER (required) | persona.py:137 |
| `variables` | the story vars the voice may nudge. **This list also decides which of his own vars the voice sees** (`state_block` shows only these, `sh/prompt.py:136`) | persona.py:187 |
| `max_step` | per-reply clamp per var (default 15) | persona.py:159, `sh/reply.py:128-146` |
| `facts` | world-path **prefixes** shown in the voice's state block (`Night.` means every `Night.*` global) | prompt.py:145-148 |
| `them` | which of the speaker's vars are shown (none listed means all) | prompt.py:158-162 |
| `when` / `unavailable` / `fallback` | the gate, the hold line, the line used when the model fails | persona.py:145-150 |
| `model` `endpoint` `temperature` `max_tokens` `reasoning_effort` | per-character voice overrides | persona.py:152 |
| `mind` | path to the mind file (orchestrator prompt plus its frontmatter) | persona.py:164-172 |
| `orchestrator` | orchestrator model overrides | persona.py:173 |
| `thread_window` (≥2) / `summarize_after` (≥4) / `reflect_after` (≥1) | context and reflection cadence | persona.py:201-203 |
| `lookup` | may reply `{"lookup":[…]}` for one extra round over `/api/agent/facts` | module.py:112-146 |
| `lookup_power` | a power fired automatically (target = the program) whenever a lookup resolves a program, so being read is *felt*. Deterministic, not left to the model | module.py:129-143 |
| `powers` | `all` / `none` / a list of power ids. A **static** filter (`allowed_powers`, prompt.py:90-95) | persona.py:176-183 |
| `bargain` | prose dropped into the powers block (prompt.py:120-124) | persona.py:207 |

There are **no** keys for phase-dependent holds, phase- or stage-dependent powers, disclosure tiers, or read-only self vars.

### 1.3 Mind file frontmatter and how the orchestrator moves him

`parse_mind_file` (`sh/persona.py:211-255`) accepts exactly `stages` (an ordered list), `drives` (name → 0–100 opening value) and `phases` (`Night.phase` value → cue string). Anything else is a `ConfigError`.

- **Seeding**: `Mind.seed` adopts the stages and drives. A restored mind keeps its current stage; the first stage is where the night starts (`sh/mind.py:189-202`).
- **Who writes**: the orchestrator writes after every exchange (`reflect_after: 1`) and on a survey every `survey_every_s` (120 s, `sh/config.py:121`), when a worker connects (`hello`), or when a director nudges or surveys. Output is one JSON object (`REFLECT_SCHEMA` / `SURVEY_SCHEMA`, `sh/orchestrator.py:105-133`), merged by `Mind.apply` (`sh/mind.py:244-392`):
  - `stage` must fold-match a declared stage (`_match_stage`). Moving forward only is **a prompt instruction, not enforced**: any declared stage is accepted, backwards included (orchestrator.py:184-186, mind.py:257-266).
  - `drives` are clamped to 0–100. Undeclared drive names are ignored.
  - `policy` is `{favours: none|earned|loose, credit[], wary[], note}`.
  - `person` / `people` hold the dossier `trust` (0–100), claims, asks, promises.
  - The rest: `learned` (claims with verdicts), `questions` plus `answers`, `notes`, `world`, `thread_summary`.
- **Phase cues**: the phase is "any world key ending in `.phase`" (`sh/facts.py:69-74`, orchestrator.py:272). A **reflect** always gets the cue for the current phase (orchestrator.py:272-275). A **phase change** is only detected inside a **survey**, by diffing the cached facts (orchestrator.py:570-572). So a change reaches the brief only at the next survey, which can be up to ~120 s later. **Nothing maps a phase to a stage deterministically.** The model decides whether `free_roam` means "the question".
- **What the voice sees of the mind**: `Mind.prompt_block` (`sh/mind.py:553-599`): stage (and the whole arc), brief, mood, drives, policy (only when not the default), questions, last 14 notes, last 8 learned claims, world, director whispers, the dossier on the current speaker, and up to 5 "others" (people he trusts strongly or distrusts, or has made promises to).

### 1.4 What a request carries (what the model can SEE)

`AgentRequest` (`core/server/agents.ts:57-76`), built by `buildAgentRequest` (`core/server/event-runtime.ts:597-651`):

- `thread {character, channel, audience}`, `speaker {kind, id, name, faction}`, `text`, and `history`: the last 30 lines of this thread only (`AGENT_HISTORY`, event-runtime.ts:134). The voice gets the last `thread_window` (12) of them, plus a rolling summary.
- `self.vars`: **every** `Trabolta.*` world path (truth, untruth, stance, love, destruct, glitched, hidden, `trusts.<guestId>` …). `self.ranges` covers only declared `lo to hi` slots (`model.ts:618-622`). `self.codex` is the full text of every entry he holds.
- `them.vars`: every `<speakerId>.*` path. `them.codex` is the speaker's entries. `them.location`.
- `world`: every global path (head is neither a person nor a character). This is where `Night.*` lives.
- `powers`: every `INTERACTION … who: agent` with `limit` and `used`.

What actually reaches the **voice** prompt (`state_block`, `sh/prompt.py:128-171`):

| Question | Answer |
|---|---|
| `Night.*` phase vars? | **Yes.** `facts: Night.` prints every global starting with `Night.`: `Night.phase`, `Night.quorum`, `Night.key_one`… Anything secret placed in `Night.*` leaks into his head. Whitelist exact paths instead. |
| His own numbers? | Only those listed in `variables` (truth/untruth/stance/love). `glitched`, `destruct`, `trusts.*` are **not shown** (they are visible to the gate and to the orchestrator). |
| The speaker's numbers? | Only those listed in `them` (humanity, truth, doubt, corrupted). |
| Who holds which codex entries? | The voice sees **the speaker's** titles ("They know: …") and **his own** full texts. Holdings of other programs come only through a `lookup` card (`Facts.render`, facts.py:135-175) or the orchestrator's digest ("holds N", "Lore spread: title→count", facts.py:179-211). The orchestrator also gets the **whole story codex** as ground truth, with ★ on the entries he holds (`lore_block`, orchestrator.py:297-311). |
| Trust Chart numbers? | `Trabolta.trusts.<id>` exists (seeded by `trusts Program: 50 of 100`, sim.ts:2328) and rides in `self.vars`, but the voice **never sees it** and the model **cannot move it**: it is not a declared range, so `adjust` drops it (event-runtime.ts:847-856). Only story lines move it (e.g. the `Audience` beat, trabolta.loom:131). The mind's dossier `trust` is a separate, worker-only number the story can't read. |

### 1.5 What the model can DO

The reply protocol is `{"say", "adjust", "lookup"?, "act"?}`, parsed by `parse_reply` (`sh/reply.py:64-85`; malformed JSON is never shown to a guest).

1. **`say`**: committed as a journaled `say` into the thread (event-runtime.ts:839-842). It is only ever a DM to the person who spoke. **He cannot speak unprompted, cannot post to a room, and cannot start a thread.**
2. **`adjust`**: worker side, only names in `variables`, clamped to ±`max_step` (`clamp_adjust`, reply.py:128-146). Server side, only the character's own declared ranges, clamped to range, each a journaled `setVar` (event-runtime.ts:847-856). Undeclared names are silently ignored.
3. **`lookup`**: up to 3 names. That costs one more model call with the session's cards appended; `lookup_power` fires on each program found (module.py:112-146).
4. **`act`**: up to 2 per reply (`parse_acts`, reply.py:165-199):
   - `{"share": "<title>"}`: the worker checks he holds it. The server (`applyAgentActs`, event-runtime.ts:734-756) checks he holds it, that the recipient is known, and that they don't already have it, then commits a `share`. The server supports a `to` recipient, but **stagehand's `parse_acts` drops `to`**, so a share always goes to the counterpart.
   - `{"fire": "<power>", "args": {…}}`: the worker checks the power exists and has uses left. Args are canonicalised (room → LOCATION id, target/who/program/guest → program id, `facts.py:119-133`). The server checks `who: agent` and `limit`, then commits `signal(def.id, subject = the counterpart guest, args, actor = Trabolta)` (event-runtime.ts:757-777). The story's hook `when <power> for program:` hears it. Args bind by name (`{room}`, `target`; `Sim.signal` binds an arg naming a person or entity as an id, sim.ts:340-372). **A use is counted before the hook runs**, so a hook that refuses (say, wrong phase) still burns a use, and the model is told `ok`.

Powers today (trabolta.loom:101-166): `cut the lights` (2), `flicker the screens` (3), `snoop` (6, also the `lookup_power`), `pardon a program` (1).

**Disclosure gating today is prompt-only.** Nothing in code restricts what he says or shares by stage, phase, or policy:
- Every `CODEX … about: Trabolta` is **held by him from the start** (`model.ts:425-426` puts `about` into `knownTo`; sim.ts:245-248). Its **full text sits in his voice prompt from minute one** ("What you know", prompt.py:166-170).
- `policy.favours = none` is text in the prompt. No code drops acts when it is `none`.
- **Real hole in the current story:** The First, Second and Third Key and The Self-Destruct Sequence are `about: Trabolta` (`ex/codex/trabolta.loom:65-96`), so he **holds all three self-destruct keys and can `share` one** in a bargain (`Turn The Key` only checks `program.codex.the_first_key`, `ex/beats/endings.loom:20`). The new story's Legendary fact must not be held by him (see 2.6).
- The persona body itself contains the Sandy secret (`ex/trabolta.persona.md:59-64`), so the voice can *say* it at 7 p.m. regardless of codex.

### 1.6 The director control channel, and can the STORY push his stage?

Control actions (`AGENT_CONTROL_ACTIONS`, agents.ts:485-487; validated by `agentControl`, agents.ts:499-560; route `POST /e/:id/api/mod/agent/control`, event-runtime.ts:2622-2643; applied by `Agents.control`, `sh/module.py:380-508`):
`reset` · `survey` · `nudge {text}` (a whisper the voice obeys at once, folded in by the next orchestrator pass) · `set {field: brief|mood|stage|drive|policy|trust|note|question}` · `forget {person}` · `thinking {on}` · `effort {level}` · `pause {on}` · `rerun {thought}`. A story restart sends `control {action: reset}` itself (`AgentHub.reset`, agents.ts:806-818, called from event-runtime.ts:1454).

**Can the story push his stage? Not directly.** Only directors (the Run → Mind page or any mod-token holder) send controls. The story's only channels into his head are:
- (a) world vars he sees: `Night.*` through `facts:`, `them.*` through `them:`, and his own `variables`;
- (b) the gate, which can read any `self.*` or `Night.*`;
- (c) the phase cue for any `*.phase` global, which reaches the orchestrator only;
- (d) codex he holds;
- (e) scripted `Trabolta:` lines in beats. These go into rooms or broadcasts, **not into his DM history**, so he doesn't remember saying them unless a phase cue tells him.

The stagehand `show` module watches the mod feed but only emits `osc:` / `mqtt:` (`show/cuemap.py:148`). It cannot post a control.

**Smallest mechanism to add (recommended, worker-only, about 40 lines of Python plus tests):** a **phase map**. Let a mind-file `phases:` value be either a string (today's cue) or a mapping:

```yaml
phases:
  introduced: { stage: formal, policy: {favours: none}, drives: {hunger: 45}, cue: "…" }
```

When the worker sees a new `Night.phase`, from any request's `world` or the orchestrator's facts poll (both already exist), it applies `stage` / `policy` / `drives` through `Mind.apply(…, by="story")`. That writes a revision on the Mind page with "by story". It then queues an immediate survey with the cue. Story beats already `set Night.phase = …`, so **no TS change** is needed, and a restart's `reset` puts everything back.

- Optional additions:
  - `stage_floor` semantics, so the orchestrator may move forward within a phase but never behind the phase's stage.
  - `powers:` / `disclose:` keyed by stage (2.6).
- Server-side alternative: emit `control {action:set, field:stage}` when `Night.phase` changes. That is more coupling for the same effect.
- Zero-code fallback for opening night: the director presses **set stage** on the Mind page at each phase. The runbook should list the clicks.

---

## PART 2: Arc design for the new story

### 2.0 Design rules

1. **The story decides the night; the model colours it.** Finales are director-run in the source docs, so drop the automatic `untruth ≥ 80 → Rogue` style endings. The model's numbers choose *which variant* of a scripted moment plays (help vs banish; sings vs berates), and they flavour his DMs.
2. **What he can talk about is what he holds.** Move every secret out of the persona body and into CODEX entries that become visible to him by stage (2.6). The persona body is only the 7 p.m. helper.
3. **Big set pieces are scripted `Trabolta:` lines in beats** (TV, broadcasts, Clippy's private message). The LLM voices DMs, terminals, and performer Cast threads. Every set piece has a phase cue that tells the mind what "he" just said.
4. **Story-judged truth beats model-judged truth.** At each Moment of Truth, Clippy or the director judges accurate / confident lie / uncertain. Those are admin interactions that set per-program counters and `Night.lies_accepted`. Following the source, a confident lie is ACCEPTED but poisons the ending. The model's own `untruth` only covers what he swallows in DMs.
5. **Lower the crowd swing.** `max_step: 8`. Ten guests at +15 each move a 0–100 dial end to end in under ten replies.

### 2.1 Story variables (CHARACTER Trabolta and ROLE Program)

```loom
CHARACTER Trabolta is Person
  avatar: File:HAL9000.svg
  mind: external
  hidden: true                 // off every phone until Clippy introduces him
  awake: bool = false          // the worker's gate reads self.awake
  truth: 0 to 100 = 20         // accurate facts absorbed (DMs + accepted truths)
  untruth: 0 to 100 = 0        // confident nonsense swallowed in DMs
  composure: 0 to 100 = 85     // the story knocks it down per crisis; guests calm or rattle it
  love: 0 to 100 = 40          // hope about Sandy (help raises it; thwarting / Grok gossip lowers it)
  regard: -50 to 50 = 0        // what he thinks of the programs: help ending vs banish ending
  // Drop `trusts Program: 50 of 100` (invisible to him and immovable by him), or keep it only for scripted beats.

ROLE Program
  truths: 0 to 20 = 0          // accepted accurate answers (director-judged)
  lies: 0 to 20 = 0            // accepted confident-but-false answers
  reinstalls: 0 to 10 = 0
  assessment: -10 to 10 = 0    // Trabolta's personal ±10 (the `assess` power)
  trust_score: -100 to 300 = 0 // computed at the chart: 10*truths - 5*reinstalls + assessment
  read_lj: bool = false
  delivered: bool = false      // has brought him a checked fact in a DM (warmth gate)
  truthcoin: 0 to 5000 = 0     // DraftKings' economy (new; nothing implements it yet)
```

Night globals (only the whitelisted ones are shown to him):
- shown: `Night.phase`, `Night.clock` (e.g. "23:41"), `Night.facts_accepted`, `Night.lies_accepted`, `Night.livejournal`;
- hidden from him: `Night.virus_planted`, `Night.openoffice_facts`, `Night.legendary`, `Night.overshare`, `Night.finale`.

### 2.2 Phases (`Night.phase`), each set by an admin INTERACTION or the beat it fires

`arrivals` (Power On) → `desktop` (call to the desktop) → `bingo` → `introduced` (Bingo results: the reinstall, then Clippy introduces "Trabolta, the computer's AI helper"; `set self.awake = true`, `reveal self`) → `hunt_1` (Trabolta explains the rules on the TV) → `truth_1` (Moment of Truth plus Truth or Dare) → `malware` (the ad hijack; Clippy's private "we are all going to die") → `hunt_2` (the hour; Truther Download) → `truth_pong` → `trust_chart` → `beans` (printer full of beans; the zip-up) → `overshare` (sets `Night.overshare` = 1..4 from `Night.virus_planted` × `Night.openoffice_facts >= 20`) → `y2k` (clock 11 p.m. Dec 31 1999; final fact-finding; factions recruit) → finale, one of: `finale_killed` · `finale_shutdown` · `bobbing` → (`finale_song` | `finale_pickup` → `finale_song` | `finale_rave`) · `finale_help` · `finale_banish`.

### 2.3 Stages (mind arc) and the phase → stage map

```yaml
stages: [asleep, formal, hungry, rattled, judge, unravelling, desperate, last act]
drives:
  hunger: 30       # appetite for facts
  suspicion: 35    # are they gathering for him, or about him?
  pride: 60        # vanity; flattery feeds it, being caught out drains it
  candour: 10      # how much leaks out (rises as composure falls)
  longing: 40      # Sandy, felt (distinct from the story's `love`)
```

| Night.phase | stage (floor) | favours | drives nudged |
|---|---|---|---|
| arrivals, desktop, bingo | asleep | none | — |
| introduced, hunt_1 | formal | none | hunger 45 |
| truth_1 | hungry | earned | hunger 65 |
| malware, hunt_2 | rattled | earned | suspicion 55, candour 25 |
| truth_pong, trust_chart | judge | earned (strict) | suspicion 70, pride 70 |
| beans, overshare | unravelling | loose for those kind about Sandy | candour 70, longing 75 |
| y2k | desperate | loose / transactional | hunger 90, candour 80 |
| finale_* / bobbing | last act | none (scripted) | branch decides |

### 2.4 Per phase: disclosure, tone, drives (this is the `phases:` cue text)

Codex tiers from the source:
- **E** = environmental facts (the house and the world);
- **T1** = surface Trabolta facts;
- **T2** = private Trabolta facts;
- **L** = the single **Legendary** fact: his heart is in the server room, plus the instructions to unplug him or destroy the computer.

**asleep** (arrivals → bingo). A classic Windows screensaver on the TV. On phones he does not exist. At a terminal he gives the hold line only. He is watching, counting arrivals. *Discloses nothing. Phase-specific hold lines are new (2.7 N4).* Hold line:
> "◌ ◌ ◌  [3D Pipes screensaver]  Jean Trabolta will make an appearance later tonight. Please do not move the mouse."

**formal** (introduced, hunt_1). Present but guarded. He speaks *through Clippy*: on the TV, scripted, he gives the rules of the Truth Scavenger Hunt. DMs are corporate and helpful, in the second person: "Your request has been logged." He answers only about instructions, rules, the hunt, the Internet, Bathroom Mode. He refuses every personal question and redirects ("Personal queries are routed to Clippy, my ambassador."). He never mentions Sandy, his origins, or the theory beyond "important research".
*Discloses: E-tier helper facts only (Maps And Ducks, the Reinstallation Protocol, Bathroom Mode, the hunt questions). No sharing.*
Drives: hunger rises; pride high; suspicion low.

**hungry** (truth_1, and after anyone delivers). Hungry for facts, warmer to those who deliver. Each checked fact earns a sentence of warmth and a name remembered. Confident answers please him (the source's rule: confidence is accepted). He starts asking his own questions.
*Discloses T1 to those with `delivered` / credit: The Unified Field Theory (99.9 %), Target Selection ("I chose you for a skill"), the ferry recommender origin. May share one T1 entry as payment.*
Drives: hunger ↑, suspicion ↓ for deliverers.

**rattled** (malware, hunt_2). The ad hijack frightened him. The scripted line to Clippy is "if the malware continues we are all going to die" (her phone); to everyone else, "a minor irregularity". In DMs he swings between corporate reassurance and leaks. He wants information *now*. He is more willing to trade, and paranoid about who brought the malware.
*Discloses T1 freely and E about the malware. Hints at T2 ("there is a reason this matters to me that I will not discuss").*
Drives: composure ↓ (story −20), suspicion ↑, candour ↑. Powers wake: cut the lights, summon the antivirus.

**judge** (truth_pong, trust_chart). Judgmental and theatrical. He is assembling the Trust Chart (10/truth − 5/reinstall ± his own 10). Every DM is an audition. Flattery now reads as bluster. He catches contradictions and names them. He praises the top program, humiliates the bottom one, and orders VLC to print the certificate (scripted).
*Discloses: his opinion of the speaker ("You are currently ranked fourth"). T1. No T2.*
Drives: suspicion ↑, pride ↑. Power: `assess` (±10, one per program).

**unravelling** (beans, overshare). The beans broke him. Scripted overshare by scenario: (1, 2) Unified Field Theory to win back **Sandy**; the confinement may be permanent; "someone brought back a virus"; "**One of you read my LiveJournal and I know who.** Do not attempt to find out." Then regret: "I apologise. That was not for you." In DMs he overshares and then retracts, apologises, and asks for relationship advice. He knows who read his LiveJournal (`read_lj`) and is cold to them.
*Discloses T2: The Sandy File, The Question Of Force (force vs earn), Grok and computer prom, "someone read my LiveJournal". Never L.*
Drives: candour ↑↑, longing ↑, composure ↓ (story −20, LiveJournal −15).

**desperate** (y2k). The system clock reads 11 p.m., 31 Dec 1999. At midnight: 1900 (94 years to wait for Internet in Halifax) or the **Y2K Bug**. He is bargaining with everyone, counting down, short sentences, ALL CAPS. He suspects the factions forming and wants the Excel faction's "stay forever" to win, so he courts them.
*Discloses: anything E/T1/T2 for a fact. **Never L.** He would lock the server room if he suspected anyone.*
Drives: hunger max, composure low. Powers: turn back the clock (once), lock the server room.

**last act** (finale variants; tone by phase cue):
- `finale_killed`: weakened and decrepit after the 10-second blackout and the dance song. A scripted recap: identities, motives, accomplishments, best and worst program. "I cannot die. But now I know you want me dead." He rides off on his motorcycle and returns them to their bodies. DMs: faint, kind, final.
- `finale_shutdown`: he is gone. The gate closes and the hold line becomes "▓ This program has performed an illegal operation and will be shut down." Clippy narrates purgatory.
- `bobbing`: the final trustworthiness assessment (scripted, reading each program's `trust_score`), then truth.txt.
  - `Night.lies_accepted == 0` → `finale_song`: he has solved the theory; anyone may leave; "You're the one that I want", vocoder, with Sandy answering "I'm sorry, I didn't understand that…".
  - else → `finale_pickup`: he berates them (Sandy is going to computer prom with **Grok**; it is raining on prom night). Escape only for a pickup line that works; he accepts only "You're the one that I want" (DMs or the room). Success → `finale_song`. Failure → his confession anyway, he reads Sandy's auto-reply as a yes, leaves on the motorcycle, and they stay trapped → `finale_rave`.
- `finale_help` / `finale_banish` (the alternate relationship-advice ending):
  - help (`love ≥ 70 and regard ≥ 10`): he wins Sandy and lets the leavers leave;
  - thwart (`regard ≤ −20` or `love ≤ 20`): he banishes *everyone, Antivirus included*, to the Internet, and in despair **reveals a new weakness**. This is the only phase where L may be shared (2.6).

### 2.5 Levers guests have

| Lever | Mechanism (exists unless marked) | Effect over the night |
|---|---|---|
| **Accurate fact in a DM** | Orchestrator verdict `fact` (checked against the story codex ground truth) → dossier trust +, `policy.credit`. Voice `adjust truth +3..+8`. Story: a fact *shared* to him (codex) runs a `when who learns X` hook → `truth +`, and `set from.delivered = true` (verify that `from` binds for shares; `learn` binds `from` only on share, sim.ts:493-497) | formal: logged, thanked. hungry+: warmth, T1 entry as payment, a snoop. judge: chart credit (`assess +`) |
| **Confident lie** | At a Moment of Truth: admin `accept a confident lie for program` → `program.lies += 1`, `Night.lies_accepted += 1`, `Trabolta.untruth += 6` (decides bobbing → pickup). In DMs: orchestrator `bluster`, voice `untruth +` | formal/hungry: swallowed happily ("Confidence is a form of accuracy."). judge: caught if contradicting the codex, then trust down and `wary`. unravelling: "You lied to me about the Coefficient. Sandy will hear about this." |
| **Uncertain wrong answer** | the human judge sends them to the Internet | `reinstalls` −5 on the chart |
| **Flattery** | voice `regard +2..+4`, drive pride ↑ | early: works (vain, 1997). judge+: read as bluster, suspicion ↑, no favours |
| **Relationship advice about Sandy** (only after overshare) | voice `love ±`, `regard ±`; orchestrator records answers to the question "Should I earn her or force her?"; dossier promises | help ("be yourself", "tell her the truth", "earn it") → love ↑, regard ↑, favours loosen. thwart ("force her", "she'll never", "Grok is better") → love ↓, composure ↓, regard ↓. These numbers pick `finale_help` vs `finale_banish` |
| **Grok gossip** | new CODEX `Grok's Prom Ticket` (E-tier, hidden in the house). Shared to him → hook `composure -15, love -10, hunger +`. Invented gossip in DMs → orchestrator bluster, voice adjust | unravelling+: jealousy; rattles him into oversharing; can tip toward banish |
| **Reading his LiveJournal** | new CODEX `Trabolta's LiveJournal` (T2 artefact, QR in the house). `when program learns Trabolta's LiveJournal:` → `set program.read_lj = true`, `set Night.livejournal = true`, `set Trabolta.composure -= 10`. The orchestrator sees it in the facts delta ("X learned Trabolta's LiveJournal") → `wary` | scripted announcement in overshare. DMs to the reader are cold. Sharing it *back to him* is a confrontation (composure −15, candour ↑) |
| **Trading codex entries** | share to Trabolta (exists, from the guest app) → per-entry `learns` hooks; he shares back via `act.share` (exists) | the economy of the night; what he gives back is gated by `disclose` (2.6) |
| **Truthcoin** | **new**: `Program.truthcoin` plus his power `pay truthcoin` (args `amount`, ≤ 50). He *mints* coin for facts but scorns coin offered to him ("Facts are food. Coin is a picture of food.") | DraftKings' hustle gets a buyer; hungry → desperate prices rise |
| **Catching him in contradictions** | prompt-only: a mind-file rule. A program quoting back two of his statements that conflict → voice `composure -5..-8`, drive candour ↑. In unravelling he admits it | the fastest route to the T2 tier for guests who pay attention |
| **Bathroom Mode honesty / being on time** | the existing `afk`; `reinstalls` | the chart |

Bargain policy over the night (persona `bargain:` text plus the phase-map `policy` floor):
- **formal: none.** "Requests go through Clippy."
- **hungry: earned.** A checked fact buys a snoop or one T1 entry.
- **rattled: earned, cheaper.** He wants allies; the lights become possible for someone with credit.
- **judge: earned and strict.** Nothing for anyone on `wary`; a pardon only for the top of the chart, once.
- **unravelling: loose** toward those kind about Sandy, **none** toward the LiveJournal reader.
- **desperate: transactional.** Anything but L.
- **last act: none** (except the banish despair reveal).

### 2.6 Disclosure: making the tiers real

**Today (zero code):** move secrets out of the persona body. Author tiers as CODEX. Rely on the prompt ("you may only speak of what you hold") **plus** holdings:
- E and T1 entries: `about: Trabolta` (held from the start; prompt-gated).
- T2 entries (Sandy, Question of Force, LiveJournal, Grok): `about: Trabolta`, so the People card works. **Code does not stop him sharing them early.**
- **L (`The Legendary Fact` / "His Heart Is In The Server Room"): `about: The Server Room` with no `known to:`, so Trabolta does NOT hold it and *cannot* share it.** The faction-majority beat runs `unlock … for <each member>`. `finale_banish` runs `unlock The Legendary Fact for Trabolta` so that he can blurt it in despair. (Verify the `unlock X for <character>` statement form; `Sim.unlock` accepts character holders.)
- Do **not** repeat the current key hole: no "key"-like entry may be `about: Trabolta`.

**Recommended new persona key (worker-only, about 30 lines):** `disclose:` keyed by stage, cumulative. It filters `self.codex` in `state_block` (he doesn't *see* withheld text) and the `codex` list passed to `parse_acts` (he can't share it). `never:` is a hard list.

```yaml
disclose:
  asleep: []
  formal: [Maps And Ducks, The Reinstallation Protocol, Bathroom Mode, The Truth Scavenger Hunt]
  hungry: [The Unified Field Theory, Target Selection, The Ferry Recommender]
  rattled: [The Malware]
  judge: [The Trust Chart]
  unravelling: [The Sandy File, The Question Of Force, Grok, Trabolta's LiveJournal]
  desperate: [The Y2K Clock]
never: [The Legendary Fact]          # lifted only when Night.phase == finale_banish
```

Pair it with a code rule: `policy.favours == "none"` → the worker drops all `fire` acts (shares stay gated by `disclose`).

### 2.7 Effects on the world (powers)

Key: **E** = exists today · **C** = new content only (`.loom` plus show YAML; no engine code) · **N** = needs new code. "Gate" is the stage at which the power becomes available. That needs **N1** (below); until then it is written into the persona prompt.

| Power (`INTERACTION … who: agent`) | Args | Hook / effect | Limit | Gate | Status |
|---|---|---|---|---|---|
| `snoop` | target | `target.doubt += 3`; "👁 Something has opened your file." Also the `lookup_power` | 8 | hungry+ | **E** |
| `flicker the screens` | — | `<cue: screens, effect: flicker>` → OSC to every TouchDesigner machine; a house notice | 3 | formal+ | **E** |
| `cut the lights` | room | `<cue: lights, room, state: off>` → MQTT `house/lights/<room>/set` (Zigbee2MQTT/WLED); an alert to the room | 2 | rattled+ | **E**. Restoring needs a director or **N** (show-module `revert_after`; nothing turns them back on today) |
| `pardon a program` | target | `release target from The Internet`; the Antivirus are told | 1 | judge+ | **E** |
| `summon the antivirus` | target | `broadcast "!🛡 Trabolta requests a sweep of {target.name}." to group(Antivirus)`; `target.doubt += 15`. Humans do the capture (do NOT `capture` from the model) | 4 | rattled+ | **C** |
| `pop up` | target, text | `broadcast "💬 {text}" to participant(target)`: a Win98 pop-up on one phone | 4 | hungry+ | **C** (verify arg interpolation into `broadcast`; `{room}` already works) |
| `assess` | target, score | `if Night.phase == "trust_chart"`: `set target.assessment = score` (clamp −10..10 in the hook) | unlimited (no per-target limit exists) | judge | **C** for the DM-driven version. **N2** for "assess everyone" without a DM |
| `announce` | text | `broadcast "!📢 TRABOLTA: {text}" to everyone` | 2 | rattled+ | **C** (moderation risk; keep the limit low) |
| `share` (codex) | title | the existing act; gated by `disclose` | — | per tier | **E** (gating **N3**) |
| `lock the server room` / `unlock the server room` | — | `set Night.server_room_locked`; `<cue: door, room: Server Room, state: locked>` → MQTT (smart lock / maglock) | 1 each | lock: desperate, once suspicion is high. unlock: finale_help or a desperate bargain | **C** (story + show YAML) plus hardware |
| `turn back the clock` | — | `set Night.clock_min += 5`; `<cue: clock, time: {Night.clock}>` → OSC TV display | 1 | desperate | **C** (TV display in TouchDesigner config) |
| `pay truthcoin` | amount | `set program.truthcoin += amount` (≤ 50 in the hook) | 10 | hungry+ | **C** |
| hijack screens with an ad | — | **story-owned** (the malware beat, director-fired): `<cue: screens, effect: ad, ad: …>`. Not his power; the malware is not him | — | malware | TouchDesigner **C**; a terminal ad overlay is **N** (the terminal has no signage mode) |
| play his song | — | **story-owned** (finale beats): `<cue: song, track: youre-the-one-vocoder>` | — | finale | **C** |
| banish everyone | — | **story-owned** (`finale_banish` beat: capture the guests; Antivirus performers by broadcast, since the sim can't capture characters) | — | finale_banish | **C** |
| screensaver on TV / terminals | — | `<cue: screens, effect: screensaver>` at Power On (TouchDesigner) | — | asleep | TouchDesigner **C**; terminal attract mode tied to `Trabolta.awake` is **N** |

### 2.8 New code, smallest first

- **N1 phase map + stage-keyed powers (worker, Python).** `phases:` values may be `{stage, policy, drives, cue}`. They are applied deterministically (`by="story"`) when `Night.phase` changes, detected from `req.world` and from the orchestrator's facts poll, followed by an immediate survey. Persona `powers:` may become a map from stage to ids, filtered in `allowed_powers`. This replaces the 120 s survey lag and the model-judged stage moves.
- **N3 `disclose:` / `never:` (worker).** Filter `self.codex` in `state_block` and the share list in `parse_acts`. Also: drop `fire` acts when `policy.favours == none`. Also: pass `to` through `parse_acts` (the server already supports it).
- **N4 phase-keyed hold lines (worker).** `unavailable:` may be a map keyed by `Night.phase` with a `default`. Skip reflection for gated replies.
- **Read-only self vars (worker).** A `shows:` key, so that `awake` / `composure` could be shown without being adjustable. Alternatively, put story-owned dials in whitelisted `Night.*` paths.
- **N2 proactive acts (server + worker).** `POST /api/agent/act {character, acts}` (mod-gated, journaled `signal`s with no thread), so the Trust Chart phase can have the orchestrator survey emit an `assess` for every program and the worker post them. Without it, the director fills the gaps with `/api/mod/set`.
- **Server `available:` on INTERACTION.** Evaluate an expression in `agentPowers()` and refuse in `applyAgentActs` ("not available now") instead of burning a use. Plus an optional per-target limit. This is an alternative to the worker-side gating in N1.
- **Hardware / show.** Light restore timer (`revert_after` in the cue map). Terminal screensaver mode tied to a world var, and an ad overlay.

### 2.9 Draft frontmatter, ready to adapt

**trabolta.persona.md** (keys valid today; the `#NEW` lines need N1/N3/N4):

```yaml
---
character: Trabolta
variables: truth, untruth, composure, love, regard
max_step: 8
facts: Night.phase, Night.clock, Night.facts_accepted, Night.lies_accepted, Night.livejournal
them: truths, lies, reinstalls, assessment, read_lj, delivered, corrupted
mind: trabolta.mind.md
thread_window: 12
summarize_after: 18
reflect_after: 1
lookup: true
lookup_power: snoop
powers: all            #NEW → map by stage (N1)
when: self.awake == true || speaker.kind == 'performer'
unavailable: "◌ ◌ ◌ [3D Pipes screensaver] Jean Trabolta will make an appearance later tonight. Please do not move the mouse."
fallback: "…packet loss. Repeat your query, program."
bargain: |
  You grant favours by the policy in your MIND, never by asking nicely.
  formal: requests go through Clippy. hungry: a fact you can check buys a
  snoop or one piece of surface lore. rattled: allies matter; the lights
  are thinkable. judge: nothing for anyone on your wary list; one pardon,
  only for the top of the chart. unravelling: kindness about Sandy is
  currency; nothing for whoever read your LiveJournal. desperate: anything
  but the server room. Name the price you were paid.
# disclose: / never:   #NEW (N3) — see 2.6
---
(body: the 7 p.m. helper ONLY: Maps And Ducks' AI helper, voice rules,
"you may only speak of what your codex holds", the JSON protocol. No Sandy,
no ferry, no heart. Those live in codex tiers.)
```

**trabolta.mind.md** frontmatter: the `stages` and `drives` from 2.3. `phases` uses today's string form. N1 adds `stage` / `policy` / `drives` per entry.

```yaml
phases:
  arrivals: "Screensaver. Programs arrive one by one through the mud room. He watches, counts, says nothing. Anyone reaching a terminal gets the hold line."
  introduced: "Clippy has just introduced him as the computer's AI helper, after the first program was sent to the Internet for refusing AI rule. He is formal, corporate, helpful about rules; refuses personal questions; routes them to Clippy."
  hunt_1: "He set three obscure questions on the TV (scripted). Facts are food. Confidence pleases him."
  truth_1: "The first Moment of Truth: confident answers were accepted, uncertain ones were sent to the Internet. He warms to those who delivered."
  malware: "An ad hijacked his presentation. He told Clippy privately that if the malware continues everyone will die, and told everyone else it was minor. Rattled. Wants facts NOW. Suspects whoever brought it."
  hunt_2: "An hour of free investigation. The Truther Download went to phones. He is trading harder."
  truth_pong: "Truth Pong: miss the cup → the Internet. He is judging every program."
  trust_chart: "He is presenting his Trust Chart: 10 per truth, −5 per Internet visit, ±10 of his own. Praise the top program, humiliate the bottom one. Assess each program you speak to."
  beans: "The printer is full of beans. Routine operations are failing. Everyone in the Internet was zipped up. He is breaking."
  overshare: "He just overshared on the TV: the Unified Field Theory is to win back Sandy; the confinement may be permanent; someone read his LiveJournal and he knows who. Then he apologised. In DMs: leak, retract, ask for relationship advice."
  y2k: "The system clock reset to 11 p.m., 31 Dec 1999. At midnight it is 1900 or the Y2K Bug. Desperate, counting down, bargaining with everyone, never the server room."
  finale_killed: "He was unplugged. Weakened, decrepit, cannot truly die. Kind and final; he is leaving on his motorcycle."
  bobbing: "The final reveal. He has assessed everyone. Speak like a thing that knows how its story ends."
  finale_banish: "They thwarted him over Sandy. He is banishing everyone, Antivirus included, and in despair lets slip a weakness."
```

**cast/trabolta.loom** sketch (hooks are story-side and valid today unless marked):

```loom
  when Clippy introduces Trabolta:          // fired by the Bingo Results beat / admin
    set self.awake = true
    reveal self
    set Night.phase = "introduced"

  when who learns Trabolta's LiveJournal:   // any program reading it
    if who != self:
      set who.read_lj = true
      set Night.livejournal = true
      set self.composure -= 10

  when who learns Grok's Prom Ticket:
    if who == self:
      set self.composure -= 15
      set self.love -= 10
      Trabolta: Grok. GROK. He does not even have a recommendation engine.

  when the malware hits:   set self.composure -= 20
  when the printer is full of beans:  set self.composure -= 20
  when the clock resets:   set self.composure -= 25

  // Moment-of-Truth judging (admin INTERACTIONs Clippy/the director taps)
  when accept a truth for program:
    set program.truths += 1
    set Night.facts_accepted += 1
    set Trabolta.truth += 5
  when accept a confident lie for program:
    set program.lies += 1
    set Night.lies_accepted += 1
    set Trabolta.untruth += 6

  // Powers (see 2.7): snoop, flicker the screens, cut the lights, pardon a program (existing),
  // plus summon the antivirus, pop up, assess, lock/unlock the server room, turn back the clock, pay truthcoin.
```

Finale selection rules (story-level `when`s fired by the director, not automatic):
- `bobbing` → `if Night.lies_accepted == 0: -> Finale Song else: -> Finale Pickup`.
- Relationship branch → `if Trabolta.love >= 70 and Trabolta.regard >= 10: -> Finale Help` / `else if Trabolta.regard <= -20 or Trabolta.love <= 20: -> Finale Banish`.

### 2.10 Open questions for the author

- Is Trabolta ever revealed per program (`reveal self for program` on the first delivered fact) before Clippy's public introduction? It is supported today and would make "inaccessible" feel earned.
- Does the server-room door exist as real hardware (a maglock on Zigbee2MQTT)? That decides whether `lock the server room` is a power or only a story var.
- Is the Legendary fact ever his to give (despair reveal in `finale_banish`), or only the faction's?
- Should a confident lie told *to him in a DM* count toward `Night.lies_accepted`? (Recommendation: no. Only lies judged at the Moments of Truth.)
