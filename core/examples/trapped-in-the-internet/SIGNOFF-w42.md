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
