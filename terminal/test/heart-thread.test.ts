import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Thread } from "../src/chat.tsx";
import type { Line } from "../src/pilot.ts";

const line = (seq: number, text: string, theirs = true): Line => ({ seq, text, theirs, from: theirs ? "Trabolta" : "Winamp", channel: "dm:Trabolta", ts: 0, kind: "line" }) as unknown as Line;

describe("the thread's echoes of a pick at the heart", () => {
  it("land after the line they followed, never stored", () => {
    const html = renderToStaticMarkup(
      createElement(Thread, { lines: [line(1, "So. Someone has found my heart."), line(5, "Go on.")], revealed: new Map(), typing: false, character: "Trabolta", guestName: "Winamp", echoes: [{ key: "a", text: "I'm a person.", after: 1 }, { key: "b", text: "Then listen to me.", after: 5 }] }),
    );
    const at = (s: string) => html.indexOf(s);
    expect(at("› I&#x27;m a person.")).toBeGreaterThan(at("found my heart"));
    expect(at("› I&#x27;m a person.")).toBeLessThan(at("Go on."));
    expect(at("› Then listen to me.")).toBeGreaterThan(at("Go on."));
  });
});
