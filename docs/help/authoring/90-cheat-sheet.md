---
title: Cheat sheet — every symbol
section: Reference
order: 90
keywords: act, watch, countdown, arm, reserved, busy, judge, for guests, ack: none, no ok, L1226, lock:, locked phone, L1216, cheat sheet, reference, symbols, syntax, quick reference, summary, verbs, when, loom 4
---

**Structure**

| Symbol | Meaning |
|---|---|
| `# Title` | the story's title (and the event name in the app) |
| `start: The First Beat` | which beat starts the story |
| `== Any Words Here` | begins a beat — names are plain words |
| `== Ask About(topic)` | a beat that takes a value |
| `cast:` / `setting:` | who's in a beat / where it is |
| `//` , `/* … */` | comments (for you) |
| triple-backtick fence | notes for the production team (` ```todo ` = task list) |

Names match ignoring case, and spaces / `_` / `-` are all the same:
`-> the front gate` reaches `== The Front Gate`. Inside an
*expression* (a condition, a `set` path, `{…}`) write a multi-word name
with underscores: `Ivo_Marsh.trusts.guest`.

**Dialogue & prose**

| Form | Meaning |
|---|---|
| `Ivo: You came back.` | a one-line speech |
| `Ivo (quietly): …` | with a parenthetical — a hint to the performer (shown after the name on a phone) |
| `Ivo (glitch): …` | an effect manner (`glitch`, `static`, `corrupted`, `scream`, `flicker`, …) — the line performs on the phone ([live shows](live-shows.md)) |
| `Ivo:` then indented lines | a speech block |
| `IVO` then indented lines | the screenplay cue (still works) |
| `Ivo \| Mara: …` | two speakers at once |
| `Narrator: …` | narration with a voice |
| `Self:` / `SELF` / `ME` | speaker = whoever owns this beat |
| flush-left paragraph | action / narration |
| `\Note: …` | force a line to be prose |
| `INT. PLACE - TIME` | scene heading |

**Choices & flow**

| Form | Meaning |
|---|---|
| `* text` | once-only choice |
| `+ text` | sticky choice |
| `text[ hidden]` | words shown only after the choice |
| `+ (if cond) text` | offered only while `cond` holds |
| `⟦TAG⟧ text` | a tag on an option (never `[TAG]`) |
| `-> The Beat` | go to a beat |
| `-> self.Beat` / `-> Owner.Beat` | go to an owned beat |
| `-> folder/beat` , `-> file#knot` | disambiguated jumps |
| `-> The Beat with k: v` | divert with parameters |
| `-> The Beat as self` | run a beat per participant |
| `(The Beat) ->` … `return` (or `<-`) | tunnel there and back |
| `-> END` | end the story |

**Instructions** — a lowercase verb at the start of a line; block
openers end with `:` and indent their body.

| Form | Meaning |
|---|---|
| `set x = 5` , `+= -= *= /=` | change a value |
| `if cond:` / `else if cond:` / `else:` | conditional |
| `match value:` + `arm:` lines | pick an arm by value |
| `cue x` / `sound x` / `pause` / `flash white, 200` / `anchor x` | stagecraft |
| `sound x in The Desktop` / `sound x with rooms: hall, The Start Bar` | a sound on the house speakers in those places only (map room ids or LOCATIONs); commas between names; a target with no wired speaker is skipped, so give new sounds a cue in `audio.json` ([instructions](directives.md); lint `L1213` when a several-word name is no LOCATION) |
| `fire lockdown` / `fire rally for guest` / `fire alarm with level: 3` | raise a named event |
| `reply text` / `reply !text` | private line back to whoever acted (a booth: its Readouts) / the same as an alert |
| `reply !!text` / `broadcast "!!text" to everyone with close: 6s` | a **big moment**: full screen on the phone (a booth: a pop-out); the house-wide one closes itself ([broadcasts](broadcast-improv.md); lint `L1218` outside an admin cue's hook or a story rule) |
| `reply "text" with go: The Desktop, go: pass` / `broadcast "…" to everyone with go: quest: The Cold Door as "See it"` | the moment's buttons: a place, room, character, guest button, `codex[: Entry]`, `quests` / `quest: Quest`, or a screen (`pass` `scan` `chats` `mission` `notifications` `sides` `wallet` `me`); never `lobby` (lint `L1214`; quote the text) |
| `reply "!!…" with go: pass, go: go to the bathroom, ack: none` | no OK: only the `go:` buttons close the moment, for a capture the guest must answer ([broadcasts](broadcast-improv.md); lint `L1226` when the tail has no `go:`; a phone that can take none of the exits still shows OK) |
| `show fact "📝 File a fact" to guest with questions: "H1: … \| H2: …"` | deal a card (`captcha` / `poll` / `image` / `tutorial` / `pass` / `fact` / `answer` / `sides`); `with moment: major` makes it interrupt, `moment: big` takes the screen |
| `unlock The Sandy File for guest` | hand out a codex entry |
| `who.codex` / `who.codex.the_sandy_file` / `who.codex_in.facts` | how many entries they hold / do they hold this one / how many in a `category:` (lower-cased, accents dropped, `_` for anything else: `How it works` → `how_it_works`, and a `_` before a leading digit: `1999 Files` → `_1999_files`; uncategorised ones count nowhere; **unset, not 0, until the first entry**, so for "none" write `< 1`, never `== 0` (`>= 1` and adding to it are fine); a guest's only, and never shown to an agent-voiced character) |
| `start quest X for who` / `update` / `complete` / `fail` (+ `"line"`) | the quest log — `who` may be a character |
| `restrict guest to The Tube, The Internet` / `unrestrict guest` | shrink a guest's app to DMs + those places, no buttons — and lift it |
| `pin "!🚨 text" [in room] [for who]` / `unpin [in room] [for who] ["text"]` | a sticky notice above a stream (`!` = alert) — and take it down |
| `do verb args` | any custom verb (show control, extensions) |
| `Ivo: Lightning?<flash: white, 200>` | the `<verb: args>` long form, for mid-line effects |

**Values & logic**

| Form | Meaning |
|---|---|
| `{expr}` | insert a value into text |
| `let name = formula` | a live, self-updating value |
| `and` `or` `not` `== != > < >= <=` | condition operators |
| `visits("The Beat")` `played(b)` `since(e)` `count(C)` | ask the ledger |
| `[x for x in C where cond]` | list comprehension |
| `sum([p.score for p in Persons])` `max(list)` `len(list)` | add up / top / count a list |
| `names([p for p in Persons where p.slow == true])` | their names for speech: "A, B and C" ("" for nobody) |
| `30s` `2m` `1h` | durations |

**Variety**

| Form | Meaning |
|---|---|
| `cycle a \| b \| c` | step through in order |
| `shuffle a \| b \| c` | pick at random |
| `each visit:` + `first:` `then:` `finally:` | change on revisit |
| `after cond:` + `otherwise:` | swap content at a turning point |

**Characters & traits**

| Form | Meaning |
|---|---|
| `CHARACTER Ivo Marsh` / `ROLE Guest` | a part / a part many people play |
| `is X, Y` | wear traits / inherit |
| `trusts Guest: 30 of 100` | disposition (`trusts`/`respects`/`fears`) |
| `knows:` | a character's facts |
| `goal name` | something they're pursuing |
| `when <event>:` | a hook — do this when that happens (`on …` still works) |
| `TRAIT Prop(beat)` | reusable shape with a blank |
| `self.field` | "this character's" field |
| `beat Name(params)` inside a character | an owned beat |
| `slot:` / `fill` | template blanks / filling them |
| `super` , `when X: none` | extend / silence an inherited hook |
| `0 to 100 = 50` , `any of KIND` , `a \| b` , `list of` , `text?` | typed slots |

**Stats**

| Form | Meaning |
|---|---|
| `STATS Name` | a stats sheet |
| `attribute` / `stat` / `pool` / `axis` | set value / formula / gauge / track |
| `TREE Name` + `node` | an unlockable skill tree |
| `stats: Combat(strength: 12)` | attach stats to a character |

**Live shows**

| Form | Meaning |
|---|---|
| `PERSON` / `ROSTER` / `cast p as Role` | real people, the night's plan, binding |
| `GROUP` (`hidden: true`) / `LOCATION` (`hidden: true`, `cutscene: true`) / `COHORT` | a side / a place (and a room; hidden until visited or revealed; on rails) / a grouping |
| `move who to Place` | put a participant somewhere |
| `add who to Group` / `remove who from Group` / `reveal X [for who] [quietly]` | membership / open a hidden group, place, room or character (`quietly`: no notice) |
| `broadcast cue to scope` (+ indented lines) | send a cue to a subset |
| `broadcast "!📣 text" to everyone` / `broadcast "~✅ text" to everyone` | an alert (a major moment on every phone) / a per-person notice (folds with its neighbours) |
| `participant(X)` `group(G)` `location(L)` , `and` / `but` | broadcast scopes |
| `(improv duration: 45s, advance on: any […])` | an improvised beat |
| `SPACE` / `CHANNEL` | chat sections / rooms |
| `CODEX Name` + `about:` / `code:` / `secret: true` / `category:` | lore a participant holds, unlocks, shares (filed under its category) |
| `QUEST Name` + `title:` / `from:` / `text:` | a quest for the Quest Log |
| `INTERACTION name` + `label:` / `who:` / `by:` / `while:` | a button in the app (or a cue on the sheet) |
| `OBJECTIVE Name` + `for:` / `while:` / `act:` / `title:` / `text:` (`- to-do, done when <cond>`) / `buttons:` (+ `pass`, `scan`) / `loud: true` | what a phone shows as NOW, and the buttons it leads with ([objectives](objectives.md)) |
| `go: The Desktop` / `target: Night.bottle_pick` / `pick: program.location == "The Desktop"` / `evergreen: true` (OBJECTIVE) | the Mission's one place to go / a booth's one guest / a booth's list of guests (PLAYER SELECT or rows) / the fallback never counted (lints `L1214`, `L1215`) |
| `admin: true` (a performer's CHARACTER) | a host part: its booth gets the host console (cues, judging, announcements, the alert level) |
| `crawl: fx` (a CHARACTER) | every line it speaks is effect text |
| `alerts: Night.alerts` (header, first file) | the world path the phones' alert level is read from: `balloon` / `sticky` (default) / `dialog` / `bsod` |
| `sequence: false` / `repeat: true` / `urgent: true` (a `who: admin` cue) | never the sheet's last / next · stays next while pressed · next ahead of the order while live and unfired |
| `arm: true` (a performer's or guest's button) | arms on the first tap, fires on the second ([live verbs](live-verbs.md)) |
| `act: B · Act I` (a `who: admin` cue) | opens an act on the Director page; later admin cues join it (`act: Anytime` rejoins by name; never changes NEXT) |
| `by: Bartender` (a `who: admin` cue) | that performer's booth may call it too, from its 🎤 cue bar ([live verbs](live-verbs.md); lint `L1217` when it names no part, `L1222` when it names a player) |
| `player: true` (a performer's CHARACTER) | a player: a lean booth with a Mission home, its own buttons only, a Trust Chart row; never a cue caller |
| `private: covert, defiance` (a CHARACTER) | slots no agent reads and no other character's badge / watch / stat shows |
| `stat: self.score as ⭐ Points[, for …][, while …]` (header) | a score tile on a player's booth (lint `L1223`) |
| `wanted: program.marked as program.marked_for by program.escort_by, for Antivirus` (header) | a Wanted board for those booths and the hosts: every guest whose flag is true, why, where, who claimed them ([live shows](live-shows.md)) |
| `reinstall: <cond>` (header) | who may enter the reinstallation games, read per guest |
| `lock: program.corrupted == true` (header) | locks a guest's phone while it holds for them: a lock screen with the objective, the pass and the `restricted: allow` buttons; every story-changing guest route answers `403 locked`, never journaled ([live shows](live-shows.md)) |
| `archive: The Uploader when program.cleared == true` (header, repeatable) | moves a guest's finished thread under *Other rooms* |
| `arrival: self.arrived != true` (header) | a booth reports in as `booth_arrived` while it holds for its part; a character in a `cutscene: true` location is on rails, and its booth is the stage ([live shows](live-shows.md)) |
| `majority: Night.present / 2 + 1` (header) | what a side needs, shown on the Sides screen's doors (lint `L1216` for a bad `wanted:` / `reinstall:` / `archive:`, an error for a `lock:` that is no expression) |
| `founding: <condition>` (header) | faction mode: programs found factions that race like the sides, one faction at a time; `majority_faction()` / `faction_of(who)` / `faction_name(id)` / `faction_founder(id)` read the race (lint `L1220`) |
| `badge: program.afk as 🚻 Bathroom Mode[, while …]` (header) | a glyph beside their name on every people list while it is true (never a secret: lint `L1219`) |
| `lobby: hidden` (header) | guests never list the lobby (its lines still reach them as moments / Notifications) |
| `watch: Night.round as Round, program.cleared, Ivo Marsh, while <cond>` (header, first file) | what the Director page's glance column keeps in view ([run mode](run-mode.md)) |
| `countdown: Night.hunt_end as Hunt ends, while <cond>` (header, first file) | a countdown to a story time in seconds on the Director page and the director phone; end it `, for guests` and the guests' app shows it too |
| `reserved: true` (a guest's program CHARACTER) | held for an invitee: 🔒 to everyone without its claim link ([live shows](live-shows.md)) |
| `hold: …` / `busy: …` (a `mind: external` CHARACTER) | said for it when no agent answers / when a message waits behind others ([codex](codex.md)) |
| `judge: Trabolta` (header) | a `mind: external` CHARACTER rules on every filing that isn't an exact match in `auto` mode, one at a time behind his voice replies; what he can't rule by the round's settle falls back to the house rule; a director can override ([cards & widgets](widgets.md); lint `L1206` when it names nobody an agent voices) |
| `currency: score as Truthcoin, max 500, expiry 10m` (header) | a wallet over a ROLE slot ([currency](currency.md)) |
| `wallet: approver, every 3, window 60s` / `wallet: minter, limit 3, while <cond>` | on a CHARACTER: who audits transfers / who mints a stimulus |
| `GENERATOR` / `SCENE` , `loop` / `wait until` / `tier:` / `while` | background life |
| `spawn X` / `run X(args)` / `cancel X` | launch / await / stop a coroutine |

**`when` events** — inside a CHARACTER, ROLE, or TRAIT body

| Form | Fires when… |
|---|---|
| `when scanned by guest:` | this entity's pass is scanned (`guest` = who) |
| `when guest arrives at The Cellar:` / `when arrives at …:` | someone (or `self`) enters a place |
| `when guest leaves The Cellar:` | …leaves it |
| `when joins The Gardeners:` | membership added |
| `when someone joins:` | a new participant is created |
| `when lockdown:` / `when rally for guest:` | a named event you `fire` |
| `when fact answered for guest:` | a card was answered (`question` / `answer` / `confidence` / `verdict` bound; `key_answer`, the key's answer as written, only when `verdict == "accurate"`) |
| `when guest learns X:` / `when guest completes quest X:` | lore unlocked / a quest step |
| `when restricted for guest:` / `when unrestricted for guest:` | `restrict` / `unrestrict` took effect |
| `when recruited for guest:` (`side` or `crew`, `by` = the recruiter) / `when founded for guest:` / `when unaligned for guest:` | a guest recruited by pass / founded a crew / left their side |
| `when transfer_received for guest:` | the wallet moved coin (narrate; never move it yourself) |
| `when self.suspicion >= 70:` | a **watcher** — the condition becomes true |
| a `when …:` at file level | a **story rule** — no owner, no `self` |
| `fire x for who with k: v` | raise an event with a subject and details |
| `INTERACTION name` + `label:` / `who:` | a button in the participant app (fires `name`) |
| `theme: plain` / `theme: aol97` (header) | the participant app's skin |
| `every 60s:` / `after 2m:` | the clock |

Filler words (`a`, `the`, `by`, `at`, `to`, `for`, …) are ignored;
a lowercase word binds who acted, a Capitalised word filters.

**v3 spellings still accepted**

| v3 | Loom 4 |
|---|---|
| `entry: x` | `start: x` |
| `<set: x = 5>` , `<if: c>` , `<else>` , `<cue: x>` … | `set x = 5` , `if c:` , `else:` , `cue x` … |
| `<respond: text>` | `reply text` |
| `<capture: g into L>` / `<release:>` / `<escape:>` | `move g to L` + your own flag |
| `<join: g to F>` / `<enroll:>` / `<defect:>` | `add g to G` / `remove g from G` |
| `FACTION` , `faction(F)` | `GROUP` , `group(G)` |
| `on scan guest` , `on enters L who` , `on every 60s` | `when scanned by guest:` , `when who arrives at L:` , `every 60s:` |
| `reacts trust > 60 -> warm` , `on trust passes 80` | `when self.trusts.Player > 60:` |
| `<-` | `return` |
