# SIGNOFF — wave 18 (signed off)

**Signed off 2026-10-27.** The user, of every sign-off sheet: *"Every line in the signoffs looks good! ship those please."* Every line below ships as written, and every drafted default and vetoable decision ("as drafted", "as built", "default unless vetoed") is accepted as it stands. The `DRAFT w18` markers are gone from the source; this sheet stays as the record.

**Status (when drafted):** Wave 18 is the Play app's
de-bloat and *feel like a game* overhaul (the user's ask of 2026-10-21, after
answering `SIGNOFF-w13.md`): a guest's home is **Mission**, the rooms are
**Chats**, the story-named lobby is a far-away **📜 Chat log**, big decisions are
**full-screen and un-ignorable**, every moment's buttons land on its own
place, a **Recycle Bin** of notifications, the **Wanted board** and the
confrontation for the Antivirus, Clippy's **🎤 cue bar**, hosts **calling the
show equally**, sides joined through **doors** and recruited **by pass**, and
guest-founded **crews**. Built on `oct31-w18/{core,crews,story,moments,guest,
booth,host,edges}`, merged on `oct31-w18/integration`, then a fix round of 33
commits; the docs on `oct31-w18/docs`.

Every row is a decision taken for you with its drafted default (§1), or a line
of show text that changed (§2, `// DRAFT w18` or `// DRAFT w18 (fix …)` in the
source, file:line on `oct31-w18/docs`, old → new). Mark each ✅ keep / ✏
reword / ❌ drop. Nothing marked DRAFT here plays on the night until it is
signed off (`sync-show` carries the wave 18 text only after).

Deploy note: the composition changes (big moments, `go:` exits, the side
reveal, the Wanted board, the door queue to all four Antivirus, the mark that
no longer pins or restricts), so every event's rebuilt chat store changes.
Ship the server first (it is additive: an old story plays as before), check
the preview's roster before `ship.sh`, then `sync-show` **with its reload**
before doors; restart every other non-ended event; re-export the Quest APK;
reload the terminals, the TV and the tent tablet; reprint the cast packs after
the sign-off (all four Antivirus, Clippy, the three hosts, all-crew, the
Installation Wizard, the crew cards, Excel's and OpenOffice's sheets).
`cast-packs/performers/windows-defender.md` is deleted.

## 1. Questions for the user (each has a drafted default)

### The frame (DECISIONS G0–G8, GUEST-SPEC §17)

