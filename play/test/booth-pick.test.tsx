// Wave 18 (booth lane): PLAYER SELECT (BOOTH-SPEC §4.7), the Rows window
// (§4.10), the door queue window (§4.4), the 🔔 Waiting window (§4.13) and
// Clippy's 🎤 ON MIC bar (§4.9).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PlayerSelect, sameLabel, stepHelper } from "../src/booth/pick/select.tsx";
import { RowsWindow, THEYRE_HERE, isSummons, rowLabel } from "../src/booth/pick/rows.tsx";
import { GuestTiles } from "../src/booth/pick/tiles.tsx";
import { DoorWindow } from "../src/booth/door.tsx";
import { WaitingWindow } from "../src/booth/waiting.tsx";
import { ClippyCueBar, callMarks, callerChip, clippyFire, nextForYou, sheetNext, yourCue } from "../src/booth/cue-bar.tsx";
import { wizardSteps } from "../src/booth/popouts/model.ts";
import { PopOutScope } from "../src/booth/popouts/rung.ts";
import { ApiError } from "../src/client.ts";
import type { BoothObjective, CallsView } from "../src/booth/wire.ts";
import type { Interaction, PrimeGuest } from "../src/types.ts";
import type { PrimeSession } from "../src/session/prime.ts";

const noop = () => {};
const press = () => Promise.resolve({ ok: true as const, guest: null });
const G = (id: string, location: string | null = "Desktop"): PrimeGuest => ({ id, name: id, faction: null, captured: false, location });
const guests = ["Encarta", "Winamp", "ICQ"].map((n) => G(n));
const I = (id: string, label: string, extra: Partial<Interaction> = {}): Interaction => ({ id, label, who: "performer", description: null, ...extra });
const ints = [I("bingo_winner", "🎱 Bingo winner"), I("award_the_ribbon", "🎀 Give the Bingo Ribbon"), I("named_at_bingo", "🎯 Named on the card: marked for reinstallation"), I("made", "🏓 Made"), I("missed", "🏓 Missed: marked for reinstallation"), I("check_in_at_desktop", "📍 Check in")];
const celebrate: BoothObjective = {
  id: "ci2",
  title: "CI 2: celebrate the winners",
  brief: "",
  act: null,
  pick: ["Encarta", "Winamp", "ICQ"],
  buttons: ["bingo_winner", "award_the_ribbon", "named_at_bingo"],
  checklist: [
    { label: "🎱 Who shouted BINGO?", done: false },
    { label: "🎀 Give the winner the Bingo Ribbon", done: false },
    { label: "🎯 Who did the winner name?", done: false },
  ],
};

