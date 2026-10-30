# SIGNOFF — wave 48: the Password Manager's filter

**Status: DRAFT.** Branches `oct31-w48/core`, `oct31-w48/play`,
`oct31-w48/terminal`, then wave 48b (`oct31-w48b/*`, your answers to this
sheet: section 4 below, which wins where they differ). Not shipped. The contract is
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
| F-3 | ~~The list of stems~~ (48b: B-1, the bands) | arse, ass, bastard, bitch, bloody, bollock, boob, bugger, bum, butt, cock, crap, cunt, dammit, damn, dang, darn, dick, douche, fart, fml, frick, frig, fuck, heck, hell, lmao, lmfao, piss, poop, prick, pussy, rump, shit, slut, stfu, tit, turd, twat, wank, whore, wtf. No slurs are on it (a director still hides those from Run, as before). Tell us what to add or drop: it is one list in `core/src/language-filter.ts`. |
| F-4 | **One alert at a time** | A new caught line pops up in her booth only when no filter pop-up is already up; the rest wait in a **🔑 n** counter on her tray, which opens the list. *Later* puts a pop-up in 🔔 Waiting. Her phone does not buzz with a push notification for each one. |
| F-5 | **✂ Censor takes two taps** | Because it raises their suspicion (48b; it marked someone in wave 48). It censors every caught word in that line. *Let it go* is her phone's own and tells nobody. |
| F-6 | **Censored means starred out, for everyone** | `password` becomes `p***word`, `hello` becomes `****o`, on every phone, the TV, the walls and Run. The rest of the line stays. Trabolta's later messages see the starred line too. |
| F-7 | ~~The mark~~ (48b: B-6, no mark) | *censored: password, hello* is the reason on the Wanted poster and on the program's phone (*🚨 You are marked for reinstallation (censored: password, hello)…*). A program already marked or in the Internet is not marked again (the line is still censored and counted). After the ending (the ceremony) she can still censor; it counts for the report but marks nobody. |
| F-8 | ~~No ⭐ for censoring~~ (48b: B-5, the ⭐ game) | She earns her ⭐ when an Antivirus captures the program she marked, as for any mark. |
| F-9 | **"Cursed the most" is words caught** | Every caught word in what they typed, censored or not. Among the programs at the party (scanned in, not gone, not a Run persona). A tie names everyone tied. |
| F-10 | **"Out of how many in total" is out of every word the filter caught** | *She censored 14 of the 37 words the filter caught.* (Not out of every word typed tonight.) |
| F-11 | ~~The censored words are read and shown in full~~ (48b: B-7, B-8) | The reveal: Trabolta (or Clippy) reads each censored word once, and the TV lists them unstarred on stamped tiles (60 at most, then *+ n more*). Say if you want them starred on the TV instead. |
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

## 4. Wave 48b: your answers

Your words, verbatim:

> 1) Yes but maybe she could have a special slider in her start menu to
> tune the profanity filter so that she can filter from the most extreme
> case like you've listed, down to 0%, which is the most extreme swears
> (not buried), [two slurs] ... At 10% or higher "fuck", "cunt", 25% is
> "shit", "asshole", etc, at 50% "crap", "balls", "butt". over 50% and it
> starts to get more extreme, with 100% being what you described, ie:
> "Password Manager" being a "bad word". She should start the night with
> 100% filter and must find the slider. And to be clear, we should only be
> running the filter on messages guests have actually sent. 2) Correct -
> out of how many the filter (at the time) caught -- just keep a running
> tally any time Password Manager gets a "censoring needed" notifcation.
> 3) Yes, on second thought there will probably be *tons* of swears ---
> create a comical effect that shows them all (cosmic horror style, but
> you know, from a computer terminal) in a timely manner. 4) Slurs should
> not be displayed or read aloud, and this should be automatic; no need
> for the director. 5) She *should* get rewarded, but with higher
> frequency comes a lower multiplier. It should feel like a little
> mini-game. perhaps there is an external lib for language filtering?

> oh, and Password Manager censoring a word shouldn't trigger
> reinstallation; suspicion is raised, though, and the guest gets an
> automated message.

(The two slurs you named are left out of this sheet on purpose.)

