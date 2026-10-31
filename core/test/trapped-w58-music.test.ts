//! Trapped in the Internet, wave 58 (`docs/loom-w58-contract.md` C4–C7):
//! Trabolta at the stereo. He can change the music, like the lights, but only
//! for a program he is chummy with, only with the moves the story lists, never
//! past a lock, and what he puts on goes back by itself.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";

import { scenarioSource } from "../examples/load.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import type { AgentRequest } from "../server/agents.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";

const SRC = scenarioSource("trapped-in-the-internet");
const POWER = "change_the_music";

function night(): Sim {
  const sim = Sim.fromSources(SRC);
  sim.fireBeat("Power On");
  sim.createPerson("g1", "Calculator");
  sim.createPerson("g2", "Winamp");
  sim.setVar("Night.step", "7");
  sim.setVar("Night.music", "act_2");
  sim.setVar("g1.chummy", "3");
  return sim;
}

type Args = Record<string, string | number | boolean>;
const fire = (sim: Sim, who: string, args: Args) => sim.signal(POWER, who, args, "Trabolta");
const value = (sim: Sim, path: string) => (sim.world.get(path) as { value: unknown } | undefined)?.value;
const cues = (evs: SimEvent[]) => evs.flatMap((e) => (e.type === "directive" && e.verb === "cue" ? [e.args] : []));
const his = (evs: SimEvent[]) => evs.flatMap((e) => (e.type === "dialogue" && e.speaker === "Trabolta" ? [e.text] : []));
const casts = (evs: SimEvent[]) => evs.filter((e) => e.type === "broadcast");
const tick = (sim: Sim, seconds: number) => {
  const out: SimEvent[] = [];
  for (let i = 0; i < seconds; i++) out.push(...sim.tick(1000));
  return out;
};

describe("the power's moves", () => {
  it("a skip goes out, and nothing needs to go back", () => {
    const sim = night();
    const e = fire(sim, "g1", { move: "skip" });
    expect(cues(e)).toEqual(["music, action: skip"]);
    expect(his(e)).toEqual([]);
    expect(value(sim, "Night.dj_back_at")).toBe(0);
    expect(value(sim, "Night.dj_last")).toBe("skipped a song");
    expect(value(sim, "Night.dj_for")).toBe("Calculator");
  });

  it("silence pauses for 30 s, then goes back on its own", () => {
    const sim = night();
    expect(cues(fire(sim, "g1", { move: "silence" }))).toEqual(["music, action: hush"]);
    expect(cues(tick(sim, 29))).toEqual([]);
    expect(cues(tick(sim, 2))).toEqual(["music, action: back"]);
    expect(value(sim, "Night.dj_back_at")).toBe(0);
  });

  it.each([
    ["calm", "act_1"],
    ["uneasy", "act_2"],
    ["dread", "act_3"],
  ])("%s plays %s for three minutes", (move, playlist) => {
    const sim = night();
    expect(cues(fire(sim, "g1", { move }))).toEqual([`music, action: play, playlist: ${playlist}`]);
    expect(cues(tick(sim, 179))).toEqual([]);
    expect(cues(tick(sim, 2))).toEqual(["music, action: back"]);
  });

  it("he never touches the story's own scene", () => {
    const sim = night();
    fire(sim, "g1", { move: "dread" });
    expect(value(sim, "Night.music")).toBe("act_2");
  });

  it("tells the asker and the hosts", () => {
    const sim = night();
    const shown = casts(fire(sim, "g1", { move: "skip" }));
    expect(shown).toHaveLength(2);
  });
});

