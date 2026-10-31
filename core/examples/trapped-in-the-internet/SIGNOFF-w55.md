# SIGNOFF — wave 55: the read-aloud pop-up and the teleprompter

**Status: DRAFT.** Branch `oct31-w55/teleprompter`. Not shipped. The contract is
[`docs/loom-w55-contract.md`](../../../docs/loom-w55-contract.md).

Your words, verbatim:

> we need a telepromter type view for Trapped in the Internet -- some lines from
> the story are meant to be read outloud: when that happens, it should be a top
> priority notification / pop-up that cannot go away -- when you click on it goes
> to an obvious teleprompter view with variable speed and a scroll preview / jump
> features.

## 1. Decisions taken for you (vetoable)

| # | Decision | What it means on the night |
|---|---|---|
| T-1 | **Speeches and read-outs pop up, quick reactions don't** | 25 beats are marked (§2). A marked beat takes over the phone, and Clippy also judges and scans on hers, so one-liners in the middle of a game stay chat lines (§3). To change one, add or remove its `aloud:` line. |
| T-2 | **Only ✓ Done clears it** | ✕, Back and a reload all land on the pop-up again. Before the last line, ✓ Done takes two taps. |
| T-3 | **It sounds every 15 s until opened** | One alarm tone and a buzz, repeating. iPhones don't buzz in a browser, and no phone sounds until it has been tapped once. |
| T-4 | **The whole phone, over everything** | Over the pass, a `!!` takeover, the glitch and pop-outs. Nothing else on that phone works until the script is opened and finished. |
| T-5 | **One running script** | The night's lines add up, so ≡ Jump reaches anything read earlier, and awards join the end one at a time. ⊞ Start → 📜 My script reopens it. |
| T-6 | **The bobber keeps the printout** | The bag and the dry printout are Adobe's scene, so nothing about it changed. The bobber's phone also gets truth.txt. If it sits on a table during the bob, they'll find the pop-up after, and need to tap it, then ✓ Done twice. |
| T-7 | **Others' lines are cues** | Trabolta's lines and the room's narration show small and grey, so Clippy can see what she is answering. The TV still speaks him. |
| T-8 | **A new phone starts 10 minutes back** | A replacement phone shows what landed in the last 10 story-minutes, not the whole night. Older lines are still in ≡ Jump. |
| T-9 | **The script follows the speed you set** | 1.0× is 130 words a minute. Auto-scroll can't follow Trabolta's voice, so in a dialogue scene it is easier to scroll by hand. |
| T-10 | **Hosts can't see a reader's progress** | Nothing tells Run whether the pop-up was opened. How far someone has read stays on their phone. |

## 2. What is marked

| Who reads | Beats |
|---|---|
| Clippy | Computer Bingo, Bingo Time, Corrupted Code, Trabolta Introduction, Truth Scavenger Hunt One, First Moment Of Truth, Ad Hijack, Second Hunt, Hunt Two Go, Five Minute Warning, Truth Pong, Full Of Beans, Final Reveal, Bobbing For Truth |
| Clippy, only when the ending makes her host | The Night In Review, The Report On Everyone, The Rest Of The Report, The Goals Report, What We Did, The Ceremony, Present Award, Bathroom Report, Language Report |
| Clippy, at Purgatory | Purgatory (with What We Did, The Report On Everyone, The Goals Report) |
| Task Manager, Adobe Acrobat, Recycling Bin | Their lines in Computer Bingo; Adobe's in Truth Pong |
| The program who brought up the bag | Truth Txt (its narration) |

## 3. Left as chat lines

Hunt One Go, Filing Closed, Question Results, Summons Closed, Trust Chart, Praise
The Top: one line each, in the middle of a game.

## 4. New words to approve (`DRAFT w55`)

- The pop-up: *📜 READ THIS OUT LOUD*, *{n} lines · about {n} min*, *▶ Open the teleprompter*.
- The view: *📜 READ OUT LOUD*, *▶ Scroll*, *⏸ Pause*, *Speed 1.0×*, *≡ Jump*, *✓ Done*, *Skip the rest? Tap again*, *End of script*, *✓ Done reading*, *↩ Back to line {n}*, *＋ {n} new lines ▾*, *Jump to*.
- ⊞ Start: *📜 My script*. The phone notification: *📜 Read this out loud*.
- Section titles are the beats' own names, so truth.txt reads *Truth Txt*.
- Clippy's mission text and CI 9 now say *teleprompter* for *the Desktop room*.

## 5. Still to check by hand

- [ ] A real iPhone and Android phone: the tone, the buzz on Android, the screen staying on, thumb-scrolling.
- [ ] Clippy reads the opening from it at the read-through, and sets a speed.
- [ ] Reprint Clippy's pack and `all-crew` (the teleprompter paragraphs).
