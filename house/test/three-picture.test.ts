// Profile pictures on ghosts and the King's "n / max" bar, with a fake DOM:
// a canvas whose 2-D context records what it is asked to draw, and an
// `Image` that "loads" any URL but one with "broken" in it. Nothing renders;
// the tests read the scene graph and the recorded draw calls.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sprite, Texture } from "three";
import { AVATAR_HEIGHT, createAvatar, createKing, loadPicture, PICTURE_PX } from "../src/three/index.ts";
import { clearPictureCache } from "../src/three/picture.ts";
import { healthBarTexture } from "../src/three/textures.ts";
import { loadHouse, SHOW_HOUSE } from "./golden.ts";

type Call = { op: string; args: unknown[] };
let calls: Call[] = [];
let images = 0;

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
    queueMicrotask(() => (url.includes("broken") ? this.onerror?.() : this.onload?.()));
  }
}

const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

beforeEach(() => {
  calls = [];
  images = 0;
  clearPictureCache();
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext() }),
  });
  vi.stubGlobal("Image", FakeImage);
});

afterEach(() => {
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

  it("a picture that won't load is null — and never asked for again", async () => {
    expect(await loadPicture("/e/ev/api/avatar/broken")).toBeNull();
    expect(await loadPicture("/e/ev/api/avatar/broken")).toBeNull();
    expect(images).toBe(1);
  });
});

describe("a ghost wearing its picture", () => {
  const url = "/e/ev/api/avatar/cccccccccccccccc";

  it("the tile is the head over the capsule; the tag is lifted above it and redrawn with the icon", async () => {
    const plain = createAvatar("Excel", "g-1");
    const plainTagY = plain.tag!.position.y;
    const a = createAvatar("Excel", "g-1", { picture: url });
    expect(a.object.getObjectByName("avatar:picture")).toBeUndefined(); // not loaded yet
    const iconsBefore = calls.filter((c) => c.op === "drawImage").length;
    await settle();
    const tile = a.object.getObjectByName("avatar:picture") as Sprite;
    expect(tile).toBeDefined();
    expect(tile.position.y - tile.scale.y / 2).toBeGreaterThan(AVATAR_HEIGHT);
    expect(a.tag!.position.y).toBeGreaterThan(tile.position.y + tile.scale.y / 2);
    expect(a.tag!.position.y).toBeGreaterThan(plainTagY);
    // The tile's draw and the tag's icon.
    expect(calls.filter((c) => c.op === "drawImage").length).toBe(iconsBefore + 2);
    // Off again: no tile, the tag back down.
    a.setPicture(null);
    expect(a.object.getObjectByName("avatar:picture")).toBeUndefined();
    expect(a.tag!.position.y).toBe(plainTagY);
    a.dispose();
    plain.dispose();
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
    expect(b.object.getObjectByName("avatar:picture")).toBeDefined();
    b.setPicture(null);
    b.dispose();
    expect(freed).toBe(0);
  });

  it("the last picture asked for wins, however the loads land", async () => {
    const a = createAvatar("Excel", "g-1", { picture: "/e/ev/api/avatar/1111111111111111" });
    a.setPicture("/e/ev/api/avatar/2222222222222222");
    await settle();
    const tiles: Sprite[] = [];
    a.object.traverse((o) => {
      if (o.name === "avatar:picture") tiles.push(o as Sprite);
    });
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.material.map).toBe(await loadPicture("/e/ev/api/avatar/2222222222222222"));
    expect(a.picture).toBe("/e/ev/api/avatar/2222222222222222");
    a.dispose();
  });

  it("a picture that won't load leaves the plain capsule", async () => {
    const a = createAvatar("Excel", "g-1", { picture: "/e/ev/api/avatar/broken" });
    await settle();
    expect(a.object.getObjectByName("avatar:picture")).toBeUndefined();
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

  it("setHp draws the bar sprite over him", () => {
    const show = loadHouse(SHOW_HOUSE);
    const k = createKing(show.props.find((p) => p.kind === "king")!);
    k.setHp(14, 15);
    expect(k.object.getObjectByName("king:bar")).toBeDefined();
    expect(texts()).toContain("14 / 15");
    k.dispose();
  });
});
