# Wave 59 contract: the notes from the live run

2026-10-31. The user ran `w56` on the live server and sent a list of notes, then a
few more during the run. Wave 59 is those notes, built on wave 58's story. This page
is the map: what each lane changed, where its own contract or runbook lives, and the
order it ships in. Every word we wrote, every decision and its cost and what is
owed are on
[`SIGNOFF-w59.md`](../core/examples/trapped-in-the-internet/SIGNOFF-w59.md).

Branches: one lane each, `oct31-w59/<lane>`, merged on `oct31-w59/integrate` in the
order games, terminals, booth, costume, claims, qr, prompter, with wave 58's story
merged into `oct31-w59/story`. Not shipped. Nothing here has met a real phone, printer,
camera, tablet, iPad, Quest, TV or voice.

## The shape of it

| Lane | What changed | Lives in | Reaches the show by |
|---|---|---|---|
| **qr** | Every printed QR has a text code. Typing it does what scanning does. In-world names on everything a guest or a wall reads, and in his facts. `titi:qr-lock` | `core/server/routes/printed.ts`, `routes/k12.ts`, `core/src/in-world.ts`, `core/scripts/titi-qr-lock.ts`, `play/src/guest-scan-sheet.tsx`, `editor/src/lib/print-sheet.ts`; `core/CLAUDE.md`, *Text codes and in-world names* | `ship.sh`; a reload of every phone and terminal; the print after the sync; then the lock |
| **claims** | One holder: a part or a Person is one phone's. The refused screen, Ask a host for a performer too, ⏏ Release on a guest | `core/server/routes/rejoin.ts` (its header), `routes/n02.ts`, `play/src/held.tsx`, `play/src/rejoin-calls.ts`; `core/CLAUDE.md`, *One holder*; `docs/help/play/18-getting-back-in.md` | `ship.sh`; a reload. Tokens held on the preview at the ship count as held |
| **booth** | The filter's strength is only a slider. No director on anyone's People, only who is online, a host's Offline switch | `play/src/booth/filter/strength.tsx`, `core/server/unseen-directors.ts`, `core/src/host-board.ts`, `play/src/host/tab-people.tsx`; `core/CLAUDE.md`, *Directors stay unseen*, *Who is online* | `ship.sh`; a reload of every phone |
| **terminals** | `🔇 No ad sounds or bleeps`, the hidden ⚙, the tablets' feed with its readout | `terminal/src/sound/bus.ts`, `terminal/src/config.ts`, `terminal/src/camfeed.ts`, `terminal/src/software-canvas.ts`, `terminal/src/link-stats.ts`, `core/src/link-health.ts`; `docs/trapped/kiosk.md`, `docs/help/authoring/48-terminal-setup.md`, `TECH.md`, *The tablets' camera feed* | `ship.sh` for Run's readout; a reload of every terminal |
| **games** | Dialogue on top in VR, the run reset in both games, Gerald's body back in VR | `core/server/spatial.ts` (`runReset`), `reinstall/web/src/game/reset.ts`, `reinstall/vr/game/`; `docs/loom-reinstall.md`, `docs/help/play/11-reinstallation.md` | `ship.sh`; a reload of the web game and the tent; the Quest's APK re-exported and sideloaded |
| **prompter** | One shared position on the server, his lines wait for it, the lock, a small card for someone else's line, ▶ Let him speak, the handover at the end of her paragraph | `core/server/prompter.ts`, `play/src/aloud/`; [`loom-w59-prompter-contract.md`](./loom-w59-prompter-contract.md) (C1–C11), `docs/help/authoring/56-read-aloud.md`, `docs/help/play/07-performers.md`, `14-hosts.md` | `ship.sh`; a reload of every phone and the TV |
| **costume** | Task Manager's iPad 2: the keys, the menu, a narrow token, the 🎭 switch, the root profile and the relay | `core/server/costume.ts`, `core/server/costume-page.ts`, `core/src/costume.ts`, `costume.json`, `scripts/house-macbook/costume-root.mjs`, `costume-relay.mjs`; [`docs/trapped/costume.md`](./trapped/costume.md) | `ship.sh`; a reload of Run; the iPad's setup. `sync-show` for later menu edits |
| **story** | The two rooms renamed and their lore rewritten, the Act II heading, chat rooms opening on their beat, The Tube's card, `costume_flicker`, the handover, the guest-facing words | `main.loom`, `beats/`, `objectives.loom`, `codex/`, `house.json`, `house.shed.json`, `trabolta.persona.md`, `terminal/src/`; `core/CLAUDE.md`, *A room opens on its beat* | `ship.sh`, then `sync-show --replace-maps`; the MacBook's restart for his persona and guard |
| **fullscreen** | Play fills the screen on the first tap (`oct31-w58/play-fullscreen`, on `oct31-w59/base`) | `play/src/fullscreen.ts`; `play/CLAUDE.md` | `ship.sh`; a reload of every phone |

