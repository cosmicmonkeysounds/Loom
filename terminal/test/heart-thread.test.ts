import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Thread } from "../src/chat.tsx";
import type { Line } from "../src/pilot.ts";

const line = (seq: number, text: string, theirs = true): Line => ({ seq, text, theirs, from: theirs ? "Trabolta" : "Winamp", channel: "dm:Trabolta", ts: 0, kind: "line" }) as unknown as Line;
const render = (p: Partial<Parameters<typeof Thread>[0]>) =>
  renderToStaticMarkup(createElement(Thread, { lines: [], revealed: new Map(), typing: false, character: "Trabolta", guestName: "Winamp", ...p }));

describe("the thread's echoes of a pick at the heart", () => {
  it("land after the line they followed, never stored", () => {
    const html = render({ lines: [line(1, "So. Someone has found my heart."), line(5, "Go on.")], echoes: [{ key: "a", text: "I'm a person.", after: 1 }, { key: "b", text: "Then listen to me.", after: 5 }] });
    const at = (s: string) => html.indexOf(s);
    expect(at("I&#x27;m a person.")).toBeGreaterThan(at("found my heart"));
    expect(at("I&#x27;m a person.")).toBeLessThan(at("Go on."));
    expect(at("Then listen to me.")).toBeGreaterThan(at("Go on."));
  });

  it("read like a typed line (YOU and the time); a deed reads as an action (B4)", () => {
    const ts = new Date(2026, 9, 31, 20, 4).getTime();
    const html = render({ lines: [line(1, "Go on.")], echoes: [{ key: "a", text: "[shows the Sandy File]", after: 1, ts, action: true }] });
    expect(html).toContain('class="line mine echo act"');
    expect(html).toContain("20:04");
    expect(html).toContain("[shows the Sandy File]");
    expect(html).not.toContain("›");
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
