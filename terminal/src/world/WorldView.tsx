//! The world view (`docs/loom-reinstall.md` §4): the virtual copy of the
//! house, rendered through `@loom/house/three` exactly as the web game
//! renders it, with every player in the simulation as a ghost (interpolated
//! ~120 ms behind, name tag over the head) and each session's golden duck
//! (it lays its egg and flies on `found` — never for a find the story kept:
//! "GERALD CAN'T HELP", Gerald stays put). Ghosts wear the guest's profile
//! picture; the King shows the shared bar and kneels at 0, his door open
//! (`HouseScene.showKing`). The indicator trail is the player's, not the
//! audience's — it is not drawn here.
//!
//! One camera, cut by `director.ts`: a placed terminal is a fixed window
//! from where it hangs (the mount shot, always — players cross it as
//! ghosts), an unplaced one follows / orbits. Overlays in the DOM: the
//! banner, the camera's mode tag, the counts line ("2 REINSTALLING · 1
//! HERE", so a window on an empty room says where everyone is), the corner
//! mini-map of the terminal's floor, and the celebration (a banner only: a
//! find never moves a window's camera). Rendering is capped at 30 fps, at most 1.5× pixel ratio,
//! stops while the page is hidden, and frees the GL context on unmount.
//!
//! Each run of the render effect (a new map, a new spot) draws on a canvas
//! of its own: the teardown deliberately loses the old one's GL context, and
//! a canvas only ever has the one context — a renderer built on it again
//! would fail ("no WebGL") until a reload.

