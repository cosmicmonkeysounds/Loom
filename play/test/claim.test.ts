//! W11 (SW-PLAY-01): reserved programs. An invitation's `?claim=` rides
//! the whole join (the picker and the register), reserved tiles read
//! 🔒 Reserved, and the 409 `reserved` refusal says to ask a host.

import { afterEach, describe, expect, it, vi } from "vitest";

import { hitNote, hitPickable, orderPicker, rowNote, rowPickable, rowTitle, type IdentityRow, type ProgramHit } from "../src/avatars.ts";
import { CLAIM_KEY, RESERVED_TEXT, claimField, claimFromSearch, isReservedRefusal, joinClaim, registerErrorText, rememberClaim, storedClaim, withoutClaim } from "../src/claim.ts";
import { memoryStore } from "../src/host.ts";
import { ApiError } from "../src/client.ts";
import { initialRole } from "../src/director.tsx";
import { fetchIdentities, fetchPictures, registerBody, searchPrograms } from "../src/session.ts";

const row = (name: string, extra: Partial<IdentityRow> = {}): IdentityRow => ({ name, faction: null, avatar: null, claimed: false, ...extra });

describe("the claim link", () => {
  it("reads and strips ?claim=", () => {
    expect(claimFromSearch("?code=EVT1&claim=ab12cd")).toBe("ab12cd");
    expect(claimFromSearch("?code=EVT1&claim=%20")).toBeNull();
    expect(claimFromSearch("?code=EVT1")).toBeNull();
    expect(withoutClaim("?code=EVT1&claim=ab12cd")).toBe("?code=EVT1");
    expect(withoutClaim("?claim=ab12cd")).toBe("");
    expect(claimField("ab12cd")).toEqual({ claim: "ab12cd" });
    expect(claimField(null)).toEqual({});
    expect(claimField("")).toEqual({});
  });

  it("opens the guest join from the chooser, never over a stored session", () => {
    const none = () => null;
    expect(initialRole("?code=EVT1&claim=ab12cd", none)).toBe("guest");
    expect(initialRole("?code=EVT1", none)).toBe("none");
    expect(initialRole("?code=EVT1&claim=ab12cd", (k) => (k === "loom.prime" ? "{}" : null))).toBe("prime");
  });
});

describe("the kept claim", () => {
  it("a cut session rejoins with the claim this browser kept for the code", () => {
    const storage = memoryStore();
    // The invitation's first join: the address bar's claim, then kept.
    expect(joinClaim("ab12cd", storage, "EVT1")).toBe("ab12cd");
    rememberClaim(storage, "evt1 ", "ab12cd");
    // A restart cut the session; the address bar lost the claim at the join.
    expect(joinClaim(null, storage, "EVT1")).toBe("ab12cd");
    expect(storedClaim(storage, "evt1")).toBe("ab12cd");
    // Another event's code gets nothing; a newer invitation replaces it.
    expect(joinClaim(null, storage, "OTHER")).toBeNull();
    rememberClaim(storage, "EVT1", "zz99");
    expect(joinClaim(null, storage, "EVT1")).toBe("zz99");
    // A plain join keeps what was there; junk in storage reads as nothing.
    rememberClaim(storage, "EVT1", null);
    expect(storedClaim(storage, "EVT1")).toBe("zz99");
    storage.save(CLAIM_KEY, { code: "EVT1", claim: 7 });
    expect(storedClaim(storage, "EVT1")).toBeNull();
  });
});

