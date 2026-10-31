//! The raycast view (wave 16): the reinstallation as a "simple recreation of
//! the game" for a tablet with no WebGL2, wherever it would draw the world.
//! A classic raycaster in Canvas 2D (`raycast.ts`): one ray per column of a
//! small canvas (~320 × 180, scaled up pixelated), the virtual house's walls
//! in their rooms' colours (shaded by distance and by which way they face;
//! door gaps are open, lintels hang over them), flat floor and ceiling.
//!
//! A placed terminal is a **fixed window** from its own spot — the virtual
//! copy of its room seen from where the tablet hangs, the way the games'
//! virtual terminals show the real room — so you watch the players walk past
//! it in the second person. A terminal with no spot follows the most recently
//! active player over the shoulder.
//!
//! The players are billboards (their picture cut into a glitchy swarm,
//! `swarm.ts`, under a name tag), clipped against each column's nearest wall;
//! their golden ducks bob; the King stands with his shared bar (greyed when
//! he kneels). A small top-down inset shows the busiest floor. A find shows
//! the celebration banner (GERALD CAN'T HELP for a find the story kept); a
//! join / leave a toast. Fed by the same spatial stream as the world view
//! (`world/stream.ts` + `world/state.ts`) — no three.js, so it runs on
//! Chrome 87 / Safari 14 / the old Android tablets. Capped at 20 fps,
//! stopped while the page is hidden.

import { useEffect, useMemo, useRef, useState } from "react";
import { fnv1a32, roomById, type Vec3 } from "@loom/house";
import { avatarUrl, type WorldPlayer } from "../world/state.ts";
import { useWorld, type WorldStore } from "../world/stream.ts";
import { celebrationHeadline, chooseFloor, fitTransform, guestColor, holdFloor, kingOnFloor, planFloor, roomCaption, rosterTellsToasts, rosterToasts, statusLine, toScreen, type FloorHold, type PlanFloor } from "./plan.ts";
import {
  castColumns,
  chaseCamera,
  depthSorted,
  dirOf,
  internalSize,
  followTarget,
  projectSprite,
  rayWalls,
  shade,
  smoothCamera,
  spotCamera,
  visibleRuns,
  type Projected,
  type RayCamera,
  type RayWall,
} from "./raycast.ts";
import { drawSwarm, swarmPieces } from "./swarm.ts";
import "./raycast.css";
import { noteWorldShowing } from "../cutscene/world-bus.ts";

const FRAME_MS = 1000 / 20;
const MAX_PIXEL_RATIO = 2;
const TOAST_MS = 4000;
/** The players must want another floor this long before the inset follows them (ms). */
const FLOOR_HOLD_MS = 2500;
/** Billboard sizes (metres). */
const BODY_W = 0.45;
const BODY_TOP = 1.0;
const HEAD = 0.62;
const DUCK = 0.38;

interface Toast {
  id: number;
  text: string;
  at: number;
}

type Ctx = CanvasRenderingContext2D;