| # | Decision | What it means on the night |
|---|---|---|
| B-1 | **The bands** | The slider runs 0–100% in steps of 5 and starts at 100%. Each band adds to the ones below it: **0%** slurs only (whole words) · **10%** fuck in any form, cunt, rape · **25%** shit, asshole, bitch, bastard, dick, cock, prick, pussy, twat, slut, whore, wank, piss, the explicit words · **50%** crap, balls, butt, ass, arse, damn, bloody, bugger, bollocks, tits, boobs, turd, douche, wtf, stfu · **60%** hell, heck, darn, dang, frick, frig, fart, poop, bum, rump, dammit, fml, lmao · **75%** a strong swear hiding inside a word (*Scunthorpe*, *cocktail*, *Dickens*) · **90%** a mild one inside a word (*password*, *class*, *button*, *title*, *Saturday*, *document*) · **100%** a soft one inside a word (*hello*, *check*, *shell*, *trumpet*). Between two bands (say 40%) it catches what the lower one does. |
| B-2 | **The library: `obscenity`** | You asked whether there is one. There is: [`obscenity`](https://github.com/jo3-l/obscenity) (MIT, maintained, no dependencies) now does the whole-word bands (0–60%). It sees through the usual dodges (*fuuuuck*, *sh!t*, *a$$hole*, full-width letters) and knows when a whole word is innocent (*Scunthorpe* is not a whole-word swear; it is caught at 75%). It also brings a maintained list of slurs, to which we added a few. No library does the buried-word bands, because they are all built to avoid exactly that, so those (75–100%) are still ours. |
| B-3 | **She finds the slider herself** | ⊞ Start → **🔑 Filter strength**, on her phone only. Nothing else points at it: not the pop-up, not the 🔑 tile, not her pack. Her help page says only that the filter starts at full strength and can be tuned somewhere on her phone. The director's card knows where it is. |
| B-4 | **Only what a guest typed, never re-read** | The filter reads a guest's own line when it is sent. It never reads a director typing as a guest (Run's play-as or *say as*), a character, a menu pick or a card answer, and moving the slider never re-reads old lines. Lowering it hides the waiting alerts it no longer catches (her list says how many); raising it again shows them again (they were caught at the time). |
| B-5 | **The ⭐ game** | Each ✂ pays *points × multiplier*, rounded down. Points per word: slur 12, the worst 8, strong 5, mild 3, soft 2, buried 2 / 1 / 1. The multiplier is ×3 when she is rested and drops a notch with every ✂ (×2, ×1.5, ×1, ×½, ×¼); it climbs back a notch every 20 s she waits. So spamming *hello* at ×¼ pays nothing, and a rare, nasty word at a lower strength pays best. Her phone shows each line's worth, the live multiplier and *+n ⭐* when she censors. No ⭐ after the ending. |
| B-6 | **✂ raises suspicion, never reinstallation** | Censoring no longer marks anyone. It raises the program's **doubt** (the same suspicion the Antivirus' 👁 watchlist raises): +5 per ✂, up to 100. Her booth says where they are now (*Their suspicion: 35/100*). The program gets an automated notice (below). |
| B-7 | **Slurs: automatic** | With a filter on the night, a slur is starred **before the line is stored**: the room, Trabolta, Run and the journal only ever see `****`. It still pops up for her (at every strength) as **[slur]**, and ✂ still raises their suspicion and pays the most. The report counts them and never names them; the TV draws a black bar for each. Nobody has to hide anything by hand. |
| B-8 | **The report reads the top five; the TV shows everything** | Reading hundreds of words aloud would take minutes, so the host reads the five censored most, how many different words there were, how many they will not say, her ⭐ and where she left the slider (*"She never found the dial"* at 100%). The TV then lets every censored word out at once (up to 400, then *+ n more*), the most censored biggest: the containment breach. |
| B-9 | **"Out of how many" is the running tally** | Every word in every alert she got, at the strength of the time (your answer 2). |

### The words (all `DRAFT w48b`)