describe("reserved tiles", () => {
  it("are locked, read 🔒 Reserved, and sort after the free ones and before the taken", () => {
    const rows = [row("Excel", { reserved: true }), row("Winamp", { claimed: true }), row("Notepad"), row("VLC", { reserved: false })];
    expect(orderPicker(rows).map((r) => r.name)).toEqual(["Notepad", "VLC", "Excel", "Winamp"]);
    expect(rowPickable(rows[0]!)).toBe(false);
    expect(rowNote(rows[0]!)).toBe("🔒 Reserved");
    expect(rowTitle(rows[0]!)).toContain("saved for an invited guest");
    // Taken outranks reserved; an older server's row (no field) is open.
    expect(rowNote(row("Excel", { reserved: true, claimed: true }))).toBe("taken");
    expect(rowPickable(row("Notepad"))).toBe(true);
    expect(rowNote(row("Notepad"))).toBeNull();
  });

  it("the 409 reserved refusal asks for a host; anything else keeps the server's words", () => {
    expect(isReservedRefusal(new ApiError("reserved", 409))).toBe(true);
    expect(registerErrorText(new ApiError("reserved", 409))).toBe(RESERVED_TEXT);
    expect(RESERVED_TEXT).toBe("This program is saved for an invited guest — ask a host.");
    expect(isReservedRefusal(new ApiError("that name is taken", 409))).toBe(false);
    expect(registerErrorText(new ApiError("that name is taken", 409))).toBe("that name is taken");
    expect(registerErrorText(new Error("offline"))).toBe("offline");
  });
});

describe("reserved search hits", () => {
  const hit = (extra: Partial<ProgramHit> = {}): ProgramHit => ({ name: "Microsoft Excel", description: "Spreadsheet editor", avatar: null, claimed: false, blocked: null, ...extra });

  it("a featured program found by its article name is locked and says so", () => {
    expect(hitPickable(hit({ reserved: true }))).toBe(false);
    expect(hitNote(hit({ reserved: true }))).toContain("🔒 Reserved");
    // Taken and antivirus outrank it; an older server's hit (no field) is open.
    expect(hitNote(hit({ reserved: true, claimed: true }))).toBe("Taken tonight");
    expect(hitPickable(hit())).toBe(true);
    expect(hitNote(hit())).toBe("Spreadsheet editor");
  });
});

describe("the claim rides the picker calls", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("identities and pictures carry it when there is one, and not otherwise", async () => {
    const bodies: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", (async (url: string, init: RequestInit) => {
      bodies.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      const body = url === "/api/resolve-code" ? { eventId: "e1", role: "guest" } : url.endsWith("/pictures") ? { name: "Excel", options: [] } : { role: "guest", identities: [], search: false };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch);
    await fetchIdentities("EVT1", undefined, "ab12cd");
    await fetchIdentities("EVT1", { eventId: "e1", role: "guest" }, "ab12cd");
    await fetchIdentities("EVT1", { eventId: "e1", role: "guest" });
    await fetchPictures("e1", "EVT1", { name: "Excel" }, "ab12cd");
    const ids = bodies.filter((b) => b.url === "/e/e1/api/identities").map((b) => b.body);
    expect(ids).toEqual([
      { passcode: "EVT1", claim: "ab12cd" },
      { passcode: "EVT1", claim: "ab12cd" },
      { passcode: "EVT1" },
    ]);
    expect(bodies.find((b) => b.url.endsWith("/pictures"))?.body).toEqual({ passcode: "EVT1", name: "Excel", claim: "ab12cd" });
  });

  it("the directory search carries it, so an invitee's own program is open to them", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch);
    await searchPrograms("e1", "EVT1", "excel", "ab12cd");
    await searchPrograms("e1", "EVT1", "excel");
    expect(bodies).toEqual([
      { passcode: "EVT1", q: "excel", claim: "ab12cd" },
      { passcode: "EVT1", q: "excel" },
    ]);
  });

  it("the register carries it too", () => {
    expect(registerBody("Excel", "EVT1", undefined, "k1", "ab12cd")).toEqual({ name: "Excel", passcode: "EVT1", picture: "k1", claim: "ab12cd" });
    expect(registerBody("Notepad", "EVT1")).toEqual({ name: "Notepad", passcode: "EVT1" });
    expect(registerBody("NHL 97", "EVT1", "NHL 97", undefined, null)).toEqual({ name: "NHL 97", passcode: "EVT1", wiki: "NHL 97" });
  });
});
