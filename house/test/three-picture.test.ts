// Profile pictures on ghosts and the King's "n / max" bar, with a fake DOM:
// a canvas whose 2-D context records what it is asked to draw, and an
// `Image` that "loads" any URL but one with "broken" in it. Nothing renders;
// the tests read the scene graph and the recorded draw calls.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import type { ShaderMaterial, Sprite, Texture } from "three";
import { BAR_MAX_ELEV_DEG, createAvatar, createKing, kingBarY, loadPicture, PICTURE_PX, shardsOf } from "../src/three/index.ts";
import { clearPictureCache, PICTURE_RETRY_MS } from "../src/three/picture.ts";
import { healthBarTexture } from "../src/three/textures.ts";
import { loadHouse, SHOW_HOUSE } from "./golden.ts";

type Call = { op: string; args: unknown[] };
let calls: Call[] = [];
let images = 0;
/** URLs that fail to load right now (as well as any with "broken" in them). */
const failing = new Set<string>();

function fakeContext(): CanvasRenderingContext2D {
  const record =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args });
    };
  return new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText") return (t: string) => ({ width: t.length * 10 });
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop: () => {} });
      if (typeof key === "string") return record(key);
      return undefined;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

class FakeImage {
  decoding = "";
  naturalWidth = 0; // an SVG with no intrinsic size
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    images++;
  }
  set src(url: string) {
    queueMicrotask(() => (url.includes("broken") || failing.has(url) ? this.onerror?.() : this.onload?.()));
  }
}

const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

beforeEach(() => {
  calls = [];
  images = 0;
  failing.clear();
  clearPictureCache();
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext() }),
  });
  vi.stubGlobal("Image", FakeImage);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearPictureCache();
});

describe("loadPicture", () => {
  it("draws the picture contain-fit on a fixed-size tile — an SVG with no size fills the well", async () => {
    const tex = (await loadPicture("/e/ev/api/avatar/aaaaaaaaaaaaaaaa"))!;
    expect(tex).not.toBeNull();
    const canvas = tex.image as { width: number; height: number };
    expect(canvas.width).toBe(PICTURE_PX);
    expect(canvas.height).toBe(PICTURE_PX);
    const draw = calls.find((c) => c.op === "drawImage")!;
    expect(draw).toBeDefined();
    const [, x, y, w, h] = draw.args as [unknown, number, number, number, number];
    expect(w).toBeGreaterThan(PICTURE_PX / 2);
    expect(w).toBe(h); // square for a sizeless image
    expect(x).toBeGreaterThan(0);
    expect(x + w).toBeLessThan(PICTURE_PX);
    expect(y).toBe(x);
  });

  it("decodes a URL once and hands every caller the same texture", async () => {
    const a = loadPicture("/e/ev/api/avatar/bbbbbbbbbbbbbbbb");
    const b = loadPicture("/e/ev/api/avatar/bbbbbbbbbbbbbbbb");
    expect(a).toBe(b);
    expect(await a).toBe(await b);
    expect(images).toBe(1);
  });

  it("a picture that won't load is null — and not asked for again straight away", async () => {
    expect(await loadPicture("/e/ev/api/avatar/broken")).toBeNull();
    expect(await loadPicture("/e/ev/api/avatar/broken")).toBeNull();
    expect(images).toBe(1);
  });

  it("a failure expires: a transient 404 is asked for once more after PICTURE_RETRY_MS", async () => {
    const url = "/e/ev/api/avatar/dddddddddddddddd";
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    failing.add(url); // the server is still fetching upstream: 404
    expect(await loadPicture(url)).toBeNull();
    failing.delete(url); // now it would load
    now += PICTURE_RETRY_MS - 1;
    expect(await loadPicture(url)).toBeNull(); // still remembered — no loop
    expect(images).toBe(1);
    now += 1;
    const tex = await loadPicture(url);
    expect(tex).not.toBeNull();
    expect(images).toBe(2);
    now += 10 * PICTURE_RETRY_MS;
    expect(await loadPicture(url)).toBe(tex); // a success stays cached for good
    expect(images).toBe(2);
  });
});

