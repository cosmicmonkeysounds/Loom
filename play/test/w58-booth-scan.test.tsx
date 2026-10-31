// Wave 58: a booth scans codex QRs. The scanner's wall branch, the typed box's
// fall-through, the phone camera's `?unlock=` link and the room's copy. The
// route itself is core's `test/w58-booth-scan.test.ts`.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BOOTH_CODE_MISSED, BOOTH_TYPED_NOTHING, redeemHeld, redeemNote, scanError } from "../src/booth/model.ts";
import { CameraScanner } from "../src/scanner.tsx";
import { Scanner, ScannerScreen } from "../src/booth/scanner.tsx";
import { GuestCardBody } from "../src/booth/card.tsx";
import { useUnlockLink, type UnlockLinkOptions } from "../src/booth/unlock-link.ts";
import { REDEEM_THROTTLED } from "../src/codex.ts";
import { ApiError } from "../src/client.ts";
import type { RedeemAnswer } from "../src/scan-done.tsx";
import type { PrimeSession } from "../src/session/prime.ts";
import { elements, mountHooks } from "./hooks-harness.ts";

const LINK = "https://app.example/?code=ABCD&unlock=duck-1";
const HIT: RedeemAnswer = { unlocked: "The Duck", title: "The Duck" };
const ALREADY: RedeemAnswer = { unlocked: null, already: "The Duck", title: "The Duck" };
const MISS: RedeemAnswer = { unlocked: null, missed: true };

function fakeSession(o: { redeem?: PrimeSession["redeem"]; scan?: PrimeSession["scan"]; printed?: PrimeSession["printed"] } = {}) {
  const redeem = vi.fn(o.redeem ?? (() => Promise.resolve(HIT)));
  const scan = vi.fn(o.scan ?? (() => Promise.reject(new Error("unknown guest"))));
  const printed = vi.fn(o.printed ?? (() => Promise.resolve(null)));
  const session = { auth: { token: "t", character: "Clippy", admin: false, eventId: "default" }, view: null, redeem, scan, printed } as unknown as PrimeSession;
  return { session, redeem, scan, printed };
}
type Screen = ReturnType<typeof mountHooks<Parameters<typeof ScannerScreen>[0]>>;
function mount(s: PrimeSession, extra: Partial<Parameters<typeof ScannerScreen>[0]> = {}): Screen {
  const h = mountHooks(ScannerScreen, { session: s, admin: false, onClose: () => {}, onOpenThread: () => {}, ...extra });
  h.act(() => {});
  return h;
}
const flush = async (h: Screen) => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  h.act(() => {});
};
/** What the booth's status line says now. */
function hint(h: Screen): string {
  const line = elements(h.output).find((e) => (e.props as { className?: string })?.className === "booth-scan-hint");
  return String((line?.props as { children?: unknown })?.children ?? "");
}
function error(h: Screen): string {
  const box = elements(h.output).find((e) => (e.props as { className?: string })?.className === "booth-err");
  return String((box?.props as { children?: unknown })?.children ?? "");
}
const read = (h: Screen, raw: string) => (elements(h.output).find((e) => e.type === CameraScanner)!.props as { onCode: (t: string) => void }).onCode(raw);
const type = (h: Screen, text: string) => (elements(h.output).find((e) => e.type === Scanner)!.props as { onScan: (id: string) => Promise<boolean> }).onScan(text);
const openCodexButton = (h: Screen) => elements(h.output).find((e) => e.type === "button" && JSON.stringify((e.props as { children?: unknown }).children ?? "").includes("Open my Codex"));


