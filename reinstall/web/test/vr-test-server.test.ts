// The VR quick test server's shared config (reinstall/vr/tools/test-server.mjs):
// made once, then kept, so a test APK built against it keeps working.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error a plain .mjs tool with no types
import { testConfig } from "../../vr/tools/test-server.mjs";

describe("VR test server config", () => {
  it("is made once with its own passcodes, never :7000", () => {
    const path = join(mkdtempSync(join(tmpdir(), "vr-test-server-")), "build", "test-server.json");
    const a = testConfig(path);
    expect(a.port).toBe(7642);
    expect(new Set([a.mod, a.event, a.prime]).size).toBe(3);
    for (const k of ["mod", "event", "prime"]) expect(a[k]).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(a);
    expect(testConfig(path)).toEqual(a);
  });
});
