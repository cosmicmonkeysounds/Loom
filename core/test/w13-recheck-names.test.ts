//! Wave 13 recheck, lane ccore — item 5: a lookalike of a name already here
//! (an inserted space, a dotless ı, a Cyrillic і, Greek capitals) is that
//! name, compared by `nameSkeleton`; distinct names (Word, WordPad) stay apart.

import { afterAll, describe, expect, it } from "vitest";
import { nameSkeleton } from "../server/identity.ts";
import { cleanup, freshDir, guest, register, runtime } from "./w13-fix-harness.ts";
import { STORY } from "./w13-recheck-story.ts";

afterAll(cleanup);

describe("5: lookalike names", () => {
  it("nameSkeleton: spaces, punctuation, accents and look-alike letters fold; distinct names stay apart", () => {
    expect(nameSkeleton("Win Zip")).toBe("winzip");
    expect(nameSkeleton("Fire fox")).toBe("firefox");
    expect(nameSkeleton("WınZip")).toBe("winzip"); // dotless ı
    expect(nameSkeleton("Wіnzip")).toBe("winzip"); // Cyrillic і
    expect(nameSkeleton("Nоrton")).toBe("norton"); // Cyrillic о
    expect(nameSkeleton("ΑΟL")).toBe("aol"); // Greek capitals
    expect(nameSkeleton("Pokémon")).toBe("pokemon");
    expect(nameSkeleton("Ｗｉｎｚｉｐ")).toBe("winzip");
    expect(nameSkeleton("🎉")).toBe("");
    expect(nameSkeleton("Word")).not.toBe(nameSkeleton("WordPad"));
  });

  it("a lookalike of a name already here is refused (409); a distinct name registers", async () => {
    const rt = runtime({}, freshDir(), STORY);
    rt.openDoors();
    await guest(rt, "WinZip");
    await guest(rt, "Firefox");
    for (const n of ["Win Zip", "Fire fox", "WınZip", "Wіnzip", "W.I.N.Z.I.P", "win_zip"]) expect((await register(rt, n)).status, n).toBe(409);
    await guest(rt, "Word");
    await guest(rt, "WordPad");
    // A lookalike of a performer's part is that part.
    const part = await register(rt, "Nоrton");
    expect(part.status).toBe(409);
    expect(part.json.error).toMatch(/part in the story/u);
    // Emoji-only names compare folded only (no skeleton).
    await guest(rt, "🎉");
    expect((await register(rt, "🎉")).status).toBe(409);
    rt.dispose();
  });
});
