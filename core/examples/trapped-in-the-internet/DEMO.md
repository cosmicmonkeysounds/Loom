# Demo — the Oct 31 WIP in 20–30 minutes

How to show *Trapped in the Internet* as it stands (wave 3, 2026-10-15) on
**https://app.mapsandducks.com** with **2–4 phones and one laptop**. It plays the
night from the door to an ending and the awards, compressed: every timed
stretch (Bingo's 20 min, the hunts, the hour, the Y2K hour) is skipped by
firing its cue by hand.

The cue order below is pinned by a test: `core/test/trapped-in-the-internet.test.ts`
→ *the WIP demo (DEMO.md)* drives it with three phones to both endings. If you
change the order here, change it there.

## Before you start (once)

1. The VPS runs the wave-3 release (`scripts/ops/ship.sh <tag>`), and the
   show's story is in your server project: `LOOM_SSH=loom-vps pnpm sync-show`
   (with `LOOM_PROJECT="<your project name>"` if it isn't *Untitled Project*).
2. On the laptop, open **https://app.mapsandducks.com/edit/**, sign in, open
   the project, press **⌘2** (Run). If a run is already going and you want a
   clean night: header **↺ Restart ▾ → Restart this draft** (or **⇪ Push
   current draft** if the story changed since it started). Otherwise **▶ Start
   rehearsal**. A rehearsal is fine for a demo: phones join it with the same
   codes a live event uses.
3. The **Run page** shows three codes. Write them down:
   - **Event code** — guests (and its QR: point the phones' cameras at it).
   - **Performer code** — the cast's phones.
   - **Moderator code** — the TV and the tent tablet.
4. Open two more tabs on the laptop (or a second screen):
   - **The TV**: `https://app.mapsandducks.com/terminal/?code=<moderator code>&name=TV&character=Trabolta&view=tv`
     (the living-room screen: screensaver, then Trabolta's face, the slides, the live Trust Chart, the overlays).
     **Click the TV tab once** ("🔇 CLICK ONCE TO ENABLE THE VOICE"): a browser
     keeps a page silent until someone touches it, so Trabolta's TV voice is
     mute until you do.
   - **The tent tablet**: `https://app.mapsandducks.com/reinstall/?code=<moderator code>&name=Tent tablet`
     (the reinstallation game; keyboard WASD / arrows, Q/E turn, Shift runs).
5. Optional: Trabolta's voice. Start stagehand's `agents` worker on the
   laptop/house Mac (`uv run stagehand run --config <machine>.yaml --only agents`,
   see `stagehand/README.md`). Without it, DMs to Trabolta get his hold line
   ("Jean Trabolta is not responding…") after ~20 s, and you can answer as
   him from Run (👁 identity → Trabolta, then type in his thread).

## Who holds what

| Device | Signs in as | How |
|---|---|---|
| **Phone A** | a guest: **Microsoft Excel** (a featured program: he gets a secret mission at the Truther Download) | open the site → **I'm a Guest** → event code → pick *Microsoft Excel* |
| **Phone B** | a guest: **MS Paint** (featured: the night's anti-AI program, the first one sent to the Internet) | same, pick *MS Paint* |
| **Phone C** (optional) | performer **Norton Anti-Virus** | **I'm a Performer** → performer code → pick *Norton Anti-Virus*. He scans passes at the door and sends programs to the Internet. |
| **Phone D** (optional) | performer **Clippy** | performer code → *Clippy*. She judges answers (✅ / 😤 / 🏓 / 💘) on a guest's card. |
| **Laptop** | the director | Run (cue sheet), plus the TV tab and the tent-tablet tab |

Two phones only? Skip C and D: in Run, the **👁 identity control** lets you
*be* Norton or Clippy (the performer's booth, their buttons on each guest),
and the guest's **Inspector** scans them in as Norton (the *— scan as
character —* menu → *Norton Anti-Virus* → **Scan**). Add a third guest
(Calculator, any pool program) if you have the phone: three programs make
the Trust Chart and the majority read better.

Every cue below is a button on **Run → Director → cue sheet** (in running
order; LAST / NEXT track where you are). A **performer button** is on the
guest's card in that performer's booth (phone C / D), or in Run while you
*are* that performer.

## The run, step by step (≈ 25 min)

### Act 0 — the door (5 min)

| Do | What the phones show |
|---|---|
| Phones A, B join (event code → pick the program). | A dark full-screen **cutscene**: The Uploader in the Optical Drive (the mud room). |
| Each fails the **CAPTCHA**: tap any squares → VERIFY. (Getting it *right* proves you're human: INCORRECT, try again.) | "CORRECT. You failed at once." |
| A pool program (Calculator) picks a problem; everyone picks **Deposited** / *I have nothing to leave*. | *100 Truthcoin credited*, then a **pass** (QR) on the stage: "An Antivirus will scan you in." |
| **Norton** (phone C's **Scanner**, or Run → the guest's Inspector → *scan as character* Norton → **Scan**) scans each pass. | "Scanned. … free of viruses." The Tube, the Desktop, "📂 The Start Bar, The CPU, … are open now." **Continue** leaves the cutscene for the chat app. Clippy's **orientation tour** opens (Next / Skip). Excel and MS Paint get their human memories in *The Uploader*'s thread; MS Paint gets *The Centre Square*. |

### Act I — the Desktop (8 min)

| Cue (Director) | Performer | What you see |
|---|---|---|
| **C1/V1 · 📣 Call everyone to the Desktop** | — | 🔔 alert on every phone; `# task-manager` opens; the TV leaves the screensaver. |
| **V2 · 🎱 Start Computer Bingo (20 min)** | — | Clippy's rules in *The Desktop* room, the Bingo Card quest, the TV's Bingo slide (a text placeholder) + corner countdown. |
| **V3 · ⏰ Bingo time: results** | Clippy: **🎱 Bingo winner** + **🎀 Award a ribbon** on a guest (Calculator). Norton: **🛡 Send to the Internet** on **MS Paint**. | 🎀 broadcast; Norton's line to MS Paint ("you did not agree to be ruled by AI"); **Corrupted Code** (Clippy: "this is normal"). Phone B: "⛓️ You've been taken to The Internet", **WebMD**'s reinstallation instructions. |
| *(tent tablet)* | — | On the laptop's tent tab: **MS Paint** is listed under *In the Internet now* (☣ MS Paint) → **Play here** → follow the golden chevrons to **Gerald, the golden duck** and walk into him. Phone B: "Reinstallation complete", *The Golden Duck*. (The map is the 3-floor placeholder of the house; the tent is out back.) |
| **Clippy 2/X · 🤖 Clippy introduces Trabolta** | — | Trabolta appears in everyone's People list and DMs ("Hello, …"); the TV flips to his face, then the mirror of the house. |
| **V4/V5 · 🔎 Truth Scavenger Hunt 1 (15 min)** | — | Hunt One in the Quest Log; a **📝 File a fact** card in each Trabolta thread. |
| **C2 · ⏰ Hunt over** → **V6 · ⚖️ First Moment of Truth** | Clippy: **✅ Q1** on Calculator, **😤 Q2** on Excel (a confident lie: accepted, looks identical). | "✅ … answer is accepted" for both. A refused press (pressing again) lands in `# hosts`, never on the guest's phone. |
| *(optional)* **🎩 Truth or Dare from the hat** | Clippy: 🎩 *Chose Dare* sends someone to the Internet. | — |

### Act II — the malware and the hour (7 min)

| Cue | Performer / phones | What you see |
|---|---|---|
| **📺 Preview hunt 2 → the ad hijack** | — | 🔔 **000. 000. 000.** alert on every phone + the ad on the TV. Clippy's booth (phone D) gets Trabolta's private "we are all going to die". Everyone else: "A minor irregularity…". |
| **📓 Hunt 2 → quest logs; disperse for 1 hour** | — | Hunt Two quest; `# clipboard` opens. |
| **📥 Truther Download (auto at +2 min)** — fire it now | **Phone A (Excel)** answers the choice in *Truther Download* (sabotage or paranoid). | 🔔 "TRUTHER DOWNLOAD received"; `# truthcoin-exchange` opens; each program gets its glitch beat; Excel joins *Unlimited Power* (still hidden) with a mission. |
| **⏳ Five-minute warning** → **🚨 Summons closed** → **🏓 Truth Pong** | Norton scans anyone at the Desktop during the warning (a check-in). Clippy: **🏓 Made the cup** + **✅ Q1** on Calculator. | A guest not checked in gets "⏰ You are late" and Norton's booth "Go get them". |
| **🧮 Trabolta tallies round 2** → **📊 Trust Chart** | — | **The TV draws the Trust Chart live**: every program, ranked by trust. |
| **🏆 Praise the top, humiliate the bottom, VLC prints** → **🫘 Printer opened** | — | Praise / shame by name, the certificate ("The media player is not responding" with no VLC here), then *Full Of Beans*. |
| **🗜 Antivirus zip everyone out** → **🤖 Trabolta shares the next facts** | — | Captives zipped out; an overshare (scenario 1–4 by what Excel / OpenOffice did); The Final Facts quest. |
| **🕚 System clock → 11 PM, 31 Dec 1999** | **Choose your side** (Unlimited Power / The Way Out) now shows on every phone not in a group yet (Phone B; Excel is already in Unlimited Power). | 🔔 the clock alert; the TV becomes the Y2K clock; Excel's Final Orders. |

### Act III — pick one ending (3–5 min)

**A · The server room (Combo A)** — the shortest, loudest one.

1. Get a majority: **Phone B** (MS Paint): **Choose your side → The Way Out**.
   **Phone A** (Excel) is already in *Unlimited Power* from his Truther
   Download choice, so he never sees *Choose your side*: **☰ → Your pass →
   Leave … for The Way Out** (a defection). Then fire **🧾 Let a faction win without its leader's task** (OpenOffice isn't here) — or just fire **🗳 Force the majority: The Way Out**.
   Members get the whole truth (50+ codex entries, *The Legendary Fact*) and The Server Room appears.
2. **🔌 Patch: Combo A** → every phone: 🔔 **GO TO THE LIVING ROOM**; the TV: blackout, then the flashing overlay; 10 s later the dance look.
3. **🏍 After the dance: weakened Trabolta recounts** — he reads every identity of the programs who came, the first reinstall, the virus planter, the best and worst program, and rides off. Everyone is released.

**B · The verdict (Grok Prom → the song)**

1. **🎆 Midnight** → the final reveal (lights down). **🍎 Bobbing for Truth** → Adobe Acrobat's or Clippy's **🍎 Brought up the Bag of Truth** on a guest.
2. **📄 Read truth.txt → the verdict** → with a lie on record: **Grok Prom** ("You lied to me… give me a pickup line").
3. Clippy: **💘 Said "You're the one that I want"** on whoever says it (or the guest DMs it to Trabolta, if his worker is running) → the **Song Ending**.
   (Alternatives: **💔 Nobody has the line** → the rave; **💌 relationship advice** → a poll on every phone → **🗳 Count the advice poll**.)

**Then the ceremony (2 min)**: **G1 · 🏆 Start the awards ceremony**, then e.g.
**G2 · 🥇 Most Trusted** with the winner picked in the cue's *who?* box (the
top of the Trust Chart). The winner's phone: "🏆 You won Most Trusted!"; the
host's line in *The Desktop*; the TV's award slide (text only).

**The recap**: the Run page's **Recap ↗** link (under the codes) opens it as
text in a new tab, signed in as you: trust, truths and lies accepted,
Internet trips, codex, quests, Truthcoin, factions. (By hand it is
`https://app.mapsandducks.com/e/<event id>/api/mod/recap?format=text`; the
event id is the one `pnpm sync-show` prints as `✓ event <id>`.)

## Resetting between demos

Header **↺ Restart ▾ → Restart this draft**: the story starts again from the
top, the codes stay, joined phones are signed out (they land on the join
screen with a note). Performer booths stay signed in (only **Go live** signs
them out).

## What is not built yet (say so on the day)

- **The house map is a placeholder** (3 floors + the tent, not measured; K-28). The game walks it fine; the rooms won't line up with the real ones yet.
- **No hardware in the loop**: the server-room door, the patch bay, the printer button and the chess phone are the admin fallback buttons on the cue sheet. The ESP32 firmware exists but isn't wired to the VPS demo.
- **VR headsets** aren't part of this demo (the Quest build exists; the tablet game is the same game).
- **Trabolta's voice needs the laptop worker**; without it he has his hold line and a director answers as him.
- **Phones at the server-room endings** show the GO TO THE LIVING ROOM *alert banner*, not a full-screen flashing screen (the TV and terminals do flash it).
- **Every guest button shows all night** (🚻 Bathroom Mode, 💾 Insert a disk) — pressing one at the wrong time only answers "You have no disk." etc.
- **TV slides are text placeholders** (no artwork yet: "CEREMONY", "AWARD MOST TRUSTED"); the award slide doesn't name the winner — the winner's phone and the host's line do. Only the Trust Chart is drawn for real.
- **Old 📝 cards stay** in each Trabolta thread after a new round deals a fresh one.
- Not built: the tablet bench (K-02), the live tent run (K-03), the live mind run (K-04), the cellular sheet (K-07), K-31b, the printed QR posters on the walls (the Run page's 🖨 Print sheet makes them), cast-pack rehearsals.
