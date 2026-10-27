//! Wave 26 integration (R1/P1): typing in, folding or leaving a composer
//! crashed the whole app ("TypeError: n is not a function"). The composer's
//! effect returned onText's result as its cleanup, and the room's onText
//! returned the assigned string, so React called a string on the next
//! keystroke or on unmount. These run the real components' hooks through a
//! harness that commits effects the way React 18 does.

import { readdirSync, readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { ChannelView } from "../src/stream/channel-view.tsx";
import { Composer } from "../src/stream/composer.tsx";
import type { Channel, ChatMessage } from "../src/types.ts";
import { elements, mountHooks } from "./hooks-harness.ts";

const msg = { seq: 1, channel: "dm:Task Manager", channelKind: "dm", title: "Task Manager", from: "Task Manager", kind: "line", text: "Hi", ts: 0, audience: ["g1"], parentSeq: null, hidden: false } as unknown as ChatMessage;
const room = { id: "dm:Task Manager", kind: "dm", title: "Task Manager", spaceId: "story", messages: [msg], unread: 0, decision: null, lastTs: 0 } as unknown as Channel;
const widgets = { answer: () => {}, answered: new Map(), viewer: { id: "g1", name: "Ada" } };

type ChangeEvt = { target: { value: string } };
const textarea = (out: unknown) => elements(out).find((e) => (e.props as { className?: string }).className === "composer-input") as ReactElement<{ onChange: (e: ChangeEvt) => void; value: string }>;

describe("the room's draft callback returns nothing", () => {
  it("ChannelView's onText (handed to the composer) is a statement, not a value", () => {
    const h = mountHooks(ChannelView as (p: object) => unknown, { channel: room, onBack: () => {}, onSend: () => {}, widgets });
    const composer = elements(h.output).find((e) => e.type === Composer) as ReactElement<{ onText: (t: string) => unknown }> | undefined;
    expect(composer).toBeDefined();
    expect(composer!.props.onText("half typed")).toBeUndefined();
    h.unmount();
  });
});

describe("the composer survives typing, folding and leaving", () => {
  const room_onText = () => {
    // The room's own callback, exactly as ChannelView builds it.
    const h = mountHooks(ChannelView as (p: object) => unknown, { channel: room, onBack: () => {}, onSend: () => {}, widgets });
    const c = elements(h.output).find((e) => e.type === Composer) as ReactElement<{ onText: (t: string) => void }>;
    return c.props.onText;
  };

  it("the first keystroke re-runs the effect without calling a string", () => {
    const seen: string[] = [];
    const onText = room_onText();
    const spy = (t: string) => {
      seen.push(t);
      return onText(t);
    };
    const h = mountHooks(Composer as (p: object) => unknown, { onSend: () => {}, onText: spy });
    expect(() => h.act(() => textarea(h.output).props.onChange({ target: { value: "a" } }))).not.toThrow();
    expect(() => h.act(() => textarea(h.output).props.onChange({ target: { value: "ab" } }))).not.toThrow();
    expect(textarea(h.output).props.value).toBe("ab");
    expect(seen).toEqual(["", "a", "ab"]);
    // ‹ Back, the fold to the ⌨ bar, or the R1 switch to the lock screen.
    expect(() => h.unmount()).not.toThrow();
  });

  it("an untouched composer unmounts cleanly too (leaving a DM straight away)", () => {
    const h = mountHooks(Composer as (p: object) => unknown, { onSend: () => {}, onText: room_onText() });
    expect(() => h.unmount()).not.toThrow();
  });

  it("whatever onText returns, the composer's effect returns nothing", () => {
    // A caller that returns a value (as the old room callback did) still cannot crash it.
    const h = mountHooks(Composer as (p: object) => unknown, { onSend: () => {}, onText: (t: string) => t });
    expect(() => h.act(() => textarea(h.output).props.onChange({ target: { value: "x" } }))).not.toThrow();
    expect(() => h.unmount()).not.toThrow();
  });

  it("the half-typed draft is handed back when the composer mounts again (fold → unfold)", () => {
    const h = mountHooks(ChannelView as (p: object) => unknown, { channel: room, onBack: () => {}, onSend: () => {}, widgets });
    const c = elements(h.output).find((e) => e.type === Composer) as ReactElement<{ onText: (t: string) => void }>;
    c.props.onText("I was in the kit");
    h.rerender({ channel: { ...room }, onBack: () => {}, onSend: () => {}, widgets });
    const again = elements(h.output).find((e) => e.type === Composer) as ReactElement<{ initial?: string }>;
    expect(again.props.initial).toBe("I was in the kit");
    h.unmount();
  });
});

describe("no effect hands React a value as its cleanup", () => {
  const files = (dir: URL): URL[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? files(new URL(`${d.name}/`, dir)) : /\.tsx?$/u.test(d.name) ? [new URL(d.name, dir)] : [],
    );
  it("an expression-bodied effect only calls a state setter (which returns undefined)", () => {
    const bad: string[] = [];
    for (const f of files(new URL("../src/", import.meta.url))) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/use(?:Layout|Insertion)?Effect\(\(\) => (?!\{|\(\) =>|set[A-Z]\w*\()([^\n]{0,60})/gu)) bad.push(`${f.pathname.split("/src/")[1]}: ${m[1]}`);
    }
    expect(bad).toEqual([]);
  });
  it("the guest root has an error boundary: one throw gives a Reload, never a blank page", () => {
    const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
    expect(main).toMatch(/<ChunkBoundary fallback=\{\(\) => <ChunkFailed what=\{[^}]*"The app"\} \/>\}>\s*<App resume=\{resume\} card=\{card\} \/>\s*<\/ChunkBoundary>/u);
  });
});
