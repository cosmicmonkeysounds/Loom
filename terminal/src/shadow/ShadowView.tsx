//! The shadow view (wave 14, `view=shadow`, and `auto`'s pane while the
//! camera is live): this tablet's own camera full screen, and over it every
//! reinstallation player as a ghost — placed through a three.js camera
//! matched to the tablet (its house-map spot: pos, yaw, pitch, fov; see
//! `shadow.ts`), so a program walking the virtual house shows up where it
//! would stand in this real room. The room's shadow dimension.
//!
//! Its own minimal scene: no walls, no floors, only ghosts — dark translucent
//! silhouettes with a cyan / violet glow (a CSS drop-shadow over the canvas'
//! alpha), a flicker and the scanlines, wearing the guest's picture and
//! name tag like the world view's. Only players on this terminal's floor and
//! roughly in front of it show. A selfie camera is mirrored, and the ghost
//! canvas with it (the tags are flipped back so they still read).
//!
//! No camera (or no spot, or no WebGL) → `onUnavailable`, and the caller
//! shows the world view instead. Same frame cap / pixel ratio / hidden-page
//! pause / context release as the world view.

import { useEffect, useMemo, useRef, useState } from "react";
import { Color, Mesh, MeshLambertMaterial, PerspectiveCamera, Scene, Sprite, WebGLRenderer, type Material, type SpriteMaterial } from "three";
import { createAvatar, type Avatar } from "@loom/house/three";
import { fnv1a32 } from "@loom/house";
import { useCamera, type Facing } from "../camera.ts";
import { avatarUrl, byActivity } from "../world/state.ts";
import { useWorld, type WorldStore } from "../world/stream.ts";
import { flicker, inShadow, mirroredFor, shadowCamera, spotFloor } from "./shadow.ts";

const FRAME_MS = 1000 / 24;
const MAX_PIXEL_RATIO = 1.25;
const SHADOW_BODY = new Color(0x07040f);
const RIMS = [new Color(0x40e8ff), new Color(0xa060ff)];

interface Ghost {
  avatar: Avatar;
  seed: number;
  /** Materials whose opacity flickers. */
  mats: Material[];
}

/** Turn a world-view ghost into a shadow: a dark body glowing cyan or violet. */
function shade(avatar: Avatar, seed: number): Material[] {
  const rim = RIMS[seed % RIMS.length]!;
  const mats: Material[] = [];
  avatar.object.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const m = o.material as Material;
    if (m instanceof MeshLambertMaterial) {
      m.color.copy(SHADOW_BODY);
      m.emissive.copy(rim).multiplyScalar(0.18);
    } else if ("color" in m && (m as unknown as { color: Color }).color instanceof Color) {
      (m as unknown as { color: Color }).color.copy(rim);
    }
    mats.push(m);
  });
  return mats;
}

/** A mirrored canvas mirrors the tags too: flip their textures back. */
function unmirrorTag(tag: Sprite | null, mirrored: boolean): void {
  const map = (tag?.material as SpriteMaterial | undefined)?.map;
  if (!map) return;
  const want = mirrored ? -1 : 1;
  if (map.repeat.x !== want) {
    map.repeat.x = want;
    map.offset.x = mirrored ? 1 : 0;
  }
}

