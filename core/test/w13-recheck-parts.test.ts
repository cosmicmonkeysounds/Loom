//! Wave 13 recheck, lane ccore — item 6: before the doors, a performer code
//! lists the declared parts, so the host who opens the doors picks their
//! part instead of typing it.

import { afterAll, describe, expect, it } from "vitest";
import { CODES, booth, cleanup, freshDir, post, runtime } from "./w13-fix-harness.ts";
import { STORY } from "./w13-recheck-story.ts";

afterAll(cleanup);

describe("6: a performer code lists the parts before the doors", () => {
  it("identities for a performer code: the declared parts (no prop, no agent), and sign-in works", async () => {
    const rt = runtime({}, freshDir(), STORY);
    const ids = await post(rt, "/api/identities", { passcode: CODES.prime });
    expect(ids.status).toBe(200);
    expect(ids.json.doorsOpen).toBe(false);
    const names = (ids.json.identities as Array<{ name: string; claimed: boolean }>).map((r) => r.name).sort();
    expect(names).toEqual(["Clippy", "McAfee", "Norton", "Task Manager"]);
    const tm = await booth(rt, "Task Manager");
    expect(tm.status).toBe(200);
    expect(tm.json.host).toBe(true);
    const after = await post(rt, "/api/identities", { passcode: CODES.prime });
    expect((after.json.identities as Array<{ name: string; claimed: boolean }>).find((r) => r.name === "Task Manager")!.claimed).toBe(true);
    // A guest code still lists nothing before the doors.
    expect((await post(rt, "/api/identities", { passcode: CODES.event })).json.identities).toEqual([]);
    rt.dispose();
  });
});