describe("PLAYER SELECT (§4.7)", () => {
  const steps = wizardSteps(celebrate, ints);
  it("opens on step ① with the move chips, the to-do line and the tiles at hand", () => {
    const html = renderToStaticMarkup(<PlayerSelect objective={celebrate} steps={steps} guests={guests} press={press} onClose={noop} onLater={noop} />);
    expect(html).toContain("PLAYER SELECT · CI 2: celebrate the winners");
    expect(html).toContain("MOVE");
    expect(html).toContain("① 🎱");
    expect(html).toContain("② 🎀");
    expect(html).toContain("③ 🎯");
    expect(html).toContain("🎱 Who shouted BINGO?");
    expect(html).toContain("Tap the program.");
    expect(html).toContain("At hand (3)");
    expect(html).toContain("🔍 Not here? Search everyone");
    expect(html).toContain("Skip");
    expect(html).toContain("Later");
  });
  it("words: SAME's button, each step's helper", () => {
    expect(sameLabel(steps[1]!)).toBe("🎀 Give");
    expect(stepHelper(steps[0]!, 0)).toBe("Tap the program.");
    expect(stepHelper(steps[1]!, 1)).toBe("…or tap someone else below");
    expect(stepHelper(steps[2]!, 2)).toBe("Tap the program, then tap again.");
  });
  it("tiles: the chosen one navy, a greyed one names why and can't be picked", () => {
    const html = renderToStaticMarkup(<GuestTiles list={guests} everyone={guests} chosen="ICQ" greyed={new Map([["Encarta", "(bingo winner)"]])} onPick={noop} />);
    expect(html).toMatch(/tile chosen[^"]*" aria-selected="true"|aria-selected="true"[^>]*tile chosen/u);
    expect(html).toContain("(bingo winner)");
    expect(html).toMatch(/tile  greyed" disabled|disabled=""[^>]*greyed|greyed"[^>]*disabled/u);
  });
});

describe("the Rows window (§4.10)", () => {
  const judge: BoothObjective = { id: "judge_the_cup", title: "Truth Pong: judge the cup", brief: "", act: null, checklist: [], buttons: ["made", "missed"], pick: ["Encarta", "Winamp"] };
  it("one row per program with its buttons; a destructive one says · ×2", () => {
    const html = renderToStaticMarkup(<RowsWindow objective={judge} opened={judge} interactions={ints} guests={guests} placeTitle={(l) => `The ${l}`} press={press} onCard={noop} onClose={noop} />);
    expect(html).toContain("Truth Pong: judge the cup · 2 left");
    expect(html).toContain("🏓 Made");
    expect(html).toContain("🏓 Missed: marked for reinstallation · ×2");
    expect(html).toContain("📍 The Desktop");
    expect(html).not.toContain("Find a program");
    expect(rowLabel(ints[4]!, true)).toBe("Tap again");
  });
  it("the summons: They're here, the self-check-in note, and Summons over. with the board", () => {
    const summons: BoothObjective = { id: "summons_door", title: "Summons Door", brief: "", act: null, checklist: [], buttons: ["check_in_at_desktop"], pick: ["ICQ"] };
    expect(isSummons(summons)).toBe(true);
    const html = renderToStaticMarkup(<RowsWindow objective={summons} opened={summons} interactions={ints} guests={guests} placeTitle={(l) => l} countdown="⏳ 3:41" press={press} onCard={noop} onClose={noop} />);
    expect(html).toContain(THEYRE_HERE.replace("'", "&#x27;"));
    expect(html).toContain("They check themselves in with the Desktop QR. Tap 📍 only for a phone that&#x27;s dead or lost.");
    expect(html).toContain("⏳ 3:41");
    const over = renderToStaticMarkup(<RowsWindow objective={undefined} opened={summons} interactions={ints} guests={guests} placeTitle={(l) => l} wanted={3} onBoard={noop} press={press} onCard={noop} onClose={noop} />);
    expect(over).toContain("Summons over.");
    expect(over).toContain("🚨 Open the Wanted board");
  });
  it("a long list gets a search box", () => {
    const many = Array.from({ length: 9 }, (_, n) => G(`p${n}`));
    const html = renderToStaticMarkup(<RowsWindow objective={{ ...judge, pick: many.map((g) => g.id) }} opened={judge} interactions={ints} guests={many} placeTitle={(l) => l} press={press} onCard={noop} onClose={noop} />);
    expect(html).toContain("Find a program…");
  });
});

describe("the door queue window (§4.4)", () => {
  it("lists who waits, for how long, who has them; Mine with A4", () => {
    const q = [{ id: "winamp", name: "Winamp", since: 0, claimedBy: null }, { id: "icq", name: "ICQ", since: 30_000, claimedBy: "McAfee" }];
    const html = renderToStaticMarkup(<DoorWindow queue={q} now={100_000} me="Norton" canClaim onClaim={noop} onScan={noop} onCard={noop} onClose={noop} />);
    expect(html).toContain("At the door (2)");
    expect(html).toContain("waiting 1:40");
    expect(html).toContain("🙋 Mine");
    expect(html).toContain("McAfee has them");
    expect(html).toContain("📷 Scan the next pass");
  });
});

describe("the 🔔 Waiting window (§4.13)", () => {
  it("is empty and says so", () => {
    const html = renderToStaticMarkup(
      <PopOutScope session="t">
        <WaitingWindow onClose={noop} />
      </PopOutScope>,
    );
    expect(html).toContain("Waiting (0)");
    expect(html).toContain("Nothing waiting. You&#x27;re on top of it.");
  });
});

describe("Clippy's 🎤 bar (§4.9)", () => {
  const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, n: 1, code: null, title: id, fired: false, last: false, next: false, sequence: true, live: false, subject: false, act: null, description: null, ...extra });
  const calls = (rows: ReturnType<typeof row>[], extra: Partial<CallsView> = {}): CallsView => ({ rows: rows as CallsView["rows"], next: null, last: null, lastName: null, act: null, presses: 7, ...extra });
  it("your cue is only your row that is the sheet's NEXT; else the next one for you (BN-F1)", () => {
    // Live all night (no while:), fired or not, out of order: never your cue.
    expect(yourCue(calls([row("a", { live: true, fired: true }), row("b", { live: true })]).rows)).toBeNull();
    expect(yourCue(calls([row("a", { live: true }), row("b", { live: true, next: true })]).rows)?.id).toBe("b");
    expect(yourCue(calls([row("a", { live: true }), row("b", { live: true })]).rows, "a")?.id).toBe("a");
    expect(yourCue(calls([row("a")]).rows)).toBeNull();
    expect(nextForYou(calls([row("a", { fired: true }), row("b")]).rows)?.id).toBe("b");
    // The first unfired in running order, live or not; an off-sequence fallback only when nothing else waits.
    expect(nextForYou(calls([row("hunt_over", { sequence: false }), row("bingo", { live: true })]).rows)?.id).toBe("bingo");
  });
  it("binds the arm to Clippy's marks; line 2 reads the sheet's NEXT and the caller", () => {
    const c = calls([row("bingo_time", { live: true, fired: true, title: "⏰ Bingo time" })], { last: "bingo_time", lastName: "Clippy", next: "bingo_time", caller: { name: "Task Manager", at: 1 } });
    expect(callMarks(c)).toEqual({ last: "bingo_time", fired: ["bingo_time"], presses: 7, lastName: "Clippy" });
    expect(sheetNext(c, c.rows[0]!)).toBe("the same");
    expect(sheetNext({ ...c, next: "introduce_trabolta" }, c.rows[0]!)).toBe("introduce_trabolta");
    // BN-F11: the server's title, never the raw id, when it sends one.
    expect(sheetNext({ ...c, next: "introduce_trabolta", nextTitle: "🤖 Introduce Trabolta" }, c.rows[0]!)).toBe("🤖 Introduce Trabolta");
    expect(callerChip(c, "Clippy")).toBe("📣 Task Manager");
    expect(callerChip({ ...c, caller: { name: "Clippy", at: 1 } }, "Clippy")).toBe("📣 You");
    expect(callerChip({ ...c, caller: null }, "Clippy")).toBeNull();
  });
  it("renders only for a booth that gets calls: yellow YOUR CUE + ARM, or grey next for you", () => {
    const s = (cv: CallsView | undefined) => ({ view: { character: "Clippy", guests: [], channels: [], spaces: [], ...(cv !== undefined ? { calls: cv } : {}) }, auth: { token: "t", character: "Clippy", admin: false, eventId: "e" } }) as unknown as PrimeSession;
    expect(renderToStaticMarkup(<ClippyCueBar session={s(undefined)} now={0} />)).toBe("");
    const live = renderToStaticMarkup(<ClippyCueBar session={s(calls([row("bingo_time", { live: true, next: true, code: "V3", title: "⏰ Bingo time" })]))} now={0} />);
    expect(live).toContain("cue-bar live");
    expect(live).toContain("🎤 YOUR CUE");
    expect(live).toContain("V3");
    expect(live).toContain(">ARM<");
    const wait = renderToStaticMarkup(<ClippyCueBar session={s(calls([row("bingo_time", { title: "⏰ Bingo time" })], { next: "introduce_trabolta" }))} now={0} countdowns={[{ label: "Bingo", endsAt: 252 } as never]} />);
    expect(wait).toContain("cue-bar waiting");
    expect(wait).toContain("🎤 next for you");
    expect(wait).toContain("⏳ 4:12");
    expect(wait).toContain("NEXT: introduce_trabolta");
  });
  it("fires over /api/prime/cue: a 409 moved drops the arm, a refusal says not taken", async () => {
    let body: unknown[] = [];
    const ok = clippyFire({ cue: async (...a) => ((body = a), {}) });
    expect(await ok("bingo_time", null, undefined, 7)).toEqual({ ok: true });
    expect(body).toEqual(["bingo_time", null, null, 7]);
    const moved = clippyFire({ cue: async () => { throw new ApiError("the cues moved", 409); } });
    expect(await moved("x", null, undefined, 1)).toMatchObject({ ok: false, moved: true });
    const refused = clippyFire({ cue: async () => ({ refused: true }) });
    expect(await refused("x", null, undefined, 1)).toEqual({ ok: true, refused: true });
  });
});
