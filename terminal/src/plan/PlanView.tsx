//! The live plan (wave 15): the reinstallation drawn top-down in Canvas 2D,
//! for a tablet that has no WebGL2 (and for `view=plan` on any screen). Fed
//! by the same spatial stream as the world view (`world/stream.ts` +
//! `world/state.ts`), drawn with plain `@loom/house` maths (`plan.ts`) — no
//! three.js, so it runs on Chrome 87 / Safari 14 / the old Android tablets.
//!
//! One floor at a time: the one with the most players (ties → this
//! terminal's floor, else the main floor), auto-switching, with tabs that
//! count the players per floor. The rooms in their colours with their names
//! (and LOCATION), the walls (doors read as gaps; a door the King guards is
//! barred red until he falls), the stairs, each player as a Win98 tile (their
//! picture, else a coloured disc) with a heading wedge and a name tag,
//! interpolated ~120 ms behind like the ghosts (`PoseBuffer`), a fading trail
//! of where they walked, their golden duck pulsing, the golden chevrons of
//! `route()` from them to it, the King with his shared bar (greyed when he
//! kneels), and this terminal's own spot with its view cone. A find shows
//! the celebration banner (GERALD CAN'T HELP for a find the story kept); a
//! join / leave a toast. Capped at 20 fps, stopped while the page is hidden.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Vec2, Vec3 } from "@loom/house";
import { DEFAULT_SPOT_FOV, horizontalFov } from "@loom/house";
import { avatarUrl, type WorldPlayer } from "../world/state.ts";
import { useWorld, type WorldStore } from "../world/stream.ts";
import {
  chooseFloor,
  celebrationHeadline,
  duckRoute,
  ducksOnFloor,
  fitTransform,
  floorCounts,
  guestColor,
  headingOf,
  kingOnFloor,
  legsOn,
  markersOn,
  planFloor,
  pushTrail,
  rosterToasts,
  spotFloor,
  statusLine,
  toScreen,
  trailAlpha,
  type Fit,
  type PlanFloor,
  type TrailPoint,
} from "./plan.ts";
import "./plan.css";

const FRAME_MS = 1000 / 20;
const MAX_PIXEL_RATIO = 2;
/** A route is recomputed at most this often per player (ms). */
const ROUTE_MS = 1000;
/** The shown floor holds this long before following the players elsewhere (ms). */
const FLOOR_HOLD_MS = 2500;
const TOAST_MS = 4000;

interface Toast {
  id: number;
  text: string;
  at: number;
}

