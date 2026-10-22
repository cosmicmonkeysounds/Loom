//! The voice link (wave 19, `docs/loom-reinstall.md` §2.4): the pure relay +
//! upload parser on the show's map — who hears whom, `hello` / `listen` /
//! `bye` diffs, stale seqs, the tent, the caps — and the raw body reader.

import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";

import { describe, expect, it } from "vitest";

import { VOICE_FRESH_MS, VOICE_MAX_BYTES, VOICE_MAX_PLAYERS, VOICE_MIN_BYTES, validateHouse } from "@loom/house";
import type { HouseMap, Vec3 } from "@loom/house";
import { VoiceRelay, parseVoiceUpload, voiceFrom } from "../server/spatial-voice.ts";
import type { VoiceListener, VoiceRoutePlayer, VoiceWorld } from "../server/spatial-voice.ts";
import { PayloadTooLarge, readRawBody } from "../server/http-util.ts";

const SHOW = new URL("../examples/trapped-in-the-internet/house.json", import.meta.url);
function showHouse(): HouseMap {
  const v = validateHouse(JSON.parse(readFileSync(SHOW, "utf8")));
  if (!v.ok || v.house === undefined) throw new Error("the show map does not validate");
  return v.house;
}

/** Where the show map puts people (main floor y 0, basement −2.7). */
const AT = {
  hall: [-1, 0, 13] as Vec3,
  hallFar: [-1, 0, 18] as Vec3,
  desktop: [-2, 0, 9] as Vec3,
  spawn: [-4.5, 0, 26.3] as Vec3,
  serverRoom: [3.9, -2.7, 25] as Vec3,
};

type Sent = Array<{ event: string; data: Record<string, unknown> }>;
function listener(id: string, kind: "terminal" | "player", key: string, flags: { mic?: boolean; hear?: boolean } = {}): VoiceListener & { sent: Sent; closed: boolean } {
  const l = {
    id,
    kind,
    ...(kind === "terminal" ? { spot: key } : { session: key }),
    ...flags,
    sent: [] as Sent,
    closed: false,
    send(event: string, data: unknown) {
      l.sent.push({ event, data: data as Record<string, unknown> });
    },
    close() {
      l.closed = true;
    },
  };
  return l;
}
const events = (l: { sent: Sent }, kind?: string) => l.sent.filter((s) => kind === undefined || s.event === kind);

function harness(house: HouseMap | null = showHouse()) {
  const clock = { t: 10_000 };
  const world: { house: HouseMap | null; players: VoiceRoutePlayer[]; dead: Set<string> } = { house, players: [], dead: new Set() };
  const relay = new VoiceRelay({
    now: () => clock.t,
    world: (): VoiceWorld => ({ house: world.house, players: world.players, live: (s) => !world.dead.has(s) }),
  });
  return { clock, world, relay };
}
const chunk = (n = 3200, fill = 0xff) => new Uint8Array(n).fill(fill);

describe("parseVoiceUpload", () => {
  const q = (s: string) => new URLSearchParams(s);
  it("takes seq + an optional spot + 160…8000 bytes", () => {
    expect(parseVoiceUpload(q("seq=0"), Buffer.alloc(VOICE_MIN_BYTES))).toMatchObject({ ok: true, seq: 0, spot: null });
    expect(parseVoiceUpload(q("seq=12&spot=%20hall%20"), Buffer.alloc(VOICE_MAX_BYTES))).toMatchObject({ ok: true, seq: 12, spot: "hall" });
  });
  it("400 a bad seq, spot or body", () => {
    for (const s of ["", "seq=", "seq=-1", "seq=1.5", "seq=abc", "seq=1e3", "seq=9999999999999999"]) expect(parseVoiceUpload(q(s), Buffer.alloc(3200))).toMatchObject({ ok: false, status: 400 });
    expect(parseVoiceUpload(q("seq=1&spot="), Buffer.alloc(3200))).toMatchObject({ ok: false, status: 400 });
    expect(parseVoiceUpload(q(`seq=1&spot=${"x".repeat(81)}`), Buffer.alloc(3200))).toMatchObject({ ok: false, status: 400 });
    expect(parseVoiceUpload(q("seq=1"), Buffer.alloc(VOICE_MIN_BYTES - 1))).toMatchObject({ ok: false, status: 400 });
    expect(parseVoiceUpload(q("seq=1"), Buffer.alloc(VOICE_MAX_BYTES + 1))).toMatchObject({ ok: false, status: 400 });
  });
});

