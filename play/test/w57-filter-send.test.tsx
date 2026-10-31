// Wave 57 (docs/loom-w48-contract.md C15): 🛡 from the filter, beside ✂ and
// Let it go. The server says when it is on offer (`FilterLine.send`); here
// the pop-out's and the window's button, its two taps, the booth's ordinary
// press, and that ✂ and Let it go still stand after it.
import { renderToStaticMarkup } from "react-dom/server";
import { type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { elements, mountHooks } from "./hooks-harness.ts";
import { ARM_LINE } from "../src/arm.ts";
import { ApiError } from "../src/client.ts";
import { memoryStore } from "../src/host.ts";
import { bindDraft, type BoothOpeners } from "../src/booth/popouts/use-booth-popouts.ts";
import { FILTER_COPY, FILTER_SEND_COPY, filterDraft, sendDone, sendRefusal } from "../src/booth/filter/model.ts";
import { useFilter, type FilterApi, type FilterSource } from "../src/booth/filter/use-filter.ts";
import { FilterRow, FilterWindow } from "../src/booth/filter/window.tsx";
import type { FilterLine, PrimeActResult, PrimeView } from "../src/types.ts";

const LABEL = "🛡 Send to the Internet";
const SEND = { id: "send to the internet", label: LABEL };
const noop = () => {};
const L = (seq: number, extra: Partial<FilterLine> = {}): FilterLine => ({ seq, guest: `g-${seq}`, name: `Program ${seq}`, where: "# lobby", text: "what the hell", hits: [{ start: 9, end: 13 }], words: ["hell"], ts: seq * 1000, ...extra });
const PV = (lines: FilterLine[]): PrimeView => ({ character: "Password Manager", faction: null, guests: [], channels: [], spaces: [], interactions: [], objectives: [], player: true, filter: { flagged: lines.length, censored: 0, lines } }) as PrimeView;
const answer = (replies: string[], extra: Partial<PrimeActResult> = {}): PrimeActResult => ({ ok: true, replies, ...extra });

const ids = (d: ReturnType<typeof filterDraft>) => d.actions.map((a) => a.id);

describe("the 🔑 LANGUAGE pop-out", () => {
  it("offers 🛡 only when the view does; ✂ and Let it go stay either way", () => {
    expect(ids(filterDraft(L(1), 1))).toEqual(["censor", "let"]);
    expect(ids(filterDraft(L(1, { send: SEND }), 1))).toEqual(["censor", "send", "let"]);
    expect(ids(filterDraft(L(1, { send: SEND }), 3))).toEqual(["censor", "send", "let", "all"]);
  });

  it("🛡 is the story's button, armed, and stays up after: the line is still to judge", () => {
    const a = filterDraft(L(1, { send: SEND }), 1).actions.find((x) => x.id === "send")!;
    expect(a).toMatchObject({ label: LABEL, arm: true, closes: false, do: { kind: "send", seq: 1 } });
    expect(a.armedLabel).toBe(`${LABEL}? Their phone locks.`);
    expect(a.kind).toBeUndefined();
  });

  it("its status line says what came of it, over the hint", () => {
    expect(filterDraft(L(1), 1).status).toBe(FILTER_COPY.hint);
    expect(filterDraft(L(1), 1, "Logged: Program 1 sent to the Internet. ⭐ +20").status).toBe("Logged: Program 1 sent to the Internet. ⭐ +20");
  });

  it("the press goes to the booth's send, with its line", async () => {
    const calls: number[] = [];
    const openers: BoothOpeners = { act: async () => {}, card: noop, scan: noop, board: noop, door: noop, pick: noop, cue: noop, send: async (seq) => void calls.push(seq) };
    const spec = bindDraft(filterDraft(L(4, { send: SEND }), 1), openers, noop);
    await spec.actions.find((a) => a.id === "send")!.run();
    expect(calls).toEqual([4]);
  });
});

describe("what a 🛡 came to", () => {
  it("the story's reply, or plain words", () => {
    expect(sendDone(answer(["Logged: Napster sent to the Internet. ⭐ +20"]), "Napster")).toEqual({ kind: "done", text: "Logged: Napster sent to the Internet. ⭐ +20" });
    expect(sendDone(answer([" "]), "Napster")).toEqual({ kind: "done", text: FILTER_SEND_COPY.sent("Napster") });
    expect(sendDone(null, "Napster")).toEqual({ kind: "done", text: FILTER_SEND_COPY.sent("Napster") });
  });
  it("the story refused: its reason, else not right now", () => {
    expect(sendDone(answer(["Napster is already in the Internet."], { refused: true }), "Napster")).toEqual({ kind: "refused", text: "Napster is already in the Internet." });
    expect(sendDone(answer([], { refused: true }), "Napster")).toEqual({ kind: "refused", text: FILTER_SEND_COPY.refused.notNow });
  });
  it("a failed POST in plain words", () => {
    const r = FILTER_SEND_COPY.refused;
    expect(sendRefusal(new ApiError("doors are closed", 409)).text).toBe(r.doors);
    expect(sendRefusal(new ApiError("not your button: “🛡” is for Antivirus", 403)).text).toBe(r.notYours);
    expect(sendRefusal(new TypeError("Failed to fetch")).text).toBe(r.offline);
    expect(sendRefusal(new ApiError("boom", 500)).text).toBe(r.other("boom"));
  });
});

/** `useFilter` under the hooks harness, its view swappable. */
function rig(act: FilterSource["act"], lines: FilterLine[] = [L(1, { send: SEND })]) {
  const storage = memoryStore();
  let view = PV(lines);
  const src = (): FilterSource => ({ auth: { token: "tok-w57" }, view, ...(act !== undefined ? { act } : {}) });
  const h = mountHooks((p: { s: FilterSource }) => useFilter(p.s, storage), { s: src() });
  return {
    h,
    get api() {
      return h.output as FilterApi;
    },
    setLines(next: FilterLine[]) {
      view = PV(next);
      h.rerender({ s: src() });
    },
  };
}

describe("useFilter's 🛡", () => {
  it("presses the line's button on the line's program; the line stays; the view drops 🛡", async () => {
    const act = vi.fn(async () => answer(["Logged: Program 1 sent to the Internet. ⭐ +20"]));
    const r = rig(act);
    const before = r.api.key;
    expect(await r.api.send(1)).toEqual({ kind: "done", text: "Logged: Program 1 sent to the Internet. ⭐ +20" });
    r.h.act(noop);
    expect(act).toHaveBeenCalledWith("send to the internet", "g-1");
    expect(r.api.waiting.map((l) => l.seq)).toEqual([1]);
    expect(r.api.sent(1)).toBe("Logged: Program 1 sent to the Internet. ⭐ +20");
    expect(r.api.refusal(1)).toBeNull();
    expect(r.api.key).not.toBe(before);
    const held = r.api.key;
    r.setLines([L(1)]);
    expect(r.api.key).not.toBe(held);
  });

  it("a refusal is said in place, and a line gone takes its note with it", async () => {
    const r = rig(async () => {
      throw new ApiError("doors are closed", 409);
    });
    expect((await r.api.send(1)).kind).toBe("refused");
    r.h.act(noop);
    expect(r.api.refusal(1)).toBe(FILTER_SEND_COPY.refused.doors);
    expect(r.api.sent(1)).toBeNull();
    r.setLines([]);
    expect(r.api.refusal(1)).toBeNull();
  });

  it("nothing to press: a line the view stopped offering, or no session", async () => {
    const act = vi.fn(async () => answer([]));
    const r = rig(act, [L(1)]);
    expect((await r.api.send(1)).text).toBe(FILTER_SEND_COPY.refused.notNow);
    expect(act).not.toHaveBeenCalled();
    expect((await rig(undefined).api.send(1)).text).toBe(FILTER_SEND_COPY.refused.notNow);
  });
});

describe("the filter window's 🛡", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a row draws it only when offered, and says what came of it", () => {
    const row = (extra: Partial<Parameters<typeof FilterRow>[0]> = {}) => renderToStaticMarkup(<FilterRow line={L(1, { send: SEND })} now={0} armed={false} busy={false} refusal={null} onCensor={noop} onLetGo={noop} onSend={noop} {...extra} />);
    expect(row()).toContain(LABEL);
    expect(row()).toContain(FILTER_COPY.censor);
    expect(row()).toContain(FILTER_COPY.letGo);
    expect(renderToStaticMarkup(<FilterRow line={L(1)} now={0} armed={false} busy={false} refusal={null} onCensor={noop} onLetGo={noop} onSend={noop} />)).not.toContain(LABEL);
    expect(row({ sendArmed: true })).toContain(`${LABEL}? Their phone locks.`);
    expect(row({ sendArmed: true })).toContain(ARM_LINE);
    expect(row({ sent: "Logged." })).toContain('<p class="filter-sent" role="status">Logged.</p>');
  });

  it("takes two taps, and its arm is not ✂'s", async () => {
    vi.useFakeTimers({ now: 50_000 });
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: noop, removeEventListener: noop });
    vi.stubGlobal("window", { addEventListener: noop, removeEventListener: noop });
    const sent: number[] = [];
    const lines = [L(1, { send: SEND })];
    const api = { view: PV(lines).filter!, waiting: lines, censor: async () => ({ kind: "gone" as const }), letGo: noop, refusal: () => null, game: null, send: async (seq: number) => (sent.push(seq), { kind: "done" as const, text: "ok" }), sent: () => null };
    const h = mountHooks(FilterWindow, { api, now: 0, onClose: noop });
    const row = () => (elements(h.output).filter((e) => e.type === FilterRow) as Array<ReactElement<Parameters<typeof FilterRow>[0]>>)[0]!;
    h.act(() => row().props.onSend!());
    expect(sent).toEqual([]);
    expect(row().props.sendArmed).toBe(true);
    expect(row().props.armed).toBe(false);
    vi.advanceTimersByTime(500);
    h.act(() => row().props.onSend!());
    expect(sent).toEqual([1]);
    await vi.runAllTimersAsync();
    h.unmount();
  });
});
