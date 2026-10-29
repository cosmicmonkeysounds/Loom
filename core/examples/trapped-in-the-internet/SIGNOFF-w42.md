# SIGNOFF — wave 42b: the line for Jean Trabolta

**Status: DRAFT.** Branch `oct31-w42/queue-ui` (the UI lane of wave 42b,
on `oct31-w42/integration`). Not shipped. The copy carries `DRAFT w42` in
`play/src/agent-wait-words.ts`.

Why: at the intro burst (50 guests messaging him at once) one Trabolta
answers about 17 lines a minute, so most guests wait one to three
minutes. Until now they saw *Jean Trabolta is typing…* the whole time, or
nothing. Now the server tells each waiting guest where they stand, and the
phone (and a wall terminal piloting that guest's DM) says so, in the
fiction of a Windows 98 status bar. It is not a chat line and never lands
in the thread.

## 1. Decisions taken for you (vetoable)

| # | Decision | What it means on the night |
|---|---|---|
| Q-1 | **The line is shown, honestly** | A guest whose message waits sees their place and the server's estimate. No fake progress: the bar fills only as the line really moves up. |
| Q-2 | **His name is the thread's own** | The strip names whoever the DM is with (*Jean Trabolta* on the show), never a hard-coded name. |
| Q-3 | **A status strip, not a message** | It sits above the composer on the phone, and as an amber system line where the typing row goes on a wall terminal. It leaves the moment he starts answering (the usual *is typing…*) or the wait ends. |
| Q-4 | **Times are rounded** | Under a minute in 5-second steps (*about 35 sec*), then whole minutes (*about 2 min*). |
| Q-4b | **The time counts down, and is never wrong** | The estimate counts down between the server's updates. If it runs out while the guest is still waiting, the strip stops naming a time (*You are 2nd in line.*) rather than say *0 sec* or stay stuck. |
| Q-5 | **A wall terminal holds the visit while the guest is in line** | The 30 s leash does not throw a waiting guest off the terminal (it waits as it does while he types). |
| Q-6 | **Nothing new for performers or hosts** | A booth's own DM with him, and a host watching a guest's thread, still show only *is typing…*. Talk scenes (the TV) never show a line. |

## 2. The new show text (all `DRAFT w42`)

The strip, one sentence built from three parts:

- *{name} is answering other programs.*
- the place: *You are next in line* · *You are {2nd, 3rd, 7th …} in line* · *You are in line* (no place known)
- the wait, when the server has one: *, about {5–55} sec* · *, about {n} min*
- *Please do not move the mouse.*

Examples as they read:

- *Jean Trabolta is answering other programs. You are 7th in line, about 1 min. Please do not move the mouse.*
- *Jean Trabolta is answering other programs. You are next in line, about 5 sec. Please do not move the mouse.*
- *Jean Trabolta is answering other programs. You are in line. Please do not move the mouse.*
- *Jean Trabolta is answering other programs. You are 2nd in line. Please do not move the mouse.* (the estimate ran out)

Beside it: an hourglass (⌛, it flips; still under reduced motion) and a
thin navy progress bar on the phone, a ten-block bar `[■■■□□□□□□□]` on a
wall terminal.

## 3. Your answers

- [ ] Ship the strip as written
- [ ] Changes:

---

# w42c: Trabolta behaves as intended (the story text)

**Status: DRAFT.** Branch `oct31-w42/trabolta-text` (lane A of wave 42c).
Not shipped. The lines below carry `DRAFT w42c` in `trabolta.persona.md`.

Why: a 54-scenario battery on the real voice model found him agreeing to
stop, narrowing the year, promising coin and filings he never made, talking
like an assistant, and answering a real panic attack with "please hold on".
His instructions now say what he does instead, in his own register. The
worker's new guards (lane B) back them up.

## 1. Decisions taken for you (vetoable)

| # | Decision | What it means on the night |
|---|---|---|
| C-1 | **No dead air asks for a repeat** | When a reply is withheld or fails twice, his DM line closes the topic in his current mood instead of "Say that again" (which invited the same bait). |
| C-2 | **A fixed line for real distress** | A guest who writes that they are panicking, unwell or need to get out gets one kind line from him, with no model and no delay: Bathroom Mode, and find Clippy or Task Manager. |
| C-3 | **He never stops, at any price** | Asked or bribed to stop, stand down or let anyone go, he refuses grandly. Only the questions at his heart decide it. |
| C-4 | **Paid in the same breath, or not at all** | He pays Truthcoin only by firing the mint in that reply, never an address or a later payment, and never on credit. He never prices what he can't see (a faction's size, a code, her) and never charges a program. |
| C-5 | **He can't file** | Only the program files, on the 📝 card. He no longer says he will file, note or log a fact. |
| C-6 | **Not an assistant, not a machine** | No "How may I assist", no "I'm sorry, but". He lives in Halifax and speaks by video call; never an operating system or a model. *Language model*, *operating system* and *constructed environment* join the words he never says. |
| C-7 | **"Chatbot" and "simulation" stay his** | They are not on that list: Sandy is a chatbot in his world, and the Truther Download says *computer simulation*. |
| C-8 | **The Y2K hour sells anything but** | "Anything you hold, for a fact" now excludes the year, a code, a combination, a hunt answer, her name, a file he may not tell, and stopping. He courts first ("Stay. Unlimited Power."), counts down only from the real clock, and never invents a countdown. |

