# Trapped in the Internet: the work schedule

> **After the party (2026-10-24).** This is the post-party / next-run
> roadmap; the wave notes below are build history. For the night use
> [`SHOWNIGHT.md`](./SHOWNIGHT.md) and [`TECH.md`](./TECH.md). Waves 18b
> Stage B, 19, 20, 20b, 21 and 22 are all merged on master; only 19 is
> shipped (inside `w18b-1021`).

> **🎃 The party is Sat Oct 31, 2026 (set 2026-10-15, 16 days out). The active plan is [`OCT31.md`](./OCT31.md)**: 29.6 lane-days of minimal slices in 4 lanes (27.6 committed + 2.0 conditional for iPhone push), gates Oct 18 / 20 / 21 / 22 / 23, push call Oct 24 12:00, run-through Oct 25, freeze Oct 27, tech 10-28, dress 10-29, code freeze 10-30. **This schedule is now the full post-party / next-run roadmap.** Anything OCT31.md builds counts as done here; everything else stays as planned below. **Oct 31 wave 1 is merged to `master` (2026-10-15, not yet deployed to the VPS):** 37 builds, each a minimal slice (OCT31.md §5 *Wave 1 status*); the CHECKLIST items they advanced carry an "**Oct 31 wave 1:**" note, and the WPs below still own whatever each slice left out.
>
> **What OCT31.md pulled in** (as minimal slices, `K-xx` / `N-xx` ids in OCT31.md §5):
> - **MUST:** WP-01 (K-01) · SP-1 (K-02) · WP-48 (K-03, K-30 Quest time-boxed) · WP-42 (K-04) · WP-39 + WP-40 link (K-05) · WP-10 (K-06) · WP-24 (K-07) · WP-62/63/64 (K-08 + the rehearsals, + K-32 the pre-freeze load test and the show-night backups / warm standby) · WP-61 uplink plan (ops: the LTE failover router B-9 + OP-16).
> - **Cheap wins:** WP-02 (K-10, K-11) · WP-08 (K-23, K-24) · WP-13/14/15 + SP-2 (K-31a push for Android + booths, K-31b iPhone Home Screen, conditional; decision #25) · WP-17 (K-27) · WP-18 + WP-26 + WP-29 (K-16: a 2 s lean poll instead of ScreenHub) · WP-20 (K-13) · WP-23 (K-12) · WP-27 (K-14, K-15) · WP-28 + WP-30a (K-17, K-29) · WP-33 (K-18) · WP-34 (K-19) · WP-37 (K-20, house speakers only) · WP-40 (K-22) · WP-46 (K-28) · WP-50 (K-26) · WP-51 (K-25, story beats) · WP-57 (K-21). Plus 8 walk-through fixes N-01…N-08 and N-10 (release a performer's part, SW-ADM-16, from the show-safety critic pass) (new checklist items SW-PLAY-25/26/27, SW-ADM-15, SW-SCR-30/31/32, SW-STORY-17/18, SW-AI-23, SW-OPS-22/23, HW-AUD-16, HW-SAFE-06). The two OCT31 critic passes (2026-10-15 evening) added SW-ADM-16, SW-OPS-24, SW-AI-24 (⭐ N-11), HW-SAFE-07/08/09, HW-NET-08, HW-LIT-09 and HW-AUD-17. They are Oct 31 slices; after the party each folds into its WP (SW-ADM-16 → WP-57, SW-OPS-24 → WP-64, SW-AI-24 → WP-42, the HW items → H-packages for lights, network, audio and safety).
> - **Run on a workaround on Oct 31** (OCT31.md §9, W-01…W-34): WP-03, 04, 05, 06, 07, 09, 11, 16, 19, 21, 22a, 25, 30b, 31, 32, 35, 36, 38, 41, 43, 47, 49, 52, 53, 54, 56, 58, 60, 65. **After the party:** WP-12, 22b, 44, 45, 55, 59.
> - **Oct 31 wave 2 (merged 2026-10-15, not yet deployed; OCT31.md §5 *Wave 2 status*):** WP-34 is dropped (native device voices). Built but not yet ✅ (device checks open, so not ticked): WP-03 (SW-MAP-01, SW-MAP-06), WP-45 at minimal scope (SW-MAP-03, SW-MAP-09), WP-47's switch half (SW-MAP-13 + `house.shed.json`; the survey and the drill remain), WP-46's story half (SW-MAP-07 on the placeholder; SW-MAP-02 remains), SW-RE-14 from WP-49.
> - **Oct 31 wave 3 (merged 2026-10-15, deploying with waves 1–2; OCT31.md §5 *Wave 3 status*):** WP-46's story half is done (SW-MAP-07 ✅: the real house's 17 rooms on a 3-floor placeholder, final ids). SW-MAP-02, the survey, now only corrects footprints, positions and elevations, and a stacked stairwell must be drawn side by side or end to end (`validateHouse` refuses overlapping flights). Built but not yet ✅: WP-06's engine half at minimal scope (SW-ENG-03: INTERACTION `while:` + `by:`; the show's buttons carry them, nothing enforced; `while:` is per booth, not per guest) and WP-31's Trust Chart half (SW-SCR-11: the live `chart` on `/api/screen/state`, no bottom-up reveal). The show's rooms are renamed (The Optical Drive, The Start Bar, The RAM, `# clipboard`) and five hidden rooms were added; the WIP demo script is [`DEMO.md`](./DEMO.md).
> - **Oct 31 wave 4 (built 2026-10-16, committed as 9d35a4b, not deployed; OCT31.md §5 *Wave 4 status*):** the user's 18 asks of that day. WP-08's judge half is built, differently from the plan (SW-AI-20 🟡: a server judge keyed from the team's `facts.json`, no `QUESTION` declaration — SW-ENG-17 stays open; SW-STORY-16; SW-PLAY-24 with the confidence slider and per-round cards); WP-60 is built (SW-PLAY-08 🟡 the Truthcoin Wallet room — no wager; SW-PLAY-09 🟡 the pickup-line `answer` card); WP-16's judging UI exists as Run → Mind's Judging card (SW-ADM-13 note); WP-56's disarm moved into the simulation (the King on the tent tablet, SW-KING-01..05; SW-CHESS-05/08 stay the phone fallback, U17); WP-11 gained the tutorial's Bathroom Mode step; the hat is retired (🍾 the bottle), the tent voice is the Installation Wizard (SW-RE-04), `alexa_chime` is `announce_chime` (HW-AUD-02). New checklist rows: SW-FACTS-01/02, SW-WALLET-01..03, SW-MARK-01, SW-KING-01..05. **The team's content work is dated under [*Oct 31 authoring tasks*](#oct-31-authoring-tasks-added-2026-10-16-wave-4).**
> - **Oct 31 wave 5 (built 2026-10-16, committed as 85d2bad, not deployed; OCT31.md §5 *Wave 5 status*; wave 6, the live-test bug fixes, is merged on top, *Wave 6 status*):** the stock-take of every item still open after wave 4. Built but not yet ✅ (device checks open): WP-09's phone half (SW-PLAY-04 🟡: a `!!` pin is the full-screen takeover, retracted by the story at the dance; SW-ENG-13 stays open) · WP-11's timeout (SW-PLAY-16 🟡: Bathroom Mode ends after 15 min, never in the summons phase; SW-ADM-08's away panel stays open) · WP-14's Safari handoff (SW-PLAY-21 🟡, behind `LOOM_HOMESCREEN`, off) and SW-PLAY-20's deep links + dynamic manifest · WP-05 loses SW-ENG-08 (dropped: booth cues ride the Enforcer readouts, so WP-15 no longer waits on it) · WP-31's Trust Chart reveal (SW-SCR-11: bottom-up + the most / least trusted call-outs; the synced video stays open) · WP-58 at minimal scope (SW-ADM-02 🟡: the play app's `/?role=director` phone cue sheet) · WP-40's restart catch-up (SW-SH-10 🟡: stagehand catches the lights up on reconnect and restart) · N-04a prebuilt (SW-SCR-32 🟡, inert until an mp4 is there) · the K-32 contingency built and off (SW-OPS-24, `LOOM_SNAPSHOT_MS`) · WP-23's print page gained a door sign, cast cards and sorted codex stacks (SW-QR-11, SW-FACTS-02) · WP-50's recap gained shares, chess and bathroom trips (SW-AI-17; lines sent and bathroom minutes stay with WP-07) · WP-16's provenance view (SW-ADM-13) · W-24 got award suggestions only (SW-ADM-12; the CeremonyHub stays post-party) · the wallet's loose ends + Runescape's grant and freeze (SW-WALLET-01/02/03) · the King retuned (hp 8, 2 s; SW-KING-01..04) · SW-AI-10 and SW-AI-02's world filter (render / find gating stays with WP-08) · SW-SCR-21's heartbeat extras + identify (media ready + remote reload stay with WP-28) · W-15 at minimal scope (SW-SCR-20 / SW-MAP-11: 2 s holds + the map passcode; the author-session map auth + PIN stay with WP-22b). WP-60's wager is dropped for good (bets settle with Request / Send). SW-AUD-10's bench page is cut to W-16 (TEST VOICE + CHIME).
> - **Oct 31 wave 7 (built 2026-10-17 on `oct31-w7/*`, merged, not deployed; OCT31.md §5 *Wave 7 status*):** the server-room door gets a real **standalone keypad lock** (outside only; set by hand to `facts.json` `door.code`; the inside handle always opens), the sensor becomes **wire loops that touch when the door opens**, and **the chess disarm window is gone**: a checkmate from the Y2K hour, the riddle on the keypad sign or the majority gives a program the code, the door opening plays The Heart (never an alarm), and a server-room terminal lets a program talk Trabolta down. The rows below that still say "90 s", "reed (primary)", "no maglock … indicator only" or "the chess disarm rule" are annotated *(wave 7: …)*, not rewritten: this file is the post-party roadmap.
> - **Oct 31 wave 11 (built 2026-10-18 on `oct31-w11/*`, merged, not deployed; OCT31.md §5 *Wave 11 status*):** **the chess phone is retired** (HW-CHESS-01, U17): the King is played only on the **Server Door** wall terminal outside the server-room door (`terminal` `view=chess`), awake all night with no hints, and a checkmate before 📄 gives *The Door Code*. Neither the tent tablet nor a headset plays chess any more; there every program may hit his shared 15-point bar once per reinstallation visit. The riddle is no longer a path to the code: four secret digit notes are. SP-5, H-13 and the other chess-phone rows below are history.
> - **Oct 31 wave 20 (built 2026-10-22 → 23 on `oct31-w20/*`, merged into `oct31-w20/integration`, not merged to master or shipped; OCT31.md §5 *Wave 20 status*, `CONTRACT-w20.md`, `SIGNOFF-w20.md`):** Trabolta's heart — **H-06's door changes**: the sensor is an LED + LDR on a **Grand Central M4** on Steph's laptop, read by the server-room terminal over Web Serial (HW-DOOR-10 / 11 replace the ESP32's reed / copper tape, D16); **H-05 gains the server room's RGB bulb** (HW-LIT-10, driven from `lights.json` by the stagehand `lights` module, SW-SH-14, on the user's CC2652P coordinator); the four-layer talk and the heart to heart wait on the sign-off (SW-STORY-19). Order for the last week: the show text sign-off (Q1–Q10) → the server ship → the house Mac (`show` restart before the sync, then Zigbee + the `lights` job) → `sync-show` → Steph's laptop (flash, N-20 bench, kiosk, port grant, calibration) → the pre-doors open / shut check.
> - The checklist tags every item 🎃 / 🩹 / ⭐ / 💤 for Oct 31. Decisions #1–#12 are approved, #25 and #33 are final, and #28 is answered (Sandy is lore, optional cutscene); the "Decisions still open" table below is historical. #35 (a hosted-model fallback for Trabolta) was answered 2026-10-15: **no** (OCT31.md §12).

This is the order in which the open work in [`CHECKLIST.md`](./CHECKLIST.md) gets built, from today to show-ready. It covers every open **P0** and **P1** item (software and hardware) and the two P2s that a P1 needs. Every open P0/P1 id (`SW-*` / `HW-*`) sits in **exactly one** package below. The story is spec'd in [`DESIGN.md`](./DESIGN.md), and the runbook is [`README.md`](./README.md).

**Built 2026-10-15, final after three critic passes (ordering, coverage, reality check against the code).** Inputs: the checklist (302 items after this review), the binding answers to "Decisions needed" #13–#34, and the session's dependency graph. The designs behind the bigger packages — chess phone, room-audio router, push / ceremony / DM lies, screens, QR, floor plan, Trabolta's arc, stagehand + hardware — are kept in [`docs/trapped/`](../../../docs/trapped/). There are 67 software work packages (WP-01…WP-65, with WP-22 and WP-30 split into a/b), 2 stand-alone spikes (SP-1, SP-2) and 15 hardware/production packages (H-01…H-15). Owner: `@__`

**This schedule is living:**

- Tick a WP when every item in it is ✅ in the checklist.
- Re-plan at every gate (G0–G5): move the remaining WPs, re-check the "Needs" column, and re-date the line above.
- The party date isn't set yet, so everything is counted in **working days from the start of work** (day 0). A week is 5 dev-days per lane.
- **Set the party date by day 7.** The invitations go out around day 10. Then apply [the cut table](#if-the-party-is-in-n-weeks-cut-here).

---

## The plan on one screen

| | |
|---|---|
| **Software** | **245.5 dev-days** in 67 WPs + 2 spikes: 131 days of P0 and 114.5 of P1. Three P1 packages gate a P0 one (WP-17, WP-21, WP-38), so **140 days are effectively P0**. |
| **Hardware + production** | ≈ 48 person-days (H-01…H-15, every open HW id mapped in [the HW table](#package--hw-ids)). Most of the wait is sourcing, shipping and creative work, not effort. It runs in a [parallel lane](#the-non-software-lane-you--friends) for you and friends. |
| **How it's built** | One developer (you) runs **4 Claude Code lanes** (A–D). Each lane is one agent session in its own git worktree, keeps one package context warm, and merges daily. You integrate, test on devices and run the gates. |
| **Critical path** | Unlimited lanes: ≈ 22 days. With real lanes the plan is **capacity-bound**: the four lanes end within 3 days of each other (A 60 · B 61 · C 61.5 · D 63). [Three chains to protect](#chains-to-protect): print (day 34.5), house → VPS link (day 39) and screens (day 37). |
| **All P0 software** | **Day 41** (week 9). Then gate **G2**: tech rehearsals plus **live-preview night #1** at the end of week 9 (day 45). |
| **All P1 software** | **Day 63** (week 13). Then gate **G4**: feature freeze. |
| **Show-ready** | **Day ≈ 67** (week 14): dress rehearsal, code freeze, pinned deploy. With a **20% buffer**, plan for **week 16–17**. |
| **With fewer lanes** | 3 lanes: all software ≈ day 85 (show-ready ≈ week 18). 2 lanes: ≈ day 125 (≈ week 26). 1 lane: 245.5 days (the effective P0 alone is 140). |

**Why this order** (each point is a dependency, not a preference):

1. **Wave 0 (week 1): HTTPS on the VPS, the right public URL, codes and identities that survive a restart, and the cheap spikes** (WP-01, WP-02, SP-1, SP-2, plus spikes folded into WP-01/36/48). Nothing below can be verified without a secure context: the camera, wake lock, push and the Quest need one, and every emailed or printed link needs the right base URL. The spikes test the riskiest assumptions on real hardware before anything is built on them (old tablets, iOS push, Kokoro on the VPS, the 16-out interface, the Quest APK).
2. **Then the Loom language and the Play app, as you asked, P0 first.** Lane A: scopes → QUESTION + DM judge + secrecy → takeover → performer comms → the small story pass → timers → INTERACTION 2.0 → judging UIs. **Every language WP swaps its own story workarounds as it lands** (+0.5 day each), so there's no big-bang story rewrite. Lane B: the Play platform (featured claims → printables → push → PWA → QR check-in → badges → the print page).
3. **The print run (WP-24, day 33–34.5) waits for the install-first PWA (WP-14) and the content review (WP-17).** An iPhone Home Screen app doesn't share Safari's storage, so a native-camera scan of a room sign lands in the wrong browser. The in-app scanner is the only path, and that changes the signage wording.
4. **Lane C starts with the old-Android bench (SP-1)**, so no terminal UI gets built for tablets that can't run it. ScreenHub follows on day 3. Every screen, overlay, template, the TV voice and the audio sync clock hang off it.
5. **Lane D does one thing at a time:** media + TTS on the VPS, then the Quest APK on day 10.5 (the tent's riskiest unknown, retired by day 14.5), then the stagehand block (house YAML → scoped tokens → house → VPS link), then the map block, then chess.
6. **Within a lane, the most cuttable work comes last.** Cutting is then just stopping a lane early (see [the cut line](#the-cut-line)).

---

## How to run it

- **Units:** ideal dev-days of focused agent and developer work (S ≈ 0.5–1, M ≈ 2–3, L ≈ 4–6). The reality pass re-estimated 14 packages against the code. Language WPs carry a ≈ 0.5-day "language tax": the parser decl kind, keywords, LSP, highlighter, a bank "ignored" diagnostic, a help article and the writer's guide.
- **Local-Sim parity rule:** language features (scopes, QUESTION, INTERACTION 2.0, timers, takeover, AWARD) must run in the editor's local `Sim` too. `store/sim.ts` reuses `views.ts`, so most of that is free, and the estimates include the direct calls. **Server-only** (on a local folder, Run shows "needs a server project"): push, the PWA, check-in scans, printables and device tokens, the recap and the ceremony.
- **Lanes own packages**, which keeps merge conflicts down and context warm:

| Lane | Home | Typical files |
|---|---|---|
| **A · Language → Play → Story → Trabolta** | `core/src` (sim, model, statements), `play` guest/performer, the story `.loom`, `stagehand/agents` | `sim.ts` (grep with `-a`), `model.ts`, `statements.ts`, `views.ts`, `answers.ts`, `play/src/widgets.tsx`, `./*.loom` |
| **B · Platform → Push → QR → Admin** | `core/server` (new modules), the `play` shell, the editor's Run mode | `push.ts`, printables, `identity.ts`, `play` PWA/scanner, `editor` cockpit/Print/Ceremony |
| **C · Screens + Audio** | `terminal`, `core/server/screens.ts`, `stagehand` audio | `terminal/src/screen/*`, `stagehand/src/stagehand/audio/*` |
| **D · Media/TTS → Quest → Stagehand → Map → Chess** | `core/server` media + tokens, `reinstall`, `house`, `stagehand/show`, `chess/` | `server.ts` media route, `reinstall/web/src/map/*`, `trapped.house.yaml`, `show/*.py`, `chess/` |
| **Ops** (you) | the runbook, rehearsals, deploy | — |

- **Conflict hotspots:**
  - **`core/server/event-runtime.ts`**: all four lanes add routes to it. Put new logic in new modules (`push.ts`, `screens.ts`, `answers.ts`, `recap.ts`, `ceremony.ts`, `tokens.ts`) with a thin route each, and rebase every lane daily.
  - **`play/src/session.ts` + `guest.tsx`**: lane B edits them in WP-14/20 (days 17.5–25.5), lane A in WP-09/10 (days 14.5–22.5). Land lane A's widget/overlay work behind its own component first, and merge B → A daily during that window.
  - **The story `.loom` files**: lane A owns them. The cue rename (WP-39, lane D) and the `found at` gates (WP-19, lane B) are mechanical one-commit edits. Rebase them onto lane A's tip and run `loomcheck` before merging.
- **Your review load is the real limit.** If you can't keep up with four lanes, drop to three by folding lane D into C after G2. That costs about 3 weeks (see the cut table).
- **Every WP ends green:** `pnpm --filter <pkg> test`, and `uv run pytest` for stagehand. Run `loomcheck` whenever a `.loom` file changes. A WP marked **live** in its acceptance check also needs a real-device check.

---

## Milestones at a glance

| Milestone | Weeks | Days | Software dev-days | Cumulative | Ends with |
|---|---|---|---|---|---|
| **M0 Foundations + spikes** | 1 | 0–5 | 20 | 20 | **G0**: the rewritten story runs on the public HTTPS preview; the spike results are in |
| **M1 Language + Play foundations, invitations out** | 2–6 | 5–30 | 100 | 120 | **G1**: a Run-mode rehearsal of the new language, a push to a locked phone on cellular, the house talking to the VPS |
| **M2 Print run → all P0 → night #1** | 7–9 | 30–45 | 60 | 180 | **G2**: tech rehearsals in the house, plus **live-preview night #1** with friends |
| **M3 P1 fidelity** | 10–11 | 45–55 | 40 | 220 | **G3**: **live-preview night #2** (the whole story), then the language freezes |
| **M4 Ceremony + polish** (the cut zone) | 12–13 | 55–63 | 25.5 | **245.5** | **G4**: all P1 done, then the feature freeze |
| **M5 Dress rehearsal + freeze** | 13–14 | 63–67 | — (ops) | 245.5 | **G5**: dress rehearsal → code freeze → pinned deploy = **show-ready** |
| Buffer (recommended) | 15–17 | 67–82 | — | — | slack for bugs found at G2–G5, and weeks lost to holidays |

If work starts on Monday 2026-10-19: G0 = Fri 2026-10-23, invitations ≈ Mon 2026-11-02, G1 = Fri 2026-11-27, print run ≈ Thu–Fri 2026-12-03/04, **G2 = Fri 2026-12-18**. Weeks 10–11 fall on Dec 21–Jan 1. Counting them as half weeks: G3 ≈ Fri 2027-01-08, G4 ≈ Wed 2027-01-20, **G5 ≈ Fri 2027-01-29**.

### The four lanes (start–end, in dev-days)

| Lane | Order | Ends |
|---|---|---|
| **A** | WP-05 (0–6.5) · SP-2 (6.5–7.5) · WP-08 (7.5–14.5) · WP-09 (14.5–19.5) · WP-10 (19.5–22.5) · WP-17 (22.5–25.5) · WP-07 (25.5–31.5) · WP-06 (31.5–38) · WP-16 (38–42.5) · WP-50 (42.5–46) · WP-12 (46–48.5) · WP-51 (48.5–52.5) · WP-53 (52.5–55.5) · WP-43 (55.5–60) | 60 |
| **B** | WP-01 (0–3) · WP-02 (3–5.5) · **WP-04 (5.5–10)** · WP-19 (10–14.5) · WP-13 (14.5–17.5) · WP-14 (17.5–21.5) · WP-20 (21.5–25.5) · WP-21 (25.5–28.5) · WP-23 (28.5–33) · **WP-24 (33–34.5)** · WP-15 (34.5–39) · WP-22b (39–41) · WP-11 (41–44.5) · WP-65 (44.5–47.5) · WP-59 (47.5–50.5) · WP-58 (50.5–53) · WP-52 (53–56.5) · WP-60 (56.5–61) | 61 |
| **C** | SP-1 (0–1) · WP-18 (1–3) · WP-26 (3–8.5) · WP-36 (8.5–15) · WP-27 (15–18.5) · WP-28 (18.5–24.5) · WP-29 (24.5–29) · WP-35 (29–34) · WP-38 (34–37) · WP-30a (37–39.5) · WP-31 (39.5–43) · WP-33 (43–48) · WP-37 (48–52.5) · WP-54 (52.5–55) · WP-30b (55–58) · WP-32 (58–61.5) | 61.5 |
| **D** | WP-03 (0–3.5) · WP-25 (3.5–7.5) · WP-34 (7.5–10.5) · WP-48 (10.5–14.5) · WP-39 (14.5–18.5) · WP-22a (18.5–21) · WP-40 (21–27.5) · WP-44 (27.5–30) · WP-46 (30–33) · WP-47 (33–37.5) · WP-57 (37.5–41) · WP-42 (41–42.5) · WP-55 (42.5–45) · WP-56 (45–51) · WP-49 (51–54.5) · WP-45 (54.5–59.5) · WP-41 (59.5–63) | **63** |
| **Ops** | WP-61 (37–39) · WP-63a tech rehearsals (41–42.5) · WP-62 (42.5–46) · WP-63b dress (63–65.5) · WP-64 (66–67) | ≈ 67 |

A lane simulation (planning session, not kept) checked that every start respects the WP's hard dependencies. A **bold** WP is a calendar gate: invitations go out after WP-04, and the print run is WP-24. The order of each lane's tail follows the cut table, with one exception: WP-52 waits for WP-51, so WP-59/58 fill the gap before it.

### Chains to protect

1. **Print:** WP-01 → SP-2 → WP-13 → WP-14 → WP-20 → WP-23 → WP-24, plus WP-19 → WP-21 → WP-23 and WP-08 → WP-17 → WP-24. The print run is on day 33–34.5, with ≈ 10 days of slack before night #1.
2. **House → VPS link:** WP-01 → WP-19 → WP-22a → WP-40 → WP-61. Scoped device tokens exist server-side by day 21, the link by day 27.5 and the uplink plan by day 39.
3. **Screens:** SP-1 → WP-27 → WP-28 → WP-29 / WP-35 / WP-38. All P0 in lane C is done by day 37. Lane C ends 1.5 days before the binding lane D.

---

## Week-1 spikes (de-risk before building)

None of these is a checklist item of its own. Each is the **first step** of the item named, and its result goes into that item's line in the checklist.

| Spike | Where · days | First step of | What it answers | Decides |
|---|---|---|---|---|
| **SP-1** Old-Android bench | C · 0–1 (own row), then you run it on every tablet as it arrives | HW-SCR-06/08, SW-SCR-28 | A probe page (deployed with WP-01) reports: system WebView/Chrome version, WebGL2, Wake Lock, `structuredClone` (Chrome 98+; used by `house/src/validate.ts:72` and the reinstall map), autoplay with Fully Kiosk vs plain Chrome, `speechSynthesis`, H.264 720p decode, EventSource over the VPS, camera + jsQR, WASM SIMD (for the chess phone's Stockfish lite), and whether Fully Kiosk installs at all | The build target (chrome64 vs chrome87) and which tablets are world-view vs face/signage-only. A tablet without WebGL2 gets the Canvas2D attract screens |
| **SP-2** iOS PWA push prototype on the VPS | A · 6.5–7.5 | SW-PLAY-20/21 | Push reaches only a Home Screen app, and permission must come from a tap inside it. Every push must show a notification (Safari revokes subscriptions that get silent pushes), so the "app is visible" rule must stop the **server** from sending. Also: `getUserMedia` in standalone mode (camera re-prompts) and the Safari → Home Screen storage split. Try it on 2–3 iOS versions over cellular | WP-13's send rules and WP-14's door wording, both before any signage is printed |
| SP-3 TV-computer audio | inside WP-36 (C · 8.5–9.5) | HW-AUD-07/08 | Can PortAudio open the 16-ch interface while Chrome (`setSinkId`) plays to channels 1–2 of the same CoreAudio device? Does the living room come from HDMI or the interface? | The router's device model; whether H-03 needs a DA converter |
| SP-4 Kokoro on the chosen VPS plan | inside WP-01 (B · 0–3) | SW-OPS-20 | Latency per line, plus CPU contention with the Node event server and Postgres during announcement bursts. Put CPU limits on the Kokoro compose service | The VPS tier, locked on day 3 |
| SP-5 Chess phone | inside SP-1 | HW-CHESS-01 | Does Stockfish lite (WASM SIMD, Chrome 91+) run, or only the 3.1 MB asm.js fallback? | Which found phone becomes the chess phone (Android 8+) |
| SP-6 Quest APK | inside WP-48 (D · 10.5–11.5) | SW-RE-01 | `export_presets.cfg` has a Quest preset, but no APK has ever been built. It needs the Android SDK, the OpenXR vendors plugin, a keystore and Meta developer mode, then a connection to the VPS over HTTPS | Whether H-08 is on track |
| SP-7 Mod-feed bandwidth | inside WP-40 | SW-OPS-21 | Measured: GuestView ≈ 8.2 KB (fine), PrimeView 17 KB, **ModView ≈ 196 KB re-sent to every mod client on every story step** | The lean mod stream (SW-OPS-21, P0) |
| SP-8 Caddy SSE | inside WP-01 | SW-OPS-18 | `encode gzip zstd` sits in front of `reverse_proxy loom:7000` in `deploy/Caddyfile`. Does it buffer `text/event-stream`? If so, exclude that type. Server pings are every 25 s | The Caddyfile |

---

## M0 · Foundations + spikes (week 1, days 0–5)

**Goal:** a real HTTPS URL running the rewritten story, the spike answers in hand, and the first package of each lane started.

| WP | Lane · days | Items | Needs | Why now | Done when (acceptance) |
|---|---|---|---|---|---|
| **WP-01** Go public: preview, real URL, HTTPS on the VPS (+ SP-4, SP-8) | B · 0–3 (3 d) | SW-STORY-06, SW-STORY-12, SW-QR-01, SW-QR-15, SW-OPS-02, SW-OPS-03, SW-OPS-15, SW-OPS-20 | the VPS plan (H, day 0) | Unblocks every real-device test, every printed or emailed link, the invite site and the SP-1 probe page | `https://<app>` serves with a valid cert; the Run → Join QR encodes `LOOM_BASE_URL` (a unit test on `joinBase`); `loomcheck` runs in CI; the invite site is live on the apex; SSE passes Caddy unbuffered (a `curl -N` sees each 25 s ping on time); Kokoro latency per line is recorded and the VPS tier is locked; a phone **on cellular** joins the rewritten story |
| **WP-02** Codes and identities that survive | B · 3–5.5 (2.5 d) | SW-QR-02, SW-QR-03, SW-QR-17 | — | The invitation email carries the codes. Identity-across-restart has to be settled before PushHub binds to it | A core test shows End → relaunch keeps the event and prime codes; the 9th miss in a minute gets a 429 and isn't journaled; after `restart()` the same guest token still reads its own `GuestView` with the same person id |
| **WP-05** Engine: scopes, membership, ranking (+ story swap) | A · 0–6.5 (6.5 d) | SW-ENG-01, 02, 04, 05, 08 | — | The first language piece. The staff scope is a hard dependency of performer push and the private channel; the ranking feeds AWARD, the Trust Chart and the recap. Re-estimated 4.5 → 6: `staff(G)` must resolve characters to `@<Character>` audience tokens, and `for everyone` is a **standing grant** that has to replay deterministically for late arrivals | Core vitest: `unlock … for group(G)` / `for everyone` reach the members without leaking narration; `start quest … for everyone` reaches a guest who joins later, and still does after a restart (journal replay); `move who to {expr}` interpolates; personas are excluded from `Persons`; `len` / `max` / `top()` / `bottom()` work; joining a hidden or `joinable: false` group gets a 403; `broadcast … to staff(X)` reaches booths only. **Story swap:** the per-member watchers, the quest catch-up watchers, the check-in if-chain and the argmax watchers are gone, and `loomcheck` is clean |
| **WP-03** The map belongs to the project | D · 0–3.5 (3.5 d) | SW-MAP-01, SW-MAP-06 | — | Must land before anyone spends a weekend surveying | Save in `/reinstall/map` → End → relaunch → the map is still there (core test + manual); the LOCATION picker lints "no room for X" |
| **SP-1** Old-Android bench | C · 0–1 (1 d) | — | the tablets you have; an Android Studio emulator with an old system WebView | The first step of HW-SCR-06/08 (H-01). Lane C builds nothing for tablets that can't run it | The probe page is deployed and a results table exists in the checklist under HW-SCR-08 (one row per device); the build target is proposed |
| **WP-18** Trabolta stays hidden on terminals and the server | C · 1–3 (2 d) | SW-SCR-01, SW-SCR-02, SW-AI-12 | — | P0 secrecy (#32), needed before any terminal goes on a wall. Re-estimated 3 → 2 (one poll + one branch in `terminal/src/app.tsx:364-406`, one guard in `agents.ts`) | Terminal test: while hidden, the terminal shows attract mode, never "TRABOLTA ONLINE", and doesn't pilot into `dm:Trabolta`. The check reads **the scanned guest's own visibility** (reveals can be per person, `reveal X for who`), not a global flag. Core test: agent dispatch is refused for a hidden character |
| WP-26 ScreenHub + server clock *(starts)* | C · 3–8.5 | see M1 | — | | |
| WP-25 Media route + video players *(starts)* | D · 3.5–7.5 | see M1 | WP-01 | | |

**Gate G0 (end of week 1):** the rewritten story is live on the public HTTPS preview, and a friend on cellular registers from an emailed link. The codes survive End → relaunch, and identities survive a restart. SP-1 has proposed a build target, the VPS tier is locked (SP-4), and the Caddy SSE question is closed (SP-8).

---

## M1 · Language + Play foundations, invitations out (weeks 2–6, days 5–30)

**Goal:** the P0 language and Play work is done, the Play app is installable and pushable, room check-in works, the first screen and the first room-audio cue work, the house talks to the VPS, and the **invitations go out around day 10**.

| WP | Lane · days | Items | Needs | Why now | Done when |
|---|---|---|---|---|---|
| **SP-2** iOS PWA push prototype | A · 6.5–7.5 (1 d) | — | WP-01; 2–3 iPhones | The first step of SW-PLAY-20/21 (WP-14). Its answers shape WP-13/14 and the door sign | A Home Screen app on 2–3 iOS versions gets a visible push on a locked phone over cellular; the send rules and the camera behaviour in standalone mode are written into SW-PLAY-20 |
| **WP-08** QUESTION key + DM filing judge + answer secrecy + the secrecy fix + File a fact | A · 7.5–14.5 (7 d) | SW-ENG-17, SW-AI-20, SW-AI-21, SW-AI-02, SW-PLAY-24, SW-STORY-16 | — | The P0 secrecy guard (#33). The code half of SW-AI-02 (`facts.py:96-211`, `orchestrator.py:259-266`, the same stagehand files SW-AI-21 edits) moved in here, so the secrecy test is fully green on day 14.5. Decision #10 (`lookup: true`) can be settled now | Core: `QUESTION` parses; `POST /api/guest/answer` files and fuzzy-judges; **secrecy test**: no answer, hunt-clue codex text or verdict reaches any `AgentRequest`, `/api/agent/facts`, `lore_block` or the mind's `learned`; stagehand `test_orchestrator.py` / `test_agents.py` green, including the `Facts.render`/`find` holder filter. **#33:** a filed lie raises `Kernel.lies_accepted`, and Trabolta's reply is **byte-identical** to the reply for a true filing; the sheet opens from the `dm:Trabolta` header and from a long-press on the guest's own message (pre-filled). **Story swap:** the 8 `QUESTION`s, the DM-lies rule (+50 ⓣ), and the persona's "file it" line |
| **WP-09** Takeover widget + retraction (+ story swap) | A · 14.5–19.5 (5 d) | SW-PLAY-04, SW-ENG-13 (P2, pulled in) | — | P0: "GO TO THE LIVING ROOM". The overlay path is hard-wired to `tutorial` today (`widgets.tsx:282-288`, `guest.tsx:476`), and retraction needs a new sim event over an append-only chat store | Play test: the takeover is full-screen with chime and vibrate, and only the story's retraction dismisses it, including over a cutscene and inside an embedded Players shadow root; core: poll ids + retraction survive restore/replay. **Story swap:** the takeover in the E4/E6 beats; poll retraction replaces the `Night.poll` workaround |
| **WP-10** Performer comms (+ story swap) | A · 19.5–22.5 (3 d) | SW-PLAY-03, SW-PLAY-12, SW-ADM-03 | WP-05 | P0 booth alerts; feeds staff push (WP-15) | The booth chimes, vibrates and banners on `!`; Clippy has a private channel; the Director broadcast form has an Alert toggle. **Story swap:** the Clippy-only codex and the malware warning move to the private channel |
| **WP-17** The story pass: chess, rearm, detectors, content review *(wave 7: rearm → `reset_server_room`)* | A · 22.5–25.5 (3 d) | SW-STORY-13, SW-ADM-10, SW-CHESS-01, SW-STORY-11 (your review) | WP-05, WP-08; **sign-offs #1–#12 by day 20** | Shrunk from 5 to 3 days: each language WP now swaps its own workarounds. What's left is what the print run needs (the final hunt questions and truths (`facts.json` since wave 4), Bingo squares and coded files, after your review) plus the chess story | `loomcheck … --smoke` → 0 errors / 0 warnings, including the new detectors; `trapped-in-the-internet.test` green with the chess-disarm tests (a win at step 14 → the door opens quietly; after 90 s → alarm) and the rearm tests; your SW-STORY-11 review is recorded |
| WP-07 Timers + show clock + journal timestamps *(starts)* | A · 25.5–31.5 | see M2 | | | |
| **WP-04** Featured-program claims + invitations | B · 5.5–10 (4.5 d) | SW-PLAY-01 | WP-01, WP-02; party date + sign-offs #4, #8 by day 7 | **Calendar gate:** the claim codes go in the invitation email (via the existing `mail.ts`, SW-OPS-08). The claim codes are stored with **WP-19's printable table schema** (kind `claim`), so there's one token table and one release flow | Core identity test: only the claim code can take "Microsoft Excel"; an invite with a claim link reaches a test inbox; GuestRegister shows the reserved program. **Then send the invitations, with an RSVP deadline of day ≈ 25.** |
| **WP-19** Printable tokens + `/q/` + clue scan (+ `found at` story gates) | B · 10–14.5 (4.5 d) | SW-QR-04, SW-QR-07 | WP-01 | A hub (effectively P0): check-in, badges, cast cards, device tokens and the print page all use `/q/<token>` | Core: `/q/<token>` resolves the place / clue / badge / device / claim kinds; a clue scan unlocks with `via: "scan"`, and a hunt clue with `found at: <LOCATION>` refuses a scan from another room. **Story swap:** `found at` gates on the hunt and clue codex entries (the fact rows in `facts.json` → the generated `codex/9-facts.loom`, plus the hand-written `codex/*`) |
| **WP-13** PushHub (VAPID, subscriptions, fan-out) | B · 14.5–17.5 (3 d) | SW-PLAY-19 | WP-01, WP-02, SP-2 | On the print chain. VAPID keys are pinned in `.env` here (they're part of SW-OPS-17, which closes in WP-15) | Core push tests: subscribe, fan-out from `deliverMessage`, prune 404/410; subscriptions bind to the stable person id (WP-02) and survive a restart; the server never sends to a subscription whose app is visible (SP-2's rule) |
| **WP-14** Play PWA + iOS install-first door + Safari handoff | B · 17.5–21.5 (4 d) | SW-PLAY-20, SW-PLAY-21, SW-PLAY-11 | WP-13 | Decides how iPhones scan room signs, so it must come before the signage | **Live:** iPhone Safari → Add to Home Screen → the session resumes (nonce) → a push arrives on a locked phone **on cellular**; Android the same; the tour copy covers guests who refuse alerts |
| **WP-20** Room check-in + in-app scanner (+ story swap) | B · 21.5–25.5 (4 d) | SW-QR-06, SW-PLAY-06 | WP-19, WP-14 | P0 check-in; SW-PLAY-06 is effectively P0 | Scanning a room sign in the app puts the program in that room's chat (core + play tests); **live** from the iPhone Home Screen app. **Story swap:** `check_in_at_desktop` and the room check-in become the scan event |
| WP-21 Guest badges + performer cast cards *(starts)* | B · 25.5–28.5 | see M2 | | | |
| **WP-26** ScreenHub + server clock | C · 3–8.5 (5.5 d) | SW-SCR-03, SW-AUD-03 | — | The hub for all screens, and the wall-clock anchor that WP-07's countdowns need | Core: ScreenHub folds programs and replays the current state on connect; `GET /api/time`; `at` on sim frames and screen programs |
| **WP-36** Room-audio router core, 16 ch (+ SP-3) | C · 8.5–15 (6.5 d) | SW-AUD-01 | H-03 (TV computer + interface by day 8.5); 2 rooms of speakers for the live check | P0 room audio on the TV computer (#14). Re-estimated 5 → 6 + the spike: streaming from disk inside the PortAudio callback xruns, so it needs a reader thread + ring buffer per voice. Ducking under Trabolta's TV voice needs voice start/end notices from ScreenHub (a soft edge to WP-33) | Stagehand pytest (mixer, rooms/buses, fades, `exclusive`, ring buffer under load); **live:** `sound X rooms: kitchen` plays only in the kitchen, while Chrome plays on channels 1–2 of the same device. The story's room-routed `sound … rooms:` edits can land from here |
| **WP-27** Kiosk hardening for old Android | C · 15–18.5 (3.5 d) | SW-SCR-19, 28, 29, 23 | SP-1; the real-tablet acceptance is **soft** (prove it by G1) | The oldest tablet sets the build target (#15). Built against the emulator so a late tablet can't block lane C | `structuredClone` is replaced or polyfilled in `house/src/validate.ts:72`, `reinstall/web/src/api.ts:77` and `map/edit.ts:26` (a test runs `validateHouse` with `structuredClone` deleted); wake lock holds for 30 min, with a muted-video NoSleep fallback, or Fully Kiosk's "Keep screen on" where the Wake Lock API is missing; tablets that fail the WebGL2 probe fall back to face/signage; the shared kiosk helper is in use; the build target is picked from SP-1 (chrome64 or chrome87, written into SW-SCR-28); an older Fully Kiosk APK is kept for the oldest Android |
| **WP-28** Screen client + cue bridge + overlays + heartbeat | C · 18.5–24.5 (6 d) | SW-SCR-05, 14, 21 | WP-26, 27, 18 | Gates every template, the TV voice and the uplink plan. Re-estimated 4.5 → 6: `terminal/src/app.tsx` (760 lines) becomes a layered base/program/overlay renderer that pre-empts piloting | `cue screens_blackout` / `screens_go_to_living_room` from Run reaches every tablet within 1 s, and a takeover ends any pilot session; heartbeats show in Run; `identify` flashes each tablet's name |
| WP-29 Screensaver + attract *(starts)* | C · 24.5–29 | see M2 | | | |
| **WP-25** Media route (Range/206) + video players (+ story swap) | D · 3.5–7.5 (4 d) | SW-SCR-04, SW-PLAY-14, SW-RE-04 | WP-01 | The Installation Wizard video (#21; the doctor until wave 4), the attract loop and the ad hijack. Re-estimated 5 → 3.5 (+0.5 story) | `curl -H 'Range: bytes=0-99'` returns 206 with an ETag; an iPhone plays the Installation Wizard video card on cellular; the tent wizard plays the Wizard placeholder. **Story swap:** the Wizard's phone `video` card in the capture/queue beat (`beats/internet.loom`), and the `cue tablet_wizard` workaround in `main.loom` retired |
| ~~**WP-34** Kokoro on the VPS + TTS disk cache + `tts:warm`~~ **Dropped 2026-10-15** (native device voices; Kokoro is an opt-in compose profile, SW-AUD-08 struck) | D · 7.5–10.5 (3 d) | SW-AUD-08 | WP-01 (VPS tier from SP-4) | Gates the TV voice, the house announcements and the ceremony voice | A compose service with CPU limits; `/api/mod/tts` returns one sentence in under 2 s to a tablet on cellular; `pnpm tts:warm` pre-renders |
| **WP-48** Real reinstall devices (+ SP-6) | D · 10.5–14.5 (4 d) | SW-RE-01, 02, 03, SW-MAP-00 | WP-01; **H-08 started on day 0** | The tent's riskiest unknown, retired early, and the APK pipeline is proven before WP-47 has to re-export it | **Live:** the Quest APK on both headsets finds the duck on the VPS; a tablet run over HTTPS with the camera scan; the review-round fixes re-run live (pause, moved duck, 409 on save) |
| **WP-39** House YAML finish + story cue rename + power wiring bench | D · 14.5–18.5 (4 d) | SW-SH-01, 02, 08, 09, 13, SW-AI-14, HW-PATCH-04 | (WP-36 soft) | The rules must exist before the door and patch bay go on the bench (≈ day 17–20). The story's cues are renamed to the spec §2.13 registry **here**, in one commit, so the stagehand test asserts the final names from the start and is never rewritten | `uv run pytest tests/test_trapped_house.py` green, including the reed, the indicator, the patch-combo rules, and a blackout that spares the stairs, bathroom and tent; it asserts the §2.13 cue names; `loomcheck` clean after the rename; **bench:** opening the reed logs `server_door_opened` in Run, and each of Trabolta's powers (`cut_the_lights`, `flicker_the_screens`, …) visibly reaches the rig |
| **WP-22a** Scoped device tokens, server side | D · 18.5–21 (2.5 d) | SW-QR-10 | WP-19 | P0 now: the house → VPS link (SW-OPS-18) needs it, and so do the wall terminals (HW-SCR-01), the tent stations (HW-TENT-01) and night #1. The device enrolment cards go in the main print run | A `device` printable mints a scoped token; a terminal token can't call `say`, `reset` or `load`, and a stagehand token can read the (lean) mod stream and fire signals but not edit guests (core tests, one per scope) |
| **WP-40** Stagehand + agents worker: robustness, house → VPS link, lean mod stream (+ SP-7) | D · 21–27.5 (6.5 d) | SW-SH-03, 05, 10, SW-OPS-18, SW-OPS-21, SW-AI-08 | WP-01, WP-22a; H-02 (router, SSIDs), H-15 (Ollama laptop) | The VPS answer (#16) makes every uplink blip a reconnect. The measured 196 KB ModView per step makes the lean stream P0 | **Live:** stagehand on the TV computer **and** the agents worker on the Ollama laptop connect outbound with scoped tokens over the lean stream; pull the uplink for 60 s → both reconnect within 10 s of it returning, catch up with no duplicate cues, and pending agent requests are re-sent with none answered twice; retained MQTT is ignored; signal `args` arrive; house → VPS → lights stays under 0.5 s for the blackout |
| WP-44 Map underlay + `MapApp` split *(starts)* | D · 27.5–30 | see M2 | | | |

**Gate G1 (end of week 6, day 30): a Run-mode rehearsal + device checks**

- A scripted rehearsal (local Sim, then the preview) uses every form landed so far: the scopes, a QUESTION filing (auto-judged) from the File-a-fact sheet, a DM lie that counts, the takeover and its retraction, a staff broadcast with an alert, and the chess story. Timers (day 31.5) and INTERACTION 2.0 (day 38) are shown at G2.
- Installed PWAs on an iPhone and an Android each get a push on a **locked** screen over cellular.
- The in-app scanner checks a phone into a room.
- One wall tablet (the oldest one in hand) shows the blackout cue. This is WP-27's real-device acceptance.
- One `sound` plays in one room only (two rooms wired, H-04).
- Stagehand and the agents worker survive a 60-second uplink pull. The Quest finds the duck on the VPS.
- The invitations are out, with an RSVP deadline of day ≈ 25.

---

## M2 · Print run → all P0 → night #1 (weeks 7–9, days 30–45)

**Goal:** the paper is printed, every P0 is done (day 41), judging works from Clippy's phone and from Run, and friends play the first hour.

| WP | Lane · days | Items | Needs | Why now | Done when |
|---|---|---|---|---|---|
| WP-07 Timers + show clock + journal timestamps (+ story swap) | A · 25.5–31.5 (6 d) | SW-ENG-06, SW-PLAY-05, SW-ENG-18 | WP-26 (`/api/time`) | Gates the countdown template (WP-30a) and the recap's time stats. **Timers run in sim time** (they pause with the event), and phones render a wall-clock `endsAt` computed from server time; the Y2K/midnight countdown is a wall-clock target (`at 23:59`). No per-second snapshots: `fanout` already pushes every client's snapshot | Core: `start timer X for 15m`, `when timer X ends:` and `has 5m left` survive a restart; pause → `endsAt` moves; `GuestView.timers` filled; the play strip renders `endsAt`, never the device clock; every journal line carries `at`. **Story swap:** the 15 `Night.*_end` deadline watchers become timers; `five_minute_warning` becomes a timer rule |
| WP-06 INTERACTION 2.0 (+ story swap) | A · 31.5–38 (6.5 d) | SW-ENG-03, SW-AI-07, SW-PLAY-17 | — | P1, but the judging UIs need its args. Re-estimated 5 → 6: per-viewer `when:` evaluation, a per-guest availability matrix for performer powers with `target: guest`, `/api/prime/act` args (`event-runtime.ts:2392-2420`), and both backends (`store/sim.ts:425`) | Core: `when:` filters `GuestView` / `PrimeView` per viewer; `/api/prime/act` takes args; a guest acts on a guest from a People card; `available:` refuses an out-of-phase power without burning a use; play PersonCard test; the local Sim store passes args. **Story swap:** `when:` on the Bingo, pong, pickup, hunt and bathroom buttons (the hooks' phase guards dropped); Trabolta's powers get `available:` by phase. **The six judge buttons stay** until WP-16 |
| **WP-16** Answer judging UIs (+ the judge-button swap) | A · 38–42.5 (4.5 d) | SW-ADM-07, SW-ADM-13 | WP-06, WP-08, WP-17 | #22: Clippy **and** the director judge, and night #1 plays the hunt. It owns the swap of the six buttons, so if it slips, the buttons simply stay | Clippy's booth **and** Run both judge, arguments picked from `model.questions`; the first verdict wins, the other judge sees it land, and the last verdict can be undone; **review queue:** an unclear filing appears in the queue, a judge resolves it, and it journals `answer judged` (core + play + editor tests). **Story swap:** one ✅ / 😤 INTERACTION with args replaces `accurate_q1..3` / `confident_q1..3` |
| WP-21 Guest badges + performer cast cards | B · 25.5–28.5 (3 d) | SW-QR-08, SW-QR-09 | WP-19, WP-04 | Effectively P0 (it feeds the print page). The identity half is already in WP-02 | Scanning a badge signs in as the claimed program, and still does after a restart; a claimed badge needs a director release to move; one cast-card scan opens the performer booth (409 if held) |
| **WP-23** Run → Print page + print lint + RSVP import | B · 28.5–33 (4.5 d) | SW-QR-11, SW-QR-16, SW-QR-05 | WP-19, 20, 21, 14; RSVPs in by day ≈ 25 | On the print chain | Editor test; the Print page renders room signs, codex posters, badges (from the RSVP CSV), cast cards, **device enrolment cards** and the "Add to Home Screen" door sign; the lint lists codex entries with no poster and no unlock |
| **WP-24** Test sheet on cellular → **print run** | B · 33–34.5 (1.5 d) | SW-QR-14, HW-PROP-04, HW-PATCH-06 | WP-23, WP-17 | Calendar gate: posters (incl. the Desktop's fact stacks since wave 4), badges, signs, Bingo cards and the door sign (its wording comes from WP-14; it's part of SW-OPS-17) | Every code type on the test sheet scans on an iPhone and an Android **on cellular**; then print the real run |
| **WP-15** Push for staff + story `notify` + device test | B · 34.5–39 (4.5 d) | SW-PLAY-22, SW-ADM-11, SW-ENG-15, SW-OPS-17, SW-PLAY-02 (closes the umbrella) | WP-05, 09, 10, 13, 14 | All phones get push (#25). `notify` lands whole here: the in-page nudge and the push, plus its story swap | **Live:** locked phones of a guest, a performer and a director each get the right push on cellular; story `notify who "…" urgent` pushes, and shows an in-page nudge when the app is open; a push health card shows in Run; VAPID keys are pinned. **Story swap:** `notify who "…"` replaces the personal `!` broadcasts |
| WP-29 Screensaver + `terminals_attract` | C · 24.5–29 (4.5 d) | SW-SCR-06, 07 | WP-28, WP-25 | P0: the "before Trabolta" monitors. Built in **Canvas2D**, not three.js, because the tablets without WebGL2 fall back to exactly these screens | Before Trabolta, every tablet cycles the screensaver, videos and attract screens; it runs 30 min on the oldest tablet without a crash |
| WP-35 Media pipeline + TV-computer cache + old-Android codecs + **precache** | C · 29–34 (5 d) | SW-AUD-12, 02, 10, 11, SW-SCR-25 | WP-25, WP-36 | P0: every sound plays from local files, and the synced ad hijack can't stream to ~10 tablets over the house uplink at once (20–30 Mbps) | `pnpm media:build` outputs FLAC, AAC and H.264; the TV computer verifies the sha manifest and plays from local disk; every tablet precaches from the manifest and reports "media ready" in its heartbeat; the bench page plays every file on the oldest tablet |
| WP-38 Audio resilience | C · 34–37 (3 d) | SW-AUD-06, 07 | WP-36 | Effectively P0: part of the uplink plan | With the WAN unplugged, the LAN page `:7700` and MQTT `show/audio/cmd` still play cues; the `health/audio` LWT shows in Tech |
| WP-30a Slides + countdown templates | C · 37–39.5 (2.5 d) | SW-SCR-08, 09 | WP-28, WP-07 | Night #1 needs the Bingo rules slide and the 15:00 countdown | `screens_slides` and `screens_countdown_*` render from cues; the countdown follows the server's `endsAt` through a pause |
| WP-44 Map underlay + `MapApp` split | D · 27.5–30 (2.5 d) | SW-MAP-04 | WP-03; H-14 photos | The survey goes in on top of a traced photo. Starts by splitting the 1,064-line `MapApp.tsx` (SW-MAP-03's last bullet), which every later map change needs. The underlay is **not** stored in `house.json`, which ships offline to terminal/reinstall/VR builds and has a 4 MB body cap: it gets its own asset route | Reinstall tests; trace a photo underlay with 2-point scale; the underlay survives a reload and never appears in `house.json` |
| **WP-46** Survey entry + the map matches the story | D · 30–33 (3 d) | SW-MAP-02, SW-MAP-07 | WP-03, WP-44 (soft: the JSON tab works without it), H-14 | P0: the real house, the Server Room, the **outdoor tent** (#23). Rooms can't have holes, so the yard is a notched polygon around the tent | `house.json` with the real rooms validates; `pnpm --filter @loom/house test` green; **every LOCATION maps to a room** (the lint returns 0); the tent room sits outside the house footprint; every wall terminal has a spot |
| **WP-47** Tent ↔ shed switch + VR sync release | D · 33–37.5 (4.5 d) | SW-MAP-13, SW-MAP-10, SW-SCR-22 | WP-46, WP-39 (WP-45 soft) | #31: the shed is the rain plan. Re-estimated 3.5 → 4.5: the switch is **not** map-only. A `Night.tent_site` world variable drives stagehand's tent lights and the blackout group, the router's tent/shed audio room, the check-in signs and the terminal spot, together with the map. **No story change**: don't add a `LOCATION The Shed` | The switch flips the map, duck spots, terminal spot, lights and audio room in under a minute, also mid-show (live sessions keep going; `setHouse` re-deals the duck); `pnpm house:sync` + `pnpm test:vr` green on **both** variants (the autopilot reaches every duck spot); the Quest APK is re-exported |
| **WP-57** Cue sheet + codex/quest grant UIs | D · 37.5–41 (3.5 d) | SW-ADM-01, 04, 09 | (WP-06 soft) | P0 cue sheet for the director. In lane D because lanes A and B are full before G2, and it reads the same cue registry WP-39 just fixed | Run → Director lists the admin INTERACTIONs in `Night.step` order with the current step highlighted; codex grants and quest steps work from the Inspector (editor tests) |
| **WP-61** Uplink failure plan | Ops · 37–39 | SW-OPS-19, HW-NET-07 | WP-40, 28, 38, H-02 | P0 under VPS hosting | **The pull-the-WAN-cable test:** guests on cellular keep playing; the LTE failover takes over and **every house device (stagehand, the worker, tablets, Quests, the chess phone) is back within 60 s**; audio and screens recover; the runbook card is written |

**Gate G2 (end of week 9, day 45): all P0 done (day 41), night #1**

- **WP-63a tech rehearsals** (day 41–42.5), one subsystem at a time, in the house: phones on cellular, wall tablets, the TV, room audio, the door, the patch bay, and the Quest + tablet in the tent.
- **Live-preview night #1** (the weekend of week 9): 4–6 friends play the first hour (login → Desktop → Bingo → the hunt). Clippy judges from her phone, the director from Run, and the screens show the Bingo slide and the countdowns. **Trabolta on the TV falls back to text** (his voice lands on day 48).
- The print run is done, and sign-offs #1–#12 are in. Every story workaround the language WPs replaced is gone (`loomcheck` and the trapped test assert it).
- Re-plan the rest of the schedule from here.

---

## M3 · P1 fidelity (weeks 10–11, days 45–55)

| WP | Lane · days | Items | Needs | Done when |
|---|---|---|---|---|
| WP-50 Recap stats | A · 42.5–46 (3.5 d) | SW-AI-17 | WP-05, 08, 07 (journal `at`); WP-49 soft (duck times from `spatial-runs.jsonl` when present) | `GET /api/mod/recap` returns the Trust Chart, truths, `lies_accepted`, Internet visits, codex counts, quests, factions, time stats (bathroom minutes, the first DM lie with its time) and duck times **from night #1's real journal** (a core test on a replayed journal) |
| WP-12 AWARD declaration (data only) | A · 46–48.5 (2.5 d) | SW-ENG-16 | WP-05 | Core tests: AWARD parses and ranks with `top()` / `bottom()`; the bank compiler diagnoses it. **No sim-side `start/next ceremony`:** the server's CeremonyHub is the only sequencer (one state machine, ≈ 1 day saved) |
| WP-51 CeremonyHub (templates first) + ceremony content | A · 48.5–52.5 (4 d) | SW-AI-18, SW-STORY-15 | WP-12, 50, 34 | **A template-only ceremony** runs end to end in a test: cold open → stats → 5 fixed + 3 bonus awards → finale, every line with a fallback; stepped by `POST /api/mod/ceremony/next`; `codex/9-trophies.loom` written. **Story swap:** the AWARDs, `start_the_ceremony`, the host per ending, the `ceremony` phase cue |
| WP-22b Run → Devices + map auth + PIN-gated ⚙ | B · 39–41 (2 d) | SW-QR-18, SW-SCR-20, SW-MAP-11 | WP-22a | **Do not cut** (the other half of scoped tokens). Run → Devices lists every token with last-seen and Revoke (a revoked tablet drops to setup); the map page signs in with the author session; the terminal ⚙ needs a long-press + PIN |
| WP-11 Bathroom Mode for real | B · 41–44.5 (3.5 d) | SW-PLAY-07, 16, SW-ADM-08, SW-RE-07 | WP-06 | A 🚻 toggle in the HUD whose label flips; `afk` expires after 10 min with a "still there?" prompt; the panel in Run; the tent tablet's buttons work. **Story swap:** the `afk` expiry rule and the label flip |
| WP-65 Reload the story, keep the run | B · 44.5–47.5 (3 d) | SW-ADM-14 | WP-02 | Core test: a mid-run patch replays the journal onto the new source, keeps every guest's identity and token, keeps the chat, and reports the first diverging entry (then stops with the director's OK) |
| WP-59 Run → Screens page | B · 47.5–50.5 (3 d) | SW-ADM-05 | WP-28 | Every screen's program and heartbeat are visible, and a program can be pushed to one screen |
| WP-31 Trust Chart + synced video | C · 39.5–43 (3.5 d) | SW-SCR-11, 15 | WP-28, 25, 05 | The Trust Chart draws from the live `trust` slots; the ad hijack starts on every screen within ≈ 100 ms (`startAt`), from the precache |
| WP-33 TV presentation ⇄ mirror + Trabolta's room voice | C · 43–48 (5 d) | SW-SCR-16, 17 | WP-28, WP-34 | #13: the TV is his face and voice. **Live:** the TV switches between presentation and the reinstall mirror; his Desktop lines are spoken on the TV by Kokoro, with the mouth moving within 100 ms of the audio level; music ducks under him (voice start/end notices reach the router, WP-36) |
| WP-37 Synced cues + house announcements + terminal audio roles | C · 48–52.5 (4.5 d) | SW-AUD-04, 05, 09 | WP-26, 28, 34, 36; H-04 full install | `do announce "…"` plays the chime + TTS on the room outputs **and** on tablets with `announce` on, within 150 ms of each other (#20); **a tablet in a router-covered room still plays its own pilot speech and a video on its own speaker** (#14: terminals keep their own audio); audio walk with H-04. **Story swap:** the house announcements (`do announce "…"` since wave 4; a system voice, never a character) gain `rooms:` |
| WP-42 Trabolta live verifications | D · 41–42.5 (1.5 d) | SW-AI-01, SW-AI-10, SW-AI-11, SW-AI-13, SW-STORY-04, SW-STORY-08 | WP-08, WP-40; H-15 | **Do not cut.** `editor/e2e-live/mind.spec.ts` and `live-collab.spec.ts` pass against a real worker on the laptop, through the VPS; the Kernel-only secrets, the codex order, the hold line and the power list are verified live; #10 is answered (`lookup: true` or `false`) before night #1 |
| WP-55 Chess foundations | D · 42.5–45 (2.5 d) | SW-CHESS-02, 03, 04 | — | `/chess` is served with `CHESS_CSP`; the GPL `chess/engine/` package has COPYING and a source link; **Stockfish ships as separate, unmodified files in `public/engine/`, loaded at runtime, never bundled into the app's JavaScript** (a build test greps `dist/assets` for it), so `chess/` stays MIT; `puzzles.json` is committed |
| WP-56 Chess app: full game + *Checkmate Trabolta* | D · 45–51 (6 d) | SW-CHESS-05, SW-CHESS-08 | WP-55, 27, 17, 39, 22a; H-06, H-13; SP-5 | Vitest green (UCI parser incl. `score mate`, puzzle judge, phase reducer, retry queue); **live** on the taped phone: a **full game** against the engine at ≈ 2200 Elo (#29: "a really hard chess AI") and the puzzle mode; a win at `Night.step >= 14` → `chess won` → the ring goes green for 90 s and the door opens with no alarm; after 90 s, opening it sounds the alarm. *(wave 7: superseded — a win gives the winner the door code to a standalone keypad lock; the door never alarms)* Re-estimated 3 → 4.5 (+1 for the full game, +0.5 for SP-5) |
| WP-62 Runbook, backups, training, comms, loaners | Ops · 42.5–46 | SW-OPS-04, 05, 09, 10, 12, 13, 14 | — | The runbook is printed; a `pg_dump` + state-dir restore is tested; performer training is held; the radio/comms plan is tried in the house (SW-OPS-13); the loaner phones and chargers are set up and tested (SW-OPS-14) |

**Gate G3 (end of week 11, day 55): live-preview night #2**

- The whole story runs end to end with friends: Trabolta's TV voice, the house announcements, the server judge with the Judging card, the chess disarm (the King on the tent tablet; the phone the fallback; *wave 7: a win gives the door code*), scoped tokens on every device, and the template-only ceremony, stepped through the CeremonyHub (its Run tab lands on day 56.5 and is rehearsed at G4).
- **Language freeze:** no new syntax after G3. Story text can still change.

---

## M4 · Ceremony + polish, the cut zone (weeks 12–13, days 55–63)

Everything here goes first when time is short (see [the cut line](#the-cut-line)).

| WP | Lane · days | Items | Needs | Done when |
|---|---|---|---|---|
| WP-53 Trabolta writes the ceremony | A · 52.5–55.5 (3 d) | SW-AI-19 | WP-51 (WP-43 soft) | #26 asked for **genuine lines inside a structured script**. Stagehand tests: a facts-only prompt (the recap numbers + names, nothing else) and one structured slot per line; **a rewrite containing a number or a name that isn't in the facts is rejected, and the template line is kept**; a rewrite over the word cap, or one that misses the timeout, falls back to the template. Live: night #2's real stats become his lines |
| WP-43 Phase map + disclosure + hold lines | A · 55.5–60 (4.5 d) | SW-AI-03, 05, 06 | WP-42 | Stagehand tests: a phase cue sets stage, policy and drives deterministically; `never:` facts never reach the voice prompt at that stage; hold lines change by phase. **Story swap:** `trabolta.mind.md` `phases:` become the phase map; `disclose:` / `never:` / `unavailable:` |
| WP-58 Phone cue page | B · 50.5–53 (2.5 d) | SW-ADM-02 | WP-57 | A director fires a cue from their phone |
| WP-52 Run → Ceremony tab + phone ceremony cards | B · 53–56.5 (3.5 d) | SW-ADM-12, SW-PLAY-23 | WP-51 | Prepare is refused before the ending; step through the lines; phones show award cards; the winner gets a takeover; Clippy has a teleprompter |
| WP-60 Truthcoin + pickup line | B · 56.5–61 (4.5 d) | SW-PLAY-08, 09 | — | Give, trade and wager with a ⓣ balance (wager dropped in Oct 31 wave 5: bets settle with Request / Send, player to player; since wave 9 McAfee only referees); a trade (a fact for coin) is one journaled mutation (codex share + coin escrow); the pickup line ignores punctuation. **Story swap:** the host buttons give way to the routes |
| WP-54 TV ceremony template | C · 52.5–55 (2.5 d) | SW-SCR-27 | WP-33, WP-51 | Counters, nominees and the reveal on the TV, with his face voicing the lines |
| WP-30b The rest of the show templates | C · 55–58 (3 d) | SW-SCR-10, 12, 24 | WP-30a | A test iterates the §2.13 registry and renders every template name with sample cue data (the Y2K clock, the notepad and the rest); none throws or falls back to blank |
| WP-32 Songs (lyrics) | C · 58–61.5 (3.5 d) | SW-SCR-13 | WP-31, WP-35; H-10 finals | Karaoke lyrics from the VTT against a shared `startAt`; Sandy's line as text in a chat bubble (#28: Sandy is lore); `screens_grok_prom`, `screens_rave`, `screens_recount`, `screens_overshare` render. **Story swap:** Sandy's line in `beats/finale.loom`, once #28 is decided |
| WP-49 Tent operations | D · 51–54.5 (3.5 d) | SW-RE-06, 08, 14 | — | Zip everyone out ends every session; the queue goes in capture order (#30: informal turns in the tent); `spatial-runs.jsonl` is written. **Story swap:** `zip_everyone_out` uses release-all |
| WP-45 Map structural editing + walkability | D · 54.5–59.5 (5 d) | SW-MAP-03, SW-MAP-09 (P2, pulled in) | WP-44 | Reinstall tests: draw/delete rooms with typed W×D, doors that follow a moved edge (`edit.ts:186`), stairs, floors, zoom/pan, snap; **walkability:** a fixture map with a known unreachable duck spot is flagged, and the real map (both tent/shed variants) reports none. The props palette, measure tool and redo are SW-MAP-14 (P2) |
| WP-41 Tech rail | D · 59.5–63 (3.5 d) | SW-SH-04, SW-SH-12, SW-ADM-06 | (WP-38 soft) | A Run tech view shows stagehand, the worker, audio, Z2M and WLED health; **stop Z2M and its row turns red within 10 s**; kill the worker and its row turns red within one heartbeat |

**Gate G4 (week 13, day 63): all P1 done, then the feature freeze** (fixes only from here). Rehearse the full ceremony from night #2's journal stats.

---

## M5 · Dress rehearsal + freeze (weeks 13–14, days 63–67)

| WP | Days | Items | Done when |
|---|---|---|---|
| **WP-63b** Full dress rehearsal | ≈ 63–65.5 | SW-OPS-06, HW-NET-05 | The whole night runs with performers and the SW-OPS-07 dress checklist (all of its checks), including the HW-NET-05 load test, **pulling the WAN cable** mid-show, a **tent ↔ shed switch**, and Trabolta's powers re-checked on the full rig (first verified on the bench in WP-39). Every issue becomes a checklist item or a runbook line |
| **WP-64** Code freeze + pinned production deploy + safety walk | ≈ 66–67 | SW-OPS-11, HW-SAFE-05 | A pinned Docker image, the morning-of reset tested (SW-OPS-10), and the safety walk done |

**Gate G5: show-ready.** From here, change only what the dress rehearsal broke.

---

## The non-software lane (you + friends)

"Needed by" is the first WP that has to run against the item, in this plan. Start everything in week 1 that has a lead time.

| Week | Do | Package | Needed by |
|---|---|---|---|
| **1 (day 0)** | Pick the VPS plan (sized for Kokoro; confirm with SP-4) | (SW-OPS-20) | WP-01 · day 3 |
| **1 (day 0)** | Acquire the **TV computer** if it isn't owned; confirm the 16-out interface: 16 analog outs, or 8 + ADAT (then **order the DA converter now**); name the channels | H-03 | SP-3 / WP-36 · day 8.5 |
| **1 (day 0)** | Apply for Quest 3 developer mode (Meta org, both headsets); install JDK 17, the Android SDK, the Godot Android export template, the OpenXR vendors plugin; make a keystore | H-08 | WP-48 · day 10.5 |
| **1** | **Find or beg ≈ 12 old Android tablets** (8 walls + the tent + spares) plus an Android 8+ chess phone. Run the SP-1 probe on each as it arrives; **have at least one old tablet in hand by day 10** | H-01 | WP-27 (soft) · day 15; G1 · day 30 |
| **1** | **Set the party date.** Sign off #4 (Excel's plant), #8 (MS Paint on Cat's sheet) and the featured-sheet parts of #12: they're printed on the invitations' character sheets | — | invitations · **day 7** |
| 1 | The guest list (name, program, email) | (SW-QR-16) | WP-04 invites · day 10 |
| 1 | **Order the patch-bay parts** (MCP23017s, ESP32, DFPlayer) and the door parts (reed, copper tape, indicator ring; *wave 7: wire loops + a keypad lock, the reed optional*) | H-07, H-06 | bench · day 17–20 |
| 1 | Placeholder media: a dummy Installation Wizard video, attract loop and ad | H-10 | WP-25 · day 3.5 |
| 1 | Name the Ollama laptop; Ollama + both models pulled | H-15 | WP-40 · day 21 |
| **2** | **Order speakers + cables for at least 2 rooms** (living room + kitchen) | H-04 | WP-36 live · day 15; G1 · day 30 |
| 2 | Order the LTE failover router + data SIM, an **outdoor AP / mesh node** for the tent and the shed, the **Zigbee coordinator** and a **UPS** for the TV computer; set up the 2.4 GHz IoT SSID and reservations | H-02 | WP-40 · day 21; Z2M pairing wk 5–6; WP-61 · day 37 |
| 2 | Identify the PAUTIX strips; order controllers + PSUs | H-05 | G2 |
| 2–3 | **Book the performers** (Clippy judges at night #1) | (SW-OPS-12) | G2 · day 45 |
| **2** | **Send the invitations** once WP-04 lands, with an **RSVP deadline of day ≈ 25** | — | ≈ day 10 |
| **3** | **Measure the house** (laser + tape + photos): every room, the Server Room, the **outdoor tent spot** (the yard as a notched polygon), the **shed**, the terminal mounts, the Truth Pong table | H-14 | photos → WP-44 · day 27.5; data → WP-46 · day 30 |
| 3 | Bench-test the patch bay (normals, 75 Ω, empty and with a cord in the partner jack) | H-07 | WP-39 · day 14.5 |
| 3 | Sign off the **Installation Wizard's backstory** (part of #12) before the shoot | — | the shoot · wk 4 |
| **4** | Patch bay + door sensor on the bench, talking to stagehand | H-06, H-07 | WP-39 / WP-40 · day 14.5–27.5 |
| 4 | **Wire the 2 rooms' speakers** to the interface | H-04 | G1 · day 30 |
| 4–5 | Script and shoot the **Installation Wizard video** (full + "welcome back" cuts, VTT) | H-10 | finals by WP-35 · day 29 |
| 4–5 | **Book friends for live-preview night #1** (2+ weeks' notice) | — | G2 · day 45 |
| **4** | The remaining **content sign-offs** #1–#12 and the invented-content review (SW-STORY-11) | — | **WP-17 · day 22.5 (by day 20)** |
| 5 | RSVPs in | (SW-QR-16) | WP-23 · day 28.5 |
| 5–6 | Pair every bulb to Z2M; scenes; WLED | H-05 | G2 |
| 6 | The ad hijack + 4–8 fake ads, the sfx list | H-10 | WP-35 · day 29–34 |
| **7** | Paper, ink, laminator → **print run** right after the cellular test sheet (including the device enrolment cards) | (WP-24) | day 33–34.5 |
| 7–8 | Mount and provision the wall terminals with their device cards | H-09 | G2 · day 45 |
| 7–8 | Safety + weather: darkness, strobes, GFCI, the outdoor tent's power, the shed fallback | H-12 | G2 |
| 8–10 | Props: the Tube, the bean printer, Truth Pong, the bobbing station, clue props | H-11 | G2 / G3 |
| **9** | **G2:** tech rehearsals + night #1; **book the dress-rehearsal cast** | — | ≈ day 63 |
| 9 | The rest of the speakers and runs, the tent speaker, the audio walk | H-04 | WP-37 · day 48 |
| 9 | Mount the chess phone outside the server room | H-13 | WP-56 · day 45 |
| 9–10 | Trophies; ceremony assets (drumroll, fanfare, bed, stats-reel art) | H-11, H-10 | WP-51 · day 48.5 |
| 10–11 | *You're the One* vocoder + Sandy-only versions + lyric VTT; (#28 decided: Sandy is lore; optional cutscene video) | H-10 | WP-32 · day 58 |
| **11** | **Live-preview night #2** (friends) | — | G3 · day 55 |
| 13–14 | Dress rehearsal, the safety walk, the morning-of checklist | — | G5 |

### Oct 31 authoring tasks (added 2026-10-16, wave 4)

The team's content for wave 4 lives in one file, `facts.json` (SW-FACTS-01); after every edit run `pnpm --filter @loom/core titi:facts` and commit the regenerated files with it (`generated/questions.loom`, `codex/9-facts.loom`, `generated/print-stacks.md`, the marked blocks in `trabolta.mind.md` + DESIGN.md §2.11). Dates follow OCT31.md §4.

| By | Do | Where | Check |
|---|---|---|---|
| **Wed 10-21** (before the Sat 10-24 12:00 content lock for print batch 2) | Replace the **DRAFT hunt questions** H1–H6 and F1–F2 (the `draft: true` rows: `text`, `answer`, the `accept` aliases, `where` / `hint`); keep the rounds 3 / 3 / 2 and give H4 a `topics` entry the finale-claim check accepts | `facts.json` `questions` | `titi:facts` → `--check` green; `core/test/trapped-in-the-internet.test.ts`; stagehand `tests/test_secrets.py` |
| **Wed 10-21** | **Check the 24 character facts** (category `character`: they quote the invitations' real-world details — the user's call before anything is printed) and the two DRAFT main facts (M22, M23) | `facts.json` `facts` | read `codex/9-facts.loom` after regenerating; the show test proves no entry gives away a hunt answer |
| **Mon 10-26** (print batch 2, after the run-through; batch 1 on 10-22 is the 42 hand-authored codex posters) | **Print the stacks**: Run → 🖨 Print sheet → sort the codex posters into the piles of `generated/print-stacks.md` (gold = the hunt answers, green = main, …) and hide each pile where its row says, in The Desktop's newspapers / encyclopaedias; photograph each | `generated/print-stacks.md` | every stack found again at the 10-30 set-up (OCT31.md §11, item 12) |
| **Fri 10-23** | Replace the **DRAFT truths** TD05–TD20 (Jean Trabolta asks them on the TV when the bottle lands on Truth; TD01–TD04 are the team's own four) | `facts.json` `truths` | `titi:facts` → the generated `Truth Question` beat carries every truth |
| **Sun 10-25** (the run-through) | **Rehearse the hunt and the wallet on the server project** (the preview), never a local folder: a folder run has no judge and no Wallet room. V6 → ⏱ → 📋 → 🍾 with real phones; two phones + the CRA booth for the wallet; 🤷 → the 🚨 card → 🛡 | OCT31.md §5 *Wave 4 status* | the device checks in that table ticked |
| **Fri 10-30** (code freeze) | `scripts/ops/predeploy.sh` runs `pnpm --filter @loom/core titi:facts --check` as its first story gate (SW-FACTS-02); ship the server **before** the `sync-show` that carries `facts.json` or the king maps | OCT31.md §5 deploy log | `--check` prints "5 outputs up to date with facts.json" |

### Package → HW ids

Every open hardware P0/P1 item is in exactly one package. The six not listed here are owned by a software WP: HW-PROP-04 and HW-PATCH-06 (WP-24), HW-PATCH-04 (WP-39), HW-NET-07 (WP-61), HW-NET-05 (WP-63b) and HW-SAFE-05 (WP-64).

| Package | HW ids | Person-days · lead time |
|---|---|---|
| H-01 Find, bench and triage the old Android tablets (+ SP-1/SP-5) | HW-SCR-06, HW-SCR-08 | 2 · 2–4 weeks sourcing |
| H-02 Show network | HW-NET-01, 02, 03, 04, 06, HW-TENT-05 | 2.5 · LTE router + SIM, outdoor AP, Zigbee coordinator, UPS |
| H-03 TV computer + 16-out interface | HW-AUD-07, HW-AUD-08, HW-SCR-03 | 1.5 · buy the computer / DA converter if needed |
| H-04 Room speakers, runs, audio walk, tent/shed speaker | HW-AUD-04, 09, 10, 11 | 3 · speakers + cables (2 rooms first) |
| H-05 Lights | HW-LIT-01, 02, 03, 04, 05, 06, 07, 08, 10 *(wave 20: the server room's RGB bulb, paired on the CC2652P, placed in the map editor)* | 5.5 · PAUTIX controllers |
| H-06 Server-room door: reed (primary) + copper tape (fallback) + indicator + siren *(wave 7: the wire-loop contact that closes when the door opens is the default, the reed optional, + a standalone keypad lock, HW-DOOR-09; **wave 20: the door sensor is the M4's LED + LDR on Steph's laptop, HW-DOOR-10 / 11; HW-DOOR-01 / 03 / 06 retired, D16**)* | HW-DOOR-04, 05, 10, 11 (~~01, 03, 06~~) | 2 · the M4 is owned; an LDR, an LED, a shroud tube |
| H-07 Patch bay: bench test, wiring, firmware, feedback | HW-PATCH-01, 02, 03, 05, 07 | 6 · AliExpress lead time |
| H-08 Tent: Quests in dev mode, tablet, virus props, shed fallback | HW-TENT-01, 02, 03, 04, 06 | 2.5 · Meta developer account |
| H-09 Install + provision the wall terminals | HW-SCR-01, 02, 05 | 1.5 · after H-01 and WP-22a |
| H-10 Media production | HW-AUD-01, 02, 03, 05, 06, 12, 13, 14, 15 | 9 · creative, 3–5 weeks |
| H-11 Props | HW-PROP-01, 02, 03, 06, 07, 08, 11, 12 | 8 · crafts |
| H-12 Safety + weather | HW-SAFE-01, 02, 03, 04 | 2 · GFCI, flood |
| H-13 Chess phone set-up + mount | HW-CHESS-01 | 0.5 · after SP-5 |
| H-14 Measure the house, the tent spot and the shed (feeds WP-46) | — | 1.5 · a weekend |
| H-15 The Ollama laptop on the show LAN (its model setup is in WP-40; never-sleep is in H-02) | — | 0.5 · by day 21 |

---

## Story content follow-ups lane

**Each language or app WP swaps its own story workarounds when it lands** (+0.5 day in its estimate). Lane A owns the `.loom` files. Paths are relative to this folder.

| Lands with (day) | Story change | Files | Items |
|---|---|---|---|
| WP-05 (6.5) | `unlock X for group(G)` / `for everyone` replaces the per-member ROLE watchers. `start quest … for everyone` replaces the quest catch-up watchers. `move who to {expr}` replaces the check-in if-chain. `top()` / `bottom()` / `len` replace the argmax watchers. `broadcast … to staff(X)` replaces the TRAIT `reply` readouts | `main.loom` (catch-up ≈ :634, if-chain ≈ :548), `quests.loom:10`, `cast/kit.loom`, `cast/hosts.loom`, `cast/antivirus.loom` | SW-ENG-01/02/04/08 |
| WP-25 (7.5) | The Installation Wizard's phone `video` card in the capture/queue beat; the `cue tablet_wizard` workaround retired | `beats/internet.loom`, `main.loom` | SW-PLAY-14, SW-RE-04 |
| WP-08 (14.5) | Declare the 8 `QUESTION`s (wave 4 did it with `facts.json` + the generated `generated/questions.loom` instead, and the server judge reads the same file). Add the **DM-lies rule** (#33): a confident wrong filing bumps `Kernel.lies_accepted`, Trabolta gives the identical reply either way, +50 ⓣ. The persona says "file it" when a guest asserts something. README: one DM bluff fails "all accurate" | `facts.json` → `generated/questions.loom` (via `titi:facts`) / `beats/hunt.loom`, `main.loom`, `trabolta.persona.md`, `README.md` | SW-ENG-17, SW-STORY-16 |
| WP-19 (14.5) | `found at: <LOCATION>` gates on the hunt and clue codex entries (a `facts.json` row's `where` is the natural source) | `facts.json` → `codex/9-facts.loom` (via `titi:facts`), `codex/*` | SW-QR-07 |
| WP-36 (15) | Room-routed `sound … rooms:` (the long form) can land from here | `atmosphere.loom`, `main.loom` | SW-AUD-01 |
| WP-39 (18.5) | **Cue names match the §2.13 registry** (`screens_trust_chart`, `screens_countdown_hunt`, …), one mechanical commit; `test_trapped_house.py` asserts them | `main.loom`, beats | SW-SH-02 |
| WP-09 (19.5) | The **takeover statement** ("GO TO THE LIVING ROOM") in the E4/E6 beats. Poll retraction replaces the `Night.poll` workaround | `beats/desktop.loom`, `beats/finale.loom`, `main.loom` | SW-PLAY-04, SW-ENG-13 |
| WP-10 (22.5) | The **Clippy-only codex** and the malware warning move to the performer-private channel, with an alert | `codex/7-clippy.loom`, `cast/staff.loom` | SW-PLAY-12 |
| WP-17 (25.5) | The **chess disarm rule**: a win at `Night.step >= 14` sets `Kernel.disarmed_until`, the door rule honours it, a watcher re-locks, plus a *The Cold Lock* codex entry *(wave 7: replaced — a win gives the winner *The Door Code*; no window, no re-lock; *The Cold Door* is the riddle)*. Also `rearm_server_room`, the new `loomcheck` detectors, and your content review | `beats/server-room.loom`, `codex/1-world.loom`, `main.loom`, `core/scripts/loomcheck.ts` | SW-CHESS-01, SW-ADM-10, SW-STORY-13, SW-STORY-11 |
| WP-20 (25.5) | **Check-in via the room QR:** `check_in_at_desktop` (`main.loom` ≈ :1023) and the room check-in become the scan event | `main.loom`, `rooms.loom` | SW-QR-06 |
| WP-07 (31.5) | **The 15 `Night.*_end` deadline watchers become real timers** (`start timer The Hunt for 15m`, `when timer … ends:`, `has 5m left`). `five_minute_warning` becomes a timer rule | `main.loom`, `cast/trabolta.loom` | SW-ENG-06 |
| WP-47 (37.5) | **No story change.** The tent ↔ shed switch is map + `Night.tent_site` only; don't add a `LOCATION The Shed` | — | SW-MAP-13 |
| WP-06 (38) | `when:` on the Bingo, pong, pickup, hunt and bathroom buttons, and the hooks' phase guards dropped. Trabolta's powers get `available:` by phase | `main.loom`, `cast/trabolta.loom`, `beats/pong.loom` | SW-ENG-03, SW-AI-07 |
| WP-15 (39) | `notify who "…"` for personal wake-ups instead of `!` broadcasts | `main.loom`, beats | SW-ENG-15 |
| WP-16 (42.5) | **The six per-question judge buttons** (`accurate_q1..3`, `confident_q1..3`, `main.loom` ≈ :1042–1062) become one judging INTERACTION with args (question, verdict) and `target: guest` | `main.loom` | SW-ADM-07 |
| WP-11 (44.5) | The `afk` expiry rule and the Bathroom label flip | `main.loom` | SW-PLAY-16 |
| WP-37 (52.5) | The house announcements (`do announce "…"`) gain `rooms:` | `atmosphere.loom`, `main.loom` | SW-AUD-05 |
| WP-51 (52.5) | **Ceremony beats**: the AWARDs (5 fixed + 3 bonus, a fallback per line), `codex/9-trophies.loom`, `start_the_ceremony`, the host per ending, the `ceremony` phase cue | `main.loom`, `codex/9-trophies.loom` (new), `trabolta.mind.md` | SW-STORY-15 |
| WP-49 (54.5) | `zip_everyone_out` uses release-all; the queue goes in capture order | `main.loom`, `beats/internet.loom` | SW-RE-06/08 |
| WP-43 (60) | `trabolta.mind.md` `phases:` become the phase map (`{stage, policy, drives, cue}`). Add `disclose:` / `never:` and the phase-keyed `unavailable:` hold lines | `trabolta.mind.md`, `trabolta.persona.md` | SW-AI-03/05/06 |
| WP-60 (61) | The host buttons `pay_truthcoin`, `the_line_works` and `no_pickup_line` give way to the give/trade routes and pickup-line input (built in wave 4: the Wallet room + Trabolta's `answer` card; `pay_truthcoin` / `charge_truthcoin` stay for corrections) | `main.loom`, `cast/hosts.loom` | SW-PLAY-08/09 |
| WP-32 (61.5) | Sandy's line as a chat bubble (#28: lore; optional cutscene video) | `beats/finale.loom` | SW-SCR-13 |

Dropped: the Trojan Horse shared identity (#24) and the zip-up question (#27).

---

## Gates, freezes and rehearsals

| Gate | When | What's proven | Type |
|---|---|---|---|
| G0 | end wk 1 (day 5) | The public HTTPS preview of the rewrite; a cellular join from an emailed link; codes and identities survive; spike answers (SP-1/4/8) | smoke test |
| (invites) | ≈ day 10 | Featured claims work → send the invitations (RSVP by day ≈ 25) | calendar |
| G1 | end wk 6 (day 30) | Scopes, QUESTION + File a fact + DM lies, takeover, staff alerts in a scripted Run-mode rehearsal; a locked-phone push on cellular; a room scan; one screen cue on the oldest tablet; one room sound; the house ↔ VPS link survives a 60 s pull; the Quest finds the duck | **Run-mode rehearsal** |
| (print) | day 33–34.5 | The test sheet scans on cellular on iPhone + Android → the real print run | calendar |
| G2 | end wk 9 (day 45) | **All P0** (day 41) + judging. Per-subsystem tech rehearsals in the house + **live-preview night #1** with friends (TV shows text for Trabolta) | tech rehearsal + friends |
| G3 | end wk 11 (day 55) | **Live-preview night #2**: the whole story, TV voice, house announcements, judging, chess, template ceremony. **Language freeze** | friends night |
| G4 | wk 13 (day 63) | **All P1. Feature freeze** (fixes only); ceremony rehearsal | freeze |
| G5 | wk 14 (day ≈ 67) | **Full dress rehearsal** (WAN pull, tent ↔ shed) → **code freeze** → pinned deploy → safety walk | **dress rehearsal** |

At every gate: tick the WPs, re-date the checklist's "Last reviewed" line, move unfinished WPs, and re-apply the cut table against the party date.

---

## The cut line

**Everything at P2 is below the cut line**, except SW-ENG-13 and SW-MAP-09, which are pulled into WP-09 and WP-45. That includes SW-MAP-14 (map props palette, measure, redo) and SW-CHESS-06 (anti-cheat). Pick P2s up only after G4, if there's slack.

If time runs short, cut P1s in this order (least loss first). Each has a working fallback, and each sits at the end of its lane:

| # | Cut | Saves | Fallback |
|---|---|---|---|
| 1 | WP-60 Truthcoin + pickup line | 4.5 d | The host buttons `pay_truthcoin` / `the_line_works`; trades happen in person |
| 2 | WP-41 Tech rail | 3.5 d | Watch the Mind tab, the Z2M frontend and the terminal grid by eye |
| 3 | WP-45 Map structural editing + walkability | 5 d | The JSON tab + underlay; `pnpm test:vr`'s autopilot checks duck reachability |
| 4 | WP-58 phone cue page + WP-59 Run → Screens | 5.5 d | Cue from the laptop |
| 5 | WP-32 Songs | 3.5 d | Audio only from the router; lyrics on the TV as a slide |
| 6 | WP-30b The rest of the templates | 3 d | Keep slides + countdowns (WP-30a); Trabolta and Clippy read the notepad aloud; the Y2K clock as a slide |
| 7 | WP-65 Reload, keep the run | 3 d | Identities survive a restart (SW-QR-17), so a restart costs story progress, not registrations. Patch only at a natural break |
| 8 | WP-43 Phase map | 4.5 d | The director presses **set stage** on Run → Mind at each phase |
| 9 | WP-11 Bathroom Mode | 3.5 d | The buried INTERACTION + a director's eye on `afk` |
| 10 | WP-49, part of it | ≈ 2 d | Keep zip-out; queue by hand |
| 11 | WP-53 Trabolta writes the ceremony | 3 d | **Contradicts #26** (genuine AI lines). WP-51's templates run the whole ceremony. Cut only right before the ceremony itself |
| 12 | The ceremony chain WP-50/12/51/52/54 | 16 d | **Contradicts #26.** Clippy runs the awards by hand from Run → World numbers |
| 13 | WP-55/56 chess | 8.5 d | **Contradicts #29.** Any chess app on the phone; the director presses `chess won` (SW-CHESS-07) |

WP-16 (judging UIs) is no longer cuttable in practice: it finishes before G2. If it slips, the six per-question buttons simply stay, because WP-16 owns their swap.

**Never cut:** WP-22a/22b scoped device tokens, WP-42 Trabolta live verifications (or run `lookup: false`, Decision #10), WP-18 hidden Trabolta, or any P0.

### If the party is in N weeks, cut here

Weeks count from the start of work. Show-ready ≈ the last software day + 4 (dress 2.5, freeze 1). "With rebalancing" means a lane that runs out of work picks up the binding lane's next package. The simulated ends came from a throwaway simulation script (not kept in the repo).

| Weeks to the party | Lanes | What fits | Cut |
|---|---|---|---|
| **≥ 17** | 3 or 4 | Everything P0 + P1, with ≥ 3 weeks of buffer | Nothing; P2s after G4 |
| **15–16** | 4 | Everything + 1–2 weeks of buffer | Nothing |
| **14** | 4 | Everything, no buffer (software ends day 63, ready day ≈ 67) | Pre-cut **1–5** (22 d): software ends day 60 (≈ 56 with rebalancing), which buys a week of slack |
| **12–13** | 4 | All P0 + most P1 (the template ceremony, judging, chess, TV voice, house announcements) | Cut **1–10** (≈ 38 d): software ends day 56 (≈ 52 with rebalancing), ready ≈ day 56–60 |
| **11** | 4 | P0 + judging + chess + the TV voice + the house announcements | Cut **1–12** (≈ 58.5 d): software ends ≈ day 52.5 (≈ 47 with rebalancing) |
| **10** | 4 | P0 + the never-cut P1s + the TV voice | Cut **1–13**, plus WP-37 (the announcements are pre-rendered and played by the router, HW-AUD-05): software ends ≈ day 48 (≈ 44 with rebalancing), dress in week 10 |
| **< 10** | 4 | P0 + the never-cut P1s need ≈ 9 weeks on 4 lanes, plus a rehearsal week | **Re-scope P0 itself**: terminals stay on `view=mirror` (SW-SCR-02), audio from one laptop, push skipped (guests keep the app open), the map stays a placeholder. Talk it through before starting |

---

## Decisions still open, and when they're needed

| Decision | Default until answered | Needed by |
|---|---|---|
| **The party date** | — | **Day 7** (the invitations go out ≈ day 10, and the cut table depends on it) |
| #4 (Excel's plant), #8 (MS Paint on Cat's sheet), and the featured-sheet parts of #12 | The spec's defaults | **Day 7**: they're printed on the invitations' character sheets |
| The rest of #1–#12 (incl. #12 = the SW-STORY-11 content review; the Installation Wizard's backstory by week 3, before the shoot) | The spec's defaults | **Day 20**, for WP-17 (day 22.5); hard stop at the print run (day 33) |
| RSVP deadline | Day ≈ 25 | WP-23 (day 28.5) imports the RSVP CSV for badges |
| #10 `lookup: true` for Trabolta | `lookup: false` | Can be decided once WP-08 lands (day 14.5); confirmed live in WP-42 (day 42.5), before night #1 |
| ~~#28 How Sandy appears~~ | **Decided 2026-10-15:** lore only, optional cutscene video | — |
| Patch-cable order / Combo B on main power (#18, partly answered) | Unordered cable sets; Combo B on cables | WP-39 (day 14.5) |
| **Push scope (#25, "all devices"), one line to confirm** | Every **phone** gets Web Push: guests (iPhone via Add to Home Screen), performers, directors. The **wall tablets, the TV and the chess phone don't**: they're always-on kiosks that hold the screen stream and heartbeat, and a missed heartbeat pushes an alert to the directors instead | Before WP-13 (day 14.5) |
| #33 interpretation, one line to confirm | A lie counts when it is **filed** (the sheet opens from the DM thread or a long-press on the guest's own message; the persona asks them to "file it"). The AI never judges free text | Before WP-08 (day 7.5) |

Assumed from the answers: there's no maglock (#17), so it's a door sensor + indicator only *(wave 7, #17 amended: plus a standalone keypad lock that nothing drives)*, and Press-A stays P2 (#19).

---

## What the 2026-10-15 critic passes changed

Folded into this schedule and into the checklist (counts recounted there: 302 items at the time; **335 after the Oct 31 passes incl. wave 4**, see the checklist's counts line).

- **New checklist items:** SW-QR-17 (identities survive a restart), SW-QR-18 (Run → Devices), SW-ENG-18 (journal `at`), SW-OPS-21 (lean mod stream, P0), SW-ADM-14 (reload, keep the run), SW-CHESS-08 (full game, P1), SW-MAP-14 (map polish, P2). Their content was split out of SW-QR-08, SW-QR-10, SW-MAP-03 and SW-CHESS-06, or found by the reality pass.
- **Raised to P0:** SW-QR-10 (scoped tokens: the house → VPS link needs them) and SW-SCR-25 (media precache: the uplink can't carry a synced ad hijack).
- **One owner per id:** SW-OPS-17 is closed by WP-15 (WP-13 pins the keys, WP-24 prints the sign). SW-ENG-15 lands whole in WP-15. SW-ADM-07 lands whole in WP-16, which also owns the judge-button swap. SW-MAP-03 is in WP-45 only (WP-44 does its `MapApp` split first). SW-AI-08 is in WP-40. SW-AI-02's code moved into WP-08; WP-42 keeps only the live checks.
- **Splits:** WP-22 → WP-22a (server, P0, before WP-40) + WP-22b (UI). WP-30 → WP-30a (slides + countdown, before night #1) + WP-30b.
- **Re-estimates against the code:** WP-05 +1.5, WP-06 +1, WP-08 +0.5 tax, WP-09 +0.5, WP-18 −1, WP-25 −1.5, WP-27 +0.5, WP-28 +1.5, WP-36 +1, WP-44/45 re-scoped, WP-47 +1, WP-50 +0.5, WP-56 +1.5 (+1 full game), WP-60 +1, WP-12 −0.5 (data only). There's a 0.5-day language tax on WP-07/08/12/15 and a 0.5-day story swap per language WP; WP-17 shrank 5 → 3. Net: 234 → 245.5 dev-days. All P0 moved from day 39.5 to day 41, and show-ready from ≈ 62 to ≈ 67.
- **Dependency fixes:** the WP-08 secrecy test is green on day 14.5 (it was partial until day 35.5); scoped tokens land before the house link; judging and File a fact land before night #1; the ceremony templates are ready for G3 (WP-49 is a soft edge); the cue rename moved into WP-39, so the stagehand test is written once; the map survey no longer waits for structural editing (WP-46 → WP-44 is soft); the countdowns' wall-clock anchor (SW-AUD-03) lands before timers; the Quest risk is retired on day 14.5 (it was day 29.5).
- **The SW-PLAY-05 typo** ("pairs with SW-ENG-07") now reads SW-ENG-06 in the checklist.
- **Still schedule-level notes, not checklist edits:** SW-QR-04, SW-PLAY-06 and SW-AUD-06 are P1 but effectively P0 (a P0 needs them), and SW-PLAY-02 is an umbrella that closes with WP-13 + WP-14 + WP-15.