Her booth (the story's replies to ✂):

| When | Text |
|---|---|
| on the night | ✂ Censored {name}: {words}. {points} × {mult} = ⭐ +{stars}. Their suspicion: {doubt}/100. |
| after the ending | ✂ Censored {name}: {words}. The night is over: no ⭐. It counts for the Language Report. |

The program's automated notice: *🔑 Automated notice: a message you sent
was censored for language ({words}). This incident has been logged.*

Trabolta at G14, new and changed lines:

| When | Text |
|---|---|
| the words | The words censored most: {top five}. All {n} different words are on the screen. I would not look at them for long. |
| slurs | Words I will not say: {n}. Some words should stay in the filter. |
| never moved the slider | My filter ran at full strength all night. At full strength, even her own name is a swear. |

Clippy at G14, new and changed lines:

| When | Text |
|---|---|
| the words | Different words censored: {n}. The most censored: {top five}. The rest are on the screen. Please do not read the screen out loud. |
| slurs | Words I am not allowed to read at all: {n}. They stay in the filter. Forever. |
| her ⭐ | The Password Manager earned {n} stars censoring you. She was having a great time. |
| never moved the slider | And the filter ran at one hundred percent all night. At one hundred percent, "Password Manager" is a swear. She never found the dial. |
| moved it | She left the filter at {n} percent. She found the dial! |

Her booth (`play/src/booth/filter/model.ts`):

| Where | Text |
|---|---|
| ✂ armed | ✂ Censor? It raises their suspicion. |
| the pop-up's hint | ✂ Censor stars it out for everyone and raises their suspicion. |
| the list's foot | ✂ Censor takes two taps and raises their suspicion. Let it go only clears it from this phone. |
| a line's worth / the ✂ button | ⭐ {n} · +{n} ⭐ |
| the heat meter | Heat · ×{m} · rested · ×3 in {s} s |
| the list's header | Censored {c} of {f} flagged words · ⭐ {n} tonight · {n} waiting lines hidden at this strength |
| the burst after ✂ | +{n} ⭐ ×{m}, then one of: *Clean cut!* · *Snip!* · *Warm scissors.* · *Getting hot.* · *Overheating…* · *Scissors on fire.* · at 0 ⭐: *Too hot to pay. Let the scissors cool.* |
| ⊞ Start | 🔑 Filter strength |
| the strength window | Filter strength · {n}% · Catches · ◀ Less · More ▶ · Saving… · *It decides what new lines get caught. Lines it no longer catches wait hidden until you raise it again.* |
| the bands | Slurs only · + fuck, cunt · + shit, asshole, bitch… · + crap, balls, butt, ass… · + hell, heck, darn, fart… · + swears hiding inside words (Scunthorpe) · + mild ones inside words (password, button) · + everything (hello, check, Password Manager); the legend's slur row: *Slurs (never shown)* |
| a refused move | Not changed: that strength isn't on the dial. / the doors are closed. / this part isn't the censor tonight. … Still {n}%. |

The TV and the walls (`terminal/src/cutscene/scenes/language.tsx`, the
containment breach; nobody reads these aloud):

| Where | Text |
|---|---|
| the window | censored.log - MS-DOS Prompt · `C:\FILTER>type censored.log` · the status bar: CENSORED c/f · FILTER n% · ⭐ n · BUFFER → OVERFLOW |
| the notes | *Password Manager*: WARNING: Profanity buffer overflow. · *Password Manager*: Please do not read the words aloud. · *KERNEL32.DLL*: kernel panic: too many feelings · *censored.log*: IT HAS SEEN WHAT YOU TYPED. · *SWEAR.DLL*: This program has performed an illegal operation and will not go quietly. |
| the end | *C:\FILTER*: Abort, Retry, Censor? (✂ Censor is pressed) |
| the summary | Cursed the most · Censored c of f words · Filter strength n% with its caption (*Paranoid: hello is a swear* · *Suspicious: password is a swear* · *Nosy: Scunthorpe is a swear* · *Soft: heck is a swear* · *Mild: crap is a swear* · *Strong words only* · *Only the worst words* · *Slurs only*) · Password Manager ⭐ n *earned with ✂* · censored.log, n lines, Most censored: "word" ×n, ✂ CONTAINED |
| quiet nights | Nobody said anything the filter caught. · Not one of them was censored. |

## 5. To ship wave 48b

Server first (`ship.sh`, after the roster check), then `sync-show` with its
reload (the story changed: the ⭐, the suspicion, the notice, G14's lines,
`swear_filter`). The server image gains the `obscenity` package (in the
lockfile). Reload the Password Manager's booth, the TV and every wall.
Reprint the Password Manager's pack and the director and second-director
cards. Nothing on the house machines.
