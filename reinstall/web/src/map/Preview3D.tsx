//! The map page's 3D preview (a lazy chunk: three.js loads only when it is
//! opened) — the draft as the games will build it, through the same
//! `buildHouseScene` (`@loom/house/three`), without ceilings so you look
//! in from above. Drag to orbit, wheel to zoom, right-drag to pan. It
//! shows the floor being edited (or every floor), and only a valid map:
//! the scene builder assumes one.

import { useEffect, useRef, useState } from "react";
import { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { polyBounds } from "@loom/house";
import type { HouseMap } from "@loom/house";
import { DESCENT_MAX } from "@loom/house";
import { buildHouseScene, createDuck, houseAtmosphere } from "@loom/house/three";

export default function Preview3D({ house, floor }: { house: HouseMap | null; floor: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [all, setAll] = useState(false);
  const [failed, setFailed] = useState(false);
  const view = useRef<{ camera: PerspectiveCamera; controls: OrbitControls; aimed: string } | null>(null);
  const stage = useRef<{ renderer: WebGLRenderer; scene: Scene } | null>(null);

  // One renderer for the preview's life.
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, powerPreference: "low-power" });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.prepend(renderer.domElement);
    const scene = new Scene();
    houseAtmosphere(scene, { near: 40, far: 120 });
    const camera = new PerspectiveCamera(50, 1, 0.05, 300);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    stage.current = { renderer, scene };
    view.current = { camera, controls, aimed: "" };
    const resize = () => {
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      controls.update();
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      stage.current = null;
      view.current = null;
    };
  }, []);

  // The house, rebuilt as the draft changes (a beat after the last edit).
  useEffect(() => {
    const s = stage.current;
    const v = view.current;
    if (s === null || v === null || house === null) return;
    let built: ReturnType<typeof buildHouseScene> | null = null;
    const ducks: ReturnType<typeof createDuck>[] = [];
    const t = window.setTimeout(() => {
      // Every prop, even those only the far gone see (wave 49).
      built = buildHouseScene(house, { ceilings: false, descent: DESCENT_MAX });
      for (const [id, g] of built.floors) g.visible = all || id === floor;
      s.scene.add(built.root);
      for (const spot of house.duck.spots) {
        const on = house.rooms.find((r) => r.id === spot.room)?.floor;
        if (!all && on !== floor) continue;
        const d = createDuck();
        d.object.position.set(spot.pos[0], spot.pos[1], spot.pos[2]);
        s.scene.add(d.object);
        ducks.push(d);
      }
      // Aim once per floor (an edit never yanks the camera).
      const key = `${all ? "*" : floor}`;
      if (v.aimed !== key) {
        v.aimed = key;
        const rooms = house.rooms.filter((r) => all || r.floor === floor);
        const b = rooms.map((r) => polyBounds(r.poly)).reduce((a, c) => [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[2]), Math.max(a[3], c[3])], [Infinity, Infinity, -Infinity, -Infinity]);
        const y = house.floors.find((f) => f.id === floor)?.elevation ?? 0;
        const cx = Number.isFinite(b[0]) ? (b[0] + b[2]) / 2 : 0;
        const cz = Number.isFinite(b[1]) ? (b[1] + b[3]) / 2 : 0;
        const size = Number.isFinite(b[0]) ? Math.max(b[2] - b[0], b[3] - b[1], 4) : 10;
        v.controls.target.set(cx, y, cz);
        v.camera.position.set(cx + size * 0.35, y + size * 0.9, cz + size * 0.9);
      }
    }, 120);
    return () => {
      window.clearTimeout(t);
      for (const d of ducks) {
        s.scene.remove(d.object);
        d.dispose();
      }
      built?.dispose();
    };
  }, [house, floor, all]);

  return (
    <div className="map-3d" ref={box}>
      {failed && <p className="pad">This browser can't show 3D (no WebGL).</p>}
      {house === null && !failed && <p className="map-3d-note">The 3D preview shows a valid map — fix the problems first.</p>}
      <label className="map-3d-all radio checkbox">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> every floor
      </label>
    </div>
  );
}
