// The map embedded in Loom Edit (wave 49, C7): the key rules in a shadow root,
// the opened lock, the re-scoped stylesheet, and what the embed may import.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { baseOf } from "../src/config.ts";
import { mapPaneCss } from "../src/map/embed-css.ts";
import { editorTakesKey, isTyping, keyOrigin, mapAnswersKey, MapUnlock } from "../src/map/unlock.ts";

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const key = (key: string, mods: Partial<Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey">> = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe("keys in a shadow root", () => {
  it("reads where the key really landed, not the shadow host", () => {
    const input = { tagName: "INPUT", type: "text" } as unknown as EventTarget;
    const hostEl = { tagName: "DIV" } as unknown as EventTarget;
    expect(keyOrigin({ composedPath: () => [input, hostEl], target: hostEl })).toBe(input);
    // Only after the dispatch is the path empty.
    expect(keyOrigin({ composedPath: () => [], target: hostEl })).toBe(hostEl);
  });

  it("a text field types, a checkbox or a plain element doesn't, so typing never deletes a room", () => {
    const el = (tagName: string, more: object = {}) => ({ tagName, ...more }) as unknown as EventTarget;
    for (const t of [el("INPUT", { type: "text" }), el("INPUT", { type: "number" }), el("TEXTAREA"), el("SELECT"), el("DIV", { isContentEditable: true })]) expect(isTyping(t)).toBe(true);
    for (const t of [el("INPUT", { type: "checkbox" }), el("INPUT", { type: "range" }), el("BUTTON"), el("DIV"), null]) expect(isTyping(t)).toBe(false);
    expect(editorTakesKey({ typing: isTyping(el("INPUT", { type: "text" })), editing: true, asking: false })).toBe(false);
    expect(editorTakesKey({ typing: false, editing: true, asking: false })).toBe(true);
  });

  it("answers to its own keys and lets the host's through", () => {
    for (const k of [key("z", { metaKey: true }), key("Z", { metaKey: true }), key("z", { ctrlKey: true }), key("y", { metaKey: true }), key("d", { metaKey: true }), key("Delete"), key("Backspace"), key("Escape"), key("["), key("]"), key("ArrowUp"), key("v"), key("r"), key("R"), key("y"), key("d"), key("s")]) expect(mapAnswersKey(k)).toBe(true);
    for (const k of [key("1", { metaKey: true }), key("b", { metaKey: true }), key("p", { metaKey: true }), key("s", { metaKey: true }), key("/", { metaKey: true }), key("[", { altKey: true }), key("x"), key(" "), key("Enter"), key("F1")]) expect(mapAnswersKey(k)).toBe(false);
  });
});

describe("the lock opened", () => {
  it("never asks once the page has been given the passcode", async () => {
    const lock = new MapUnlock(async () => "never asked", true);
    expect(lock.open).toBe(true);
    expect(await lock.ensure(async () => { throw new Error("asked"); })).toBe(true);
  });

  it("stays shut by default", () => {
    expect(new MapUnlock(async () => null).open).toBe(false);
  });
});

describe("the stylesheet in a pane", () => {
  const real = readFileSync(resolve(src, "styles.css"), "utf8");

  it("moves the page's rules onto the host and the frame", () => {
    const css = mapPaneCss(real);
    expect(css).not.toMatch(/:root\b/u);
    expect(css).toContain(":host {");
    expect(css).toMatch(/\.map-frame \{\s*background: var\(--teal\)/u);
    expect(css).not.toMatch(/(^|\n)\s*html, body, #root/u);
    expect(css).not.toMatch(/(^|[}\n])\s*body\s*\{/u);
  });

  it("sizes to the pane, not the window", () => {
    const css = mapPaneCss(real);
    expect(css).toContain("@container map (max-width: 860px)");
    expect(css).toContain("grid-template-rows: 58cqh auto");
    expect(css).toContain("clamp(15px, 1.6cqw, 18px)");
    expect(css).toContain("container: map / size");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toMatch(/\d(vw|vh)\b/u);
  });

  it("reads a minified build too, range queries and all", () => {
    const css = mapPaneCss(":root{--a:1}*{margin:0}html,body,#root{height:100%;margin:0}body{color:red;font-size:1.6vw}@media (width<=860px){.m{height:58vh}}@media (prefers-reduced-motion:reduce){.m{color:red}}");
    expect(css).toContain(":host{--a:1}");
    expect(css).toContain("*{margin:0}.map-frame {color:red;font-size:1.6cqw}");
    expect(css).toContain("@container map (width<=860px){.m{height:58cqh}}");
    expect(css).toContain("@media (prefers-reduced-motion:reduce)");
  });
});

describe("the embed's API base", () => {
  it("is same-origin unless the host says otherwise", () => {
    expect(baseOf({ eventId: "ev 1" })).toBe("/e/ev%201");
    expect(baseOf({ eventId: "ev1", apiBase: "https://loom.example" })).toBe("https://loom.example/e/ev1");
  });
});

/** Every module `file` reaches through static imports; `import("…")` stays lazy. */
function staticImports(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/^(?:import|export)\s[^;]*?\sfrom\s+"([^"]+)";/gmu)) {
    if (/^import\s+type\s|^export\s+type\s/u.test(m[0])) continue;
    const spec = m[1]!;
    if (!spec.startsWith(".")) {
      seen.add(spec);
      continue;
    }
    const target = resolve(dirname(file), spec.split("?")[0]!);
    if (/\.tsx?$/u.test(target) && existsSync(target)) staticImports(target, seen);
  }
  return seen;
}

describe("what the embed drags in", () => {
  const reached = [...staticImports(resolve(src, "map/embed.tsx"))];

  it("has neither Setup nor the game", () => {
    expect(reached.filter((f) => f.endsWith("/app.tsx") || f.endsWith("/flow.tsx") || f.endsWith("/game/engine.ts") || f.endsWith("/game/Play.tsx"))).toEqual([]);
    expect(reached.filter((f) => f.includes("/src/game/")).map((f) => f.split("/src/")[1]).sort()).toEqual(["game/hud.ts", "game/quality.ts"]);
  });

  it("leaves three.js to the lazy 3D preview", () => {
    expect(reached.filter((f) => f === "three" || f.startsWith("three/") || f === "@loom/house/three" || f.endsWith("/Preview3D.tsx"))).toEqual([]);
    expect(readFileSync(resolve(src, "map/MapEditor.tsx"), "utf8")).toContain('lazy(() => import("./Preview3D.tsx"))');
  });

  it("the standalone page still brings the map's stylesheets, the editor doesn't", () => {
    const page = readFileSync(resolve(src, "map/MapApp.tsx"), "utf8");
    const editor = readFileSync(resolve(src, "map/MapEditor.tsx"), "utf8");
    expect(page).toContain('import "./audio.css"');
    expect(page).toContain('import "./lights.css"');
    expect(editor).not.toMatch(/import ".*\.css"/u);
  });
});