export function ShadowView({ store, spotId, facing, onUnavailable }: { store: WorldStore; spotId: string; facing: Facing; onUnavailable: () => void }) {
  const info = useWorld(store, (s) => s.house);
  const world = useWorld(store, (s) => s.world);
  const cam = useCamera(facing, true);
  const video = useRef<HTMLVideoElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [showing, setShowing] = useState(0);
  const spot = useMemo(() => info?.house.terminals.find((t) => t.id === spotId) ?? null, [info, spotId]);
  const mirrored = mirroredFor(facing);
  const gaveUp = useRef(onUnavailable);
  gaveUp.current = onUnavailable;

  // No camera, or a spot the map doesn't have: the world view instead.
  useEffect(() => {
    if (cam.state === "denied" || cam.state === "none" || cam.state === "insecure" || cam.state === "error") gaveUp.current();
  }, [cam.state]);
  useEffect(() => {
    if (info !== null && info.source !== "bundled" && spot === null) gaveUp.current();
  }, [info, spot]);

  useEffect(() => {
    const v = video.current;
    if (v === null || cam.stream === null) return;
    v.srcObject = cam.stream;
    void v.play().catch(() => {});
    return () => {
      v.srcObject = null;
    };
  }, [cam.stream]);

  useEffect(() => {
    const box = host.current;
    if (info === null || box === null || spot === null) return;
    const { house } = info;
    const el = document.createElement("canvas");
    el.className = "shadow-canvas";
    box.appendChild(el);
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas: el, alpha: true, antialias: false, powerPreference: "low-power", premultipliedAlpha: true });
    } catch {
      el.remove();
      gaveUp.current();
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    const scene = new Scene();
    const floor = spotFloor(house, spot);
    const pose = shadowCamera(spot);
    const camera = new PerspectiveCamera(pose.fov, 1, 0.05, 40);
    camera.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
    camera.lookAt(pose.look[0], pose.look[1], pose.look[2]);
    const ghosts = new Map<string, Ghost>();
    let aspect = 1;
    let shown = -1;

    const resize = () => {
      const w = Math.max(1, box.clientWidth);
      const h = Math.max(1, box.clientHeight);
      renderer.setSize(w, h, false);
      aspect = w / h;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);

    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (last !== 0 && t - last < FRAME_MS - 2) return;
      const dt = last === 0 ? 0 : Math.min(0.1, (t - last) / 1000);
      last = t;
      const players = store.snapshot.world.players;
      for (const [id, g] of ghosts) {
        if (players.has(id)) continue;
        g.avatar.dispose();
        ghosts.delete(id);
      }
      let count = 0;
      for (const p of players.values()) {
        const picture = avatarUrl(store.base, p.avatar);
        let g = ghosts.get(p.session);
        if (!g) {
          const avatar = createAvatar(p.name, p.guest, { picture });
          const seed = fnv1a32(p.session);
          g = { avatar, seed, mats: shade(avatar, seed) };
          scene.add(avatar.object);
          ghosts.set(p.session, g);
        } else g.avatar.setPicture(picture);
        const at = p.buffer.sample(t) ?? p.pose;
        const visible = inShadow(spot, floor, { p: at.p, floor: p.floor }, aspect);
        g.avatar.object.visible = visible;
        if (!visible) continue;
        count++;
        g.avatar.setPose(at.p, at.yaw, at.pitch);
        g.avatar.update(dt);
        const o = flicker(t, g.seed % 97);
        for (const m of g.mats) m.opacity = o;
        unmirrorTag(g.avatar.tag, mirrored);
      }
      renderer.render(scene, camera);
      if (count !== shown) {
        shown = count;
        setShowing(count);
      }
    };
    const start = () => {
      cancelAnimationFrame(raf);
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const onVisibility = () => (document.hidden ? cancelAnimationFrame(raf) : start());
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) start();
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      for (const g of ghosts.values()) g.avatar.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      el.remove();
    };
  }, [info, spot, store, mirrored]);

  const total = useMemo(() => byActivity(world).length, [world]);

  return (
    <div className={`shadow${mirrored ? " mirrored" : ""}`} ref={host}>
      <video ref={video} className="shadow-video" muted playsInline autoPlay />
      {cam.stream === null && <div className="world-note blink">OPENING THE CAMERA…</div>}
      <div className="shadow-tag">
        <span className="rec" />
        SHADOW · {showing > 0 ? `${showing} PROGRAM${showing === 1 ? "" : "S"} IN THIS ROOM` : total > 0 ? `${total} IN THE SIMULATION` : "NO PROGRAMS IN THE SIMULATION"}
      </div>
    </div>
  );
}