describe("a ghost wearing its picture", () => {
  const url = "/e/ev/api/avatar/cccccccccccccccc";

  it("the swarm is cut from the bare picture; the tag takes the tile as its icon", async () => {
    const a = createAvatar("Excel", "g-1", { picture: url });
    const swarm = a.object.getObjectByName("avatar:body") as unknown as { material: ShaderMaterial };
    const uniforms = swarm.material.uniforms as Record<string, { value: unknown }>;
    expect(a.wearing).toBe(false); // not loaded yet
    expect(uniforms["uWorn"]!.value).toBe(0);
    const iconsBefore = calls.filter((c) => c.op === "drawImage").length;
    await settle();
    expect(a.wearing).toBe(true);
    const tile = (await loadPicture(url))!;
    expect(uniforms["uMap"]!.value).toBe(shardsOf(tile));
    expect(uniforms["uMap"]!.value).not.toBe(tile);
    expect(uniforms["uWorn"]!.value).toBe(1);
    // The tile's draw, the bare picture's and the tag's icon.
    expect(calls.filter((c) => c.op === "drawImage").length).toBe(iconsBefore + 3);
    // Off again: static.
    a.setPicture(null);
    expect(a.wearing).toBe(false);
    expect(uniforms["uMap"]!.value).toBeNull();
    expect(uniforms["uWorn"]!.value).toBe(0);
    a.dispose();
  });

  it("the bare picture covers its square, with no bevel", async () => {
    const before = calls.length;
    const tex = (await loadPicture("/e/ev/api/avatar/ffffffffffffffff"))!;
    const draws = calls.slice(before).filter((c) => c.op === "drawImage");
    expect(draws).toHaveLength(2);
    const [, x, y, w, h] = draws[1]!.args as [unknown, number, number, number, number];
    expect([x, y, w, h]).toEqual([0, 0, PICTURE_PX, PICTURE_PX]);
    expect(shardsOf(tex)).not.toBeNull();
  });

  it("dispose never frees the shared texture (another ghost may wear it)", async () => {
    const a = createAvatar("Excel", "g-1", { picture: url });
    const b = createAvatar("Excel", "g-2", { picture: url });
    await settle();
    const tex = (await loadPicture(url)) as Texture;
    let freed = 0;
    tex.addEventListener("dispose", () => freed++);
    a.dispose();
    expect(freed).toBe(0);
    expect(b.wearing).toBe(true);
    b.setPicture(null);
    b.dispose();
    expect(freed).toBe(0);
  });

  it("the last picture asked for wins, however the loads land", async () => {
    const a = createAvatar("Excel", "g-1", { picture: "/e/ev/api/avatar/1111111111111111" });
    a.setPicture("/e/ev/api/avatar/2222222222222222");
    await settle();
    const swarm = a.object.getObjectByName("avatar:body") as unknown as { material: ShaderMaterial };
    expect((swarm.material.uniforms as Record<string, { value: unknown }>)["uMap"]!.value).toBe(shardsOf((await loadPicture("/e/ev/api/avatar/2222222222222222"))!));
    expect(a.picture).toBe("/e/ev/api/avatar/2222222222222222");
    a.dispose();
  });

  it("a ghost whose picture failed wears it once the failure expires and it is asked again", async () => {
    const url = "/e/ev/api/avatar/eeeeeeeeeeeeeeee";
    let now = 2_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    failing.add(url);
    const a = createAvatar("Excel", "g-1", { picture: url });
    await settle();
    expect(a.wearing).toBe(false);
    failing.delete(url);
    a.setPicture(url); // the next sync, too soon
    await settle();
    expect(a.wearing).toBe(false);
    expect(images).toBe(1);
    now += PICTURE_RETRY_MS;
    a.setPicture(url); // a sync a minute later
    a.setPicture(url); // and the frame after, while it loads: one load
    await settle();
    expect(a.wearing).toBe(true);
    expect(images).toBe(2);
    a.setPicture(url); // worn: a no-op
    await settle();
    expect(images).toBe(2);
    a.dispose();
  });

  it("a picture that won't load leaves the swarm as static", async () => {
    const a = createAvatar("Excel", "g-1", { picture: "/e/ev/api/avatar/broken" });
    await settle();
    expect(a.wearing).toBe(false);
    expect(a.object.getObjectByName("avatar:body")).toBeDefined();
    a.dispose();
  });
});

