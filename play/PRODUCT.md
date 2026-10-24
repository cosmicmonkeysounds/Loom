# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Mobile web first: guests' and performers' own phones, iPhone Safari and
Android Chrome, opened from a QR. Also old Android tablets / iPads at
stations, and an embedded copy inside the editor's Run → Players. Built by
Vite, served by the `@loom/core` event server at `/`.)

## Users

- **Guests ("programs").** Party-goers at a live, one-night immersive show
  in a house (*Trapped in the Internet*, Oct 31; ~30–45 guests). Each plays
  a piece of software. They hold their phone in one hand, walk between
  rooms, talk to people and performers, and glance down when the story
  calls. Their job: know where to be and what to do next, show their pass
  to be scanned, answer the story's cards, chat, pick a side (or found a
  crew), and not miss the beats.
- **Performers.** Cast members playing characters with a booth on their
  phone: the four Antivirus (Norton, McAfee, Password Manager, CRA Agent
  Software; they share the door) and Clippy. Since wave 21 they are
  **players** (`player: true`): they play the night like the guests do,
  with a Mission home, their own goals and a live score, and call no cues
  (the hosts and directors call Clippy's games; Clippy gets a *NEW
  MISSION* pop-out). They work face to face with guests, mostly
  one-handed. Their job: act on the guest the story names (a pop-out, a
  picker of picture tiles, a list), scan only to clear a program at the
  door or to confront a marked one, and follow the night from Mission
  without reading a cast pack mid-scene. No booth sees the story's
  machinery: no *All buttons…*, no gate chips, no raw ids.