describe("the power's refusals", () => {
  const refused = (sim: Sim, who: string, args: Args, line: string) => {
    const e = fire(sim, who, args);
    expect(his(e)).toEqual([line]);
    expect(cues(e)).toEqual([]);
    expect(casts(e)).toEqual([]);
  };

  it("before the malware, and after the Y2K hour", () => {
    const sim = night();
    sim.setVar("Night.step", "6");
    refused(sim, "g1", { move: "skip" }, "That function is not available yet.");
    sim.setVar("Night.step", "16");
    refused(sim, "g1", { move: "skip" }, "I do not have the strength.");
  });

  it("works through the Y2K hour, the lights' window", () => {
    const sim = night();
    sim.setVar("Night.step", "15");
    expect(cues(fire(sim, "g1", { move: "skip" }))).toEqual(["music, action: skip"]);
  });

  it("a program under the bar: not close enough", () => {
    const sim = night();
    sim.setVar("g1.chummy", "2");
    refused(sim, "g1", { move: "skip" }, "We are not that close.");
    refused(sim, "g2", { move: "skip" }, "We are not that close.");
  });

  it("a director can move the bar", () => {
    const sim = night();
    sim.setVar("Night.dj_bar", "1");
    sim.setVar("g2.chummy", "1");
    expect(cues(fire(sim, "g2", { move: "skip" }))).toEqual(["music, action: skip"]);
  });

  it("while the story keeps the house silent", () => {
    const sim = night();
    sim.setVar("Night.music", "off");
    refused(sim, "g1", { move: "skip" }, "The speakers are not answering me.");
  });

  it("one song at a time, then again", () => {
    const sim = night();
    fire(sim, "g1", { move: "calm" });
    refused(sim, "g1", { move: "skip" }, "One song at a time.");
    tick(sim, 241);
    expect(cues(fire(sim, "g1", { move: "skip" }))).toEqual(["music, action: skip"]);
  });

  it("a move he doesn't hold", () => {
    const sim = night();
    refused(sim, "g1", { move: "rave" }, "I do not have that record.");
    refused(sim, "g1", { move: "afterparty" }, "I do not have that record.");
    refused(sim, "g1", {}, "I do not have that record.");
  });

  it("from a performer's thread there is no program, so nothing happens", () => {
    const sim = night();
    const e = sim.signal(POWER, undefined, { move: "skip" }, "Trabolta");
    expect(his(e)).toEqual([]);
    expect(cues(e)).toEqual([]);
  });
});

describe("the lock", () => {
  it("stops him, and hands back what he had on", () => {
    const sim = night();
    fire(sim, "g1", { move: "dread" });
    expect(cues(sim.signal("trabolta_music_lock"))).toEqual(["music, action: back"]);
    expect(value(sim, "Night.dj_locked")).toBe(true);
    expect(cues(tick(sim, 200))).toEqual([]);
    expect(his(fire(sim, "g1", { move: "skip" }))).toEqual(["The speakers are not answering me."]);
  });

  it("with nothing on it only locks, and the unlock lets him back", () => {
    const sim = night();
    expect(cues(sim.signal("trabolta_music_lock"))).toEqual([]);
    sim.signal("trabolta_music_unlock");
    expect(value(sim, "Night.dj_locked")).toBe(false);
    expect(cues(fire(sim, "g1", { move: "skip" }))).toEqual(["music, action: skip"]);
  });
});

describe("how a program gets chummy", () => {
  it("starts at nothing, and a fact and a gift each count", () => {
    const sim = Sim.fromSources(SRC);
    sim.fireBeat("Power On");
    sim.createPerson("g1", "Calculator");
    expect(value(sim, "g1.chummy")).toBe(0);
    sim.signal("fact_accepted", "g1");
    expect(value(sim, "g1.chummy")).toBe(1);
    sim.signal("trabolta_heard", "g1");
    expect(value(sim, "g1.chummy")).toBe(2);
  });
});

// -- the server: his own word on a program, ±1 a reply --------------------------------

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CODES = { event: "EV", mod: "MD", prime: "PR" };

function fakeReq(body: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
    destroy() {},
  } as unknown as IncomingMessage;
}