export function RaycastView({ store, spotId, size }: { store: WorldStore; spotId: string; size: "pane" | "full" }) {
  const info = useWorld(store, (s) => s.house);
  const connected = useWorld(store, (s) => s.connected);
  const players = useWorld(store, (s) => s.world.players.size);
  const celebrations = useWorld(store, (s) => s.world.celebrations);
  // This view celebrates a find itself: the duck's cutscene plays over it, see-through.
  useEffect(() => noteWorldShowing(), []);
  const box = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLCanvasElement>(null);
  const hud = useRef<HTMLCanvasElement>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [where, setWhere] = useState("");
  const spot = useMemo(() => info?.house.terminals.find((t) => t.id === spotId) ?? null, [info, spotId]);

  // Join / leave toasts, off the roster — only real joins / leaves (never a
  // reconnect's hello, the players dropped while the line is down, a reset).
  useEffect(() => {
    let prev = store.snapshot.world.players;
    let wasConnected = store.snapshot.connected;
    let awaitingHello = false;
    let resetAt = store.snapshot.world.resetAt;
    let seq = 0;
    return store.subscribe(() => {
      const snap = store.snapshot;
      if (snap.connected && !wasConnected) awaitingHello = true;
      wasConnected = snap.connected;
      const next = snap.world.players;
      if (next === prev) return;
      const tell = rosterTellsToasts({ awaitingHello, connected: snap.connected, resetChanged: snap.world.resetAt !== resetAt });
      awaitingHello = false;
      resetAt = snap.world.resetAt;
      const lines = tell ? rosterToasts(prev, next) : [];
      prev = next;
      if (lines.length === 0) return;
      const at = Date.now();
      setToasts((t) => [...t.filter((x) => at - x.at < TOAST_MS), ...lines.map((text) => ({ id: ++seq, text, at }))].slice(-3));
    });
  }, [store]);
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = window.setTimeout(() => setToasts((all) => all.filter((x) => Date.now() - x.at < TOAST_MS)), 1000);
    return () => window.clearTimeout(t);
  }, [toasts]);

  useEffect(() => {
    const el = scene.current;
    const over = hud.current;
    const host = box.current;
    if (info === null || el === null || over === null || host === null) return;
    const ctx = el.getContext("2d");
    const hctx = over.getContext("2d");
    if (ctx === null || hctx === null) return;
    const { house, walls } = info;
    const floorsRay = new Map<string, RayWall[]>();
    const wallsOn = (id: string) => floorsRay.get(id) ?? (floorsRay.set(id, rayWalls(house, walls, id)), floorsRay.get(id)!);
    const floorsPlan = new Map<string, PlanFloor>();
    const planOn = (id: string) => floorsPlan.get(id) ?? (floorsPlan.set(id, planFloor(house, walls, id)), floorsPlan.get(id)!);
    const pictures = new Map<string, HTMLImageElement | null>();
    const picture = (url: string | null): HTMLImageElement | null => {
      if (url === null) return null;
      if (pictures.has(url)) return pictures.get(url) ?? null;
      const img = new Image();
      img.onerror = () => pictures.set(url, null);
      img.src = url;
      pictures.set(url, img);
      return img;
    };
    const shades = new Map<string, string>();
    const shadeOf = (hex: string, light: number) => {
      const key = `${hex}|${Math.round(light * 40)}`;
      let s = shades.get(key);
      if (s === undefined) shades.set(key, (s = shade(hex, Math.round(light * 40) / 40)));
      return s;
    };
    let iw = 320;
    let ih = 180;
    let cw = 1;
    let ch = 1;
    let dpr = 1;
    const resize = () => {
      cw = Math.max(1, host.clientWidth);
      ch = Math.max(1, host.clientHeight);
      ({ w: iw, h: ih } = internalSize(cw, ch));
      el.width = iw;
      el.height = ih;
      dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      over.width = Math.round(cw * dpr);
      over.height = Math.round(ch * dpr);
    };
    resize();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    ro?.observe(host);
    window.addEventListener("resize", resize);

    let cam: RayCamera | null = null;
    let hold: FloorHold = { shown: null, want: null, since: 0 };
    let shownWhere = "";
    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (last !== 0 && t - last < FRAME_MS - 2) return;
      const dt = last === 0 ? 0 : (t - last) / 1000;
      last = t;
      const world = store.snapshot.world;
      const list = [...world.players.values()];
      const sample = (p: WorldPlayer) => p.buffer.sample(t) ?? p.pose;

      // The camera: the spot's fixed window, else over the followed player's shoulder.
      let target: RayCamera;
      let room: string | null;
      let label: string;
      if (spot !== null) {
        target = spotCamera(house, spot);
        room = spot.room;
        label = `WINDOW · ${roomCaption(house, spot.room).toUpperCase()}`;
      } else {
        const p = followTarget(list, t);
        if (p !== null) {
          const s = sample(p);
          target = chaseCamera(walls, p.floor, s.p, s.yaw);
          room = p.room;
          label = `FOLLOWING ${p.name.toUpperCase()}`;
        } else {
          const sp = house.spawn;
          target = { ...spotCamera(house, { id: "", name: "", room: sp.room, pos: [sp.pos[0], sp.pos[1] + 1.6, sp.pos[2]], yaw: sp.yaw }), pitch: -4 };
          room = sp.room;
          label = "THE SPAWN";
        }
      }
      cam = spot !== null ? target : smoothCamera(cam, target, dt);
      if (label !== shownWhere) setWhere((shownWhere = label));

      // The scene, at the internal resolution.
      const { cols, zbuf, horizon } = castColumns(wallsOn(cam.floor), cam, iw, ih);
      const roomColour = (room !== null ? roomById(house, room)?.color : undefined) ?? "#8a7a62";
      const sky = ctx.createLinearGradient(0, 0, 0, Math.max(1, horizon));
      sky.addColorStop(0, "#05051a");
      sky.addColorStop(1, shadeOf(roomColour, 0.18));
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, iw, Math.max(0, Math.min(ih, horizon)));
      const ground = ctx.createLinearGradient(0, Math.max(0, horizon), 0, ih);
      ground.addColorStop(0, "#0a0a0a");
      ground.addColorStop(1, shadeOf(roomColour, 0.55));
      ctx.fillStyle = ground;
      ctx.fillRect(0, Math.max(0, horizon), iw, ih - Math.max(0, horizon));
      const eye = cam.pos[1];
      const focal = ih / 2 / Math.tan((cam.fov * Math.PI) / 360);
      for (let x = 0; x < iw; x++) {
        for (const hit of cols[x]!) {
          const y0 = horizon - ((hit.wall.top - eye) / hit.depth) * focal;
          const y1 = horizon - ((hit.wall.bottom - eye) / hit.depth) * focal;
          const a = Math.max(0, Math.floor(y0));
          const b = Math.min(ih, Math.ceil(y1));
          if (b <= a) continue;
          ctx.globalAlpha = hit.wall.solid ? 1 : 0.75;
          ctx.fillStyle = shadeOf(hit.colour, hit.light);
          ctx.fillRect(x, a, 1, b - a);
          // A darker top and foot line gives each wall an edge.
          ctx.fillStyle = shadeOf(hit.colour, hit.light * 0.45);
          ctx.fillRect(x, a, 1, 1);
          ctx.fillRect(x, b - 1, 1, 1);
        }
      }
      ctx.globalAlpha = 1;

      // Sprites: the players, their ducks, the King — far first, clipped by the walls.
      type Sprite = { depth: number; draw: () => void };
      const sprites: Sprite[] = [];
      const tags: Array<{ x: number; y: number; text: string; colour: string }> = [];
      const clipTo = (pr: Projected, fn: () => void) => {
        const runs = visibleRuns(pr.x0, pr.x1, pr.depth, zbuf);
        if (runs.length === 0) return false;
        ctx.save();
        ctx.beginPath();
        for (const [a, b] of runs) ctx.rect(a, 0, b - a, ih);
        ctx.clip();
        fn();
        ctx.restore();
        return pr.depth < (zbuf[Math.max(0, Math.min(iw - 1, Math.round(pr.x)))] ?? Infinity);
      };
      for (const p of list) {
        if (p.floor !== cam.floor) continue;
        const s = sample(p);
        const base = s.p[1];
        const body = projectSprite(cam, iw, ih, s.p[0], s.p[2], base, base + BODY_TOP, BODY_W);
        const head = projectSprite(cam, iw, ih, s.p[0], s.p[2], base + BODY_TOP - 0.02, base + BODY_TOP + HEAD, HEAD);
        if (body === null || head === null) continue;
        const colour = guestColor(p.guest);
        const img = picture(avatarUrl(store.base, p.avatar));
        sprites.push({
          depth: body.depth,
          draw: () => {
            const seen = clipTo(head, () => {
              drawSwarm(ctx, head, body, img, colour, swarmPieces(fnv1a32(p.session) % 1000, t, body.depth));
            });
            if (seen) tags.push({ x: head.x, y: head.y0, text: p.name.toUpperCase(), colour });
          },
        });
      }
      for (const p of list) {
        if (p.found || roomById(house, p.duck.room)?.floor !== cam.floor) continue;
        const bob = 0.08 * Math.sin(t / 300 + p.session.length);
        const d = p.duck.pos;
        const pr = projectSprite(cam, iw, ih, d[0], d[2], d[1] + 0.15 + bob, d[1] + 0.15 + bob + DUCK, DUCK);
        if (pr === null) continue;
        sprites.push({ depth: pr.depth, draw: () => void clipTo(pr, () => drawDuck(ctx, pr, t)) });
      }
      const king = kingOnFloor(house, cam.floor, world.king);
      const kingProp = king !== null ? house.props.find((k) => k.id === king.id) : undefined;
      if (king !== null && kingProp !== undefined) {
        const kh = kingProp.size[1] > 0 ? kingProp.size[1] : 1.8;
        const pr = projectSprite(cam, iw, ih, king.x, king.z, kingProp.pos[1], kingProp.pos[1] + (king.fallen ? kh * 0.55 : kh), Math.max(0.6, kingProp.size[0]));
        if (pr !== null)
          sprites.push({
            depth: pr.depth,
            draw: () => {
              const seen = clipTo(pr, () => drawKing(ctx, pr, king.fallen, king.hp / king.max));
              if (seen) tags.push({ x: pr.x, y: pr.y0, text: king.fallen ? "♚ HE KNEELS" : `♔ THE KING ${king.hp} / ${king.max}`, colour: king.fallen ? "#777" : "#ffe9a8" });
            },
          });
      }
      for (const s of depthSorted(sprites)) s.draw();

      // The overlay at full resolution: name tags, then the inset.
      hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      hctx.clearRect(0, 0, cw, ch);
      const sx = cw / iw;
      const sy = ch / ih;
      const font = Math.max(11, Math.min(22, ch * 0.035));
      hctx.font = `${font}px VT323, monospace`;
      hctx.textAlign = "center";
      hctx.textBaseline = "middle";
      for (const g of tags) {
        const x = g.x * sx;
        const y = Math.max(font, g.y * sy - font * 0.9);
        const tw = hctx.measureText(g.text).width + 8;
        hctx.fillStyle = "#000080";
        hctx.fillRect(x - tw / 2, y - font * 0.55, tw, font * 1.1);
        hctx.fillStyle = "#fff";
        hctx.fillText(g.text, x, y);
      }
      hold = holdFloor(hold, chooseFloor(house, list, cam.floor), t, FLOOR_HOLD_MS);
      drawInset(hctx, planOn(hold.shown!), cam, list, sample, cw, ch);
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
      window.removeEventListener("resize", resize);
      ro?.disconnect();
    };
  }, [info, store, spot]);

  const celebration = celebrations[celebrations.length - 1] ?? null;

  return (
    <div className={`world rc ${size}`} ref={box}>
      <canvas className="rc-scene" ref={scene} />
      <canvas className="rc-hud" ref={hud} />
      {info === null && <div className="world-note blink">LOADING THE HOUSE…</div>}
      <div className="rc-top">
        <div className="rc-status">
          <span className="dot" data-on={String(connected)} />
          {statusLine(players, connected)}
          {where !== "" && <span className="rc-where"> · {where}</span>}
        </div>
      </div>
      {info !== null && players === 0 && <div className="rc-idle">NOBODY IS REINSTALLING</div>}
      {toasts.length > 0 && (
        <div className="rc-toasts">
          {toasts.map((t) => (
            <div key={t.id} className="rc-toast">
              {t.text}
            </div>
          ))}
        </div>
      )}
      {celebration !== null && (
        <div className={`world-celebrate rc-celebrate${celebration.kept ? " kept" : ""}`} key={`${celebration.session}:${celebration.at}`}>
          <div className="world-celebrate-name">{celebrationHeadline(celebration)}</div>
        </div>
      )}
    </div>
  );
}

