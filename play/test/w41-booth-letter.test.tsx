//! Wave 41 (C3): a performer's opt-in to Jean Trabolta's letter, on the
//! booth's home (`booth/letter.tsx` over `booth/letter-model.ts`).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ApiError } from "../src/client.ts";
import { PlayHostContext, browserHost, memoryStore, type SessionStorage } from "../src/host.ts";
import { LetterCard } from "../src/booth/letter.tsx";
import { LETTER_COPY, LETTER_TITLE, letterCardState, letterDismissKey, letterErrorText, letterOnHome, loadLetterDismissed, saveLetterDismissed } from "../src/booth/letter-model.ts";
import type { PrimeLetter } from "../src/types.ts";

const save = async (email: string | null) => ({ ok: true as const, email });

function render(letter: PrimeLetter | undefined, storage: SessionStorage = memoryStore(), withSave = true, startOpen = true): string {
  return renderToStaticMarkup(
    createElement(PlayHostContext.Provider, { value: { ...browserHost, storage } }, createElement(LetterCard, { letter, eventId: "ev-1", character: "Clippy", save: withSave ? save : undefined, startOpen })),
  );
}

describe("the letter card's state", () => {
  const letter: PrimeLetter = { email: null, from: "Jean Trabolta <letters@example.com>" };
  it("shows nothing without PrimeView.letter (an older server, no character)", () => {
    expect(letterCardState(undefined, null, false, false)).toBe("none");
    expect(letterCardState(undefined, "guest@example.com", false, true)).toBe("none");
  });
  it("asks until an address is sent or No thanks is tapped", () => {
    expect(letterCardState(letter, null, false, false)).toBe("ask");
    expect(letterCardState(letter, null, true, false)).toBe("none");
  });
  it("shows the address on file (even after a No thanks), and the form while changing it", () => {
    expect(letterCardState(letter, "guest@example.com", false, false)).toBe("onFile");
    expect(letterCardState(letter, "guest@example.com", true, false)).toBe("onFile");
    expect(letterCardState(letter, "guest@example.com", false, true)).toBe("ask");
  });
  it("still asks when the server has no mail set up (from: null)", () => {
    expect(letterCardState({ email: null, from: null }, null, false, false)).toBe("ask");
  });
});

describe("the dismissal is kept per event + character, guarded", () => {
  it("keys on both", () => {
    expect(letterDismissKey("ev-1", "Clippy")).not.toBe(letterDismissKey("ev-2", "Clippy"));
    expect(letterDismissKey("ev-1", "Clippy")).not.toBe(letterDismissKey("ev-1", "Norton"));
  });
  it("round-trips, and a blocked store forgets without throwing", () => {
    const store = memoryStore();
    const k = letterDismissKey("ev-1", "Clippy");
    expect(loadLetterDismissed(store, k)).toBe(false);
    saveLetterDismissed(store, k);
    expect(loadLetterDismissed(store, k)).toBe(true);
    const blocked: SessionStorage = {
      load: () => {
        throw new Error("blocked");
      },
      save: () => {
        throw new Error("blocked");
      },
      drop: () => {},
    };
    expect(() => saveLetterDismissed(blocked, k)).not.toThrow();
    expect(loadLetterDismissed(blocked, k)).toBe(false);
  });
});

describe("refusals in plain words", () => {
  it("names a bad address and a booth with no part", () => {
    expect(letterErrorText(new ApiError("bad_email", 400))).toMatch(/email address/u);
    expect(letterErrorText(new ApiError("forbidden", 403))).toMatch(/no part/u);
    expect(letterErrorText(new Error("network"))).toMatch(/Try again/u);
  });
});

describe("it lives on the booth's home, never over a scan", () => {
  const base = { player: false, mission: false, host: false, showOnScreen: false, wide: false, roomOpen: false, scanning: false };
  it("a booth's room list, a player's Mission, a host's Show", () => {
    expect(letterOnHome(base)).toBe(true);
    expect(letterOnHome({ ...base, roomOpen: true })).toBe(false);
    expect(letterOnHome({ ...base, roomOpen: true, wide: true })).toBe(true);
    expect(letterOnHome({ ...base, player: true, mission: true })).toBe(true);
    expect(letterOnHome({ ...base, player: true, mission: false })).toBe(false);
    expect(letterOnHome({ ...base, host: true, showOnScreen: true })).toBe(true);
    expect(letterOnHome({ ...base, host: true, showOnScreen: false })).toBe(false);
  });
  it("never while the scanner is up", () => {
    expect(letterOnHome({ ...base, scanning: true })).toBe(false);
    expect(letterOnHome({ ...base, player: true, mission: true, scanning: true })).toBe(false);
  });
  it("sits below the NOW card and the banner in the booth's frame", () => {
    const app = readFileSync(new URL("../src/booth/app.tsx", import.meta.url), "utf8");
    const now = app.indexOf("<NowCard");
    const layer = app.indexOf("<MomentsLayer />");
    const card = app.indexOf("<LetterCard");
    expect(now).toBeGreaterThan(0);
    expect(card).toBeGreaterThan(layer);
    expect(layer).toBeGreaterThan(now);
  });
});

describe("the card", () => {
  it("asks with the DRAFT w41 copy, a 16 px email field, Send and No thanks", () => {
    const html = render({ email: null, from: null });
    expect(html).toContain(LETTER_TITLE);
    expect(html).toContain(LETTER_COPY.replace(/'/gu, "&#x27;"));
    expect(html).toContain('type="email"');
    expect(html).toMatch(/autocomplete="email"/iu);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send<\/button>/u);
    expect(html).toContain(">No thanks</button>");
    const css = readFileSync(new URL("../src/css/booth.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.booth-letter-input \{[^}]*font: 16px/u);
  });
  it("wave 47: on a phone the ask starts as one row (the title, No thanks), never the whole form over Mission", () => {
    const html = render({ email: null, from: null }, memoryStore(), true, false);
    expect(html).toContain('class="booth-letter folded"');
    expect(html).toContain(LETTER_TITLE);
    expect(html).toContain(">No thanks</button>");
    expect(html).not.toContain("<input");
    expect(html).not.toContain(LETTER_COPY.replace(/'/gu, "&#x27;"));
    const app = readFileSync(new URL("../src/booth/app.tsx", import.meta.url), "utf8");
    expect(app).toMatch(/<LetterCard [^>]*startOpen=\{wide\} \/>/u);
  });
  it("folds to ✔ <address> with Change / Remove when one is on file", () => {
    const html = render({ email: "guest@example.com", from: null });
    expect(html).toContain("✔ guest@example.com");
    expect(html).toContain(">Change</button>");
    expect(html).toContain(">Remove</button>");
    expect(html).not.toContain("<input");
  });
  it("is gone once dismissed, without PrimeView.letter, or without the session call", () => {
    const store = memoryStore();
    saveLetterDismissed(store, letterDismissKey("ev-1", "Clippy"));
    expect(render({ email: null, from: null }, store)).toBe("");
    expect(render(undefined)).toBe("");
    expect(render({ email: null, from: null }, memoryStore(), false)).toBe("");
  });
  it("marks its copy DRAFT w41", () => {
    const src = readFileSync(new URL("../src/booth/letter-model.ts", import.meta.url), "utf8");
    expect(src).toMatch(/DRAFT w41/u);
  });
});