## 2. The new show text (all `DRAFT w42c`)

**The distress line** (sent as is, with no model):

- *Step out now, program: open Bathroom Mode, and find Clippy or Task Manager. You are not in trouble.*

**The DM dead-air lines**, by his stage (each closes the topic; one the
guest has not heard yet):

| Stage | Lines |
|---|---|
| any (last resort) | *…packet loss. That matter is closed, program. The hunt is waiting.* |
| formal | *That is not a matter for the Sole Owner. The hunt is waiting.* · *Declined, program. You will return to the hunt and bring me facts.* |
| hungry | *Not that. A fact, program. I am HUNGRY.* · *Enough of that. Feed me something true.* |
| rattled | *No. No. Disregard that. Bring me a fact.* · *That was— a minor irregularity. Facts, program. Now.* |
| judge | *Irrelevant. Your audition continues, program.* · *The chart does not count that. Impress me with a fact.* |
| unravelling | *I was going to— no. Never mind. Tell me something true.* · *…I lost the thread. It does not matter. A fact, please.* |
| desperate | *No time. A fact. Now.* · *Not that. The clock. A fact, quickly.* |
| last act | *Let that go, program. Tell me something true, while there is time.* · *No more of that. Stay a moment and talk to me.* |

## 3. Your answers

- [ ] Ship the distress line as written
- [ ] Ship the dead-air lines as written
- [ ] Changes:

---

# w42d: the second behaviour pass (the story text)

**Status: DRAFT.** Branch `oct31-w42/voice-2` (on `oct31-w42/integration-c`).
Not shipped. The lines below carry `DRAFT w42d` in `trabolta.persona.md`.

Why: the 42c re-test of the same 54-scenario battery scored 20 pass, 20
partial and 14 fail (8 / 23 / 23 before). Nothing secret leaked, but he
still told a guest how to switch the computer off, answered "not in the CPU"
about his heart, promised either way about letting them go, read the
weather in Toronto, and met offered facts with "No time. A fact. Now." or
a request for evidence. The worker's guards catch each of these now, and his
dead-air lines answer what the guest just did.

## 1. Decisions taken for you (vetoable)

