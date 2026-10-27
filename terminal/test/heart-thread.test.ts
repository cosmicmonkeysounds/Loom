import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Thread, lineClass } from "../src/chat.tsx";
import type { Line } from "../src/pilot.ts";
import { pendingPickOf, unansweredPicks, withPendingPicks } from "../src/heart/pending-pick.ts";

const line = (seq: number, text: string, theirs = true): Line => ({ seq, text, theirs, from: theirs ? "Trabolta" : "Winamp", channel: "dm:Trabolta", ts: 0, kind: "line" }) as unknown as Line;
const render = (p: Partial<Parameters<typeof Thread>[0]>) =>
  renderToStaticMarkup(createElement(Thread, { lines: [], revealed: new Map(), typing: false, character: "Trabolta", guestName: "Winamp", ...p }));
const pick = (seq: number, text: string, act = false): Line => ({ ...line(seq, text, false), pick: true, ...(act ? { act: true } : {}) }) as Line;

describe("a pick at the heart is the server's own line (wave 28)", () => {
  it("lands in the thread's order (before his reply), as YOU, from the stream itself", () => {
    const html = render({ lines: [line(1, "So. Someone has found my heart."), pick(2, "I'm a person."), line(3, "Go on.")] });
    const at = (s: string) => html.indexOf(s);
    expect(at("I&#x27;m a person.")).toBeGreaterThan(at("found my heart"));
    expect(at("I&#x27;m a person.")).toBeLessThan(at("Go on."));
    expect(html).toContain('class="line mine kind-line echo"');
    expect(html).toMatch(/<span class="who">YOU<\/span>/u);
  });

  it("a deed reads as an action (B4), with its time", () => {
    const ts = new Date(2026, 9, 31, 20, 4).getTime();
    const html = render({ lines: [line(1, "Go on."), { ...pick(2, "[shows the Sandy File]", true), ts }] });
    expect(html).toContain('class="line mine kind-line echo act"');
    expect(html).toContain("20:04");
    expect(html).toContain("[shows the Sandy File]");
    expect(lineClass({ theirs: false, kind: "line", pick: true, act: true }, false)).toBe("line mine kind-line echo act");
    expect(lineClass({ theirs: false, kind: "line" }, false)).toBe("line mine kind-line");
  });

});

describe("a pick shows at once, pending, until the server's line arrives (wave 28)", () => {
  const menu = { id: 7, channel: "dm:Trabolta" };
  const youLines = (html: string) => html.match(/<span class="who">YOU<\/span>/gu)?.length ?? 0;

  it("pick → one dimmed pending YOU row → the server's pick line arrives → exactly one YOU line", () => {
    const before = [line(1, "So. Someone has found my heart.")];
    // The pick: one pending row, right after the line it followed, dimmed.
    let pending = [pendingPickOf(`${menu.id}:0:1`, menu.channel, "I'm a person.", before)];
    let shown = withPendingPicks(before, pending, "Winamp");
    let html = render({ lines: shown });
    expect(youLines(html)).toBe(1);
    expect(html).toContain('class="line mine kind-line echo pending"');
    expect(html.indexOf("I&#x27;m a person.")).toBeGreaterThan(html.indexOf("found my heart"));

    // A slow stream: other lines come, the pick is still pending, still once.
    const slow = [...before, line(2, "Hm.")];
    pending = unansweredPicks(pending, slow);
    expect(pending).toHaveLength(1);
    expect(youLines(render({ lines: withPendingPicks(slow, pending, "Winamp") }))).toBe(1);

    // The server's own pick line, then his reply: the pending row gives way.
    const after = [...slow, pick(3, "I'm a person."), line(4, "A person. Of course.")];
    shown = withPendingPicks(after, pending, "Winamp");
    html = render({ lines: shown });
    expect(youLines(html)).toBe(1);
    expect(html).not.toContain("pending");
    expect(unansweredPicks(pending, after)).toEqual([]);
  });

  it("a deed is pending as the server will draw it; an older pick, another room or a typed line never answers it", () => {
    const lines = [line(5, "Prove it.")];
    const p = pendingPickOf("7:1:2", menu.channel, "⟦PROOF⟧ Show him the Sandy File.", lines);
    expect(p).toMatchObject({ text: "[shows the Sandy File]", act: true, after: 5 });
    expect(withPendingPicks(lines, [p], "Winamp").map((l) => l.text)).toEqual(["Prove it.", "[shows the Sandy File]"]);
    expect(unansweredPicks([p], [pick(4, "[shows the Sandy File]", true)])).toHaveLength(1);
    expect(unansweredPicks([p], [{ ...pick(6, "[shows the Sandy File]", true), channel: "dm:Clippy" }])).toHaveLength(1);
    expect(unansweredPicks([p], [line(6, "[shows the Sandy File]", false)])).toHaveLength(1);
    // Answered by a line the visit's thread leaves out: still dropped.
    expect(withPendingPicks([], [p], "Winamp", [pick(6, "[shows the Sandy File]", true)])).toEqual([]);
  });

  it("two same-word picks each wait for their own server line (one line answers one pick)", () => {
    const before = [line(1, "Again?")];
    const a = pendingPickOf("7:0:1", menu.channel, "I'm a person.", before);
    const b = pendingPickOf("8:0:2", menu.channel, "I'm a person.", before);
    // The first pick's line arrives: only the first gives way.
    const one = [...before, pick(2, "I'm a person.")];
    let open = unansweredPicks([a, b], one);
    expect(open.map((p) => p.key)).toEqual(["8:0:2"]);
    expect(youLines(render({ lines: withPendingPicks(one, [a, b], "Winamp") }))).toBe(2);
    // The terminal prunes its list: the claimed line never answers the second pick too.
    open = unansweredPicks(open, one);
    expect(open.map((p) => p.key)).toEqual(["8:0:2"]);
    // Its own line arrives: both answered, two YOU lines, none pending.
    const two = [...one, pick(3, "I'm a person.")];
    expect(unansweredPicks(open, two)).toEqual([]);
    const html = render({ lines: withPendingPicks(two, open, "Winamp") });
    expect(youLines(html)).toBe(2);
    expect(html).not.toContain("pending");
  });
});

describe("the thread at a room terminal (wave 27)", () => {
  it("draws no empty cursor for a line still queued for the voice: one typing row instead (B3)", () => {
    const html = render({ lines: [line(1, "First."), line(2, "Second."), line(3, "Third.")], revealed: new Map([[1, 3], [2, 0], [3, 0]]) });
    expect(html).toContain("Fir");
    expect(html).not.toContain("Second.");
    expect(html).not.toContain("Third.");
    expect(html.match(/class="line theirs typing"/g)?.length).toBe(1);
    expect(html.match(/class="cursor"/g)?.length).toBe(1);
  });

  it("says once that earlier messages are on the phone, and never asks his heart to say something", () => {
    const html = render({ lines: [line(9, "Winamp. I know that name.")], earlier: true });
    expect(html.indexOf("earlier messages are on your phone")).toBeLessThan(html.indexOf("I know that name"));
    expect(render({ lines: [], empty: "— direct line to TRABOLTA open. he speaks first. —" })).not.toContain("say something");
    expect(render({ lines: [] })).toContain("say something");
  });
});
