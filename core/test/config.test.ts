//! `LOOM_DB_WAIT`'s off switch reads the same in the server as in
//! deploy/docker-entrypoint.sh (scripts/ops/test/run.sh covers that side).

import { describe, expect, it } from "vitest";
import { dbWaitOff } from "../server/config.ts";

describe("dbWaitOff (review 2: the entrypoint and the server agree)", () => {
  it("off in the entrypoint's spellings, or 0 seconds, means the database is not required", () => {
    for (const v of ["off", "OFF", "Off", "0", "00"]) expect(dbWaitOff(v), v).toBe(true);
  });
  it("seconds, blank, unset or anything the entrypoint reads as 60 keep the wait", () => {
    for (const v of [undefined, "", "60", "5", "30s", "oFf", " off", "no"]) expect(dbWaitOff(v), String(v)).toBe(false);
  });
});