- **Hosts / directors.** Three performer characters who also run the
  night: **Adobe Acrobat, Recycling Bin and Task Manager** (Task Manager is
  the show owner). They are on stage, in costume, in their booths. Their
  job: call the cue sheet (any of them, equally: whoever calls claims it,
  📣), watch what needs them (judging, wallet holds, refusals, escorts
  waiting, lost guests, terminals, Trabolta's worker), announce, and fix a
  guest, all from the Play app without leaving it all evening. A second
  director may still sit at the editor's Run mode on a laptop as backup.

## Product Purpose

The Play app is the participant client of Loom, a language and server
for live, branching, multi-person stories. The story (`.loom` files) is
the source of truth. The server turns every line into exactly one room
(DMs, location rooms, the lobby, pinned Codex / Quest Log / Wallet), and
the app renders it as a game: a guest's home is **Mission** (the NOW
objective, the one place to go, its buttons big, what's waiting on you),
the rooms are a **Chats** tab you visit, the lobby is a far-away **📜 Chat
log**, every moment lands in a **Recycle Bin** of notifications, and the
big decisions take the whole screen. Success on the night: every guest
always knows the current beat and their next move. Performers act on the
guest the story names in one or two taps, mostly without scanning. Hosts
never have to open a laptop.

## Positioning

The interface is a character in the show. The fiction is that guests have
been uploaded into a 1990s computer, so the chat app is the computer
(`theme: aol97`: Win95/AOL chrome). Glitches, takeovers and pop-ups are
story devices, not just notifications. Everything a phone shows is
computed from the authored story state, so a restart or replay shows the
same thing, and the same story drives the TV, wall terminals, house
speakers and lights.

## Operating Context

- A dark, loud house party. Phones on cellular or house Wi-Fi, often
  locked between beats and woken by a chime. Guests stand while using
  them, often in a crowd.
- The night runs in acts with a director's cue sheet: arrival and
  clearance (an Antivirus scans the pass), the Desktop / Computer Bingo /
  the first truth hunt and Moment of Truth (B), the malware and the hour
  (C), Truth Pong / Trust Chart / the beans (D), the Y2K hour and the
  server room (E), the final reveal and endings (F), the awards ceremony
  (G). `Night.phase` / `Night.step` and the admin cues' `act:` lines track
  it.
- House-wide set pieces play in The Desktop room while the TV speaks the
  same lines aloud. Ambient barks, readouts and per-guest game notices
  share the rooms.
- Performers' current instructions live today in printed cast packs
  (`core/examples/trapped-in-the-internet/cast-packs/`), booth readouts,
  staff quests and Clippy's instruction Codex entries.

## Capabilities and Constraints

- Roles: guest, performer (booth), host, director phone
  (`/?role=director`), plus admin powers (the moderator passcode in a
  booth). **Decision (2026-10-20):** hosts are hosts by character, inside
  their own booth: the story marks Acrobat, Recycling Bin and Task Manager
  (`CHARACTER … admin: true`; never Clippy), and signing in as one gives
  that booth the host capability — the NEXT bar and the Cues · Needs ·
  Judge · People · More console — never the lifecycle or the god view.
  The user accepted the trade-off that whoever picks that part with the
  performer code becomes a host.
- **Decision (2026-10-20):** "can't miss" moments use every level (banner
  that times out, sticky banner until tapped, full-screen card until
  tapped, full-screen for everything), and the level can be switched live
  by the story or a host, with a glitch when it switches.
- **Decision (2026-10-20):** performers' per-act instructions, objectives
  and checklists are authored in the story (a new Loom surface), drafted
  from the cast packs, with the text signed off by the user.
- **Decision (2026-10-21, wave 18):** *"the Play app should feel more like
  a game than it does now for everybody"*. Mission is home; the tab is
  **Chats** (never the story's title); the lobby is a far-away Chat log,
  never where a moment sends you; big decisions are un-ignorable
  full-screen moments with their own buttons; navigation from every alert
  lands on the moment's own place; a Notifications tab (the Recycle Bin)
  with funny Win95 delete dialogs, where nothing is sticky.
- **Decision (2026-10-21, Q30):** a mark doesn't hinder; the Antivirus
  hunt from a Wanted board with pop-outs, and their scan is the
  confrontation. **Q26:** Windows Defender is gone; the four share the
  door. **Q2** (reversed in wave 21): Clippy calls its own games. **Q1:** hosts see and call the
  event equally from Play. **Q21:** sides are joined through doors, a
  member recruits by pass, guests may found crews, and joining never
  replaces the profile (the Me sheet). **Q16 dropped:** the reinstallation
  is a party favour after the end.
- **Decision (2026-10-23, wave 21, reverses Q2 / Q39):** Clippy and the
  Antivirus are players, not super-performers: Mission, goals, a score, a
  trust the story keeps hidden from them, awards of their own; every
  action a pick or a pop-out; no booth gets *All buttons…*, earlier
  readouts, gate chips or raw ids. The hosts keep their dock.
- Minimise scanning: scans are for clearance at the door and the
  confrontation; everything else is a tap.
- Typewriter: minimal for ordinary speech; exaggerated effects are wanted
  for effect text (alerts, glitches, takeovers).
- The pass QR and the QR scanner must be reachable in one tap from
  anywhere, for guests and performers.
- Devices: guests' own phones; performers' and hosts' own phones and
  house tablets (old Android; built for Chrome 87 / Safari 14 elsewhere in
  the stack); a laptop with the editor for the director as backup.
- Lifecycle controls (restart, push draft, go live, end), the free-form
  world var table and log export stay out of the Play app.
- Everything is computed from story state through the server's views
  (`GuestView`, `PrimeView`, `ModView`, `CueSheetView`), never stored in
  the client. Mod actions go through `/api/mod/*` and are journaled `by`
  the actor.
- Technical: React 18 + Vite, one stylesheet (`src/styles.css`) with CSS
  variables and themes (`plain`, `aol97`), no web fonts, vitest. The app
  also mounts embedded in shadow roots (`embed.tsx`).

## Brand Commitments

- *Trapped in the Internet*'s world: 1990s software as people (Clippy,
  Norton, Task Manager, a rogue AI called Trabolta), Win95/AOL97 chrome,
  Truthcoin, the Codex, the golden duck. The show uses `theme: aol97`.
- The Play app itself carries no show-specific branding: the story's
  title and theme come from the event (`title`, `theme`).
- Copy is the story's (authored `.loom` text); UI copy is plain, direct,
  short.

## Evidence on Hand

- The show: `core/examples/trapped-in-the-internet/` (main.loom, beats,
  cast, cast packs, DESIGN.md, OCT31.md, CHECKLIST.md).
- The user's source story docs: repo-root `Trapped In The Internet story/`.
- The 2026-10-20 UX mapping (scratchpad `ux/*.md`) and 107 phone-width
  screenshots of the live show from that day.
- Wave 18's two specs (GUEST-SPEC, BOOTH-SPEC), its six test reports
  (guest night, booth night, adversary, navigation matrix, old devices,
  code review) and the decisions in
  `core/examples/trapped-in-the-internet/SIGNOFF-w18.md`.
- Help articles bundled into the app: `docs/help/play/`.

## Product Principles

1. **The story is the operator.** What a phone shows comes from authored
   state (act, phase, objectives), not from hand-kept client lists.
2. **One glance, one tap.** Whoever holds the phone (a guest walking, a
   performer mid-scene, a host on stage) should see the one thing that
   matters now and act in one tap.
3. **Loud when it matters, quiet otherwise.** Beats interrupt, and
   everything else stays out of the way. Effect text performs; speech
   just reads.
4. **Never leave the app.** Every role, including the hosts running the
   night, has what it needs in the Play app.
5. **The interface is in the fiction.** Chrome, glitches and pop-ups belong
   to the 1990s computer the guests are trapped in.
6. **It's a game.** Home is a mission, not an inbox; big moments are
   events you can't miss; every alert has a way there.

## Accessibility & Inclusion

- Honour `prefers-reduced-motion` (the crawl shows at once; flashing and
  glitch effects have a still variant). The takeover's flash is a known
  discrepancy to decide.
- Touch targets ≥ 44 px for anything used on the night; readable in the
  dark at arm's length.
- Alerts must not rely on sound alone (iOS can't vibrate, and audio is
  locked until the first tap).