export function PlanView({ store, spotId, size }: { store: WorldStore; spotId: string; size: "pane" | "full" }) {
  const info = useWorld(store, (s) => s.house);
  const connected = useWorld(store, (s) => s.connected);
  const players = useWorld(store, (s) => s.world.players.size);
  const counts = useWorld(store, (s) => {
    let k = "";
    for (const p of s.world.players.values()) k += `${p.floor}\n`;
    return k;
  });
  const celebrations = useWorld(store, (s) => s.world.celebrations);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [floor, setFloor] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const ownFloor = useMemo(() => (info !== null ? spotFloor(info.house, spotId) : null), [info, spotId]);
  const tabs = useMemo(
    () => (info !== null ? floorCounts(info.house, counts.split("\n").filter((f) => f !== "").map((f) => ({ floor: f }))) : []),
    [info, counts],
  );

  // Join / leave toasts, off the roster.
  useEffect(() => {
    let prev = store.snapshot.world.players;
    let seq = 0;
    return store.subscribe(() => {
      const next = store.snapshot.world.players;
      if (next === prev) return;
      const lines = rosterToasts(prev, next);
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
    const el = canvas.current;
    const host = box.current;
    if (info === null || el === null || host === null) return;
    const ctx = el.getContext("2d");
    if (ctx === null) return;
    const { house, walls } = info;
    const spot = house.terminals.find((t) => t.id === spotId) ?? null;
    const floors = new Map<string, PlanFloor>();
    const floorPlan = (id: string) => {
      let f = floors.get(id);
      if (!f) floors.set(id, (f = planFloor(house, walls, id)));
      return f;
    };
    const trails = new Map<string, TrailPoint[]>();
    const routes = new Map<string, { at: number; duck: string; path: Vec3[] }>();
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
    let shown: string | null = null;
    let shownAt = 0;
    let w = 1;
    let h = 1;
    let dpr = 1;

    const resize = () => {
      w = Math.max(1, host.clientWidth);
      h = Math.max(1, host.clientHeight);
      dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    };
    resize();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    ro?.observe(host);
    window.addEventListener("resize", resize);

    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (last !== 0 && t - last < FRAME_MS - 2) return;
      last = t;
      const world = store.snapshot.world;
      const list = [...world.players.values()];

      // Which floor.
      const want = chooseFloor(house, list, ownFloor);
      if (shown === null || (want !== shown && t - shownAt > FLOOR_HOLD_MS)) {
        if (shown !== want) setFloor(want);
        shown = want;
        shownAt = t;
      }
      const plan = floorPlan(shown);
      const fit = fitTransform(plan.bounds, w, h, Math.min(w, h) * 0.06 + 8);
      const px = Math.max(0.7, fit.scale / 40); // a line-width unit that grows with the map

      // Trails (every player, every frame, interpolated).
      const sample = (p: WorldPlayer) => p.buffer.sample(t) ?? p.pose;
      for (const p of list) {
        const s = sample(p);
        pushTrail(trails.get(p.session) ?? (trails.set(p.session, []), trails.get(p.session)!), { x: s.p[0], z: s.p[2], floor: p.floor, t });
      }
      for (const id of trails.keys()) if (!world.players.has(id)) trails.delete(id);
      for (const id of routes.keys()) if (!world.players.has(id)) routes.delete(id);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#0b0b2e";
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = list.length === 0 ? 0.45 : 1;
      drawFloor(ctx, plan, fit, px, world.king?.fallen === true ? world.king.id : null);

      const king = kingOnFloor(house, plan.floor, world.king);
      if (spot !== null && house.rooms.find((r) => r.id === spot.room)?.floor === plan.floor) drawSpot(ctx, fit, spot.pos, spot.yaw, spot.fov ?? DEFAULT_SPOT_FOV, px);
      ctx.globalAlpha = 1;
      if (list.length === 0) {
        if (king !== null) drawKing(ctx, fit, king, px);
        return;
      }

      // Routes + ducks.
      const fallen = new Set<string>(world.king?.fallen === true ? [world.king.id] : []);
      for (const p of list) {
        if (p.found) continue;
        let r = routes.get(p.session);
        if (r === undefined || r.duck !== p.duck.id || t - r.at > ROUTE_MS) {
          r = { at: t, duck: p.duck.id, path: duckRoute(house, sample(p).p, p.duck, fallen) };
          routes.set(p.session, r);
        }
        drawChevrons(ctx, fit, legsOn(house, r.path, plan.floor), px, t);
      }
      for (const p of ducksOnFloor(house, plan.floor, list)) drawDuck(ctx, fit, p.duck.pos, px, t);
      if (king !== null) drawKing(ctx, fit, king, px);

      // Trails, then players on top.
      for (const [id, trail] of trails) {
        const p = world.players.get(id);
        if (p) drawTrail(ctx, fit, trail, plan.floor, p.guest, px, t);
      }
      for (const m of markersOn(list, plan.floor, sample, (k) => avatarUrl(store.base, k))) drawMarker(ctx, fit, m, picture(m.picture));
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
  }, [info, store, spotId, ownFloor]);

  const celebration = celebrations[celebrations.length - 1] ?? null;
  const floorLabel = tabs.find((f) => f.id === floor)?.label ?? "";

  return (
    <div className={`world plan ${size}`} ref={box}>
      <canvas className="plan-canvas" ref={canvas} />
      {info === null && <div className="world-note blink">LOADING THE HOUSE PLAN…</div>}
      <div className="plan-top">
        <div className="plan-status">
          <span className="dot" data-on={String(connected)} />
          {statusLine(players, connected)}
          {floorLabel !== "" && <span className="plan-floor-name"> · {floorLabel.toUpperCase()}</span>}
        </div>
        {tabs.length > 1 && (
          <div className="plan-tabs">
            {tabs.map((f) => (
              <span key={f.id} className={`plan-tab${f.id === floor ? " on" : ""}${f.count > 0 ? " busy" : ""}`}>
                {f.label.toUpperCase()} {f.count}
              </span>
            ))}
          </div>
        )}
      </div>
      {info !== null && players === 0 && <div className="plan-idle">NOBODY IS REINSTALLING</div>}
      {toasts.length > 0 && (
        <div className="plan-toasts">
          {toasts.map((t) => (
            <div key={t.id} className="plan-toast">
              {t.text}
            </div>
          ))}
        </div>
      )}
      {celebration !== null && (
        <div className={`world-celebrate plan-celebrate${celebration.kept ? " kept" : ""}`} key={`${celebration.session}:${celebration.at}`}>
          <div className="world-celebrate-name">{celebrationHeadline(celebration)}</div>
        </div>
      )}
    </div>
  );
}

// --- drawing -----------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

function path(ctx: Ctx, fit: Fit, poly: readonly Vec2[]): void {
  ctx.beginPath();
  poly.forEach(([x, z], i) => {
    const [sx, sy] = toScreen(fit, x, z);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
}

function drawFloor(ctx: Ctx, plan: PlanFloor, fit: Fit, px: number, fallenKing: string | null): void {
  for (const r of plan.rooms) {
    path(ctx, fit, r.poly);
    ctx.fillStyle = r.color;
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * (r.outdoor ? 0.35 : 0.28);
    ctx.fill();
    ctx.globalAlpha = a;
  }
  for (const s of plan.stairs) {
    const [x0, y0] = toScreen(fit, s.rect[0], s.rect[1]);
    const [x1, y1] = toScreen(fit, s.rect[2], s.rect[3]);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = px;
    // Treads across the long side.
    const along = x1 - x0 > y1 - y0;
    const n = 6;
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
      if (along) {
        const x = x0 + ((x1 - x0) * i) / n;
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      } else {
        const y = y0 + ((y1 - y0) * i) / n;
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      }
    }
    ctx.stroke();
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }
  ctx.lineCap = "square";
  for (const wl of plan.walls) {
    const [ax, ay] = toScreen(fit, wl.a[0], wl.a[1]);
    const [bx, by] = toScreen(fit, wl.b[0], wl.b[1]);
    ctx.strokeStyle = wl.kind === "wall" ? "#e8e8e8" : "rgba(160,220,160,0.7)";
    ctx.lineWidth = wl.kind === "wall" ? 2.5 * px : 1.2 * px;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  for (const d of plan.doors) {
    if (d.guard === null || d.guard === fallenKing) continue;
    const [x, y] = toScreen(fit, d.at[0], d.at[1]);
    ctx.fillStyle = "#ff4d4d";
    ctx.fillRect(x - 3 * px, y - 3 * px, 6 * px, 6 * px);
  }
  const font = Math.max(10, Math.min(22, fit.scale * 0.32));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const r of plan.rooms) {
    const [x, y] = toScreen(fit, r.at[0], r.at[1]);
    ctx.font = `${font}px VT323, monospace`;
    ctx.fillStyle = "rgba(233,255,241,0.85)";
    ctx.fillText(r.label.toUpperCase(), x, y);
    if (r.location !== null) {
      ctx.font = `${font * 0.75}px VT323, monospace`;
      ctx.fillStyle = "rgba(255,176,0,0.75)";
      ctx.fillText(r.location, x, y + font * 0.9);
    }
  }
}

function drawSpot(ctx: Ctx, fit: Fit, pos: Vec3, yaw: number, fov: number, px: number): void {
  const half = horizontalFov(fov) / 2;
  const [x, y] = toScreen(fit, pos[0], pos[2]);
  const len = 2.5 * fit.scale;
  const [ax, ay] = headingOf(yaw + half);
  const [bx, by] = headingOf(yaw - half);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + ax * len, y + ay * len);
  ctx.lineTo(x + bx * len, y + by * len);
  ctx.closePath();
  ctx.fillStyle = "rgba(120,255,160,0.12)";
  ctx.fill();
  ctx.fillStyle = "#7dffa0";
  ctx.fillRect(x - 4 * px, y - 4 * px, 8 * px, 8 * px);
  ctx.font = `${Math.max(9, 11 * px)}px VT323, monospace`;
  ctx.textAlign = "center";
  ctx.fillText("YOU ARE HERE", x, y + 12 * px);
}

function drawChevrons(ctx: Ctx, fit: Fit, legs: Array<[Vec3, Vec3]>, px: number, t: number): void {
  const step = 0.8;
  const phase = ((t / 1000) * 1.2) % step;
  ctx.strokeStyle = "#ffc83d";
  ctx.lineWidth = 1.6 * px;
  ctx.lineCap = "round";
  const size = Math.max(4, 0.18 * fit.scale);
  for (const [a, b] of legs) {
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    const [ux, uz] = [dx / len, dz / len];
    for (let d = phase; d < len; d += step) {
      const [x, y] = toScreen(fit, a[0] + ux * d, a[2] + uz * d);
      ctx.beginPath();
      ctx.moveTo(x - ux * size - uz * size * 0.8, y - uz * size + ux * size * 0.8);
      ctx.lineTo(x, y);
      ctx.lineTo(x - ux * size + uz * size * 0.8, y - uz * size - ux * size * 0.8);
      ctx.stroke();
    }
  }
}

function drawDuck(ctx: Ctx, fit: Fit, pos: Vec3, px: number, t: number): void {
  const [x, y] = toScreen(fit, pos[0], pos[2]);
  const pulse = 0.5 + 0.5 * Math.sin(t / 220);
  const r = Math.max(5, 0.22 * fit.scale);
  ctx.beginPath();
  ctx.arc(x, y, r * (1.6 + pulse), 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,200,61,${0.15 + 0.2 * pulse})`;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "#ffc83d";
  ctx.fill();
  ctx.strokeStyle = "#7a5200";
  ctx.lineWidth = px;
  ctx.stroke();
}

function drawKing(ctx: Ctx, fit: Fit, king: { x: number; z: number; hp: number; max: number; fallen: boolean }, px: number): void {
  const [x, y] = toScreen(fit, king.x, king.z);
  const size = Math.max(16, 0.7 * fit.scale);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${size}px serif`;
  ctx.fillStyle = king.fallen ? "#777" : "#ffe9a8";
  ctx.fillText(king.fallen ? "♚" : "♔", x, y);
  const bw = size * 1.4;
  const bh = Math.max(4, 5 * px);
  const by = y + size * 0.65;
  ctx.fillStyle = "#000";
  ctx.fillRect(x - bw / 2 - 1, by - 1, bw + 2, bh + 2);
  ctx.fillStyle = king.fallen ? "#555" : "#ff4d4d";
  ctx.fillRect(x - bw / 2, by, (bw * Math.max(0, king.hp)) / king.max, bh);
  ctx.font = `${Math.max(9, size * 0.45)}px VT323, monospace`;
  ctx.fillStyle = king.fallen ? "#999" : "#ffe9a8";
  ctx.fillText(king.fallen ? "HE KNEELS" : `${king.hp} / ${king.max}`, x, by + bh + size * 0.3);
}

function drawTrail(ctx: Ctx, fit: Fit, trail: readonly TrailPoint[], floor: string, guest: string, px: number, t: number): void {
  ctx.fillStyle = guestColor(guest);
  for (const pt of trail) {
    if (pt.floor !== floor) continue;
    const a = trailAlpha(pt, t);
    if (a <= 0) continue;
    const [x, y] = toScreen(fit, pt.x, pt.z);
    ctx.globalAlpha = a * 0.6;
    ctx.beginPath();
    ctx.arc(x, y, 1.6 * px + 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawMarker(ctx: Ctx, fit: Fit, m: { x: number; z: number; yaw: number; tag: string; color: string }, img: HTMLImageElement | null): void {
  const [x, y] = toScreen(fit, m.x, m.z);
  const s = Math.max(14, 0.55 * fit.scale);
  // The heading wedge.
  const [dx, dy] = headingOf(m.yaw);
  const [lx, ly] = headingOf(m.yaw + 28);
  const [rx, ry] = headingOf(m.yaw - 28);
  const len = s * 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + lx * len, y + ly * len);
  ctx.lineTo(x + dx * len * 1.08, y + dy * len * 1.08);
  ctx.lineTo(x + rx * len, y + ry * len);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fill();
  // A Win98 tile: grey face, white top-left, dark bottom-right.
  const h = s / 2;
  ctx.fillStyle = "#c0c0c0";
  ctx.fillRect(x - h - 2, y - h - 2, s + 4, s + 4);
  ctx.fillStyle = "#fff";
  ctx.fillRect(x - h - 2, y - h - 2, s + 4, 1.5);
  ctx.fillRect(x - h - 2, y - h - 2, 1.5, s + 4);
  ctx.fillStyle = "#404040";
  ctx.fillRect(x - h - 2, y + h + 0.5, s + 4, 1.5);
  ctx.fillRect(x + h + 0.5, y - h - 2, 1.5, s + 4);
  if (img !== null && img.complete && img.naturalWidth > 0) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(x - h, y - h, s, s);
    const k = Math.min(s / img.naturalWidth, s / img.naturalHeight);
    const iw = img.naturalWidth * k;
    const ih = img.naturalHeight * k;
    try {
      ctx.drawImage(img, x - iw / 2, y - ih / 2, iw, ih);
    } catch {
      /* a broken image: the grey tile stays */
    }
  } else {
    ctx.beginPath();
    ctx.arc(x, y, h * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = m.color;
    ctx.fill();
  }
  // The name tag.
  const font = Math.max(11, Math.min(20, s * 0.55));
  ctx.font = `${font}px VT323, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(m.tag).width + 8;
  const ty = y - h - 4 - font * 0.6;
  ctx.fillStyle = "#000080";
  ctx.fillRect(x - tw / 2, ty - font * 0.55, tw, font * 1.1);
  ctx.fillStyle = "#fff";
  ctx.fillText(m.tag, x, ty);
}