import { useEffect, useMemo, useRef, useState } from "react";
import { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { roomById, type HouseMap } from "@loom/house";
import { buildHouseScene, createAvatar, createDuck, houseAtmosphere, type Avatar, type Duck } from "@loom/house/three";
import { direct, insideHead, shotFloor, shotKey, type Director, type DirectorPlayer, type Shot } from "./director.ts";
import { MiniMap } from "./MiniMap.tsx";
import { countsLine, windowCounts } from "./overlay.ts";
import { avatarUrl, byActivity, celebrationLine, laysEgg, type WorldPlayer } from "./state.ts";
import { useWorld, type WorldStore } from "./stream.ts";
import { noteWorldShowing } from "../cutscene/world-bus.ts";

const FRAME_MS = 1000 / 30;
const MAX_PIXEL_RATIO = 1.5;

/** The camera's mode tag. */
export function shotTag(shot: Shot | null, players: ReadonlyMap<string, WorldPlayer>): string {
  if (shot === null) return "";
  if (shot.kind === "mount") return "LIVE · THIS ROOM";
  if (shot.kind === "follow") return `FOLLOWING ${(players.get(shot.subject)?.name ?? "A PROGRAM").toUpperCase()}`;
  return "NO PROGRAMS IN THE SIMULATION";
}

/** The player the overlays are about: the shot's subject, else the freshest. */
function subjectOf(shot: Shot | null, players: readonly WorldPlayer[]): WorldPlayer | null {
  const id = shot?.kind === "mount" ? shot.subject : shot?.kind === "follow" ? shot.subject : null;
  return players.find((p) => p.session === id) ?? players[0] ?? null;
}

function roomLabel(house: HouseMap, room: string | null): string {
  return (room !== null ? roomById(house, room)?.label : undefined) ?? "somewhere in the house";
}

export function WorldView({ store, spotId, size }: { store: WorldStore; spotId: string; size: "pane" | "full" }) {
  const info = useWorld(store, (s) => s.house);
  const world = useWorld(store, (s) => s.world);
  const host = useRef<HTMLDivElement>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [failed, setFailed] = useState(false);
  // This view celebrates a find itself: the duck's cutscene plays over it, see-through.
  useEffect(() => noteWorldShowing(), []);

  const spot = useMemo(() => info?.house.terminals.find((t) => t.id === spotId) ?? null, [info, spotId]);

  useEffect(() => {
    const box = host.current;
    if (info === null || box === null) return;
    const { house, walls } = info;

    // A fresh canvas per run (see the header): never one whose context an earlier run lost.
    const el = document.createElement("canvas");
    el.className = "world-canvas";
    box.prepend(el);
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas: el, antialias: true, powerPreference: "low-power" });
    } catch {
      el.remove();
      setFailed(true);
      return;
    }
    setFailed(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    const scene = new Scene();
    houseAtmosphere(scene);
    const built = buildHouseScene(house, { walls });
    scene.add(built.root);
    const camera = new PerspectiveCamera(70, 1, 0.05, 80);
    const ownScreen = spot !== null ? (built.terminals.get(spot.id) ?? null) : null;

    const ghosts = new Map<string, Avatar>();
    const ducks = new Map<string, Duck>();
    let director: Director | null = null;
    let reported = "";
    /** What the scene shows of the King (redrawn only on a change). */
    let kingShown = "";

    const resize = () => {
      const w = Math.max(1, box.clientWidth);
      const h = Math.max(1, box.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);

    /** Ghosts + ducks follow the store's sessions. */
    const sync = (players: ReadonlyMap<string, WorldPlayer>) => {
      for (const [id, g] of ghosts) {
        if (players.has(id)) continue;
        g.dispose();
        ghosts.delete(id);
      }
      for (const [id, d] of ducks) {
        if (players.has(id)) continue;
        d.dispose();
        ducks.delete(id);
      }
      for (const p of players.values()) {
        const picture = avatarUrl(store.base, p.avatar);
        const ghost = ghosts.get(p.session);
        if (!ghost) {
          const g = createAvatar(p.name, p.guest, { picture });
          scene.add(g.object);
          ghosts.set(p.session, g);
        } else ghost.setPicture(picture); // a no-op unless an `avatar` frame changed it
        let duck = ducks.get(p.session);
        if (!duck) {
          duck = createDuck();
          duck.object.position.set(p.duck.pos[0], p.duck.pos[1], p.duck.pos[2]);
          scene.add(duck.object);
          ducks.set(p.session, duck);
        } else if (!p.found && duck.state === "idle") {
          // A map save may have moved it (a `duck` frame).
          const at = duck.object.position;
          if (at.x !== p.duck.pos[0] || at.y !== p.duck.pos[1] || at.z !== p.duck.pos[2]) at.set(p.duck.pos[0], p.duck.pos[1], p.duck.pos[2]);
        }
        if (laysEgg(p) && duck.state === "idle") void duck.layEgg();
      }
    };

    let raf = 0;
    let lastFrame = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (lastFrame !== 0 && t - lastFrame < FRAME_MS - 2) return;
      const dt = lastFrame === 0 ? 0 : Math.min(0.1, (t - lastFrame) / 1000);
      lastFrame = t;

      const { world: w } = store.snapshot;
      sync(w.players);
      const k = w.king;
      const kingKey = k === null ? "" : `${k.id}/${k.hp}/${k.max}/${k.fallen}`;
      if (k !== null && kingKey !== kingShown) built.showKing(k.id, k);
      kingShown = kingKey;
      const players: DirectorPlayer[] = [];
      for (const p of w.players.values()) {
        const pose = p.buffer.sample(t) ?? p.pose;
        ghosts.get(p.session)?.setPose(pose.p, pose.yaw, pose.pitch);
        players.push({ session: p.session, name: p.name, p: pose.p, yaw: pose.yaw, pitch: pose.pitch, room: p.room, floor: p.floor, lastActive: p.lastActive, foundAt: p.foundAt, duck: p.duck.pos });
      }
      director = direct({ house, walls, spot, players, now: t, dt }, director);
      const { cam } = director;
      // A camera in the followed player's head (no room behind them): hide their ghost.
      const followed = director.shot.kind === "follow" ? director.shot.subject : null;
      for (const [id, g] of ghosts) {
        const p = id === followed ? players.find((x) => x.session === id) : undefined;
        g.object.visible = p === undefined || !insideHead(cam, p.p);
      }
      camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
      camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);
      if (camera.fov !== cam.fov) {
        camera.fov = cam.fov;
        camera.updateProjectionMatrix();
      }
      if (ownScreen !== null) ownScreen.visible = director.shot.kind !== "mount";

      for (const g of ghosts.values()) g.update(dt);
      for (const d of ducks.values()) d.update(dt);
      built.update(dt, camera);
      renderer.render(scene, camera);

      // Tell React only when the overlays would change.
      const key = `${shotKey(director.shot)}|${director.shot.kind === "mount" ? director.shot.subject : ""}`;
      if (key !== reported) {
        reported = key;
        setShot(director.shot);
      }
    };
    const start = () => {
      cancelAnimationFrame(raf);
      lastFrame = 0;
      raf = requestAnimationFrame(frame);
    };
    const onVisibility = () => (document.hidden ? cancelAnimationFrame(raf) : start());
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) start();

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      for (const g of ghosts.values()) g.dispose();
      for (const d of ducks.values()) d.dispose();
      built.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      el.remove();
    };
  }, [info, spot, store]);

  const ordered = useMemo(() => byActivity(world), [world]);
  const subject = subjectOf(shot, ordered);
  const floor = info !== null && shot !== null ? shotFloor(info.house, shot, ordered) : null;
  const celebration = world.celebrations[world.celebrations.length - 1] ?? null;
  const counts = countsLine(windowCounts(ordered, spot), spot !== null);

  return (
    <div className={`world ${size}`} ref={host}>
      {info === null && !failed && <div className="world-note blink">LOADING THE SIMULATION…</div>}
      {failed && <div className="world-note">THIS SCREEN CANNOT DRAW THE SIMULATION (NO WEBGL)</div>}
      <div className="world-top">
        {info !== null && subject !== null && (
          <div className="world-banner">
            REINSTALLATION IN PROGRESS · {subject.name.toUpperCase()} · {roomLabel(info.house, subject.room).toUpperCase()}
            {ordered.length > 1 && <span className="world-more"> +{ordered.length - 1}</span>}
          </div>
        )}
        {shot !== null && (
          <div className={`world-tag ${shot.kind}`}>
            {shot.kind === "mount" && <span className="rec" />}
            {shotTag(shot, world.players)}
          </div>
        )}
        {counts !== "" && <div className="world-counts">{counts}</div>}
      </div>
      {info !== null && floor !== null && <MiniMap house={info.house} floor={floor} players={ordered} spot={spot} subject={subject?.session ?? null} />}
      {celebration !== null && (
        <div className={`world-celebrate${celebration.kept ? " kept" : ""}`} key={`${celebration.session}:${celebration.at}`}>
          <div className="world-celebrate-name">{celebration.name.toUpperCase()}</div>
          <div className="world-celebrate-line">{celebrationLine(celebration)}</div>
        </div>
      )}
    </div>
  );
}
