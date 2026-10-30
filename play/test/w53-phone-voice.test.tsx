// Wave 53 (docs/loom-w53-contract.md C4, C5): the house announcements in the
// phone's own voice, opt-in, off and on from ⊞ Start. Fake `speechSynthesis`:
// what a real phone does with it is not proven here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { voiceStartItem } from "../src/chrome/start-menu.tsx";
import { chatFrameHandler, CHAT_FRAMES } from "../src/client.ts";
import { ANNOUNCE_STALE_MS, PHONE_VOICE_HELLO, phoneAnnounce, phoneVoiceOn, setPhoneVoice } from "../src/phone-voice.ts";
import { boothStartItems, playerStartItems } from "../src/booth/header.tsx";
import { guestStartItems } from "../src/guest/frame.tsx";
import type { SessionStorage } from "../src/host.ts";

class Utterance {
  lang = "";
  volume = 1;
  constructor(public text: string) {}
}
let spoken: Utterance[];
let cancelled: number;
const memory = (): SessionStorage => {
  const m = new Map<string, unknown>();
  return {
    load: <T,>(k: string) => (m.has(k) ? (m.get(k) as T) : null),
    save: (k: string, v: unknown) => void m.set(k, v),
    drop: (k: string) => void m.delete(k),
  } as unknown as SessionStorage;
};

beforeEach(() => {
  spoken = [];
  cancelled = 0;
  vi.stubGlobal("window", {
    SpeechSynthesisUtterance: Utterance,
    speechSynthesis: { speak: (u: Utterance) => spoken.push(u), cancel: () => (cancelled += 1), resume: () => {} },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("the switch", () => {
  it("is off until the owner turns it on, and says so aloud inside the tap", () => {
    const storage = memory();
    expect(phoneVoiceOn(storage)).toBe(false);
    setPhoneVoice(storage, true);
    expect(phoneVoiceOn(storage)).toBe(true);
    expect(spoken.map((u) => u.text)).toEqual([PHONE_VOICE_HELLO]);
    expect(spoken[0]!.lang).toBe("en-US");
  });
  it("turns off and cuts what it was saying, and turns back on", () => {
    const storage = memory();
    setPhoneVoice(storage, true);
    setPhoneVoice(storage, false);
    expect(phoneVoiceOn(storage)).toBe(false);
    expect(cancelled).toBe(1);
    setPhoneVoice(storage, true);
    expect(phoneVoiceOn(storage)).toBe(true);
  });
  it("survives a storage that throws", () => {
    const bad = { load: () => { throw new Error("blocked"); }, save: () => { throw new Error("blocked"); } } as unknown as SessionStorage;
    expect(phoneVoiceOn(bad)).toBe(false);
    expect(() => setPhoneVoice(bad, true)).not.toThrow();
  });
});

describe("an announcement", () => {
  const on = () => {
    const storage = memory();
    setPhoneVoice(storage, true);
    spoken = [];
    return { storage, embedded: false };
  };
  it("is said only by a phone that opted in", () => {
    phoneAnnounce({ storage: memory(), embedded: false }, { text: "Go to the living room.", at: 1000 }, 1000);
    expect(spoken).toEqual([]);
    phoneAnnounce(on(), { text: "Go to the living room.", at: 1000 }, 1000);
    expect(spoken.map((u) => u.text)).toEqual(["Go to the living room."]);
  });
  it("is never said in an embedded pane", () => {
    phoneAnnounce({ ...on(), embedded: true }, { text: "Hello.", at: 1000 }, 1000);
    expect(spoken).toEqual([]);
  });
  it("is not said once stale (a phone that slept through it)", () => {
    const host = on();
    phoneAnnounce(host, { text: "Old.", at: 1000 }, 1000 + ANNOUNCE_STALE_MS + 1);
    expect(spoken).toEqual([]);
    phoneAnnounce(host, { text: "Just in time.", at: 1000 }, 1000 + ANNOUNCE_STALE_MS);
    expect(spoken).toHaveLength(1);
  });
  it("stops on the director's 🔇, opted in or not", () => {
    phoneAnnounce({ storage: memory(), embedded: false }, { stop: true });
    expect(cancelled).toBe(1);
  });
  it("ignores a malformed frame", () => {
    const host = on();
    phoneAnnounce(host, {});
    phoneAnnounce(host, { text: "" });
    expect(spoken).toEqual([]);
  });
  it("arrives as a stream frame", () => {
    expect(CHAT_FRAMES).toContain("announce");
    const got: unknown[] = [];
    chatFrameHandler(() => ({ onAnnounce: (n) => got.push(n) }), { replace: () => {}, upsert: () => {}, drop: () => {} })("announce", JSON.stringify({ text: "Hi.", at: 5 }));
    expect(got).toEqual([{ text: "Hi.", at: 5 }]);
  });
});

describe("⊞ Start", () => {
  const voice = (on: boolean) => voiceStartItem({ on, toggle: () => {} });
  it("reads as the switch it is, and is gone with no voice to offer", () => {
    expect(voice(false)).toMatchObject({ id: "voice", icon: "🔇", label: "Say announcements out loud" });
    expect(voice(true)).toMatchObject({ id: "voice", icon: "🔊", label: "Announcements out loud (tap to stop)" });
    expect(voiceStartItem(null)).toBeNull();
    expect(voice(true)!.confirm).toBeUndefined(); // straight through: it must speak inside the tap
    expect(voice(true)!.arm).toBeUndefined();
  });
  const wake = { supported: false, on: false, toggle: () => {} };
  const noop = () => {};
  it("is on a guest's, a player's and a host's menu", () => {
    const open = { act: noop, sides: noop, people: noop, notifications: noop, help: noop, leave: noop };
    expect(guestStartItems({ name: "Calc", faction: null, interactions: [], sides: false, people: true, voice: voice(false), open }).map((i) => i.id)).toEqual(["people", "notifications", "voice", "help", "leave"]);
    expect(playerStartItems({ character: "Clippy", wake, embedded: false, onHelp: noop, onSheet: noop, onPeople: noop, onSignOut: noop, voice: voice(false) }).map((i) => i.id)).toContain("voice");
    expect(boothStartItems({ character: "Task Manager", admin: true, host: true, knows: 0, wake, embedded: false, onHelp: noop, onSheet: noop, onSignOut: noop, voice: voice(false) }).map((i) => i.id)).toContain("voice");
  });
});

describe("the wiring", () => {
  const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  it("the guest and the booth both hear the frame", () => {
    expect(src("session/guest.ts")).toContain("onAnnounce: (n) => phoneAnnounce(host, n)");
    expect(src("session/prime.ts")).toContain("onAnnounce: (n) => phoneAnnounce(host, n)");
  });
  it("the card turns it on inside its tap, before the answer goes out", () => {
    expect(src("widgets.tsx")).toMatch(/if \(voice\) setPhoneVoice\(host\.storage, i === 0\);\s+onAnswer\?\.\(/u);
  });
  it("its first-load module is written with `//`, never `//!`", () => {
    expect(src("phone-voice.ts")).not.toMatch(/^\/\/!/mu);
  });
});