## The rules between lanes

- **A typed code takes the scan's road.** `printedHit` turns a code back into the link
  its QR carries, so whatever guards the link guards the code. One holder lives in
  `/api/guest/enter` and `/api/prime/login`, so a typed badge inherits it.
- **The house is one IP.** A wrong badge at `enter` or `rejoin` counts against nobody.
  `Rejoin.passesLockout` lets the guest code with a real badge, a real part or claim, or
  a name past a lockout, and any poll or cancel, so Ask a host always works. A guessed
  part or claim, a wrong event code and the crew's codes stay locked out.
- **The costume reads the shared prompter,** never a guess at a beat's length:
  `Prompters.inUse` refuses a press while his lines are waiting or going, a finger is
  down, or a phone shows the scene (within 12 s). A slow reader keeps it refused however
  long they take. A scene nobody opened refuses nothing once its lines are said, and a
  dead phone frees it in 12 s. The other reader, a press freed 20 s after the last move,
  is gone: it let a press cut across a reader who had simply stopped to speak.
- **A story restart frees guests and leaves booths.** Only Go live frees every part, or
  a sync's reload would sign all eight staff phones out (`SIGNOFF-w59.md`, D-1).
- **A printed name is a contract.** Rooms, signs, parts, reserved programs and codex
  codes move only with a reprint. `oct31-w59/story` settled the two room names and The
  Tube before the lock was written, so the lock comes last, after the print.
- **Hidden ids stay.** `steam-room`, `graphics-card`, `steam-1`, spots and fixture names
  are ids, not words. Check-ins, clues and props stay in the same physical rooms.

## Ship order

One release and one sync with wave 58: `SHOWNIGHT.md` §1, *Landing wave 58 and wave 59*.

1. H1–H3's answers in `facts.json`, `titi:facts`, commit (wave 58).
2. `scripts/ops/predeploy.sh --vr`, and push: `ship.sh` needs the commit on origin.
3. The preview's roster, in its own step. If anyone is on, ask first.
4. `LOOM_VPS=loom-vps scripts/ops/ship.sh show-1031`, then `/api/health` and
   `deploy/release.sh --check-env`. Stop if it fails.
5. The morning reset: ⏸ Pause, Download JSON any map edits, `pnpm sync-show
   --replace-maps` with its reload, Push draft, Go live in place. Any later sync is plain.
6. The MacBook: `git pull`, `launchd restart --job agents`, Run → Mind → Reset.
7. Reload every phone, terminal, the TV, the tablets, the tent, the web game and any open
   Run tab, before the booths sign in at 17:00.
8. The Quest: re-export and sideload on every headset. A new APK on an older server resets
   the player but not Gerald.
9. The iPad, early: `docs/trapped/costume.md`. At the first sign of trouble, the relay.
10. The print: settle, ship, sync, print. Then `pnpm --filter @loom/core titi:qr-lock`, and
    commit `qr-lock.json`.
11. Reprint `clippy`, `crew/director`, `crew/second-director`, `crew/house-manager`,
    `crew/tech-operator` and `all-crew`.
12. Rehearse the checks on `SIGNOFF-w59.md` §5, scratch server first, then the preview.

The Desktop needs nothing new from this wave.

## Tests

Each lane's own: `core/test/w59-printed.test.ts`, `w59-qr-lock.test.ts`, `w59-claims.test.ts`,
`w24-directors-unseen.test.ts`, `spatial-reset.test.ts`, `w59-prompter.test.ts`,
`w59-prompter-server.test.ts`, `w59-costume.test.ts`, `w59-costume-page.test.ts`,
`w59-rooms-open.test.ts`, `trapped-w59-signoff.test.ts`; `terminal/test/w59-bleeps.test.ts`,
`w59-link.test.ts`, `minimap.test.ts`; `reinstall/web/test/reset.test.ts`, `duck-seen.test.ts`;
`play/test/w59-prompter.test.tsx`; `scripts/sim/prompter.spec.ts`, `handover.spec.ts` (real
pages, on a scratch server; run them on separate servers, because the handover spec leaves
Task Manager an unread script). `pnpm sim` must go 24/24.