| # | Question | Drafted default |
|---|---|---|
| Q1 | **Home = Mission** (G1, vetoable shape). The guest lands on one card built from the NOW objective: its title, the one place to go (the Where row from the objective's new `go:`), the countdown, the brief, the checklist with a progress bar, ≤ 3 big buttons, then *Your move* (≤ 4 rows: cards, a docked decision, invitations, coin requests, replies), the Wallet / Quest Log / Codex tiles and *Also now (n)*. Every cold load and the end of the opening land there; no room auto-opens. | As built. |
| Q2 | **The title bar on Mission reads `▣ MISSION`** (fix GN-F6 / NM-F15: the server hides the act from guests, so the spec's *▣ ACT B · The Desktop* would leak director copy). Elsewhere it reads *▣ NOW: {objective} ›*. | As built. Alternative: show the act's code only (*▣ ACT B*). |
| Q3 | **The taskbar is `⊞ · Mission · Chats · Pass · Scan`** (spec 17.2); the tray loses the 🔔 (it is the Recycle Bin at the top right now) and, under 370 px, the clock; the clock yields to a running countdown below 430 px (fix GN-F4). | As built. |
| Q4 | **Codex, Quest Log and Wallet leave Chats** and become three tiles on Mission (17.3), each with a yellow dot (never a number) when something is new. | As built. |
| Q5 | **A lobby-docked decision and the captured escape render on Mission** (17.4); the client-made *Choose your side* card is deleted (the doors replace it). | As built. |
| Q6 | **Chats hides empty location rooms** (unless you stand there), and a guest's badge is a yellow dot, never a number (17.5); only a card asking you, a `pm:` line, an agent's reply or a decision light it. | As built. |
| Q7 | **The lobby is the `📜 Chat log`** (G2): last row of *Other rooms*, no preview / badge / dot, never an exit, never where a decision docks. Broadcasts still post there (one post, one push) and are rows in the Recycle Bin. On the booth too, the story space is headed **Chats** and the lobby is the Chat log. | As built. |
| Q8 | **Archived threads** (G7): the header's new `archive:` lines move the Uploader's thread (pool programs, once cleared, until the night ends) and each clearing Antivirus' DM (while not marked or captured) under *Other rooms*. On an older server: any quiet non-agent DM after 15 story-minutes. The Uploader's thread comes back at an ending (it speaks each guest's ending: intended, GN-F16). | As built. |
| Q9 | **The evergreen objective** (A7): `evergreen: true` on Explore The Computer and each booth's fallback (Patrol The Computer, Help With That, The Help Desk, Documents And Printing, Disk Cleanup); never counted as *Also now*; alone it shows as *FREE ROAM · The house will call you.* with *👥 WHO'S HERE (n)*. | As built. |
| Q10 | **The tour is five steps** (G7): Mission, Chats, Pass and Scan, the Recycle Bin, Start (the story's `bathroom:` blurb replaces Start's text). Words in §8. | As in §8. |
| Q11 | **Me sheet** (G8, Q21's "don't remove the profile sheet"): your picture (top left) → Me: picture, name, place, Truthcoin, badges (◆ side, groups, ◇ crew), Show my pass, Change my picture, Sides & crews, settings (Keep my screen on, Get alerts). Start loses *Change your picture*, *Keep my screen on*, *Get alerts* and every *Leave X for Y*; its banner opens Me. | As built. |
| Q12 | **Notifications are the Recycle Bin** (Q3): every moment and personal `~` notice, newest first, the whole night (200 rows), ≤ 2 exits each, ✕ per row, 🗑 Clear all; house `~` notices about others fold per glyph + phase from two up (*🎀 2 updates about others*; a lone one stays its own row). Nothing in it pops or sticks. Unread = not seen for 1 s. | As built. |
| Q13 | **The delete gags** (Q3), deterministic: ✕ asks *Are you sure you want to send '…' to the Recycle Bin?* on every fourth seq; an unacknowledged big row is *in use*; Clear all always confirms, runs a fake *Deleting… k of n* bar (Cancel stops), then ends by `(n + firstSeq) % 3`: all gone (*So is your past.*), *Access is denied* (the rows with the most frequent caption stay) or *The Recycle Bin is full of beans.* `firstSeq` = the newest row's seq. | As built. |
| Q14 | **Big moments** (G4): full screen at every alert level, the Win98 Setup Wizard look, one acknowledge after 1.2 s (the install bar), no × / Escape / tap-away, never folded, queued oldest first (*1 of 2*), replayed on reload / wake for 15 story-minutes until acknowledged; a hold (the pass, the scan sheet) delays one ≤ 8 s. Kickers by glyph: ★ ACHIEVEMENT UNLOCKED / ⚠ VIRUS DETECTED / ⛔ QUARANTINED / ⚡ YOUR MOVE / 📣 HOUSE NEWS / 🚪 AN INVITATION / ! IMPORTANT. | As built. |
| Q15 | **Cards inside a big moment** (17.8): poll, captcha, answer, invite, sides are answered inside; a `fact` card offers only *📝 Open the card ›* (that tap acknowledges). A card answered inside closes the window 1.2 s later even if the POST failed (the card stays in its room). An exit tap hides an unanswered big card without acknowledging it (it comes back; fix NM-F2). | As built. |
| Q16 | **Only a house big with `close:` closes itself** (*Cheer! (6)*); a self-closing house cheer that names the viewer is skipped on that viewer's phone (they get their own medal; fix GN-F14). | As built. |
| Q17 | **Moment hygiene** (G6): a `!` alarm to you ranks with "your move", above a house `!`; one house banner at a time (the newest); a phase change retires queued non-big house moments (they stay in the bin); the blue screen's fatal-exception boilerplate only on the first of a sign-in; a quest-start balloon beside a sticky / dialog within 2 s is dropped; a wake replays only unacknowledged bigs + the newest live house banner; "Dismiss all" and "You missed n moments" are deleted. | As built. |
| Q18 | **Every moment has exits, never the lobby** (G5): the story's `with go:` first, then its own card, its own room / codex entry / quest / wallet, a named DM, else *What do I do?* (Mission). A lobby target is Mission. Push taps and `?room=` / `?go=` links land the same way. | As built. |
| Q19 | **An `act` exit for an `arm: true` button lands on Mission** (where it arms) instead of firing (guest lane 1); a Recycle Bin row's exit lands as if taken from Mission (‹ goes back to Mission; guest lane 2). | As built. |
| Q20 | **The system back gesture** (fix NM-F9) closes the open room / sheet when the app owns the page; embedded in the editor it does nothing (no history API there). | As built. |
| Q21 | **The guest's first load** grew to 143.87 kB gzip against the 145 kB gate (the QR encoder, Mission, Notifications, Me, the big moment, sides, the Codex and Quest Log rooms load lazily; a pass opened in the first ~1–2 s is a white square until its QR chunk lands). The gate now runs in predeploy (`pnpm --filter loom-play size`). | Keep the 145 kB gate. |

### Sides, recruiting and crews (Q21 dropped: "rethink the faction system", DECISIONS F1–F4, vetoable shape)

| # | Question | Drafted default |
|---|---|---|
| Q22 | **The two declared sides and their majority rules stay exactly** (F1); joining is the switching `join`; the majority counts only the two sides. | As built. |
| Q23 | **The side reveal is a full-screen pair of doors** (F2) to every non-leader program at the 🕚 Y2K clock (*🕚 SYSTEM CLOCK RESET. Two doors have opened in the computer.*): each side led by its leader with a bar toward `majority: Night.present / 2 + 1` (*4 of 13 needed*), **Walk in ▸** (no confirm: it is reversible) and *Neither. I'll pursue my own interests.* (no server call). Then the Sides screen (Start → Sides & crews, Mission's *🚪 Choose a side ›*): Join / Switch (asks) / Leave (*Back to neither?*). Excel and OpenOffice (the leaders) get no doors. | As built. |
| Q24 | **Leaders stay with their side** (17.10): `set Unlimited_Power.leader = program` / `The_Way_Out.leader` in the leaders' glitch beats, after their choice (a leader who never answers has no side and no leader entry); the Sides screen shows no Leave / Switch for them. | As built. |
| Q25 | **Recruiting is by pass scan only** (F3, 17.11): a guest's 📷 Scan of another guest's pass opens *Recruit X to {your side}* (and *Invite X to {your crew}*); the target gets a big *🚪 AN INVITATION · X wants you in Y* with Join / Not now (*Not now* is final for that invitation). No People-sheet recruit button. A marked program may recruit; captured / restricted ones may not. | As built. |
| Q26 | **Recruits count on the leaders' quests**: `when recruited for program:` adds an update step to Recruit To Stay / Recruit To Leave (*🙋 X walked through your door. Recruited by pass: n.*), counted in a new secret ROLE slot `recruits`. The recruiter is the event's `by` (not its actor, so a character's hook can hear it). | As built. |
| Q27 | **Crews** (F4): any guest may found one (one live crew per founder, at most 8 a night, 2–24 characters; refused: a declared group / character / place / room name or lookalike, a guest here tonight, the story title, a small rude-word list, hidden or bidi characters, markup; 6 attempts a minute), with a members-only room `crew:<id>` (hidden from booths), invitations by pass (≤ 6 open to one guest, 10 a minute per sender). A crew is never a side and never reaches Trabolta. Hosts (More → House → Crews) and directors may rename / dissolve. | As built. |
| Q28 | **Crew names are not checked against secrets** (fix A1 / CR-M2): the check answered a secret with its own refusal, an oracle for the door code or a hunt answer; it was removed. | As built (no secret check). |
| Q29 | **Leaving a side** fires `unaligned` (subject, `side`); a side's filtered `when who joins <Side>:` never hears a crew join. | As built. |

### Booths, the Antivirus, Clippy, hosts (DECISIONS B1–B10, BOOTH-SPEC §12)

| # | Question | Drafted default |
|---|---|---|
| Q30 | **Minimise scanning** (B1): scans stay only for clearance at the door and the confrontation; the rest is a tap (pop-outs with pictures, a NOW card naming its target or list, 🗂 Guests tabs Here / Marked / Internet / Missing / All with the place on every row). | As built. |
| Q31 | **A mark doesn't hinder** (Q30, B2): the mark sets the flag, the program hears one minor line, nothing pins or restricts; filing and check-in stay allowed. **Q35 of wave 13 (no 📝 card for a marked program) is superseded.** The scoring exclusions stay: the bottle never picks a marked program, round-2 settle and the tally don't count them, Judge The Cup's list leaves them out (fix BN-F21). | As built. |
| Q32 | **The Wanted board** (B3): header `wanted: program.marked as program.marked_for by program.escort_by, for Antivirus`; a 🚨 WANTED pop-out on every Antivirus booth (picture, name, reason, place, *seen n min ago*, 🙋 I'll get them · Open card · Later); several within 10 s are one *🚨 n programs marked* pop-out; the tray's 🚨 LED and the NOW card's row open the board (Open / Mine / Everyone, kept across a reload); a captured poster stays 60 s stamped CAUGHT BY. | As built. |
| Q33 | **The claims** (A2–A4): `claim_escort` 🙋 I'll get them, `release_escort` Hand it back, `take_over_escort` 🙋 Take over (offered on a claim quiet for 10 min, a client-side clock: C6 carries no claim time), `claim_door` 🙋 I've got them; a claim by someone else shows once and retires after 6 s, silently (§12.7); after a board claim the pop-out reads YOURS (kept, BN-F19). | As built. |
| Q34 | **The confrontation is the scanner's own screen, not a pop-out** (§12.1): ⚠ CORRUPTION DETECTED with SAY IT, 🛡 SEND TO THE INTERNET, Not now, 🩹 Not them…; the `!!🛡` readout is suppressed while it shows. 🛡 is **one tap after a 600 ms dead time** after an in-person scan, **two taps** from a card's *Scan again* (§12.2; the server can't tell them apart). The program's phone gets the big *CORRUPTION DETECTED. {Antivirus} has found you.* | As built. |
| Q35 | **The capture stays on 🛡** after the confrontation (story 4): the scan never captures by itself; **CAUGHT BY is the Antivirus who pressed 🛡** (`escort_by` overwritten at capture; story 5). | As built. |
| Q36 | **During the summons an Antivirus scan of a marked program is the confrontation**, not a check-in (story 3); the program can still check in with the Desktop QR. | As built. |
| Q37 | **Windows Defender is gone** (Q26, B5): the four Antivirus share the door. A program that finishes uploading fires `waiting_at_the_door` → *🚪 X is waiting at the Optical Drive* to all four; first 🙋 wins. **No door pop-out per arrival during the rush** (Door Duty, before C1): only after 60 s unclaimed; late arrivals pop at once (§12.4). `door_by` resets at clearance, and Patrol The Computer starts only at the call to the Desktop so the door card's face stays the scan (fix BN-F16). | As built. |
| Q38 | **The Selected Antivirus and Zip Everyone Out lose buttons** that were dead on every card (🛡 before any mark; ✅ the zip does itself; story 10). 🛡 gets `while: program.marked == true and program.corrupted != true`, ✅ `while: program.corrupted == true` (A6; the hooks still act on anyone, so the patch-bay alarm's capture is 🛡 from All buttons…). | As built. |
| Q39 | **Clippy is a super-performer** (Q2, B6): `by: Clippy` on 21 admin cues (the Bingo, Bingo time, the hunts, hunt over, ⚖️ the First Moment of Truth, ⏱, 📋, 🍾, 📓 Hunt 2, 🍎, the summary, the ceremony, all nine awards) → a 🎤 cue bar (YOUR CUE only when it is the sheet's NEXT, fix BN-F1; a *Call it?* pop-out, *Not yet* re-asks after 2 min); never the doors, 🤖 introducing Trabolta, the clock, the King, ⚖ the verdict, the resurrection, the alert dial, wallets, terminals, codes, parts or Trabolta. ⚖ in B6 is read as the First Moment of Truth (story 11). | As built. |
| Q40 | **Clippy is never asked *Fire anyway?*** on its own cues (§12.5); a host caller sees the press as LAST · Clippy. | As built. |
| Q41 | **PLAYER SELECT** (B7): Celebrate The Winners gets `pick:` (everyone cleared at the Desktop) and its to-dos as prompts in order 🎱 → 🎀 → 🎯; one window of tiles, the harmless follow-on pre-selects the same guest (SAME), the destructive 🎯 never pre-selects and arms; it opens by itself within 10 s of Clippy's own ⏰ (§12.3: the layout is chosen on the phone from the buttons + checklist glyphs). The winner gets a big medal, everyone else a self-closing big cheer, the TV a *Congratulations!* window. | As built. |
| Q42 | **The bottle is a target pop-out** (`target: Night.bottle_pick`): 🗣 one tap, 🙅 / 🎩 two taps, no scan. **Judge The Cup** and CI 5 are lists (`pick:`); Judge The Cup's list is every cleared, unthrown, unmarked program in the house, not only those checked in at the Cloud (most guests never scan its sign; story 6, BN-F21). | As built. |
| Q43 | **B7's "the TV a cue" at the ribbon** is the terminals' *Congratulations!* window for any house-wide `!!` line that leads with a win glyph (🎀 🏆 🥇 🏅 🎉 🎊 👑 🥳); no new slide. Only the ribbon is such a line today (the awards are dialogue). | As built. |
| Q44 | **No "I have BINGO" button** (ASK): the Bingo start alert's exit is the Bingo Card quest, and a **⏰ BINGO TIME** broadcast with *Go to The Desktop* calls every phone back (fix GN-F5). | As built. Alternative: a guest INTERACTION *🎱 I have BINGO* that pings Clippy's booth. |
| Q45 | **The summons without scans** (B10): guests check in with the Desktop QR (*📷 Check in* on the FIVE MINUTES alert and Be At The Desktop's `go:`); staff objectives drop `scan` and get a `pick:` *Still missing* list with 📍 They're here for a dead phone; the late marks arrive as one burst pop-out. | As built. |
| Q46 | **Hosts call the show equally** (Q1, B8): a visible caller claim (📣 I'll call / Stop calling in the Cues tab, Run's Calling, the director phone's ☰; memory only, cleared on a restart and when the caller's session ends; an author session's claim lasts until a restart or someone else's claim); a FIRE by a non-caller asks once (*Fire anyway? They'll see you did.*, Cancel the default); NEXT's description and *then:* and LAST's *did:* in Play; the watch values on the strip; the Judging auto ⇄ review switch; every "radio the director before you fire" line retired. Lifecycle beyond doors / pause / resume stays at Run. | As built. |
| Q47 | **Hosts see the Wanted board read-only** and get no Wanted pop-outs (§12.6): Needs leads with *🚨 n marked · m nobody on it*. | As built. |
| Q48 | **More is split in three** (Night · House · Setup), opening on Setup while the doors are closed and on Night after; crews (rename / dissolve) are under House, on the host allowlist. | As built. |
| Q49 | **Run's own presses never ask *Fire anyway?*** (host lane): the question is the Play app's; Run → Director's Calling is the claim, Watching lets go. A director at the laptop shows as *📣 Run* in Play. | As built. |
| Q50 | **A booth's important moment stays on screen** (B9): a `!` readout jumps the queue, is never replaced, stays in the 🔔 Waiting tray until handled, and never covers an open card's face (a 56 px strip there); the `# quarantine` escort pins are deleted (§12.8; the room stays the Antivirus' back room). | As built. |

### Story (DECISIONS S1–S3, the story lane's decisions)

| # | Question | Drafted default |
|---|---|---|
| Q51 | **Q16 dropped: after an ending the reinstallation is a party favour** (S1): header `reinstall: program.marked == true or program.corrupted == true or Night.ended == true`; the tent's begin never captures after the end; the Tablet Video's party-favour line; The Night Is Over's brief says so; runs after the end never count on the duck board / speedrun award. A director's Restrict alone no longer lets a program in (the gate is the story's). | As built. |
| Q52 | **A marked program learns it is marked** (story 1): one minor line with *🎟 Show my pass* and *What happens now?*, nothing pinned. | As built. |
| Q53 | **"You Are Marked" sits under every phase objective** (story 9): NOW only in free roam (it replaces Go To The Internet). | As built. |
| Q54 | **The NOW follows Act II beat by beat** (S3): Where You Stand splits into The Overshare, Zipped Out, Full Of Beans and Where You Stand (Trust Chart only), latest first. | As built. |
| Q55 | **Every guest objective gets a `go:`** (C11; table in §2), and every house `!` alert a `with go:` exit; none points at the lobby. | As built. |
| Q56 | **The big moments chosen** (C12): Bingo win, the ribbon (winner + a self-closing house cheer through the story rule `ribbon_cheer`, so L1218 stays quiet), the bottle, the side reveal, Help or Thwart, the pickup line, the awards, the capture, the confrontation, the release, the banishment. Not the mark (minor), not the late notice (`!`). | As built. |
| Q57 | **Q37 / Q38 signed off**: the show clock at 7:00 PM at the doors and 11:00 PM at 🕚; the DRAFT markers now read *Signed off (w13 Q3x, wave 18)*. | Done. |
| Q58 | **The casino and the King after Q30**: the casino refuses a captured program (*⛔ YOU'RE IN THE INTERNET — GO TO THE TENT*) and a restricted one; a merely marked program plays. The King's chess still refuses only a restricted program, so a marked program and a captured one may play him (its refusal copy still says *Marked programs can't challenge the King.*). | As built. Alternative: refuse a captured program at the King too, and reword the refusal. |
| Q59 | **The VR headset after an ending** tags every eligible program *[party favour]* (integration); the tablet reads the server's `favour` flag at once. | As built. |
| Q60 | **Snapshot size** (OD-F4, deferred): a late-night booth snapshot carries the Wanted rows on every frame; every K-32 gate passes, so the trim waits for a later perf pass. | Deferred. |

## 2. Show text changes

Grouped by the beat they play in. "old" is master before wave 18 (b492dc1);
"new" is this branch. Lines with no old text are new. `// DRAFT w18 (fix …)`
lines are the fix round's.

### Arrival and the door (Doors → C1)

| file:line | who | old | new |
|---|---|---|---|
| `beats/login.loom:89` | the Upload beat | — | `fire waiting_at_the_door for program` (every Antivirus booth hears the door queue; Q37) |
| `cast/kit.loom:190` | TRAIT Enforcer → booth | — | `!!🚪 {program.name} is waiting at the Optical Drive.` |
| `cast/kit.loom:196` | TRAIT Enforcer → booth | — | `🙋 {program.name} is yours at the door: scan their pass.` |
| `cast/kit.loom:84` (fix BN-F16) | clearance | — | `set program.door_by = "none"` (the card's *At the door* flag goes) |
| `main.loom:3345`–`:3370` | INTERACTION labels | — | `🙋 I'll get them` (claim_escort) · `Hand it back` (release_escort) · `🙋 Take over` (take_over_escort) · `🙋 I've got them` (claim_door), each with its description |
| `main.loom:8` (header) | watch | `watch: program.cleared as Cleared, program.marked as Marked` | `…, program.door_by as At the door` |
| `objectives.loom:417` | Door Duty | *A scan clears the program: through the Tube to the Desktop. Not uploaded yet: they finish first. Camera fails: type the id under the QR.* | *The four of you share the door. A scan clears the program: through the Tube to the Desktop. 🙋 on an arrival tells the others you have them. Not uploaded yet: …* |
| `objectives.loom:768` | The Porch (Recycling Bin) | *Lost or locked: radio the director.* | *Lost or locked out: send them to Task Manager, the help desk.* |
| master `cast/antivirus.loom:70` | CHARACTER Windows Defender | the door-only part, its `holds_the_door` slot and its summons line | deleted (Q37) |
| master `objectives.loom:463` | OBJECTIVE Hold The Door | Windows Defender's | deleted |

### Act I: the Desktop and Computer Bingo (C1 → V3)

| file:line | who | old | new |
|---|---|---|---|
| `main.loom:2692` | the admin cues | — | `by: Clippy` on start_the_bingo, bingo_time, start_the_hunt, hunt_time_up, first_moment_of_truth, close_the_filing, read_the_results, spin_the_bottle, start_the_second_hunt, bobbing_for_truth, clippy_reads_summary, start_the_ceremony and the nine award_* cues (Q39) |
| `cast/hosts.loom:45` | Clippy's readout | *⏰ 20 minutes are up. Ask the director for BINGO TIME.* | *⏰ 20 minutes are up. Call ⏰ Bingo time from your 🎤 bar.* |
| `main.loom:3507` | quest Run The Bingo (Clippy) | *Twenty minutes are up. Ask the director for BINGO TIME.* | *Twenty minutes are up. Call ⏰ Bingo time from your 🎤 bar.* |
| `main.loom:3524` (fix GN-F5) | bingo_time → everyone | — | `!⏰ BINGO TIME. Back to the Desktop: got a line? Read it to Clippy.` with *Go to The Desktop* |
| `main.loom:559` | 🎱 → the winner | *🎱 Bingo! Name the program for each square, from memory. Centre square last.* | **big**: *🎱 BINGO! Name the program for each square, from memory. Centre square last.* with *🎱 To the Desktop* and *See the quest* (The Bingo Card) |
| `main.loom:569` | 🎀 → the winner | *🎀 You won a Bingo Ribbon. Take a bow.* | **big**: *🎀 You won the Bingo Ribbon. Take a bow.* with *Read "Computer Bingo"* |
| `main.loom:3534` | rule `ribbon_cheer` → everyone | *~🎀 {program.name} wins a Bingo Ribbon! Everyone cheer!* (a folded notice) | **big, closes after 6 s**: *🎀 {Night.ribbon_winner} won the Bingo Ribbon! Cheer for them at the Desktop.* (the TV's *Congratulations!*) |
| `cast/antivirus.loom:21` | Norton's Bingo readout | *…They need to be taken to the Internet for a reinstallation. Then press 🛡 on them and drag them to the Tube.* | *…They light up on your Wanted board: scan their pass, press 🛡 and drag them to the Tube.* |
| `objectives.loom:558` | Welcome Everyone (Clippy) | *…At 20 minutes ask the director for BINGO TIME.* | *…🎱 and ⏰ Bingo time are your cues on the 🎤 bar.* |
| `objectives.loom:569` | Celebrate The Winners (Clippy) | brief *…At the centre square, 🎯 the program they name: Norton interrupts. You never press 🛡.* · to-dos *🎱 on each winner* / *🎯 on the program the winner names* / *🎀 the ribbon* · buttons `bingo_winner, named_at_bingo, award_the_ribbon` | brief *…Tap each winner, give the ribbon, then tap the program they name at the centre square: Norton interrupts. You never press 🛡.* · to-dos *🎱 Who shouted BINGO?* / *🎀 Give the winner the Bingo Ribbon* / *🎯 Who did the winner name?* / *The first reinstallation* · buttons `bingo_winner, award_the_ribbon, named_at_bingo` · `pick:` everyone cleared at the Desktop |
| `objectives.loom:427` | The Selected Antivirus (Norton) | *…Then press 🛡 on them and walk them through the Tube.* · buttons `scan, send to the internet` | *…They light up on your Wanted board: scan their pass, then 🛡 and walk them through the Tube.* · buttons `scan` |
| `objectives.loom:584` | Introduce Trabolta (Clippy) | *Radio INTRO first. "Everyone, say hello…" …The hunt runs 15 minutes.* | *Once a host fires 🤖 (it is LAST on your bar): "Everyone, say hello…" …🔎 the hunt is your cue: it runs 15 minutes.* |
| `codex/7-clippy.loom:85` | Clippy Instructions 2 | *After your corruption speech, the director fires "Clippy introduces Trabolta".* | *…a host fires "Clippy introduces Trabolta".* |

### The mark, the confrontation, the capture and the release (all night)

| file:line | who | old | new |
|---|---|---|---|
| `main.loom:30`, `:32`–`:36` (header) | wanted / archive | — | `wanted: program.marked as program.marked_for by program.escort_by, for Antivirus` · `archive:` the Uploader (pool programs, cleared, until the end) and the four Antivirus' DMs (cleared, unmarked, not captured) |
| `main.loom:989` | `mark_for_reinstallation` → the program | pin *!🚨 GO TO THE INTERNET. You are marked for reinstallation. An Antivirus will escort you through the Tube. Your buttons are off until you are reinstalled, except 🚻 Bathroom Mode.* + `restrict program to The Tube, The Internet` | minor: *🚨 You are marked for reinstallation ({program.marked_for}). Nothing is switched off: carry on. The Antivirus are looking for you.* with *🎟 Show my pass* and *What happens now?* (fix NM-F1); no restriction |
| master `main.loom:959` | the mark → `# quarantine` | pin *🚨 Escort {program.name} to the Internet — {program.marked_for}. Press 🛡 Send to the Internet on their card when you have them.* | deleted (the Wanted board) |
| `cast/kit.loom:248` | TRAIT Enforcer → booth (WANTED) | *!🚨 {program.name} is marked for reinstallation ({program.marked_for}). Escort them through the Tube, then press 🛡 on their card.* | **pop-out**: *!!🚨 {program.name} is marked for reinstallation ({program.marked_for}). Find them and scan their pass: the scan is the confrontation.* |
| `cast/kit.loom:246` | the late mark → booth | *!🚨 {program.name} is late for the Second Moment of Truth: marked for reinstallation. Go get them, escort them through the Tube, then press 🛡 on their card.* | **pop-out**: *!!🚨 … marked for reinstallation. Find them and scan their pass: the scan is the confrontation.* |
| `cast/kit.loom:171` / `:177` / `:183` | the claims → booth | — | *🙋 {program.name} is yours. Find them and scan their pass: the scan is the confrontation.* · *🙋 {program.name} is back on the Wanted board for every Antivirus.* · *🙋 You took over {program.name}. Find them and scan their pass.* |
| `cast/kit.loom:64` | TRAIT Enforcer's scan of a marked program (said) | *{program.name}. Corruption detected: you are marked for reinstallation. Come with me through the Tube to the Internet.* (with the readout *🚨 … an escort through the Tube to the Internet, then 🛡 on their card.*; Windows Defender's *An Antivirus will escort you…*) | the same spoken line (now the SAY IT box), before the summons check-in; the booth readout **pop-out** *!!🛡 Corruption detected: {program.name} ({program.marked_for}). Press 🛡 Send to the Internet, then walk them through the Tube to the Internet.* |
| `main.loom:1030` | `confronted` → the program | — | **big**: *🛡 CORRUPTION DETECTED. {hunter} has found you. Stay with them: you are going to the Internet.* |
| `main.loom:497` | `captured` → the program | — | **big**: *🌐 Sent to the Internet. Go out back through the tunnel to the Internet, scan your pass at the reinstallation station and find Gerald, the golden duck.* with *Go to The Internet* and *Show my pass* |
| `main.loom:1013` | 🩹 → the program | — (the unpin *✅ The mark is lifted.*, also at capture) | *✅ Your mark is lifted. You are not going to the Internet.* (never at capture) |
| `main.loom:517` | the release (hand jive night) | *The hand jive broke his hold. You are out of the Internet.* | **big**: *🕺 The hand jive broke his hold. You are out of the Internet.* with *Go to The Desktop* |
| `main.loom:519` | the release | *Reinstallation complete. You can follow instructions. Welcome back to the computer.* | **big**: *🦆 Reinstallation complete. …* with *Go to The Desktop* |
| `main.loom:3127` | 🛡 Send to the Internet | description *Antivirus. Corrupted program: drag them through the Tube for reinstallation.* | `while: program.marked == true and program.corrupted != true` · *Antivirus. A marked program, found: drag them through the Tube for reinstallation.* |
| `main.loom:3136` | ✅ Mark as reinstalled | — | `while: program.corrupted == true` |
| master `main.loom:1166`, `:2072` | the 📝 filing and the check-in refusals for a marked program | *You are marked for reinstallation, {program.name}. Report to the Internet.* / *You are marked for reinstallation. Go to the Internet, not the Desktop.* | deleted (Q31) |
| `objectives.loom:359` (master `:51`) | You Are Marked (was Go To The Internet) | *Go to the Internet: you are marked* / *An Antivirus will walk you through the Tube … Your buttons are off until you are reinstalled. …* · buttons `pass` | *You are marked for reinstallation* / *Nothing is switched off: carry on with the night. The Antivirus are looking for you, and when one scans your pass you go to the Internet. Bathroom Mode still works: they wait outside.* |
| `objectives.loom:408` | Escort The Marked (Antivirus) | *Your booth names each one. Find them, walk them through the Tube, then press 🛡 on their card. …* · buttons `scan, send to the internet` | *The Wanted board names each one: 🙋 claim one, find them and scan their pass (the scan is the confrontation), then 🛡 and walk them through the Tube. …* · buttons `send to the internet` |
| `objectives.loom:512` | Patrol The Computer (Antivirus) | *…Trabolta's sweep requests and the escort list land in your booth.* · `while: Night.ended != true` | *…and the Wanted board land in your booth.* · `while: … and Night.step >= 1` (fix BN-F16) · `evergreen: true` |

### Act I: the hunt and the First Moment of Truth (V4 → 🍾)

| file:line | who | old | new |
|---|---|---|---|
| `main.loom:908` | the bottle → the program | `moment: major` | `moment: big` (*🍾 The bottle landed on you. Truth or dare?*) |
| `objectives.loom:593` | The First Moment Of Truth Host (Clippy) | *Two minutes to file, then read each question's result aloud from the Desktop room. Confident answers…* | *…from the Desktop room. ⏱, 📋 and 🍾 are your cues on the 🎤 bar. Confident answers…* |
| `codex/7-clippy.loom:109` | Clippy Instructions 3 | *The director closes it with ⏱* | *You close it with ⏱ on your 🎤 bar* |
| `codex/7-clippy.loom:111` | Clippy Instructions 3 | *(App) The director fires 📋 Results for each question in turn.* | *(App) You fire 📋 Results from your 🎤 bar, for each question in turn.* |
| `codex/7-clippy.loom:121` | Clippy Instructions 3 | *The director fires 🍾 Spin the bottle up to five times per question.* | *You fire 🍾 Spin the bottle from your 🎤 bar, up to five times per question.* |
| `codex/7-clippy.loom:129` | Clippy Instructions 3 | *After five spins, the director reads the next question's results.* | *After five spins, fire 📋 for the next question's results.* |

### Act II: the hour, the summons and Truth Pong (📓 → 🏓)

| file:line | who | old | new |
|---|---|---|---|
| `codex/7-clippy.loom:154` | Clippy Instructions 4 | *(App) The director fires Hunt 2.* | *(App) Fire 📓 Hunt 2 from your 🎤 bar.* |
| `main.loom:26` (fix GN-F13) | header countdown | — | `countdown: Night.hunt2_end as Hunt 2 ends, …, for guests` (the guests see hunt 2's hour) |
| `main.loom:3903` | ⏳ FIVE MINUTES → everyone | *!⏳ FIVE MINUTES. Be in the Desktop for the Second Moment of Truth, or an Antivirus will take you…* | *!⏳ FIVE MINUTES. Be in the Desktop and scan its check-in QR for the Second Moment of Truth, or an Antivirus will take you…* with *📷 Check in* and *Go to The Desktop* |
| `beats/pong.loom:21` | Clippy (Five Minute Warning) | — | *When you get here, scan the check-in sign by the door! That's your check-in. You can do it yourself! I believe in you!* |
| `cast/kit.loom:215` | TRAIT Enforcer → booth (the summons) | *🛡 Scan every program arriving at the Desktop: that is their check-in.* | *🛡 The summons: programs check themselves in with the Desktop's QR. 📍 only for a dead or lost phone (Still missing, on your NOW card).* |
| `main.loom:2490` (fix NM-F1) | the late notice → the program | `!⏰ You are late. An Antivirus is coming for you.` | the same, with *🎟 Show my pass* and *What happens now?* |
| `objectives.loom:215` | Be At The Desktop (guests) | *Check in at the living-room door: an Antivirus or a host scans your pass. Late without Bathroom Mode means the Internet, and no Truth Pong.* · buttons `pass` | *Go to the living room and scan the Desktop's check-in QR: that is your check-in. Late without Bathroom Mode means the Internet, and no Truth Pong.* · `go: scan as "📷 Check in"` |
| `objectives.loom:396` | Summons Check In (Antivirus) | *The summons: scan everyone at the living-room door* / *A scan of a cleared program is their check-in. Bathroom Mode excuses them. After 🚨 the late list lands in your booth.* · buttons `scan, check_in_at_desktop` | *The summons: they check themselves in* / *Programs scan the Desktop's check-in QR. 📍 on Still missing only for a dead or lost phone. Bathroom Mode excuses them. After 🚨 the late marks land on your Wanted board.* · `pick:` Still missing · buttons `check_in_at_desktop` |
| `objectives.loom:697` | Summons Door (hosts) | *The summons: check them in at the living-room door* / *Scan a pass, or 📍 on their card. Bathroom Mode excuses them.* · buttons `scan, check_in_at_desktop` | *The summons: they check themselves in* / *Programs scan the Desktop's check-in QR. 📍 on Still missing only for a dead or lost phone. Bathroom Mode excuses them.* · `pick:` · buttons `check_in_at_desktop` |
| `objectives.loom:728` | Judge The Cup (Adobe Acrobat) | *…Missed: 🏓 Missed (marked; an Antivirus escorts them). …* | *…Missed: 🏓 Missed (marked: they light up on the Antivirus' Wanted board). …* · `pick:` every cleared, unthrown, unmarked program (fix BN-F21) |
| `main.loom:357` | ROLE Program slot | — | `pong_thrown` (set by 🏓 Made / Missed, for the list) |
| `codex/7-clippy.loom:183` | Clippy Instructions 5 | *When the director fires the tally, …* | *When a host fires the tally, …* |

### Act II: the Trust Chart, the beans, the zip, the overshare (📊 → 🤖)

| file:line | who | old | new |
|---|---|---|---|
| `objectives.loom:250` | The Overshare (new) | — | *Trabolta overshares: the final facts* / *Trabolta is sharing the last facts at the Desktop. The questions are in your Quest Log. Listen: he may say more than he means to.* |
| `objectives.loom:260` | Zipped Out (new) | — | *The zip: everyone out of the Internet* / *The Antivirus zipped every program out of the Internet. Compressed, do not open. Welcome them back at the Desktop.* |
| `objectives.loom:270` | Full Of Beans (new) | — | *Print failed: the printer is full of beans* / *Routine operations like print to PDF are no longer working. Clippy says it is malware. Stay close: Trabolta has two last facts to ask for.* |
| `objectives.loom:280` | Where You Stand | *…Applaud the most trusted. Then he has two last facts to ask for.* (Trust Chart, the beans and the overshare) | *…Applaud the most trusted. VLC prints a certificate.* (the Trust Chart only) |
| `objectives.loom:448` | Zip Everyone Out (Antivirus) | buttons `mark as reinstalled` | no buttons (the zip releases everyone itself) |

### Act III: the Y2K hour, the sides and the server room (🕚 → 🌑)

| file:line | who | old | new |
|---|---|---|---|
| `main.loom:4135` | 🕚 → everyone | `!🕚 SYSTEM CLOCK RESET: …` | the same, with *Choose a side* and *Open Truther Download* |
| `beats/overshare.loom:121` | the side reveal → each program | — | **big** doors card: *🕚 SYSTEM CLOCK RESET. Two doors have opened in the computer.* |
| `beats/overshare.loom:98` | Truther Download (Excel) | *Programs join Unlimited Power on the Choose your side card, in the Trapped in the Internet room.* | *Programs walk through Unlimited Power's door on the Sides screen (Start → Sides). Scan a program's pass to recruit them.* |
| `beats/overshare.loom:111` | Truther Download (OpenOffice) | *Programs join The Way Out, the Truthers, on the Choose your side card, in the Trapped in the Internet room.* | *Programs walk through The Way Out's door on the Sides screen (Start → Sides): the Truthers. Scan a program's pass to recruit them.* |
| `codex/6-missions.loom:58` | CODEX Excel Final Orders | *…Programs join Unlimited Power on the Choose your side card, in the Trapped in the Internet room.* | *…Programs walk through Unlimited Power's door on the Sides screen (Start → Sides); scan a program's pass to recruit them.* |
| `codex/6-missions.loom:103` | CODEX OpenOffice Final Orders | *…Programs join The Way Out, the Truthers, on the Choose your side card, in the Trapped in the Internet room.* | *…Programs walk through The Way Out's door on the Sides screen (Start → Sides): the Truthers. Scan a program's pass to recruit them.* |
| `beats/malware.loom:83` / `:117` | the leaders | — | `set Unlimited_Power.leader = program` / `set The_Way_Out.leader = program` (after their choice) |
| `main.loom:37` (header) | majority | — | `majority: Night.present / 2 + 1` (the doors' *n of m needed*) |
| `main.loom:4201` | `when recruited for program:` | — | *🙋 {program.name} walked through your door. Recruited by pass: {by.recruits}.* (an update step on Recruit To Stay / Recruit To Leave) |
| `main.loom:277` | ROLE Program secret slot | — | `recruits: 0 to 500 = 0` |
| `objectives.loom:290` | The Y2K Hour (guests) | *…Two factions are recruiting: pick one on the Choose your side card (it waits in the Trapped in the Internet room), or neither. …* | *…Two factions are recruiting: walk through one of their doors on the Sides screen, or neither, and scan a program's pass to recruit them. …* · `go: sides` |
| `objectives.loom:469` | Patch Bay And Clubs (Password Manager) | *…The director may radio you for a count. …* | *…A host may ask you for a count. …* |
| `quests.loom:209` | QUEST The Clubs (Password Manager) | *…Tell the director the count when asked.* | *…Tell a host the count when asked.* |
| `main.loom:1108`–`:1116` | an ending with the doors card still up (recheck N5) | — | the card is replaced by *🚪 The doors have closed.* (no Walk in after the end) |

### Act IV: the final reveal, the verdict, the endings (🌑 → the end)

| file:line | who | old | new |
|---|---|---|---|
| `codex/7-clippy.loom:233` | Clippy Instructions 8 | *(App) The director fires Bobbing for Truth.* | *(App) Fire 🍎 Bobbing for Truth from your 🎤 bar.* |
| `codex/7-clippy.loom:244` | Clippy Instructions 8 | *…reads truth.txt aloud, when the director fires it.* | *…when a host fires it.* |
| `objectives.loom:749` | Hand Over Truth Txt (Adobe Acrobat) | *They read it aloud. When they finish, radio the director for ⚖ the verdict.* | *They read it aloud. When they finish, ⚖ the verdict is NEXT: fire it, or tell whoever is calling the show.* |
| `beats/finale.loom:155` | the song ending → everyone | `!🎵 TRABOLTA SOLVED IT. …` | the same words, with *Go to The Desktop* (recheck N9) |
| `beats/finale.loom:233` | Help or Thwart → everyone | `moment` none | `moment: big` (*Will you help Trabolta win Sandy?*) |
| `main.loom:2212` | the pickup line → each program | `moment: major` | `moment: big` |
| `main.loom:4896` | the banishment → everyone | `!⛈ Trabolta is banishing EVERY program to the Internet. Antivirus included.` | **big**: the same words, with *Go to The Internet* |
| `cast/hosts.loom:85` | Clippy's readout (Purgatory) | *📋 9/X is in What Clippy knows. After the dance, ask the director for the summary and read it.* | *…After the dance, call 🪦 the summary from your 🎤 bar and read it.* |
| `objectives.loom:675` | Purgatory (Clippy) | *After the dance, ask the director for the summary and read it…* | *After the dance, call 🪦 the summary from your 🎤 bar and read it…* |

### After the night: the ceremony and the party favour (🏆 → G11)

| file:line | who | old | new |
|---|---|---|---|
| `main.loom:2380` | an award → the winner | `!🏆 You won {Night.award_title}! Come up to the TV for your trophy.` | **big**: the same words, with *Go to The Desktop* |
| `objectives.loom:684` | Host The Ceremony (Clippy) | *If you host (after Combo B or the rave), …* | *The awards are your cues on the 🎤 bar. If you host …* |
| `beats/internet.loom:50` | the Installation Wizard (the Tablet Video) | — | *The night is over, {program.name}. The simulation is open to every program now: a party favour. Put on a headset, or take the tablet, and go find Gerald.* |
| `objectives.loom:346` | The Night Is Over (guests) | *The night has ended. Stay for the ceremony: if your name is called, come up to the TV.* | *…come up to the TV. The reinstallation games in the Internet are open to every program now: a party favour.* |
| `main.loom:31` (header) | reinstall | — | `reinstall: program.marked == true or program.corrupted == true or Night.ended == true` |

### The hosts' fallbacks (all night)

| file:line | who | old | new |
|---|---|---|---|
| `objectives.loom:777` | Disk Cleanup (Recycling Bin) | *…NEXT sits above your taskbar: fire a cue only when the director radios you (tap to arm, tap again to fire).* | *…NEXT sits above your taskbar: every host may call the show. 📣 I'll call tells the others who is calling (tap to arm, tap again to fire).* · `evergreen: true` |
| `objectives.loom:786` | Documents And Printing (Adobe Acrobat) | the same *…only when the director radios you…* | the same new sentence · `evergreen: true` |
| `objectives.loom:795` | The Help Desk (Task Manager) | *…any host may fire it (tap to arm, tap again to fire); agree by radio who calls.* | the same new sentence · `evergreen: true` |

### The guests' `go:` (C11, no text change)

The one place each guest objective's Mission sends them: The Hand Jive, Find
Gerald → The Internet · Show Your Pass → `pass` · Go To The Desktop, Bingo
Results, The First Moment Of Truth, Stay Calm, The Door Is Closed, The
Overshare, Zipped Out, Full Of Beans, Where You Stand, The Final Reveal,
Bobbing For Truth, The Night Is Over → The Desktop · Meet Trabolta, File Your
Facts, The Pickup Line, Help Or Thwart → Trabolta · Find Three Facts, The Hour
→ `quests` · Truth Pong → The Cloud · The Y2K Hour → `sides` · Be At The
Desktop → `scan as "📷 Check in"`. And every house `!` alert gained a `with
go:` exit (`main.loom:3467` 📣 → The Desktop, `:3496` 🎱 → the Bingo Card quest,
`:3503` ⏰ → The Desktop, `:3555` 🤖 → Trabolta, `:3588` 🔎 → `quests`, `:3609` 📣
→ The Desktop, `:3635` 📝 → Trabolta, `:3859` 📓 → `quests`, `:3886` 📥 → Truther
Download, `:3947` 🏓 → The Cloud, `:3992` 📊 → The Desktop, `:4086` 🤖 → `quests`,
`:4764` 🌑 → The Desktop, `:4941` 🏆 → The Desktop). None points at the lobby.

### Removed

CHARACTER Windows Defender (`cast/antivirus.loom`), OBJECTIVE Hold The Door,
OBJECTIVE Go To The Internet (replaced by You Are Marked), the `# quarantine`
escort pins, the mark's phone pin and restriction, the marked program's filing
and check-in refusals (w13 Q35), and the *✅ The mark is lifted* line at
capture.

## 8. The app's own words (the guest frame, for the same sign-off)

Not story text: these are `play/src/tutorial.tsx` (the tour Clippy deals,
`show tutorial … with guide: "Clippy"`), `play/src/guest/frame.tsx` and
`play/src/chrome/pass.tsx`. Wave 18 cut the tour to five steps; it starts on
Mission. Mark each ✅ / ✏ / ❌ like the rest.

| step | spotlight | title | text |
|---|---|---|---|
| mission | the Mission button (taskbar) | Your mission | This is home: what to do now, where to go, and what's waiting on you. |
| chats | the Chats button (taskbar) | Chats | Places and people. A yellow dot means it's your move. |
| pass | 🎟 Pass (taskbar) | Pass and Scan | Your pass, one tap away. Scan is right beside it, for codes on walls and notes. |
| bell | the Recycle Bin (top bar) | Notifications | Anything you missed lands in the Recycle Bin up here. |
| start | ⊞ Start (taskbar) | Start | the story's `bathroom:` blurb; without one: Bathroom Mode, people, help and you. |

Also on the phone:

- **Leave the event** (Start's last item) asks first: *"Leave the event? This phone stops being {name}. You stay {name} — to come back, scan your badge or ask a host."*
- **The full-screen pass** says under the QR: *"Not scanning? Turn your screen brightness up."*
- **Chats**: the lobby is *📜 Chat log* · *Everything the house said tonight*;
  a wide screen with no room open says *Pick a chat, or follow your mission.*
- **Mission**: *▣ MISSION* (*▣ MISSION · waiting* with nothing live), *✓ YOU'RE
  HERE*, *FREE ROAM · The house will call you.*, *Nothing to do just yet. The
  house will call you.*, *+ n more in Chats ›*, *Also now (n)*.
- **The Recycle Bin** (`play/src/moments/delete-gags.ts`): *Are you sure you
  want to send '…' to the Recycle Bin?* · *Cannot delete '…': This item is in
  use.* · *Are you sure you want to delete these n items?* · *Deleting…* ·
  *Cannot delete '…': Access is denied.* · *The Recycle Bin is full of beans.* ·
  *The Recycle Bin is empty. Nothing has interrupted you yet.* · *The Recycle
  Bin is empty. So is your past.*
- **Big moments** (`play/src/moments/big-model.ts`): the kickers *★ ACHIEVEMENT
  UNLOCKED* (*Installing achievement… → Installed.*, *Collect ✓*), *⚠ VIRUS
  DETECTED* (*Scanning… → Threat found.*), *⛔ QUARANTINED* (*Moving to the
  Internet…*), *⚡ YOUR MOVE* (*Answer to continue.*), *📣 HOUSE NEWS* (*Cheer!
  (6)*), *🚪 AN INVITATION*, *! IMPORTANT* (*Please wait… → Ready.*).
- **The doors** (`play/src/sides/`): *Walk in ▸* · *Neither. I'll pursue my own
  interests.* · *You can switch sides from ⊞ Start → Sides.* · *Leaders stay
  with their side.* · *Crews are just friends. They never count toward a side.*
- **Recruiting**: *That's X's pass. When the sides open, scan it to recruit
  them.* · *Join a side first, then scan X's pass to recruit them.* · *✓
  Invitation sent to X.*