// --- drawing (internal pixels) ------------------------------------------------

function drawDuck(ctx: Ctx, pr: Projected, t: number): void {
  const w = pr.x1 - pr.x0;
  const h = pr.y1 - pr.y0;
  const glow = 0.5 + 0.5 * Math.sin(t / 220);
  ctx.fillStyle = `rgba(255,200,61,${0.12 + 0.18 * glow})`;
  ctx.beginPath();
  ctx.arc(pr.x, pr.y0 + h * 0.55, w * 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffc83d";
  ctx.beginPath();
  ctx.ellipse(pr.x, pr.y0 + h * 0.68, w * 0.48, h * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(pr.x + w * 0.22, pr.y0 + h * 0.32, w * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff8a00";
  ctx.fillRect(pr.x + w * 0.4, pr.y0 + h * 0.3, w * 0.18, Math.max(1, h * 0.08));
}

function drawKing(ctx: Ctx, pr: Projected, fallen: boolean, frac: number): void {
  const w = pr.x1 - pr.x0;
  const h = pr.y1 - pr.y0;
  // A chess king's silhouette: base, body, head, cross.
  ctx.fillStyle = fallen ? "#5a5a5a" : "#ffe9a8";
  ctx.fillRect(pr.x0, pr.y1 - h * 0.12, w, h * 0.12);
  ctx.fillRect(pr.x - w * 0.3, pr.y0 + h * 0.3, w * 0.6, h * 0.6);
  ctx.beginPath();
  ctx.arc(pr.x, pr.y0 + h * 0.24, w * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(pr.x - w * 0.05, pr.y0, w * 0.1, h * 0.12);
  ctx.fillRect(pr.x - w * 0.15, pr.y0 + h * 0.04, w * 0.3, h * 0.04);
  // His shared bar over him.
  const by = pr.y0 - Math.max(2, h * 0.08);
  ctx.fillStyle = "#000";
  ctx.fillRect(pr.x0 - 1, by - 1, w + 2, Math.max(2, h * 0.04) + 2);
  ctx.fillStyle = fallen ? "#555" : "#ff4d4d";
  ctx.fillRect(pr.x0, by, w * Math.max(0, Math.min(1, frac)), Math.max(2, h * 0.04));
}

// --- the inset (CSS pixels) ---------------------------------------------------

function drawInset(
  ctx: Ctx,
  plan: PlanFloor,
  cam: RayCamera,
  list: readonly WorldPlayer[],
  sample: (p: WorldPlayer) => { p: Vec3; yaw: number },
  cw: number,
  ch: number,
): void {
  const iw = Math.min(cw * 0.26, ch * 0.34, 220);
  const ih = iw * 0.8;
  const x0 = cw - iw - 8;
  const y0 = ch - ih - 8;
  ctx.fillStyle = "rgba(0,0,20,0.7)";
  ctx.fillRect(x0, y0, iw, ih);
  ctx.strokeStyle = "rgba(125,255,160,0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, iw - 1, ih - 1);
  const fit = fitTransform(plan.bounds, iw, ih, 6);
  const at = (x: number, z: number) => {
    const [sx, sy] = toScreen(fit, x, z);
    return [sx + x0, sy + y0] as const;
  };
  for (const r of plan.rooms) {
    ctx.beginPath();
    r.poly.forEach(([x, z], i) => {
      const [sx, sy] = at(x, z);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = r.color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = "#ddd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const w of plan.walls) {
    if (w.kind !== "wall") continue;
    const [ax, ay] = at(w.a[0], w.a[1]);
    const [bx, by] = at(w.b[0], w.b[1]);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();
  if (cam.floor === plan.floor) {
    const [cx, cy] = at(cam.pos[0], cam.pos[2]);
    const half = Math.atan(Math.tan((cam.fov * Math.PI) / 360) * (cw / Math.max(1, ch)));
    const len = Math.max(14, fit.scale * 2.5);
    const yaw = (cam.yaw * Math.PI) / 180;
    const ray = (a: number) => [cx - Math.sin(yaw + a) * len, cy - Math.cos(yaw + a) * len] as const;
    const [lx, ly] = ray(half);
    const [rx, ry] = ray(-half);
    ctx.fillStyle = "rgba(125,255,160,0.22)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(lx, ly);
    ctx.lineTo(rx, ry);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#7dffa0";
    ctx.fillRect(cx - 2.5, cy - 2.5, 5, 5);
  }
  for (const p of list) {
    if (p.floor !== plan.floor) continue;
    const s = sample(p);
    const [px, py] = at(s.p[0], s.p[2]);
    const [dx, dz] = dirOf(s.yaw);
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + dx * 7, py + dz * 7);
    ctx.stroke();
    ctx.fillStyle = guestColor(p.guest);
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
