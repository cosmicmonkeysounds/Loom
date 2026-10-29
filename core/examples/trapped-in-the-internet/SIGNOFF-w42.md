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