describe("the King's bar", () => {
  const texts = () => calls.filter((c) => c.op === "fillText").map((c) => c.args[0]);

  it("past nine points it reads n / max; up to nine it is one cell a point, PAWNS ONLY at 0", () => {
    expect(healthBarTexture("THE KING", 11, 15)).not.toBeNull();
    expect(texts()).toContain("11 / 15");
    calls = [];
    healthBarTexture("THE KING", 0, 15);
    expect(texts()).toContain("0 / 15");
    expect(texts()).not.toContain("PAWNS ONLY");
    calls = [];
    healthBarTexture("THE KING", 0, 8);
    expect(texts()).toContain("PAWNS ONLY");
    calls = [];
    healthBarTexture("THE KING", 3, 8);
    expect(texts().some((t) => typeof t === "string" && t.includes("/"))).toBe(false);
  });

  it("kingBarY: his nominal h + 0.25 from afar, eased to 16° over the eye up close, never under half his height", () => {
    expect(BAR_MAX_ELEV_DEG).toBe(16);
    const tan = Math.tan((16 * Math.PI) / 180);
    expect(kingBarY(1.9, 6, 1.6)).toBeCloseTo(2.15);
    expect(kingBarY(1.9, 1, 1.6)).toBeCloseTo(1.6 + tan);
    expect(kingBarY(1.9, 0, 1.6)).toBeCloseTo(1.6);
    expect(kingBarY(1.9, 0, 0)).toBeCloseTo(0.95); // a camera on the floor at his feet
    expect(kingBarY(1.9, 2, 5)).toBeCloseTo(2.15); // a camera high above (the editor's orbit)
  });

  it("in hit reach the whole bar stays inside a 70° frame at the web game's −8° pitch, from a 1.6 m eye (wave 26, R3)", () => {
    const show = loadHouse(SHOW_HOUSE);
    const prop = show.props.find((p) => p.kind === "king")!;
    const k = createKing(prop);
    k.object.position.set(...prop.pos);
    k.setHp(14, 15);
    const bar = k.object.getObjectByName("king:bar") as Sprite;
    const half = bar.scale.y / 2;
    const [x, y, z] = prop.pos;
    const camera = new PerspectiveCamera(70, 1.6, 0.05, 100);
    const ndc = (p: Vector3) => p.clone().project(camera).y;
    for (const d of [0.55, 0.75, 1, 1.25, 1.6, 2, 3, 4]) {
      const eye = y + 1.6;
      camera.position.set(x + d, eye, z);
      camera.lookAt(x, eye - d * Math.tan((8 * Math.PI) / 180), z);
      camera.updateMatrixWorld();
      k.update(0.016, camera);
      k.object.updateMatrixWorld();
      const at = bar.getWorldPosition(new Vector3());
      const top = ndc(at.clone().add(new Vector3(0, half, 0)));
      expect(top, `top edge at ${d} m`).toBeLessThan(0.95);
      expect(ndc(at.clone().sub(new Vector3(0, half, 0))), `bottom edge at ${d} m`).toBeGreaterThan(-0.95);
      // Never more than 16° above the eye.
      expect((Math.atan2(at.y - eye, d) * 180) / Math.PI).toBeLessThanOrEqual(16 + 1e-9);
      expect(bar.visible, `shown at ${d} m`).toBe(true);
    }
    // Back off: the bar returns to his nominal height over the crown.
    camera.position.set(x + 8, y + 1.6, z);
    camera.updateMatrixWorld();
    k.update(0.016, camera);
    expect(bar.position.y).toBeCloseTo(prop.size[1] + 0.25);
    k.dispose();
  });

  it("setHp draws the bar sprite over him", () => {
    const show = loadHouse(SHOW_HOUSE);
    const k = createKing(show.props.find((p) => p.kind === "king")!);
    k.setHp(14, 15);
    expect(k.object.getObjectByName("king:bar")).toBeDefined();
    expect(texts()).toContain("14 / 15");
    k.dispose();
  });
});
