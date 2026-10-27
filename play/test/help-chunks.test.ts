//! Wave 26 (integration): the performer-only help articles (`role: performer`)
//! are a chunk of their own (`help-staff.tsx`) that no guest path loads; the
//! guests' Help chunk (`help.tsx`) bundles the guest articles only.

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GUEST_FILES, guestArticles } from "../src/help.tsx";
import { STAFF_FILES, articlesFor } from "../src/help-staff.tsx";

const HELP_DIR = new URL("../../docs/help/play/", import.meta.url);
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);

function frontRole(name: string): string | null {
  const raw = readFileSync(new URL(name, HELP_DIR), "utf8");
  const head = /^---\n([\s\S]*?)\n---/u.exec(raw)?.[1] ?? "";
  return /^role:\s*(\S+)/mu.exec(head)?.[1] ?? null;
}

describe("the performer-only help chunk", () => {
  const all = readdirSync(HELP_DIR).filter((n) => n.endsWith(".md")).sort();
  const staff = all.filter((n) => frontRole(n) === "performer");

  it("help-staff.tsx bundles exactly the role: performer articles", () => {
    expect(staff.length).toBeGreaterThan(0);
    expect(Object.keys(STAFF_FILES).map(base).sort()).toEqual(staff);
  });

  it("help.tsx bundles every other article, and none of the performer ones", () => {
    expect(Object.keys(GUEST_FILES).map(base).sort()).toEqual(all.filter((n) => !staff.includes(n)));
    for (const raw of Object.values(GUEST_FILES)) expect(raw).not.toMatch(/^role:\s*performer/mu);
    expect(guestArticles().every((a) => !a.role)).toBe(true);
  });

  it("performers still read everything", () => {
    expect(articlesFor("performer").length).toBe(all.length);
    expect(articlesFor("guest")).toEqual(guestArticles());
  });

  it("only the booth and the director import help-staff.tsx", () => {
    for (const f of ["help.tsx", "help-lazy.tsx", "ui.tsx", "guest/app.tsx"]) expect(src(f), f).not.toMatch(/(?:from|import\() ?"[^"]*help-staff/u);
    expect(src("booth/app.tsx")).toContain('from "../help-staff.tsx"');
    expect(src("director.tsx")).toContain('from "./help-staff.tsx"');
  });
});