describe("VoiceRelay — who hears whom", () => {
  it("a player hears the terminals near them, a terminal the players near it, with gains", () => {
    const { world, relay } = harness();
    world.players = [{ session: "s-a", name: "Pinball", p: AT.hall }];
    const player = listener("p1", "player", "s-a");
    const hall = listener("t1", "terminal", "hall");
    relay.connect(player);
    relay.connect(hall);
    // Only a terminal with an open stream is heard: the hall, so far.
    expect([...relay.hearing("p1")]).toEqual([["t:hall", 1]]);
    for (const spot of ["steam-room", "start-bar", "backyard"]) relay.connect(listener(`t-${spot}`, "terminal", spot));
    expect([...relay.hearing("p1")]).toEqual([
      ["t:hall", 1],
      ["t:steam-room", 0.28],
      ["t:start-bar", 0.27],
      ["t:backyard", 0.16],
    ]);
    expect([...relay.hearing("t1")]).toEqual([["s:s-a", 1]]);
    // Each was greeted; the hall's hello came before the player could hear it,
    // so the player's own mic turns on in a `listen` once the hall connects,
    // and `ears` counts the streams that hear it as they come.
    expect(events(player, "hello")[0]!.data).toEqual({ codec: "mulaw", rate: 16000, chunkMs: 200, as: "player", session: "s-a", listen: false, ears: 0 });
    expect(events(player, "listen").map((s) => s.data)).toEqual([{ on: true, ears: 1 }, { on: true, ears: 2 }, { on: true, ears: 3 }]);
    expect(events(hall, "hello")[0]!.data).toEqual({ codec: "mulaw", rate: 16000, chunkMs: 200, as: "terminal", spot: "hall", listen: true, ears: 1 });
    expect(relay.wants({ kind: "terminal", spot: "hall" })).toBe(true);
    expect(relay.wants({ kind: "terminal", spot: "cpu" })).toBe(false);
  });

  it("fans a chunk out with each listener's gain; never to its own source", () => {
    const { world, relay } = harness();
    world.players = [{ session: "s-a", name: "Pinball", p: AT.hall }];
    const player = listener("p1", "player", "s-a");
    const hall = listener("t1", "terminal", "hall");
    const steam = listener("t2", "terminal", "steam-room");
    for (const l of [player, hall, steam]) relay.connect(l);

    expect(relay.upload({ kind: "terminal", spot: "steam-room" }, 1, chunk(4, 0x80))).toEqual({ listening: true, dropped: false, ears: 1 });
    const v = events(player, "voice");
    expect(v.map((s) => s.data)).toEqual([{ from: "t:steam-room", kind: "terminal", spot: "steam-room", name: expect.any(String), gain: 0.28, seq: 1, data: Buffer.from([0x80, 0x80, 0x80, 0x80]).toString("base64") }]);
    // A terminal never hears a terminal.
    expect(events(hall, "voice")).toEqual([]);
    expect(events(steam, "voice")).toEqual([]);

    expect(relay.upload({ kind: "player", session: "s-a" }, 7, chunk())).toEqual({ listening: true, dropped: false, ears: 2 });
    expect(events(hall, "voice").map((s) => [s.data.from, s.data.gain, s.data.name, s.data.session])).toEqual([["s:s-a", 1, "Pinball", "s-a"]]);
    // The steam room is 5 m off through a wall: within 8 m → half gain and falling.
    expect(events(steam, "voice").map((s) => s.data.from)).toEqual(["s:s-a"]);
    // A player never hears itself (nor any player).
    expect(events(player, "voice").map((s) => s.data.from)).toEqual(["t:steam-room"]);
  });

  it("nobody hearing: dropped and never stored; a stale seq is dropped", () => {
    const { clock, world, relay } = harness();
    expect(relay.upload({ kind: "terminal", spot: "hall" }, 1, chunk())).toEqual({ listening: false, dropped: true, ears: 0 });
    world.players = [{ session: "s-a", p: AT.hall }];
    const player = listener("p1", "player", "s-a");
    relay.connect(player);
    relay.connect(listener("t1", "terminal", "hall"));
    const heard = { listening: true, dropped: false, ears: 1 };
    const stale = { listening: true, dropped: true, ears: 1 };
    expect(relay.upload({ kind: "terminal", spot: "hall" }, 5, chunk())).toEqual(heard);
    expect(relay.upload({ kind: "terminal", spot: "hall" }, 5, chunk())).toEqual(stale);
    expect(relay.upload({ kind: "terminal", spot: "hall" }, 4, chunk())).toEqual(stale);
    expect(relay.upload({ kind: "terminal", spot: "hall" }, 6, chunk())).toEqual(heard);
    expect(events(player, "voice").map((s) => s.data.seq)).toEqual([5, 6]);
    // Quiet for VOICE_FRESH_MS: a lower seq is a reloaded terminal, kept.
    clock.t += VOICE_FRESH_MS;
    expect(relay.upload({ kind: "terminal", spot: "hall" }, 0, chunk())).toEqual(heard);
    expect(relay.talking()).toEqual(new Map([["t:hall", 0]]));
  });

  it("walking away: `bye` for a source that was heard, nothing for one that never spoke; `listen` follows", () => {
    const { world, relay } = harness();
    world.players = [{ session: "s-a", p: AT.hall }];
    const player = listener("p1", "player", "s-a");
    const hall = listener("t1", "terminal", "hall");
    relay.connect(player);
    relay.connect(hall);
    relay.upload({ kind: "terminal", spot: "hall" }, 1, chunk());
    relay.upload({ kind: "player", session: "s-a" }, 1, chunk());
    // Down to the server room: the hall is on another floor now.
    world.players = [{ session: "s-a", p: AT.serverRoom }];
    relay.route();
    expect(events(player, "bye").map((s) => s.data)).toEqual([{ from: "t:hall" }]); // steam-room etc. never spoke
    expect(events(hall, "bye").map((s) => s.data)).toEqual([{ from: "s:s-a" }]);
    expect(events(player, "listen").map((s) => s.data)).toEqual([{ on: true, ears: 1 }, { on: false, ears: 0 }]);
    expect(events(hall, "listen").map((s) => s.data)).toEqual([{ on: false, ears: 0 }]);
    expect([...relay.hearing("p1").keys()]).toEqual([]); // no basement terminal is connected
    relay.connect(listener("t2", "terminal", "server-room"));
    relay.connect(listener("t3", "terminal", "server-room-door"));
    expect([...relay.hearing("p1").keys()]).toEqual(["t:server-room", "t:server-room-door"]);
    // A second route with nothing changed sends nothing.
    const before = player.sent.length + hall.sent.length;
    relay.route();
    expect(player.sent.length + hall.sent.length).toBe(before);
  });

  it("the tent: its terminal hears nobody and is heard by nobody; a spawn-room terminal is off unless voice: true", () => {
    const house = showHouse();
    const { world, relay } = harness(house);
    world.players = [{ session: "s-a", p: AT.spawn }];
    const player = listener("p1", "player", "s-a");
    const tent = listener("t1", "terminal", "tent");
    relay.connect(player);
    relay.connect(tent);
    relay.connect(listener("t2", "terminal", "backyard"));
    expect([...relay.hearing("p1").keys()]).toEqual(["t:backyard"]);
    expect([...relay.hearing("t1").keys()]).toEqual([]);
    expect(events(tent, "hello")[0]!.data.listen).toBe(false);
    expect(relay.upload({ kind: "terminal", spot: "tent" }, 1, chunk())).toEqual({ listening: false, dropped: true, ears: 0 });

    // Unset in the spawn room is still off; `voice: true` opts in.
    const tentSpot = house.terminals.find((t) => t.id === "tent")!;
    delete tentSpot.voice;
    relay.route();
    expect([...relay.hearing("t1").keys()]).toEqual([]);
    tentSpot.voice = true;
    relay.route();
    expect([...relay.hearing("t1").keys()]).toEqual(["s:s-a"]);
    expect([...relay.hearing("p1").keys()]).toEqual(["t:tent", "t:backyard"]);
  });

  it("a stream says what it does: mic=0 is no candidate for a player's ears, hear=0 is routed nothing", () => {
    const { world, relay } = harness();
    world.players = [{ session: "s-a", p: AT.hall }];
    const player = listener("p1", "player", "s-a");
    const hall = listener("t1", "terminal", "hall", { mic: false });
    const steam = listener("t2", "terminal", "steam-room", { hear: false });
    for (const l of [player, hall, steam]) relay.connect(l);
    // The hall's mic is off: the player doesn't hear it (and its slot is free
    // for the steam room, whose mic is on). The steam room plays nothing:
    // it hears nobody, so it doesn't count as the player's ears.
    expect([...relay.hearing("p1").keys()]).toEqual(["t:steam-room"]);
    expect([...relay.hearing("t1").keys()]).toEqual(["s:s-a"]);
    expect([...relay.hearing("t2").keys()]).toEqual([]);
    expect(events(steam, "hello")[0]!.data.listen).toBe(true); // its own mic is still wanted
    expect(events(player, "listen").at(-1)!.data).toEqual({ on: true, ears: 1 });
    // A player whose every stream says mic=0 is heard by no terminal.
    relay.connect(listener("p1b", "player", "s-a", { mic: false })); // the newest stream wins
    expect(player.closed).toBe(true);
    expect([...relay.hearing("t1").keys()]).toEqual([]);
  });

  it("the edge: a route already formed is kept 0.75 m past the reach, never flapping on jitter", () => {
    const { world, relay } = harness();
    const hall = listener("t1", "terminal", "backyard"); // at [-4.4, 1.4, 20.5]
    relay.connect(hall);
    // Walk west across the backyard (the same room): 8 m is the reach.
    const at = (d: number) => [{ session: "s-a", p: [-4.4 - Math.sqrt(d * d - 0.25), 0, 21] as Vec3 }];
    world.players = at(7.5);
    relay.route();
    expect([...relay.hearing("t1").keys()]).toEqual(["s:s-a"]);
    for (const d of [8.1, 7.9, 8.2, 7.95, 8.3]) {
      world.players = at(d);
      relay.route();
      expect([...relay.hearing("t1").keys()], `kept at ${d} m`).toEqual(["s:s-a"]);
    }
    expect(events(hall, "bye")).toEqual([]);
    world.players = at(9);
    relay.route();
    expect([...relay.hearing("t1").keys()]).toEqual([]);
    // Coming back, a new route forms only inside the reach.
    world.players = at(8.3);
    relay.route();
    expect([...relay.hearing("t1").keys()]).toEqual([]);
  });

  it("the newest stream wins: one per player session, at most 2 per terminal spot", () => {
    const { world, relay } = harness();
    world.players = [{ session: "s-a", p: AT.hall }];
    const a1 = listener("p1", "player", "s-a");
    const a2 = listener("p2", "player", "s-a");
    relay.connect(a1);
    relay.connect(a2);
    expect(a1.closed).toBe(true);
    expect(relay.size).toBe(1);
    const h1 = listener("t1", "terminal", "hall");
    const h2 = listener("t2", "terminal", "hall");
    const h3 = listener("t3", "terminal", "hall");
    for (const l of [h1, h2, h3]) relay.connect(l);
    expect([h1.closed, h2.closed, h3.closed]).toEqual([true, false, false]);
    expect(relay.size).toBe(3);
  });

  it("caps: a terminal hears the 3 nearest players", () => {
    const { world, relay } = harness();
    world.players = Array.from({ length: 5 }, (_, i) => ({ session: `s-${i}`, p: [-1, 0, 13 + i * 0.5] as Vec3 }));
    const hall = listener("t1", "terminal", "hall");
    relay.connect(hall);
    expect([...relay.hearing("t1").keys()]).toEqual(["s:s-0", "s:s-1", "s:s-2"]);
    expect(relay.hearing("t1").size).toBe(VOICE_MAX_PLAYERS);
  });

  it("a session that ended closes its stream; a removed map hears nothing; reset closes all", () => {
    const { world, relay } = harness();
    world.players = [{ session: "s-a", p: AT.hall }, { session: "s-b", p: AT.hallFar }];
    const a = listener("p1", "player", "s-a");
    const b = listener("p2", "player", "s-b");
    const hall = listener("t1", "terminal", "hall");
    for (const l of [a, b, hall]) relay.connect(l);
    expect(relay.size).toBe(3);
    world.players = [{ session: "s-b", p: AT.hallFar }];
    world.dead.add("s-a");
    relay.route();
    expect(a.closed).toBe(true);
    expect(relay.size).toBe(2);
    relay.disconnect("p1"); // its close handler: harmless
    expect([...relay.hearing("t1").keys()]).toEqual(["s:s-b"]);

    world.house = null;
    relay.route();
    expect(relay.hearing("t1").size).toBe(0);
    expect(relay.hearing("p2").size).toBe(0);

    relay.reset();
    expect(b.closed && hall.closed).toBe(true);
    expect(relay.size).toBe(0);
    expect(voiceFrom({ kind: "player", session: "s-b" })).toBe("s:s-b");
  });
});

describe("readRawBody", () => {
  const req = (parts: Buffer[], seen = { destroyed: false }) =>
    ({
      [Symbol.asyncIterator]: async function* () {
        for (const p of parts) yield p;
      },
      destroy() {
        seen.destroyed = true;
      },
    }) as unknown as IncomingMessage;
  it("joins the chunks as bytes; an empty body is empty", async () => {
    expect([...(await readRawBody(req([Buffer.from([1, 2]), Buffer.from([0xff])]), 10))]).toEqual([1, 2, 0xff]);
    expect((await readRawBody(req([]), 10)).length).toBe(0);
  });
  it("throws PayloadTooLarge past the cap: a small overrun is drained (the 413 is read), a big one cut off", async () => {
    const small = { destroyed: false };
    await expect(readRawBody(req([Buffer.alloc(6), Buffer.alloc(5)], small), 10)).rejects.toBeInstanceOf(PayloadTooLarge);
    expect(small.destroyed).toBe(false);
    const big = { destroyed: false };
    await expect(readRawBody(req([Buffer.alloc(30), Buffer.alloc(30)], big), 10)).rejects.toBeInstanceOf(PayloadTooLarge);
    expect(big.destroyed).toBe(true);
  });
});
