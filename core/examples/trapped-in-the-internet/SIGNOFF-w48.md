# SIGNOFF — wave 48: the Password Manager's filter

**Status: DRAFT.** Branches `oct31-w48/core`, `oct31-w48/play`,
`oct31-w48/terminal`. Not shipped. The contract is
[`docs/loom-w48-contract.md`](../../../docs/loom-w48-contract.md).

Your words, verbatim:

> For Password Managers power, they should get alerts whenever ANY GUEST
> sends a message that contains a swear word, even mild swears, and even if
> they are embedded in bigger words, ie: "rump", "password" is censored for
> "ass", etc. they get a notification whenever these messages occur, and
> they can chose to censor them, which then marks the recalcitrant program
> that sent the message for reinstallation. This should be worked into the
> awards ceremony; who cursed the most, how many words were censored (out
> of how many in total) -- list all the censored words.

## 1. Decisions taken for you (vetoable)

| # | Decision | What it means on the night |
|---|---|---|
| F-1 | **Every line a guest types counts** | The rooms, a DM to Trabolta or a performer, a private thread between two programs, a crew or faction room, the wall terminals' keyboards, a director typing as a guest. Never a host's, a performer's, Trabolta's or Clippy's lines, a menu pick or a card answer. The alert says where it was typed (*# lobby*, *DM to Trabolta*, *to Microsoft Excel*). |
| F-2 | **Over-eager on purpose** | A stem counts anywhere in a word, so the night's most common words get caught: *hello* and *shell* (hell), *check* and *checkmate* (heck), *pass*, *password*, *class* and *Password Manager* itself (ass), *button* (butt), *title* (tit), *cocktail* (cock), *dangerous* (dang), *Saturday* (turd), *trumpet* (rump). Expect a lot of alerts. Look-alikes count too (`a$$`, `sh1t`, `h3ll0`) and a self-censored `f*ck`. |
| F-3 | **The list of stems** | arse, ass, bastard, bitch, bloody, bollock, boob, bugger, bum, butt, cock, crap, cunt, dammit, damn, dang, darn, dick, douche, fart, fml, frick, frig, fuck, heck, hell, lmao, lmfao, piss, poop, prick, pussy, rump, shit, slut, stfu, tit, turd, twat, wank, whore, wtf. No slurs are on it (a director still hides those from Run, as before). Tell us what to add or drop: it is one list in `core/src/language-filter.ts`. |
| F-4 | **One alert at a time** | A new caught line pops up in her booth only when no filter pop-up is already up; the rest wait in a **🔑 n** counter on her tray, which opens the list. *Later* puts a pop-up in 🔔 Waiting. Her phone does not buzz with a push notification for each one. |
| F-5 | **✂ Censor takes two taps** | Because it marks someone. It censors every caught word in that line. *Let it go* is her phone's own and tells nobody. |
| F-6 | **Censored means starred out, for everyone** | `password` becomes `p***word`, `hello` becomes `****o`, on every phone, the TV, the walls and Run. The rest of the line stays. Trabolta's later messages see the starred line too. |
| F-7 | **The mark** | *censored: password, hello* is the reason on the Wanted poster and on the program's phone (*🚨 You are marked for reinstallation (censored: password, hello)…*). A program already marked or in the Internet is not marked again (the line is still censored and counted). After the ending (the ceremony) she can still censor; it counts for the report but marks nobody. |
| F-8 | **No ⭐ for censoring** | She earns her ⭐ when an Antivirus captures the program she marked, as for any mark. |
| F-9 | **"Cursed the most" is words caught** | Every caught word in what they typed, censored or not. Among the programs at the party (scanned in, not gone, not a Run persona). A tie names everyone tied. |
| F-10 | **"Out of how many in total" is out of every word the filter caught** | *She censored 14 of the 37 words the filter caught.* (Not out of every word typed tonight.) |
| F-11 | **The censored words are read and shown in full** | The reveal: Trabolta (or Clippy) reads each censored word once, and the TV lists them unstarred on stamped tiles (60 at most, then *+ n more*). Say if you want them starred on the TV instead. |
| F-12 | **A cue of its own, G14 🔑 The Language Report** | Like G13: appended last (no printed cue number moved), off the running order (NEXT never suggests it), any time from G1 until G11, between two awards. Press it again for the newest numbers. Trabolta's lines skip under ✍. |

## 2. The words (all `DRAFT w48`)

Her booth (the story's replies to ✂):

| When | Text |
|---|---|
| marked | ✂ Censored {name}: {words}. Marked for reinstallation. |
| already marked | ✂ Censored {name}: {words}. They were already marked for reinstallation. |
| in the Internet | ✂ Censored {name}: {words}. They are already in the Internet. |
| after the ending | ✂ Censored {name}: {words}. The night is over, so no mark; it counts for the Language Report. |

The pop-up and the list in her booth: see the play lane's copy (`🔑
LANGUAGE`, *✂ Censor*, *Let it go*, *🔑 All flagged (n)*, *Censored c of f
flagged words*, *Nothing to judge.*).

Trabolta at G14 (the TV speaks these; skipped under ✍ like an award's):

| When | Text |
|---|---|
| opening | A bonus section. The Language Report. Every message you typed tonight passed through my filter. The Password Manager decided what was left out. |
| counts | My filter caught this many words: {m}. The Password Manager censored {n} of them. |
| most | The program that cursed the most tonight. Words caught: {n}. {names}. I heard every one. |
| the words | The words that were censored. I will say them once, so you know what was taken from you: {words}. |
| none censored | The Password Manager censored nothing. Every word stood. I noticed. |
| nothing caught | My filter caught nothing. Not one word. Either you were all very well brought up, or you were whispering. |

Clippy (after destroyed / rave, read aloud):

| When | Text |
|---|---|
| opening | Bonus section. The Language Report. The Password Manager reviewed every message you typed tonight. I am required to read her findings. |
| counts | Words the filter caught tonight: {m}. Words the Password Manager censored: {n}. |
| most | The program that cursed the most: {names}. Words caught: {n}. It looks like you're writing a complaint! Would you like help with that? |
| the words | The censored words, for the record: {words}. |
| none censored | The Password Manager censored nothing. Every word was allowed to stand. Even that one. |
| nothing caught | The filter caught nothing. Not one word. It looks like you're being suspiciously polite! Would you like help with that? |

The TV and walls (`award_language`): see the terminal lane's copy.

Cue sheet: **G14 · 🔑 The Language Report (between awards)**.

## 3. To ship

Server first (`ship.sh`), then `sync-show` with its reload (a story change:
the `censor:` header, the counters, G14), then reload the Password
Manager's booth, the TV and every wall (the new slide). Reprint the
Password Manager's pack and the director and second-director cards.
Nothing on the house machines.
