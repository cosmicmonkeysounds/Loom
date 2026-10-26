//! Wave 26 (C1, R1): `with …, ack: none` — a big moment with no
//! acknowledge button; only its exits close it. The tail key is split by
//! `splitMomentArgs` (case-insensitive, never passed through `rest`), rides
//! the `broadcast` / `respond` / `widget` SimEvents as `noAck: true`, and
//! the chat composer copies it beside `go` (`ChatMessage.noAck`). Lint
//! L1226 warns on `ack: none` with no `go:` in the same tail.

import { describe, expect, it } from "vitest";

import { splitMomentArgs } from "../src/go.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/event.ts";
import { composeGuestMessages } from "../server/chat.ts";
import { Workspace } from "../src/lsp/index.ts";

describe("splitMomentArgs: ack", () => {
  it("parses `ack: none` in any case, ignores any other value, never keeps it in rest", () => {
    expect(splitMomentArgs("go: pass, ack: none")).toEqual({ go: ["pass"], close: null, ack: "none", rest: "" });
    expect(splitMomentArgs("go: pass, ACK: None").ack).toBe("none");
    expect(splitMomentArgs("Ack:NONE, go: pass").ack).toBe("none");
    expect(splitMomentArgs("go: pass, ack: ok")).toEqual({ go: ["pass"], close: null, ack: null, rest: "" });
    expect(splitMomentArgs("go: pass").ack).toBeNull();
    expect(splitMomentArgs("moment: big, ack: none").rest).toBe("moment: big");
  });
});

const STORY = `# Ack

ROLE Program

LOCATION The Desktop

INTERACTION go to the bathroom
  label: 🚻 Bathroom Mode
  who: guest
  restricted: allow

INTERACTION catch
  who: admin

INTERACTION shout
  who: admin

INTERACTION card
  who: admin

INTERACTION plain
  who: admin

INTERACTION pinit
  who: admin

when catch for program:
  reply "!!🌐 Sent to the Internet." with go: pass as "🎟 Show my pass", go: go to the bathroom, ack: none

when shout:
  broadcast "!!Everyone, stop." to everyone with go: pass, ack: none

when card for program:
  show poll "Pick one" to program with options: "A" | "B", moment: big, go: pass, ack: none

when plain for program:
  reply "!!Hello." with go: pass

when pinit for program:
  pin "!Pinned." for program with go: pass, ack: none
`;

function sim(): Sim {
  const s = Sim.fromSources(STORY);
  s.createPerson("g-1", "Bugdom", "Program");
  s.createPerson("g-2", "Clippit", "Program");
  return s;
}
const of = (evs: readonly SimEvent[], type: SimEvent["type"]) => evs.filter((e) => e.type === type);

describe("the SimEvents carry noAck", () => {
  it("respond, broadcast and widget gain `noAck: true`; a tail without it has none; a pin never does", () => {
    const s = sim();
    const reply = of(s.signal("catch", "g-1"), "respond")[0]!;
    expect(reply).toMatchObject({ type: "respond", noAck: true, go: ["pass as \"🎟 Show my pass\"", "go to the bathroom"] });
    expect((reply as { text: string }).text).not.toContain("with go:");
    expect(of(s.signal("shout"), "broadcast")[0]).toMatchObject({ noAck: true, go: ["pass"] });
    const card = of(s.signal("card", "g-1"), "widget")[0]!;
    expect(card).toMatchObject({ noAck: true, go: ["pass"] });
    expect((card as { params: Record<string, string> }).params["ack"]).toBeUndefined();
    expect(of(s.signal("plain", "g-1"), "respond")[0]).not.toHaveProperty("noAck");
    const pin = of(s.signal("pinit", "g-1"), "pinned")[0]!;
    expect(pin).toMatchObject({ go: ["pass"] });
    expect(pin).not.toHaveProperty("noAck");
  });
});

describe("the chat composer copies noAck beside go", () => {
  it("the readout, every broadcast copy and the card carry `noAck: true`; the plain reply none", () => {
    const s = sim();
    const reply = composeGuestMessages(s, s.signal("catch", "g-1"));
    const big = reply.find((m) => m.readout === true)!;
    expect(big).toMatchObject({ moment: "big", noAck: true });
    expect(big.go?.map((g) => g.kind)).toEqual(["pass", "act"]);
    expect(big.text).not.toContain("with go:");
    const shout = composeGuestMessages(s, s.signal("shout")).filter((m) => m.kind === "signal");
    expect(shout.length).toBeGreaterThan(0);
    for (const m of shout) expect(m).toMatchObject({ moment: "big", noAck: true });
    const card = composeGuestMessages(s, s.signal("card", "g-1")).find((m) => m.kind === "widget")!;
    expect(card).toMatchObject({ noAck: true });
    const plain = composeGuestMessages(s, s.signal("plain", "g-1")).find((m) => m.readout === true)!;
    expect(plain).not.toHaveProperty("noAck");
    const pin = composeGuestMessages(s, s.signal("pinit", "g-1")).find((m) => m.pin !== undefined)!;
    expect(pin).not.toHaveProperty("noAck");
  });
});

function l1226(source: string): string[] {
  const ws = new Workspace();
  ws.open("file:///main.loom", source);
  return (ws.diagnosticsFor("file:///main.loom")?.diagnostics ?? []).filter((d) => d.code === "L1226").map((d) => d.message);
}

describe("L1226: ack: none needs a go: exit", () => {
  it("warns on a tail with `ack: none` and no `go:`; never with one, never without ack", () => {
    expect(l1226(STORY)).toEqual([]);
    const msgs = l1226(`${STORY}
== Lonely
reply "!!No way out." with ack: none
broadcast "!!Stop." to everyone with close: 6s, ack: none
reply "!!Fine." with go: pass, ack: none
reply "!!Fine." with close: 6s
`);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toContain("`ack: none` needs a `go:` exit");
  });
});
