import { describe, expect, it } from "vitest";
import { ChallengerError, fetchPlayer, placeBet } from "../src/casino/post.ts";

const config = { eventId: "evt", token: "tok", name: "Casino" };
function fake(status: number, body: unknown, seen: Array<{ url: string; init?: RequestInit }> = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

describe("the casino's calls", () => {
  it("reads a player's name, mark and balance through the moderator lens", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const p = await fetchPlayer(config, "g-abc123", { fetcher: fake(200, { id: "g-abc123", name: "Winamp", wallet: { name: "Truthcoin", balance: 140 } }, seen) });
    expect(p).toEqual({ id: "g-abc123", name: "Winamp", restricted: false, captured: false, wallet: true, balance: 140, unit: "Truthcoin" });
    expect(seen[0]!.url).toBe("/e/evt/api/state?role=guest&as=g-abc123");
    expect((seen[0]!.init!.headers as Record<string, string>)["x-loom-token"]).toBe("tok");
    const none = await fetchPlayer(config, "g-abc123", { fetcher: fake(200, { name: "Winamp", restricted: true }) });
    expect(none).toMatchObject({ wallet: false, restricted: true, balance: 0 });
    await expect(fetchPlayer(config, "g-abc123", { fetcher: fake(404, {}) })).rejects.toMatchObject({ kind: "unknown" });
    await expect(fetchPlayer(config, "g-abc123", { fetcher: fake(403, {}) })).rejects.toBeInstanceOf(ChallengerError);
  });

  it("places one bet, labelled, and reads the house's answer", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const r = await placeBet(config, "g-abc123", "dice", "seven", 10, { fetcher: fake(200, { ok: true, roll: [3, 4], payout: 50, net: 40, balance: 190 }, seen) });
    expect(r).toEqual({ ok: true, result: { game: "dice", pick: "seven", stake: 10, roll: [3, 4], payout: 50, net: 40 }, balance: 190 });
    expect(seen[0]!.url).toBe("/e/evt/api/mod/casino/bet");
    expect(JSON.parse(seen[0]!.init!.body as string)).toEqual({ guest: "g-abc123", game: "dice", pick: "seven", stake: 10, label: "Terminal · Casino" });
    expect(await placeBet(config, "g-abc123", "coin", "heads", 10, { fetcher: fake(409, { error: "insufficient funds" }) })).toEqual({ ok: false, status: 409, error: "insufficient funds" });
    const lost = await placeBet(config, "g-abc123", "coin", "heads", 10, {
      fetcher: (async () => {
        throw new TypeError("network");
      }) as unknown as typeof fetch,
    });
    expect(lost).toEqual({ ok: false, status: null, error: "" });
  });
});
