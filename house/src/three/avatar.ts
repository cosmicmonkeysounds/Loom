//! Other players as ghosts: a glitchy swarm of the program's own profile
//! picture (`swarm.ts`), held to the capsule its body would fill and tearing
//! into a face that stares at the camera, under a name tag styled as a
//! Windows 98 title bar (canvas — skipped without a DOM). The capsule itself
//! is only the shape the swarm holds to: it is never drawn. Feed it
//! interpolated poses (`PoseBuffer`) in house coordinates; `p` is the body's
//! base (the feet, floor level), as on the wire.
//!
//! The picture (`opts.picture` / `setPicture`, the guest's own — Excel looks
//! like Excel) is also the tag's window icon. Its textures are the shared
//! `loadPicture` ones, never freed here. No picture (none set, no DOM, a load
//! that failed) is the same swarm as static in the ghost's tint.

import { Color, Group, Mesh, Sprite, SpriteMaterial } from "three";
import { fnv1a32 } from "../duck.ts";
import type { Vec3 } from "../types.ts";
import { Bin, DEG } from "./dispose.ts";
import { loadPicture, shardsOf } from "./picture.ts";
import { swarmGeometry, swarmMaterial, SwarmTrail, SWARM_TIME_WRAP } from "./swarm.ts";
import { titleBarTexture } from "./textures.ts";

/** Body height (the top of the collider's capsule). */
export const AVATAR_HEIGHT = 1.6;
const TAG_HEIGHT = 0.16;
/** Over the face (`SWARM_FACE_SIZE` round `SWARM_FACE_Y`). */
const TAG_Y = 1.95;

export interface AvatarOptions {
  /** The profile picture's URL (same-origin `…/api/avatar/<key>`); null or absent = none. */
  picture?: string | null;
}

export interface Avatar {
  object: Group;
  /** The name tag sprite (null without a DOM). */
  tag: Sprite | null;
  /** The picture URL asked for (null = none); the swarm wears it once it has loaded. */
  readonly picture: string | null;
  /** Whether the swarm is made of the picture yet (false: static in the tint). */
  readonly wearing: boolean;
  /** Wear another picture (null takes it off). A no-op for the URL already worn
   *  or loading; the same URL after a failed load asks again (see `loadPicture`). */
  setPicture(url: string | null): void;
  /** House-frame pose: base position, yaw + pitch in degrees (pitch > 0 looks up). */
  setPose(p: Vec3, yaw: number, pitch?: number): void;
  /** How much of the swarm is there this frame, 0…1: shards drop out, never fade. */
  setPresence(share: number): void;
  /** Draw for a canvas mirrored in CSS, so the picture still reads the right way round. */
  setMirrored(mirrored: boolean): void;
  /** The swarm's clock; `dt` seconds. */
  update(dt: number): void;
  dispose(): void;
}

/** The ghost colour for a seed (a guest id, a session id, …): a bright hue. */
export function avatarColor(seed: string | number): Color {
  const h = typeof seed === "number" ? Math.abs(Math.floor(seed)) : fnv1a32(seed);
  return new Color().setHSL((h % 360) / 360, 0.75, 0.62);
}

export function createAvatar(name: string, colorSeed: string | number = name, opts: AvatarOptions = {}): Avatar {
  const bin = new Bin();
  const object = new Group();
  object.name = `avatar:${name}`;

  const seed = fnv1a32(String(colorSeed)) % 1000;
  const swarmMat = bin.add(swarmMaterial(seed / 10, avatarColor(colorSeed)));
  const u = swarmMat.uniforms;
  const swarm = new Mesh(bin.add(swarmGeometry()), swarmMat);
  swarm.name = "avatar:body";
  swarm.frustumCulled = false; // the shards are placed in the shader, the trail behind it
  object.add(swarm);
  const trail = new SwarmTrail();

  let tag: Sprite | null = null;
  let tagMat: SpriteMaterial | null = null;
  /** Draw the tag (again, with the picture as its icon once it has loaded). */
  const drawTag = (icon: CanvasImageSource | null): void => {
    const made = titleBarTexture(name, undefined, { buttons: true, icon });
    if (!made) return;
    if (tag === null || tagMat === null) {
      tagMat = new SpriteMaterial({ map: made.texture, depthTest: false, depthWrite: false, transparent: true });
      tag = new Sprite(tagMat);
      tag.name = "avatar:tag";
      tag.renderOrder = 10;
      tag.position.y = TAG_Y;
      object.add(tag);
    } else {
      tagMat.map?.dispose();
      tagMat.map = made.texture;
      tagMat.needsUpdate = true;
    }
    tag.scale.set(TAG_HEIGHT * made.aspect, TAG_HEIGHT, 1);
  };
  drawTag(null);

  // The picture: the URL asked for, and the swarm's shards once it has loaded.
  let picture: string | null = null;
  let wearing = false;
  /** The URL a load is in flight for (null = none). */
  let loading: string | null = null;
  let disposed = false;
  const takeOff = (): void => {
    if (!wearing) return;
    wearing = false;
    u.uMap.value = null; // the texture is the shared picture's
    u.uWorn.value = 0;
    if (tag !== null && !disposed) drawTag(null);
  };
  const setPicture = (url: string | null): void => {
    const next = url === "" ? null : url;
    if (disposed) return;
    if (next === picture) {
      // Worn, loading, or none: nothing to do. The same URL, not worn and
      // nothing in flight, is a load that failed — ask again (`loadPicture`
      // answers its remembered null until the failure expires).
      if (next === null || wearing || loading === next) return;
    } else {
      picture = next;
      takeOff();
      if (next === null) return;
    }
    loading = next;
    void loadPicture(next).then((tex) => {
      if (loading === next) loading = null;
      if (tex === null || disposed || picture !== next) return;
      u.uMap.value = shardsOf(tex);
      u.uWorn.value = u.uMap.value === null ? 0 : 1;
      wearing = true;
      if (tag !== null) drawTag(tex.image as CanvasImageSource);
    });
  };
  setPicture(opts.picture ?? null);

  let time = seed;
  let at: Vec3 = [0, 0, 0];
  return {
    object,
    get tag() {
      return tag;
    },
    get picture() {
      return picture;
    },
    get wearing() {
      return wearing;
    },
    setPicture,
    setPose(p: Vec3, yaw: number, pitch = 0) {
      object.position.set(p[0], p[1], p[2]);
      at = p;
      const up = Math.max(-80, Math.min(80, pitch)) * DEG;
      const round = yaw * DEG;
      u.uLook.value.set(-Math.sin(round) * Math.cos(up), Math.sin(up), -Math.cos(round) * Math.cos(up));
    },
    setPresence(share: number) {
      u.uPresent.value = share;
    },
    setMirrored(mirrored: boolean) {
      u.uFlip.value = mirrored ? -1 : 1;
    },
    update(dt: number) {
      if (!Number.isFinite(dt)) return;
      time = (time + dt) % SWARM_TIME_WRAP;
      u.uTime.value = time;
      trail.step(at, dt);
      trail.offsets.forEach((o, i) => u.uTrail.value[i]!.set(o[0], o[1], o[2]));
    },
    dispose() {
      disposed = true;
      takeOff();
      tagMat?.map?.dispose();
      tagMat?.dispose();
      object.removeFromParent();
      bin.dispose();
    },
  };
}