function fakeRes() {
  let buf = "";
  const res = {
    statusCode: 0,
    body: "",
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    setHeader() {},
    write(chunk: string) {
      buf += chunk;
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
    frames(): Array<[string, unknown]> {
      return buf
        .split("\n\n")
        .map((block) => {
          const ev = /^event: (.*)$/mu.exec(block)?.[1];
          const data = /^data: (.*)$/mu.exec(block)?.[1];
          return ev !== undefined && data !== undefined ? ([ev, JSON.parse(data)] as [string, unknown]) : null;
        })
        .filter((f): f is [string, unknown] => f !== null);
    },
  };
  return res;
}

async function call(rt: EventRuntime, method: string, pathAndQuery: string, body: unknown, o: { moderator?: boolean; token?: string } = {}) {
  const res = fakeRes();
  const url = new URL(`http://x${pathAndQuery}`);
  await rt.handle(fakeReq(body, o.token !== undefined ? { "x-loom-token": o.token } : {}), res as unknown as ServerResponse, method, url.pathname, url, o.moderator === true ? { moderator: true, moderatorName: "Ada" } : {});
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body || "{}") as Record<string, unknown>;
  } catch {
    /* a stream */
  }
  return { status: res.statusCode, json, res };
}

describe("the server's warmth (C5)", () => {
  async function guestLine() {
    const d = mkdtempSync(join(tmpdir(), "loom-trapped-w58-"));
    dirs.push(d);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "trapped-in-the-internet", scenarioSource: SRC, joinBase: () => "http://x" });
    rt.openDoors();
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    const sim = rt.liveSim!;
    sim.setVar("Trabolta.awake", "true");
    sim.reveal("Trabolta");
    const g = await call(rt, "POST", "/api/guest/register", { name: "Winamp", passcode: CODES.event });
    expect(g.status).toBe(200);
    const id = g.json["id"] as string;
    const requests = () => worker.res.frames().filter(([e]) => e === "request").map(([, x]) => x as AgentRequest);
    const ask = async (text: string) => {
      const said = await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text }, { token: g.json["token"] as string });
      expect(said.status, "the say").toBe(200);
      return requests().at(-1)!;
    };
    const request = await ask("hello");
    const reply = (adjust: Record<string, number>) => call(rt, "POST", "/api/agent/reply", { id: request.id, say: "Hm.", adjust }, { moderator: true });
    /** One more line and his reply to it: the power, fired as a worker fires it. */
    const fireIt = async (text: string) => {
      const r = await ask(text);
      const answer = await call(rt, "POST", "/api/agent/reply", { id: r.id, say: "Hm.", acts: [{ kind: "fire", name: POWER, args: { move: "skip" } }] }, { moderator: true });
      return (answer.json["acted"] as Array<Record<string, unknown>>)[0]!;
    };
    return { rt, sim, request, reply, id, fireIt };
  }

  it("offers the slot's range for a guest, and no other", async () => {
    const { request } = await guestLine();
    expect(request.them.ranges).toEqual({ chummy: [-5, 10] });
  });

  it("moves ±1 whatever the model asked, and nothing else of a guest's", async () => {
    const { sim, reply, id } = await guestLine();
    const r = await reply({ "them.chummy": 8, "them.trust": 5, "them.truths_accepted": 9 });
    expect(r.json["applied"]).toEqual({ "them.chummy": 1 });
    expect(value(sim, `${id}.chummy`)).toBe(1);
    expect(value(sim, `${id}.trust`)).toBe(0);
    expect(value(sim, `${id}.truths_accepted`)).toBe(0);
  });

  it("a refusal spends none of the four, and a fifth is exhausted", async () => {
    const { sim, id, reply, fireIt } = await guestLine();
    await reply({});
    sim.setVar("Night.step", "7");
    sim.setVar("Night.music", "act_2");
    expect(await fireIt("a")).toMatchObject({ ok: true, refused: true });
    expect(await fireIt("b")).toMatchObject({ ok: true, refused: true });
    sim.setVar(`${id}.chummy`, "3");
    for (const text of ["c", "d", "e", "f"]) {
      expect(await fireIt(text)).toEqual({ kind: "fire", ok: true, what: POWER });
      sim.setVar("Night.dj_free_at", "0");
    }
    expect(await fireIt("g")).toMatchObject({ ok: false, error: "power exhausted for this run" });
  });

  it("the Music card reads it", async () => {
    const { rt, sim, id } = await guestLine();
    sim.setVar(`${id}.chummy`, "4");
    const v = await call(rt, "GET", "/api/mod/audio/mixer", {}, { moderator: true });
    expect(v.json["dj"]).toEqual({ locked: false, bar: 3, pals: [{ name: "Winamp", chummy: 4 }], last: null });
  });
});