describe("the words", () => {
  it("say what came of a redeem, and a miss names no entry", () => {
    expect(redeemNote(HIT)).toBe("🔓 “The Duck” is in your Codex now.");
    expect(redeemNote({ unlocked: "x" })).toBe("🔓 A new entry is in your Codex now.");
    expect(redeemNote(ALREADY)).toBe("📓 You already have “The Duck”.");
    expect(redeemNote(MISS)).toBe(BOOTH_CODE_MISSED);
    expect(redeemNote(MISS, BOOTH_TYPED_NOTHING)).toBe(BOOTH_TYPED_NOTHING);
    expect(redeemHeld(HIT)).toBe(true);
    expect(redeemHeld(ALREADY)).toBe(true);
    expect(redeemHeld(MISS)).toBe(false);
  });
  it("word a throttle and closed doors, never the raw server line", () => {
    expect(scanError(new Error("too many wrong codes — wait a minute"))).toBe(REDEEM_THROTTLED);
    expect(scanError(new Error("doors are closed"), { night: { step: 0 } })).toMatch(/doors aren't open/u);
    expect(scanError(new Error("doors are closed"), { night: { step: 3 } })).toMatch(/paused/u);
  });
});

describe("the camera reads a codex QR", () => {
  it("redeems it, never scans it as a pass, and stays on the camera with the line and the way to the Codex", async () => {
    const { session, redeem, scan } = fakeSession();
    const opened = vi.fn();
    const h = mount(session, { onOpenCodex: opened });
    read(h, LINK);
    h.act(() => {});
    expect(redeem).toHaveBeenCalledWith("duck-1");
    expect(scan).not.toHaveBeenCalled();
    expect(hint(h)).toBe("🔓 Unlocking…");
    await flush(h);
    expect(hint(h)).toBe("🔓 “The Duck” is in your Codex now.");
    expect(elements(h.output).some((e) => e.type === GuestCardBody)).toBe(false);
    expect(elements(h.output).some((e) => e.type === CameraScanner)).toBe(true);
    (openCodexButton(h)!.props as { onClick: () => void }).onClick();
    expect(opened).toHaveBeenCalledOnce();
  });

  it("a QR held to the lens counts once, a wrong one too; a different one reads at once", async () => {
    const { session, redeem } = fakeSession({ redeem: () => Promise.resolve(MISS) });
    const h = mount(session);
    read(h, LINK);
    await flush(h);
    expect(hint(h)).toBe(BOOTH_CODE_MISSED);
    expect(openCodexButton(h)).toBeUndefined();
    for (let i = 0; i < 5; i += 1) {
      read(h, LINK);
      await flush(h);
    }
    expect(redeem).toHaveBeenCalledTimes(1);
    read(h, "https://app.example/?code=ABCD&unlock=other");
    await flush(h);
    expect(redeem).toHaveBeenCalledTimes(2);
  });

  it("a code already held says so, and still offers the Codex", async () => {
    const { session } = fakeSession({ redeem: () => Promise.resolve(ALREADY) });
    const h = mount(session, { onOpenCodex: () => {} });
    read(h, LINK);
    await flush(h);
    expect(hint(h)).toBe("📓 You already have “The Duck”.");
    expect(openCodexButton(h)).toBeDefined();
  });

  it("a refusal shows as one, and the same QR may be read again once it clears", async () => {
    let doors = false;
    const { session, redeem } = fakeSession({ redeem: () => (doors ? Promise.resolve(HIT) : Promise.reject(new Error("doors are closed"))) });
    (session as unknown as { view: unknown }).view = { night: { step: 2 } };
    const h = mount(session);
    read(h, LINK);
    await flush(h);
    expect(error(h)).toMatch(/paused/u);
    doors = true;
    read(h, LINK);
    await flush(h);
    expect(redeem).toHaveBeenCalledTimes(2);
    expect(hint(h)).toBe("🔓 “The Duck” is in your Codex now.");
    expect(error(h)).toBe("");
  });

  it("drops a read while one is on its way, and any read while a card is up", async () => {
    let answer: (r: RedeemAnswer) => void = () => {};
    const { session, redeem } = fakeSession({ redeem: () => new Promise((r) => (answer = r)) });
    const h = mount(session);
    read(h, LINK);
    h.act(() => {});
    read(h, "https://app.example/?code=ABCD&unlock=other");
    expect(redeem).toHaveBeenCalledTimes(1);
    answer(HIT);
    await flush(h);
    expect(hint(h)).toContain("The Duck");
  });

  it("still reads a pass as a pass", async () => {
    const card = { guest: { id: "g-1a2b3c", name: "Ada", faction: null, captured: false, location: null }, live: [], guestScoped: [], readouts: [] };
    const { session, redeem, scan } = fakeSession({ scan: ((id: string) => Promise.resolve({ guest: { id, name: "Ada" }, card, responses: [] })) as unknown as PrimeSession["scan"] });
    const h = mount(session);
    read(h, "g-1a2b3c");
    await flush(h);
    expect(scan).toHaveBeenCalledWith("g-1a2b3c");
    expect(redeem).not.toHaveBeenCalled();
    expect(elements(h.output).some((e) => e.type === GuestCardBody)).toBe(true);
  });

  it("keeps the other wall codes' words", () => {
    const { session, redeem } = fakeSession();
    const h = mount(session);
    read(h, "https://app.example/?code=ABCD&checkin=the-cache");
    h.act(() => {});
    expect(hint(h)).toMatch(/room sign/u);
    read(h, "https://app.example/?code=ABCD");
    h.act(() => {});
    expect(hint(h)).toMatch(/join code/u);
    expect(redeem).not.toHaveBeenCalled();
  });
});

describe("the typed box", () => {
  it("a word that is no guest falls through to the code", async () => {
    const { session, redeem, scan } = fakeSession();
    const h = mount(session);
    const done = type(h, "duck-1");
    h.act(() => {});
    await flush(h);
    await flush(h);
    expect(await done).toBe(true);
    expect(scan).toHaveBeenCalledWith("duck-1");
    expect(redeem).toHaveBeenCalledWith("duck-1");
    expect(hint(h)).toContain("The Duck");
  });

  it("neither a pass nor a code keeps the text, and says so", async () => {
    const { session } = fakeSession({ redeem: () => Promise.resolve(MISS) });
    const h = mount(session);
    const done = type(h, "banana");
    h.act(() => {});
    await flush(h);
    await flush(h);
    expect(await done).toBe(false);
    expect(hint(h)).toBe(BOOTH_TYPED_NOTHING);
  });

  it("a printed code reads as its QR would: a badge is a pass, a room says so, neither reaches the Codex", async () => {
    const link = (rest: string) => `https://x/?code=E&${rest}`;
    const badge = fakeSession({ printed: () => Promise.resolve(link("badge=abcdefgh")) });
    const a = mount(badge.session);
    const passed = type(a, "ABCD-EFGH");
    a.act(() => {});
    await flush(a);
    await flush(a);
    await passed;
    expect(badge.scan).toHaveBeenCalledWith("abcdefgh");
    expect(badge.redeem).not.toHaveBeenCalled();

    const room = fakeSession({ printed: () => Promise.resolve(link("checkin=the-cpu")) });
    const b = mount(room.session);
    const said = type(b, "R-K7QM");
    b.act(() => {});
    await flush(b);
    await flush(b);
    expect(await said).toBe(true);
    expect(hint(b)).toBe("That's a room sign — scan the guest's pass.");
    expect(room.scan).not.toHaveBeenCalled();
    expect(room.redeem).not.toHaveBeenCalled();
  });

  it("a mistyped guest id is a wrong pass, never a redeem (it would eat the limit)", async () => {
    const { session, redeem } = fakeSession();
    const h = mount(session);
    const done = type(h, "g-000000");
    h.act(() => {});
    await flush(h);
    expect(await done).toBe(false);
    expect(redeem).not.toHaveBeenCalled();
    expect(error(h)).toBe("That pass isn't a guest in this event.");
  });

  it("a paused show on the scan never falls through", async () => {
    const { session, redeem } = fakeSession({ scan: () => Promise.reject(new Error("doors are closed")) });
    const h = mount(session);
    const done = type(h, "duck-1");
    h.act(() => {});
    await flush(h);
    expect(await done).toBe(false);
    expect(redeem).not.toHaveBeenCalled();
  });

  it("a whole link typed or pasted goes straight to the code", async () => {
    const { session, redeem, scan } = fakeSession();
    const h = mount(session);
    const done = type(h, LINK);
    h.act(() => {});
    await flush(h);
    expect(await done).toBe(true);
    expect(redeem).toHaveBeenCalledWith("duck-1");
    expect(scan).not.toHaveBeenCalled();
  });
});

describe("the phone's own camera (?unlock=)", () => {
  afterEach(() => vi.unstubAllGlobals());
  function page(search: string) {
    const replaceState = vi.fn();
    vi.stubGlobal("window", { location: { search, pathname: "/" }, history: { replaceState } });
    return replaceState;
  }
  function link(o: Partial<UnlockLinkOptions>) {
    const say = vi.fn();
    const openCodex = vi.fn();
    const redeem = vi.fn(o.redeem ?? (() => Promise.resolve(HIT)));
    const props: UnlockLinkOptions = { ownsPage: true, ready: true, say, openCodex, view: () => null, ...o, redeem };
    const h = mountHooks(useUnlockLink, props);
    return { h, say, openCodex, redeem, props };
  }
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  it("waits for the booth, redeems once, strips the link and opens the Codex", async () => {
    const replaceState = page("?code=ABCD&unlock=duck-1");
    const { h, say, openCodex, redeem, props } = link({ ready: false });
    h.act(() => {});
    expect(redeem).not.toHaveBeenCalled();
    h.rerender({ ...props, ready: true });
    h.act(() => {});
    expect(redeem).toHaveBeenCalledWith("duck-1");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/?code=ABCD");
    await settle();
    expect(say).toHaveBeenCalledWith("🔓 “The Duck” is in your Codex now.");
    expect(openCodex).toHaveBeenCalledOnce();
    h.rerender({ ...props, ready: false });
    h.act(() => {});
    h.rerender({ ...props, ready: true });
    h.act(() => {});
    expect(redeem).toHaveBeenCalledOnce();
  });

  it("a miss says so and stays where it is", async () => {
    page("?code=ABCD&unlock=nope");
    const { h, say, openCodex } = link({ redeem: () => Promise.resolve(MISS) });
    h.act(() => {});
    await settle();
    expect(say).toHaveBeenCalledWith(BOOTH_CODE_MISSED);
    expect(openCodex).not.toHaveBeenCalled();
  });

  it("a refusal is worded, and a page with no link or no ownership does nothing", async () => {
    page("?code=ABCD&unlock=duck-1");
    const refused = link({ redeem: () => Promise.reject(new ApiError("doors are closed", 409)), view: () => ({ night: { step: 0 } }) });
    refused.h.act(() => {});
    await settle();
    expect(refused.say).toHaveBeenCalledWith("The doors aren't open yet: scan again once they are.");
    const embedded = link({ ownsPage: false });
    embedded.h.act(() => {});
    expect(embedded.redeem).not.toHaveBeenCalled();
    page("?code=ABCD");
    const bare = link({});
    bare.h.act(() => {});
    expect(bare.redeem).not.toHaveBeenCalled();
  });
});

describe("the booth's wiring and copy", () => {
  const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

  it("the booth app runs the link and hands the scanner its way to the Codex", () => {
    const app = src("booth/app.tsx");
    expect(app).toContain("useUnlockLink({");
    expect(app).toContain("onOpenCodex={openCodex}");
  });

  it("every taskbar says the scanner takes a codex QR", () => {
    for (const f of ["booth/app.tsx", "booth/player.tsx", "host/windows.tsx"]) expect(src(f), f).toContain('title: "Scan a pass or a codex QR"');
  });

  it("a booth's empty Codex points at 📷 Scan: it has no box to type in", () => {
    const view = src("stream/channel-view.tsx");
    expect(view).toContain('onSend === undefined ? "📷 Scan one" : "type one below"');
    expect(src("session/prime.ts")).not.toContain("a booth types no codes");
  });
});
