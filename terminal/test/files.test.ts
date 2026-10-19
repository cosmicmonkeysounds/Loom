import { describe, expect, it } from "vitest";
import { ApiError } from "@loom/play/client.ts";
import { filesOf, giveEntry, redeemCode, unlockOfScan } from "../src/files.ts";

const config = { eventId: "evt" };
const pilot = { token: "PILOT" };

type Call = { path: string; body: unknown; token?: string };
function fakeApi(answer: (path: string) => unknown, calls: Call[] = []) {
  return (async (path: string, body?: unknown, token?: string) => {
    calls.push({ path, body, token });
    const a = answer(path);
    if (a instanceof Error) throw a;
    return a;
  }) as never;
}

describe("the heart terminal's file panel", () => {
  it("gives an entry to the character as the piloted guest", async () => {
    const calls: Call[] = [];
    expect(await giveEntry(config, pilot, "what-sandy-says", "Trabolta", fakeApi(() => ({ ok: true }), calls))).toEqual({ ok: true });
    expect(calls).toEqual([{ path: "/e/evt/api/guest/codex/share", body: { entry: "what-sandy-says", to: "Trabolta" }, token: "PILOT" }]);
  });

  it("shows the server's refusal as it words it", async () => {
    const refuse = fakeApi(() => new ApiError("they won't take lore about someone else", 403));
    expect(await giveEntry(config, pilot, "x", "Trabolta", refuse)).toEqual({ ok: false, error: "they won't take lore about someone else" });
    const down = fakeApi(() => new TypeError("Failed to fetch"));
    expect(await giveEntry(config, pilot, "x", "Trabolta", down)).toEqual({ ok: false, error: "the house didn't answer (Failed to fetch)" });
  });

  it("redeems a code for the guest and says what it unlocked", async () => {
    const calls: Call[] = [];
    const codex = [{ id: "e1", title: "The First Note", about: null, text: "…" }];
    expect(await redeemCode(config, pilot, "  QX7  ", fakeApi(() => ({ ok: true, unlocked: "e1", codex }), calls))).toEqual({ ok: true, unlocked: "e1", codex });
    expect(calls[0]).toEqual({ path: "/e/evt/api/guest/codex/redeem", body: { code: "QX7" }, token: "PILOT" });
    expect(await redeemCode(config, pilot, "nope", fakeApi(() => ({ ok: true, unlocked: null, codex })))).toMatchObject({ ok: true, unlocked: null });
    expect(await redeemCode(config, pilot, "nope", fakeApi(() => new ApiError("too many wrong codes — wait a minute", 429)))).toEqual({ ok: false, error: "too many wrong codes — wait a minute" });
    expect(await redeemCode(config, pilot, "   ", fakeApi(() => ({})))).toEqual({ ok: false, error: "type a code" });
  });

  it("reads the unlock code off a codex QR; a pass or a join QR is none", () => {
    expect(unlockOfScan("https://party.example/?code=GST1&unlock=FIRSTNOTE")).toBe("FIRSTNOTE");
    expect(unlockOfScan("https://party.example/?code=GST1")).toBeNull();
    expect(unlockOfScan("g-3f9a1c")).toBeNull();
    expect(unlockOfScan("SANDY-7")).toBe("SANDY-7");
    expect(unlockOfScan("not a code at all")).toBeNull();
  });

  it("lists the guest's entries, the redeem's fresher list first", () => {
    const a = { id: "a", title: "Beta", about: null, text: "" };
    const b = { id: "b", title: "Alpha", about: "Trabolta", text: "" };
    expect(filesOf({ codex: [a, b] }, null).map((e) => e.id)).toEqual(["b", "a"]);
    expect(filesOf({ codex: [a] }, [a, b]).map((e) => e.id)).toEqual(["b", "a"]);
    expect(filesOf(null, null)).toEqual([]);
  });
});