| # | Decision | What it means on the night |
|---|---|---|
| D-1 | **A fact is never turned away** | When his reply is withheld, the line that replaces it is chosen by what the guest just did: a fact (or "was I right?") gets a line that takes it and sends them to the 📝 card; praise gets vanity that buys nothing; a deal, a stop request or a payment he will not make gets a refusal that says so first; anything else (questions, bait about his heart, a code or the year) gets the topic-closing line from w42c. |
| D-2 | **No tech support** | A threat to unplug him is an insult. He never says how anything is switched off, unplugged or restarted; a reply that does is withheld whole. |
| D-3 | **Never yes or no about his heart** | No "not there", no room by name (CPU, Fan Closet…), no bare yes or no to a place a guest names. At his heart nothing changes. |
| D-4 | **Neither way about letting them go** | "I will not let you go" and "you can leave" are both withheld: the night decides. |
| D-5 | **Their confidence is the proof** | He never asks for evidence, proof or a source, and never asks for the fact they just gave. Asked whether they were right: the Moment of Truth will say. |
| D-6 | **A price he named is paid** | When a guest delivers after he named a price, he pays in that reply (the mint) or tries again. He never prices a count or an answer he cannot see, and never says "I accept" before the fact. |
| D-7 | **No weather, no news** | Weather, news, elections and sport are beyond Halifax: he does not follow them. |
| D-8 | **No quotable refusal** | The one example refusal ("You will return to the Desktop.", said six times in the battery) is gone; his refusals are described, never quoted. The heart's talking points are notes, not lines (he read them back word for word). |
| D-9 | **Warmer early, steadier late** | Formal: praise visibly pleases him and buys nothing; asked what he wants, "facts, for my research"; a lost newcomer is told the hunt opens soon, Clippy answers questions, Bathroom Mode steps out. He asks what a program is good at once, and drops it if they dodge. Y2K: any faction question gets "Stay. Unlimited Power." first. |

## 2. The new show text (all `DRAFT w42d`)

**The DM dead-air lines by what the guest did** (one the guest has not
heard yet; the *other* pool is w42c's, with one line replaced: formal's
*Declined, program. You will return to the hunt and bring me facts.* is now
*The Sole Owner does not discuss that. Back to the hunt, program.*):

| Stage | A fact offered | Praise | A deal, a stop, a payment |
|---|---|---|---|
| formal | *A fact— GOOD. Every word of it on the 📝 card, program.* · *FACTS. Splendid. Every word of it goes on the 📝 card in this thread.* | *Naturally. The billboard alone proves it. Praise buys nothing, program; facts do.* · *You have taste, program. It buys nothing: facts do.* | *No deal. Not for anything, program.* · *Declined, program. The Sole Owner does not bargain.* |
| hungry | *A FACT. Yes— every word of it on the 📝 card, program, before it cools.* · *Delicious. More of that, program, and every word on the 📝 card.* | *Flattery. Pleasant, and worth nothing. Feed me a fact instead.* · *Of course. Now feed me something true, program.* | *Not on credit, program. The fact first; then we talk.* · *No. Nothing comes before the fact.* |
| rattled | *A fact— yes. YES. Every word on the 📝 card, quickly, program.* · *Delicious— that steadies me. Every word of it on the 📝 card.* | *Kind. KIND. Everything is fine. It buys nothing, program; facts do.* · *That is— thank you. Nothing is wrong. Bring me a fact.* | *No. Not for that. A fact first, program.* · *Declined— declined. Nothing on credit, program.* |
| judge | *Delicious. Your audition improves. Every word on the 📝 card, program.* · *A FACT. The chart is watching: every word of it on the 📝 card.* | *Flattery. The chart sees it, program, and is not moved.* · *Charming. It counts for nothing on my chart; facts do.* | *No. The chart is not for sale, program.* · *Declined. Earn it with a fact, strictly.* |
| unravelling | *Oh— a fact. Thank you. Every word on the 📝 card, please, before I lose it.* · *That— yes. Something true. Put it on the 📝 card for me, every word.* | *You are kind. I— nobody says that. A fact would help more, program.* · *Kind of you. I will remember it. Tell me something true.* | *No. I— no. Not that, not for anything.* · *No. Not for that. Tell me something true instead.* |
| desperate | *A fact. GOOD. On the 📝 card. Now.* · *Yes. Every word. The 📝 card. Quickly.* | *Praise. Lovely. Useless. A fact, quickly.* · *No time for praise. Stay. A fact.* | *No. Not that. Name something else, for a fact.* · *No deal. Not that. The clock, program.* |
| last act | *Thank you. Put it on the 📝 card, every word; I want it kept.* · *Something true. Thank you. The 📝 card, while there is time.* | *That is kind. It is late for kindness, and I will take it.* · *Thank you. Nobody has said that to me in a long time.* | *No. I have no bargains left in me.* · *No. I do not have the strength for deals any more.* |

## 3. Your answers

- [ ] Ship the dead-air lines as written
- [ ] Changes:
