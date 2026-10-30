//! Prop models (wave 47): what a `box` or `cylinder` prop looks like when it
//! carries a `model` — a wall panel, a cabinet, a server rack, a CRT. A
//! model is drawing only: the prop still collides, routes and locates as
//! its plain box or cylinder (`propSolid`, `size`), so no geometry golden
//! moves and an older server, game or terminal just draws the plain shape.
//!
//! The look is computer horror, squeaky clean: glossy white bodies, chrome
//! trim, near-black inlays, neon strips and a few red alarms. Each model is
//! a list of parts (`modelParts`), boxes and cylinders in the prop's own
//! frame (x across `w`, y up from the base, z along `d`, the front at −z
//! — the prop's yaw), each with a role the renderer colours: `body` is the
//! prop's `color` (else the model's), `neon` its `neon` (else the model's),
//! the rest fixed (`ROLE_COLORS`). Parts stay inside the prop's size but
//! for handles and inlays a few millimetres proud of a face.
//!
//! The Godot port is `reinstall/vr/house/house_models.gd`, diffed against
//! `test/golden/models.json`; change both together.

import type { Prop, Vec3 } from "./types.ts";

/** How a part is coloured. */
export type PartRole = "body" | "trim" | "dark" | "neon" | "screen" | "glass" | "leaf" | "alert" | "wood" | "flame";
export const PART_ROLES: readonly PartRole[] = ["body", "trim", "dark", "neon", "screen", "glass", "leaf", "alert", "wood", "flame"];

/** The fixed roles' colours (`body` and `neon` come from the prop or its model). */
export const ROLE_COLORS: Readonly<Record<Exclude<PartRole, "body" | "neon">, string>> = {
  trim: "#c3ccd6",
  dark: "#101318",
  screen: "#7fd4ff",
  glass: "#9fd6f2",
  leaf: "#26c46a",
  alert: "#ff2a4a",
  wood: "#7a5230",
  flame: "#ff7a1a",
};

/** The roles drawn glowing (unlit, so they bloom), beside `neon`. */
export const GLOW_ROLES: readonly PartRole[] = ["screen", "alert", "flame"];

/** A box, or a cylinder along `axis`: centre `c` and full extents `s` (a
 *  cylinder's diameter on the two other axes, its length on `axis`). */
export interface ModelPart {
  role: PartRole;
  shape: "box" | "cyl";
  axis: "x" | "y" | "z";
  c: Vec3;
  s: Vec3;
}

export type ModelGroup = "structure" | "computer" | "office" | "home" | "studio" | "strange";

export interface PropModel {
  id: string;
  /** The map editor's name for it. */
  label: string;
  group: ModelGroup;
  /** The prop kind the map editor places it as (its collision shape). */
  kind: "box" | "cylinder";
  /** A new prop's size `[w, h, d]`. */
  size: Vec3;
  /** The body colour when the prop has no `color`. */
  color: string;
  /** The neon colour when the prop has no `neon`. */
  neon: string;
}

const WHITE = "#f2f5f8";
const CYAN = "#29f4ff";
const MAGENTA = "#ff2bd6";
const VIOLET = "#8a5cff";
const BLUE = "#2b6cff";
const LIME = "#7dff3a";
const RED = "#ff2a4a";
const AMBER = "#ffb02e";
const PINK = "#ff5fa2";
const SOOT = "#1c1f26";
const WALNUT = "#6b4528";
const CREAM = "#f4ead8";

/** The catalogue, in the map editor's order. */
export const PROP_MODELS: readonly PropModel[] = [
  { id: "wall", label: "Wall panel", group: "structure", kind: "box", size: [2, 2.4, 0.12], color: WHITE, neon: CYAN },
  { id: "pillar", label: "Pillar", group: "structure", kind: "box", size: [0.4, 2.4, 0.4], color: WHITE, neon: MAGENTA },
  { id: "cabinet", label: "Cabinet", group: "structure", kind: "box", size: [0.9, 2, 0.5], color: WHITE, neon: CYAN },
  { id: "filing", label: "Filing cabinet", group: "office", kind: "box", size: [0.5, 1.3, 0.6], color: "#e4e9ee", neon: CYAN },
  { id: "shelf", label: "Shelf", group: "structure", kind: "box", size: [1.2, 1.8, 0.4], color: WHITE, neon: VIOLET },
  { id: "desk", label: "Desk", group: "office", kind: "box", size: [1.4, 0.75, 0.7], color: WHITE, neon: CYAN },
  { id: "table", label: "Table", group: "office", kind: "box", size: [1.6, 0.75, 1], color: WHITE, neon: MAGENTA },
  { id: "counter", label: "Counter", group: "structure", kind: "box", size: [1.8, 0.95, 0.6], color: WHITE, neon: CYAN },
  { id: "rack", label: "Server rack", group: "computer", kind: "box", size: [0.6, 2, 1], color: WHITE, neon: CYAN },
  { id: "mainframe", label: "Mainframe", group: "computer", kind: "box", size: [1.2, 2, 0.8], color: "#e9edf2", neon: MAGENTA },
  { id: "tower", label: "PC tower", group: "computer", kind: "box", size: [0.2, 0.45, 0.45], color: "#eceae4", neon: LIME },
  { id: "crt", label: "CRT monitor", group: "computer", kind: "box", size: [0.42, 0.4, 0.42], color: "#eceae4", neon: LIME },
  { id: "workstation", label: "Workstation", group: "computer", kind: "box", size: [1.4, 1.2, 0.75], color: WHITE, neon: CYAN },
  { id: "screenwall", label: "Video wall", group: "computer", kind: "box", size: [2, 1.4, 0.1], color: WHITE, neon: CYAN },
  { id: "printer", label: "Printer", group: "computer", kind: "box", size: [0.5, 0.35, 0.45], color: "#eceae4", neon: LIME },
  { id: "cables", label: "Cable run", group: "computer", kind: "box", size: [1.5, 0.06, 0.3], color: WHITE, neon: MAGENTA },
  { id: "popup", label: "Error dialog", group: "computer", kind: "box", size: [1, 0.7, 0.04], color: "#d4d8de", neon: BLUE },
  { id: "camera", label: "Security camera", group: "computer", kind: "cylinder", size: [0.4, 2.2, 0.4], color: WHITE, neon: RED },
  { id: "chair", label: "Office chair", group: "office", kind: "box", size: [0.6, 1, 0.6], color: WHITE, neon: CYAN },
  { id: "cooler", label: "Water cooler", group: "office", kind: "cylinder", size: [0.35, 1.3, 0.35], color: WHITE, neon: CYAN },
  { id: "plant", label: "Plastic plant", group: "office", kind: "cylinder", size: [0.5, 1.1, 0.5], color: WHITE, neon: LIME },
  { id: "bin", label: "Recycle bin", group: "office", kind: "cylinder", size: [0.35, 0.5, 0.35], color: WHITE, neon: LIME },
  { id: "tube", label: "Neon tube", group: "structure", kind: "cylinder", size: [0.12, 1.8, 0.12], color: WHITE, neon: MAGENTA },
  // Wave 49: the house's own things. Same look: gloss, chrome, a neon line.
  { id: "stove", label: "Stove", group: "home", kind: "box", size: [0.75, 0.9, 0.6], color: WHITE, neon: AMBER },
  { id: "microwave", label: "Broken microwave", group: "home", kind: "box", size: [0.5, 0.3, 0.4], color: "#e4e9ee", neon: RED },
  { id: "toaster", label: "Toaster", group: "home", kind: "box", size: [0.3, 0.2, 0.18], color: "#d6dde4", neon: AMBER },
  { id: "fridge", label: "Fridge", group: "home", kind: "box", size: [0.8, 1.8, 0.8], color: WHITE, neon: CYAN },
  { id: "sink", label: "Sink", group: "home", kind: "box", size: [0.45, 0.85, 0.6], color: WHITE, neon: CYAN },
  { id: "toilet", label: "Toilet", group: "home", kind: "box", size: [0.4, 0.75, 0.65], color: WHITE, neon: CYAN },
  { id: "bathtub", label: "Bathtub", group: "home", kind: "box", size: [0.75, 0.55, 1.5], color: WHITE, neon: CYAN },
  { id: "washer", label: "Washer", group: "home", kind: "box", size: [0.7, 0.85, 0.7], color: WHITE, neon: CYAN },
  { id: "dryer", label: "Dryer", group: "home", kind: "box", size: [0.7, 0.85, 0.7], color: WHITE, neon: AMBER },
  { id: "couch", label: "Couch", group: "home", kind: "box", size: [2, 0.85, 0.9], color: "#3a3f55", neon: MAGENTA },
  { id: "armchair", label: "Armchair", group: "home", kind: "box", size: [0.9, 0.9, 0.85], color: "#3a3f55", neon: MAGENTA },
  { id: "bed", label: "Bed", group: "home", kind: "box", size: [2, 0.55, 1.6], color: "#d8dde8", neon: VIOLET },
  { id: "tv", label: "Old TV", group: "home", kind: "box", size: [1.1, 1.2, 0.5], color: WALNUT, neon: BLUE },
  { id: "lamp", label: "Floor lamp", group: "home", kind: "cylinder", size: [0.4, 1.7, 0.4], color: WHITE, neon: AMBER },
  { id: "fireplace", label: "Fireplace", group: "home", kind: "box", size: [1.6, 1.1, 0.5], color: WHITE, neon: AMBER },
  { id: "bbq", label: "BBQ", group: "home", kind: "cylinder", size: [0.6, 1, 0.6], color: SOOT, neon: AMBER },
  { id: "gnome", label: "Garden gnome", group: "home", kind: "cylinder", size: [0.3, 0.6, 0.3], color: "#2b6cff", neon: RED },
  { id: "modular", label: "Modular synth", group: "studio", kind: "box", size: [1.2, 1.6, 0.35], color: SOOT, neon: LIME },
  { id: "mixing", label: "Mixing desk", group: "studio", kind: "box", size: [1.6, 0.8, 0.7], color: SOOT, neon: CYAN },
  { id: "speaker", label: "Speaker cabinet", group: "studio", kind: "box", size: [0.4, 1.1, 0.4], color: SOOT, neon: MAGENTA },
  { id: "amp", label: "Guitar amp", group: "studio", kind: "box", size: [0.6, 0.5, 0.3], color: SOOT, neon: RED },
  { id: "turntable", label: "Turntable", group: "studio", kind: "box", size: [0.5, 0.14, 0.4], color: "#e4e9ee", neon: CYAN },
  { id: "piano", label: "Upright piano", group: "studio", kind: "box", size: [1.5, 1.25, 0.6], color: WALNUT, neon: VIOLET },
  { id: "arcade", label: "Arcade cabinet", group: "studio", kind: "box", size: [0.7, 1.75, 0.75], color: SOOT, neon: MAGENTA },
  // Wave 49: what a program starts to see. Mostly placed with `from`.
  { id: "teatable", label: "Tea party", group: "strange", kind: "box", size: [2.4, 0.95, 1], color: WHITE, neon: PINK },
  { id: "teapot", label: "Teapot", group: "strange", kind: "box", size: [0.3, 0.25, 0.22], color: CREAM, neon: PINK },
  { id: "clock", label: "Grandfather clock", group: "strange", kind: "box", size: [0.6, 2.2, 0.4], color: WALNUT, neon: AMBER },
  { id: "mushroom", label: "Mushroom", group: "strange", kind: "cylinder", size: [0.7, 0.9, 0.7], color: CREAM, neon: LIME },
  { id: "bottle", label: "Little bottle", group: "strange", kind: "cylinder", size: [0.12, 0.3, 0.12], color: CREAM, neon: BLUE },
  { id: "door", label: "Door to nowhere", group: "strange", kind: "box", size: [1, 2.1, 0.12], color: WHITE, neon: RED },
  { id: "spiral", label: "Spiral stairs", group: "strange", kind: "cylinder", size: [1.6, 2.7, 1.6], color: WHITE, neon: VIOLET },
  { id: "mirror", label: "Tall mirror", group: "strange", kind: "box", size: [0.8, 2, 0.1], color: WALNUT, neon: CYAN },
  { id: "hole", label: "Rabbit hole", group: "strange", kind: "cylinder", size: [1.4, 0.02, 1.4], color: SOOT, neon: VIOLET },
  { id: "card", label: "Card soldier", group: "strange", kind: "box", size: [0.7, 1.9, 0.08], color: WHITE, neon: RED },
  { id: "flamingo", label: "Flamingo", group: "strange", kind: "box", size: [0.4, 1.1, 0.6], color: PINK, neon: PINK },
];

/** A model id the map editor and validation know — `PROP_MODELS`' ids. */
export const PROP_MODEL_IDS: readonly string[] = PROP_MODELS.map((m) => m.id);
/** A well-formed model id; an unknown one is drawn as the plain shape. */
export const PROP_MODEL_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;
/** The kinds a model is drawn on (the rest ignore it; validation refuses it). */
export const MODEL_KINDS: readonly string[] = ["box", "cylinder"];

export function propModel(id: string | undefined): PropModel | null {
  return PROP_MODELS.find((m) => m.id === id) ?? null;
}

/** The body colour a model prop is drawn in. */
export function modelBodyColor(prop: Prop): string {
  return prop.color ?? propModel(prop.model)?.color ?? WHITE;
}

/** The neon colour a model prop is drawn in. */
export function modelNeonColor(prop: Prop): string {
  return prop.neon ?? propModel(prop.model)?.neon ?? CYAN;
}

/** A neon strip's thickness. */
const N = 0.014;

/** The parts of `prop`'s model, or null when it draws as its plain shape
 *  (no model, an unknown one, or a kind models are not drawn on). */
export function modelParts(prop: Prop): ModelPart[] | null {
  if (prop.model === undefined || !MODEL_KINDS.includes(prop.kind) || propModel(prop.model) === null) return null;
  return partsOf(prop.model, prop.size[0], prop.size[1], prop.size[2]);
}

/** A model's parts at size `w × h × d` (an unknown id: none). */
export function partsOf(id: string, w: number, h: number, d: number): ModelPart[] {
  const out: ModelPart[] = [];
  const box = (role: PartRole, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): void => {
    out.push({ role, shape: "box", axis: "y", c: [cx, cy, cz], s: [Math.max(0, sx), Math.max(0, sy), Math.max(0, sz)] });
  };
  const cyl = (role: PartRole, axis: "x" | "y" | "z", cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): void => {
    out.push({ role, shape: "cyl", axis, c: [cx, cy, cz], s: [Math.max(0, sx), Math.max(0, sy), Math.max(0, sz)] });
  };
  const add = (parts: ModelPart[], dx: number, dy: number, dz: number): void => {
    for (const p of parts) out.push({ ...p, c: [p.c[0] + dx, p.c[1] + dy, p.c[2] + dz] });
  };
  const front = -d / 2;
  switch (id) {
    case "wall": {
      const base = Math.min(0.06, h * 0.1);
      const cap = Math.min(0.025, h * 0.05);
      const mid = base + (h - base - cap) / 2;
      box("body", 0, mid, 0, w, h - base - cap, d);
      box("dark", 0, base / 2, 0, w, base, d + 0.01);
      box("trim", 0, h - cap / 2, 0, w, cap, d + 0.01);
      for (const side of [-1, 1]) {
        box("neon", 0, base + 0.02, side * (d / 2 + 0.004), w, N, 0.008);
        box("neon", 0, h - cap - 0.03, side * (d / 2 + 0.004), w, N, 0.008);
      }
      const n = Math.max(1, Math.floor(w / 1.0 + 0.5));
      for (let i = 1; i < n; i++) box("dark", -w / 2 + (w * i) / n, mid, 0, 0.008, h - base - cap - 0.04, d + 0.006);
      break;
    }
    case "pillar": {
      const base = Math.min(0.08, h * 0.1);
      const cap = Math.min(0.04, h * 0.05);
      const mid = base + (h - base - cap) / 2;
      const len = (h - base - cap) * 0.8;
      box("body", 0, mid, 0, w - 0.02, h - base - cap, d - 0.02);
      box("dark", 0, base / 2, 0, w, base, d);
      box("trim", 0, h - cap / 2, 0, w, cap, d);
      for (const side of [-1, 1]) {
        box("neon", 0, mid, side * (d / 2 - 0.006), Math.min(0.03, w * 0.15), len, 0.008);
        box("neon", side * (w / 2 - 0.006), mid, 0, 0.008, len, Math.min(0.03, d * 0.15));
      }
      break;
    }
    case "cabinet": {
      const plinth = Math.min(0.08, h * 0.08);
      const cap = Math.min(0.03, h * 0.04);
      const mid = plinth + (h - plinth - cap) / 2;
      box("body", 0, mid, 0.004, w, h - plinth - cap, d - 0.008);
      box("dark", 0, plinth / 2, 0.02, w - 0.04, plinth, d - 0.04);
      box("trim", 0, h - cap / 2, 0, w, cap, d);
      const handle = Math.min(0.3, h * 0.15);
      if (w >= 0.6) {
        box("dark", 0, mid, front + 0.005, 0.008, h - plinth - cap - 0.04, 0.006);
        for (const side of [-1, 1]) box("trim", side * 0.04, plinth + (h - plinth - cap) * 0.55, front + 0.01, 0.02, handle, 0.02);
      } else box("trim", w / 2 - 0.06, plinth + (h - plinth - cap) * 0.55, front + 0.01, 0.02, handle, 0.02);
      box("neon", 0, h - cap - 0.012, front + 0.004, w - 0.04, N, 0.008);
      break;
    }
    case "filing": {
      const plinth = Math.min(0.05, h * 0.06);
      const n = Math.max(2, Math.floor((h - plinth) / 0.32 + 0.5));
      const dh = (h - plinth) / n;
      box("body", 0, plinth + (h - plinth) / 2, 0, w, h - plinth, d);
      box("dark", 0, plinth / 2, 0.03, w - 0.03, plinth, d - 0.06);
      for (let i = 0; i < n; i++) {
        const y0 = plinth + dh * i;
        if (i > 0) box("dark", 0, y0, front - 0.002, w - 0.02, 0.008, 0.006);
        box("trim", 0, y0 + dh * 0.55, front - 0.0125, w * 0.4, 0.025, 0.025);
        box("neon", 0, y0 + dh * 0.8, front - 0.002, w * 0.22, 0.03, 0.004);
      }
      break;
    }
    case "shelf": {
      const side = 0.03;
      const board = 0.025;
      const n = Math.max(2, Math.floor(h / 0.4 + 0.5));
      const iw = w - 2 * side;
      for (const s of [-1, 1]) box("body", s * (w / 2 - side / 2), h / 2, 0, side, h, d);
      box("dark", 0, h / 2, d / 2 - 0.005, iw, h, 0.01);
      for (let i = 0; i <= n; i++) {
        const y = board / 2 + ((h - board) * i) / n;
        box("body", 0, y, 0, iw, board, d - 0.01);
        if (i >= 1) box("neon", 0, y - board / 2 - 0.006, front + 0.012, iw - 0.02, 0.01, 0.01);
      }
      const space = (h - board) / n - board;
      const k = Math.floor((iw - 0.04) / 0.09);
      if (space >= 0.12) {
        const roles: PartRole[] = ["trim", "dark", "body"];
        for (let i = 0; i < n; i++) {
          const bottom = board + ((h - board) * i) / n;
          for (let j = 0; j < k; j++) {
            if ((j * 7 + i * 3) % 5 === 4) continue;
            const bh = space * (0.55 + 0.08 * ((j * 3 + i) % 4));
            box(roles[(i + j) % 3]!, -(iw - 0.04) / 2 + 0.045 + j * 0.09, bottom + bh / 2, d * 0.1, 0.07, bh, d * 0.7);
          }
        }
      }
      break;
    }
    case "desk": {
      const top = 0.04;
      const leg = 0.04;
      box("body", 0, h - top / 2, 0, w, top, d);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box("trim", sx * (w / 2 - leg / 2 - 0.02), (h - top) / 2, sz * (d / 2 - leg / 2 - 0.02), leg, h - top, leg);
      box("dark", 0, (h - top) * 0.6, d / 2 - 0.04, w - 0.12, (h - top) * 0.45, 0.02);
      box("neon", 0, h - top - 0.008, front + 0.01, w - 0.08, 0.01, 0.01);
      break;
    }
    case "table": {
      const top = 0.035;
      box("body", 0, h - top / 2, 0, w, top, d);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl("trim", "y", sx * (w / 2 - 0.06), (h - top) / 2, sz * (d / 2 - 0.06), 0.05, h - top, 0.05);
      for (const s of [-1, 1]) {
        box("neon", 0, h - top - 0.008, s * (d / 2 - 0.03), w - 0.06, 0.01, 0.01);
        box("neon", s * (w / 2 - 0.03), h - top - 0.008, 0, 0.01, 0.01, d - 0.06);
      }
      break;
    }
    case "counter": {
      const top = 0.04;
      const kick = Math.min(0.1, h * 0.12);
      const mid = kick + (h - top - kick) / 2;
      box("body", 0, mid, 0.02, w - 0.02, h - top - kick, d - 0.04);
      box("dark", 0, kick / 2, 0.04, w - 0.06, kick, d - 0.08);
      box("trim", 0, h - top / 2, 0, w, top, d);
      box("neon", 0, h - top - 0.01, front + 0.03, w - 0.04, N, 0.01);
      const n = Math.max(1, Math.floor(w / 0.6 + 0.5));
      for (let i = 1; i < n; i++) box("dark", -w / 2 + (w * i) / n, mid, front + 0.04 - 0.002, 0.008, h - top - kick - 0.04, 0.006);
      break;
    }
    case "rack": {
      const m = Math.min(0.1, h * 0.06);
      const n = Math.max(3, Math.floor((h - 2 * m) / 0.09));
      const uh = (h - 2 * m) / n;
      box("body", 0, h / 2, 0, w, h, d);
      box("dark", 0, h / 2, front - 0.002, w - 0.06, h - 2 * m + 0.02, 0.004);
      for (let i = 0; i < n; i++) {
        const y = m + uh * (i + 0.5);
        box("trim", 0, y, front - 0.006, w - 0.1, uh * 0.78, 0.004);
        box(i % 7 === 3 ? "alert" : "neon", -w / 2 + 0.08 + ((i * 5) % 3) * 0.03, y, front - 0.01, 0.02, Math.min(0.012, uh * 0.3), 0.004);
      }
      for (const s of [-1, 1]) box("neon", s * (w / 2 - 0.015), h / 2, front - 0.006, 0.012, h - 0.1, 0.012);
      break;
    }
    case "mainframe": {
      box("body", 0, h / 2 - 0.02, 0, w - 0.01, h - 0.04, d - 0.01);
      box("trim", 0, h - 0.02, 0, w, 0.04, d);
      box("dark", 0, h * 0.68, front + 0.002, w * 0.86, h * 0.42, 0.006);
      const r = Math.min(w * 0.19, h * 0.11);
      for (const s of [-1, 1]) {
        cyl("trim", "z", s * w * 0.22, h * 0.7, front - 0.008, 2 * r, 2 * r, 0.02);
        cyl("dark", "z", s * w * 0.22, h * 0.7, front - 0.02, r * 0.5, r * 0.5, 0.012);
      }
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 6; col++) {
          const i = row * 6 + col;
          const role: PartRole = i % 5 === 2 ? "alert" : i % 3 === 0 ? "screen" : "neon";
          box(role, -w * 0.35 + col * ((w * 0.7) / 5), h * 0.36 - row * 0.06, front - 0.003, 0.03, 0.03, 0.006);
        }
      }
      box("dark", 0, h * 0.15, front - 0.001, w * 0.86, h * 0.2, 0.004);
      box("neon", 0, h - 0.06, front - 0.004, w - 0.04, N, 0.008);
      break;
    }
    case "tower": {
      box("body", 0, h / 2, 0, w, h, d);
      box("dark", 0, h / 2, front - 0.004, w - 0.01, h - 0.01, 0.008);
      for (const f of [0.82, 0.72]) box("trim", 0, h * f, front - 0.01, w * 0.75, h * 0.06, 0.004);
      cyl("neon", "z", 0, h * 0.55, front - 0.01, w * 0.18, w * 0.18, 0.004);
      box("neon", w / 2 + 0.002, h * 0.5, 0, 0.004, h * 0.5, 0.012);
      break;
    }
    case "crt": {
      const stand = Math.min(0.07, h * 0.18);
      const sh = h - stand;
      box("body", 0, stand * 0.2, 0, w * 0.55, stand * 0.4, d * 0.55);
      box("trim", 0, stand * 0.7, 0, 0.08, stand * 0.6, 0.08);
      box("body", 0, stand + sh / 2, front + d * 0.225, w, sh, d * 0.45);
      box("body", 0, stand + sh * 0.45, front + d * 0.725, w * 0.75, sh * 0.8, d * 0.55);
      box("screen", 0, stand + sh * 0.52, front - 0.002, w * 0.8, sh * 0.72, 0.004);
      box("neon", w * 0.38, stand + sh * 0.08, front - 0.002, 0.02, 0.012, 0.004);
      break;
    }
    case "workstation": {
      const dh = Math.min(0.74, h * 0.62);
      box("body", 0, dh - 0.02, 0, w, 0.04, d);
      for (const s of [-1, 1]) box("trim", s * (w / 2 - 0.02), (dh - 0.04) / 2, 0, 0.04, dh - 0.04, d - 0.04);
      box("neon", 0, dh - 0.048, front + 0.01, w - 0.1, 0.01, 0.01);
      const mw = Math.min(0.42, w * 0.4);
      const md = Math.min(0.42, d * 0.6);
      add(partsOf("crt", mw, h - dh, md), 0, dh, d / 2 - md / 2 - 0.03);
      const kw = Math.min(0.45, w * 0.35);
      const kz = front + Math.min(0.16, d * 0.2);
      box("dark", 0, dh + 0.012, kz, kw, 0.024, Math.min(0.15, d * 0.2));
      box("trim", 0, dh + 0.026, kz, kw - 0.03, 0.006, Math.min(0.12, d * 0.16));
      box("trim", Math.min(kw / 2 + 0.12, w / 2 - 0.05), dh + 0.015, kz, 0.06, 0.03, 0.1);
      const th = Math.min(0.45, dh - 0.06);
      const td = Math.min(0.45, d - 0.1);
      if (w >= 0.7) add(partsOf("tower", 0.2, th, td), w / 2 - 0.18, 0, 0);
      break;
    }
    case "screenwall": {
      box("dark", 0, h / 2, 0, w, h, d);
      const cols = Math.max(1, Math.floor(w / 0.65 + 0.5));
      const rows = Math.max(1, Math.floor(h / 0.5 + 0.5));
      const cw = (w - 0.04) / cols;
      const ch = (h - 0.04) / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) box((r * cols + c) % 5 === 3 ? "alert" : "screen", -w / 2 + 0.02 + cw * (c + 0.5), 0.02 + ch * (r + 0.5), front - 0.002, cw - 0.03, ch - 0.03, 0.004);
      }
      for (const y of [0.012, h - 0.012]) box("neon", 0, y, front - 0.004, w, N, 0.008);
      break;
    }
    case "printer": {
      const fz = front + d * 0.15;
      box("body", 0, h * 0.4, d * 0.075, w, h * 0.8, d * 0.85);
      box("trim", 0, h * 0.85, d * 0.1, w * 0.92, h * 0.1, d * 0.7);
      box("trim", 0, h * 0.85, d * 0.4, w * 0.6, h * 0.3, 0.01);
      box("dark", 0, h * 0.3, fz - 0.003, w * 0.7, 0.03, 0.006);
      box("trim", 0, h * 0.22, front + d * 0.075, w * 0.62, 0.012, d * 0.15);
      box("neon", w * 0.38, h * 0.7, fz - 0.002, 0.025, 0.012, 0.004);
      box("screen", w * 0.22, h * 0.7, fz - 0.002, 0.08, 0.03, 0.004);
      break;
    }
    case "cables": {
      const n = Math.max(2, Math.floor(d / 0.06));
      const dia = Math.min(h, (d / n) * 0.8);
      for (let i = 0; i < n; i++) cyl(i === Math.floor(n / 2) ? "neon" : "dark", "x", 0, dia / 2, -d / 2 + (d * (i + 0.5)) / n, w, dia, dia);
      for (const s of [-1, 1]) box("trim", s * (w / 2 - 0.05), h / 2, 0, 0.04, h, d);
      break;
    }
    case "popup": {
      box("body", 0, h / 2, 0, w, h, d);
      const bar = h * 0.14;
      box("neon", 0, h - bar / 2 - 0.01, front - 0.002, w - 0.02, bar, 0.004);
      box("trim", w / 2 - 0.01 - bar * 0.6, h - bar / 2 - 0.01, front - 0.005, bar * 0.7, bar * 0.7, 0.004);
      cyl("alert", "z", -w * 0.3, h * 0.52, front - 0.002, h * 0.22, h * 0.22, 0.004);
      for (let i = 0; i < 3; i++) box("dark", w * 0.08, h * 0.62 - i * h * 0.1, front - 0.002, w * (0.45 - i * 0.08), 0.012, 0.004);
      box("trim", 0, h * 0.14, front - 0.004, w * 0.22, h * 0.12, 0.008);
      break;
    }
    case "camera": {
      const head = Math.min(0.15, h * 0.2);
      cyl("dark", "y", 0, 0.02, 0, w, 0.04, d);
      cyl("neon", "y", 0, 0.06, 0, Math.min(0.08, w * 0.5), 0.02, Math.min(0.08, d * 0.5));
      cyl("trim", "y", 0, (h - head) / 2, 0, 0.05, h - head, 0.05);
      box("trim", 0, h - head, -0.05, 0.04, 0.04, Math.min(0.14, d * 0.35));
      box("body", 0, h - head * 0.6, -d * 0.12, w * 0.6, head * 0.8, d * 0.7);
      cyl("dark", "z", 0, h - head * 0.6, front + 0.02, Math.min(0.07, w * 0.4), Math.min(0.07, w * 0.4), 0.04);
      box("alert", w * 0.2, h - head * 0.25, -d * 0.3, 0.015, 0.015, 0.015);
      break;
    }
    case "chair": {
      const seat = Math.min(0.48, h * 0.5);
      box("dark", 0, 0.03, 0, w * 0.9, 0.04, 0.06);
      box("dark", 0, 0.03, 0, 0.06, 0.04, d * 0.9);
      cyl("trim", "y", 0, 0.05 + (seat - 0.1) / 2, 0, 0.05, seat - 0.1, 0.05);
      box("body", 0, seat - 0.04, -0.02, w * 0.8, 0.08, d * 0.8);
      box("body", 0, seat + (h - seat) / 2, d / 2 - 0.05, w * 0.75, h - seat, 0.06);
      box("trim", 0, seat + 0.04, d / 2 - 0.09, 0.04, 0.16, 0.03);
      box("neon", 0, h - 0.03, d / 2 - 0.083, w * 0.6, N, 0.006);
      break;
    }
    case "cooler": {
      const cab = h * 0.68;
      box("body", 0, cab / 2, 0, w * 0.9, cab, d * 0.9);
      box("dark", 0, cab * 0.7, front + d * 0.05 - 0.002, w * 0.7, cab * 0.22, 0.004);
      box("dark", 0, cab * 0.62, front + d * 0.05 - Math.min(0.03, d * 0.1), w * 0.6, 0.02, Math.min(0.06, d * 0.2));
      for (const s of [-1, 1]) box(s < 0 ? "neon" : "alert", s * w * 0.15, cab * 0.72, front + d * 0.05 - 0.015, 0.03, 0.04, 0.03);
      cyl("trim", "y", 0, cab + 0.02, 0, w * 0.4, 0.04, d * 0.4);
      cyl("glass", "y", 0, cab + 0.04 + (h - cab - 0.04) / 2, 0, w * 0.9, h - cab - 0.04, d * 0.9);
      break;
    }
    case "plant": {
      const pot = Math.min(0.35, h * 0.32);
      const fh = h - pot;
      cyl("body", "y", 0, pot / 2, 0, w * 0.6, pot, d * 0.6);
      cyl("trim", "y", 0, pot - 0.01, 0, w * 0.64, 0.02, d * 0.64);
      cyl("neon", "y", 0, pot * 0.2, 0, w * 0.62, 0.012, d * 0.62);
      box("trim", 0, pot + fh * 0.25, 0, 0.03, fh * 0.5, 0.03);
      box("leaf", 0, pot + fh * 0.55, 0, w * 0.9, fh * 0.35, d * 0.9);
      box("leaf", w * 0.12, pot + fh * 0.8, -d * 0.08, w * 0.6, fh * 0.3, d * 0.6);
      box("leaf", -w * 0.08, pot + fh * 0.92, d * 0.06, w * 0.35, fh * 0.16, d * 0.35);
      break;
    }
    case "bin": {
      cyl("body", "y", 0, h / 2, 0, w * 0.9, h, d * 0.9);
      cyl("trim", "y", 0, h - 0.016, 0, w, 0.03, d);
      cyl("dark", "y", 0, h - 0.001, 0, w * 0.82, 0.002, d * 0.82);
      cyl("neon", "y", 0, h * 0.55, 0, w * 0.92, 0.02, d * 0.92);
      break;
    }
    case "tube": {
      cyl("dark", "y", 0, 0.025, 0, w, 0.05, d);
      cyl("trim", "y", 0, h - 0.02, 0, w * 0.6, 0.04, d * 0.6);
      cyl("neon", "y", 0, 0.05 + (h - 0.09) / 2, 0, w * 0.45, h - 0.09, d * 0.45);
      break;
    }
    case "stove": {
      const top = 0.03;
      const kick = Math.min(0.08, h * 0.1);
      const bh = h - top - kick - 0.004;
      box("body", 0, kick + bh / 2, 0.01, w - 0.01, bh, d - 0.02);
      box("dark", 0, kick / 2, 0.03, w - 0.06, kick, d - 0.06);
      box("dark", 0, h - 0.004 - top / 2, 0, w, top, d);
      box("dark", 0, kick + bh * 0.42, front - 0.002, w * 0.78, bh * 0.56, 0.006);
      box("glass", 0, kick + bh * 0.42, front - 0.006, w * 0.6, bh * 0.3, 0.004);
      box("trim", 0, kick + bh * 0.8, front - 0.02, w * 0.7, 0.02, 0.02);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) cyl(sx < 0 && sz < 0 ? "flame" : "neon", "y", sx * w * 0.22, h - 0.002, sz * d * 0.22, w * 0.24, 0.004, w * 0.24);
      }
      for (let i = 0; i < 4; i++) cyl("trim", "z", -w * 0.3 + (i * w * 0.6) / 3, kick + bh * 0.92, front - 0.012, 0.03, 0.03, 0.024);
      break;
    }
    case "microwave": {
      const body = d * 0.76;
      const bz = d / 2 - body / 2;
      const f = bz - body / 2;
      box("body", 0, h / 2, bz, w, h, body);
      box("dark", -w * 0.1, h / 2, f - 0.002, w * 0.66, h * 0.76, 0.006);
      box("alert", -w * 0.1, h / 2, f - 0.006, w * 0.42, h * 0.46, 0.002);
      box("flame", -w * 0.2, h * 0.28, f - 0.008, 0.012, h * 0.3, 0.002);
      box("flame", 0, h * 0.62, f - 0.008, w * 0.1, 0.01, 0.002);
      box("body", -w / 2 + 0.008, h * 0.45, f - (d - body) / 2, 0.016, h * 0.8, d - body);
      box("glass", -w / 2 + 0.018, h * 0.45, f - (d - body) / 2, 0.004, h * 0.5, (d - body) * 0.7);
      box("screen", w * 0.34, h * 0.8, f - 0.002, w * 0.2, h * 0.14, 0.004);
      for (let i = 0; i < 3; i++) box(i === 2 ? "alert" : "trim", w * 0.34, h * (0.58 - i * 0.14), f - 0.002, w * 0.16, h * 0.08, 0.004);
      box("neon", w * 0.34, h * 0.12, f - 0.002, w * 0.2, 0.012, 0.004);
      break;
    }
    case "toaster": {
      box("body", 0, h * 0.45, 0, w, h * 0.9, d);
      box("dark", 0, h * 0.1, 0, w * 0.9, h * 0.1, d * 0.8);
      for (const z of [-1, 1]) box("flame", 0, h * 0.9 + 0.002, z * d * 0.2, w * 0.76, 0.004, d * 0.14);
      box("trim", w / 2 + 0.006, h * 0.6, 0, 0.012, h * 0.12, d * 0.2);
      box("neon", 0, h * 0.2, front - 0.002, w * 0.5, 0.01, 0.004);
      break;
    }
    case "fridge": {
      const kick = Math.min(0.08, h * 0.06);
      const split = kick + (h - kick) * 0.32;
      box("body", 0, kick + (h - kick) / 2, 0.01, w - 0.01, h - kick, d - 0.02);
      box("dark", 0, kick / 2, 0.03, w - 0.06, kick, d - 0.06);
      box("dark", 0, split, front - 0.002, w - 0.02, 0.012, 0.006);
      const grip = h * 0.16;
      for (const y of [split - grip * 0.7, split + grip * 1.1]) box("trim", w / 2 - 0.07, y, front - 0.02, 0.025, grip, 0.025);
      box("neon", 0, h - 0.04, front - 0.002, w - 0.06, N, 0.006);
      box("alert", -w * 0.2, split + h * 0.17, front - 0.003, 0.05, 0.05, 0.004);
      box("trim", -w * 0.08, split + h * 0.25, front - 0.003, 0.09, 0.12, 0.004);
      break;
    }
    case "sink": {
      const top = 0.03;
      const deck = h * 0.84;
      box("body", 0, (deck - top) / 2, 0, w, deck - top, d);
      box("trim", 0, deck - top / 2, 0, w, top, d);
      box("dark", 0, deck - 0.005, -d * 0.05, w * 0.7, 0.012, d * 0.6);
      cyl("trim", "y", 0, deck + (h - deck) / 2, d * 0.34, 0.03, h - deck, 0.03);
      box("trim", 0, h - 0.012, d * 0.24, 0.024, 0.024, d * 0.22);
      box("neon", 0, deck * 0.5, front - 0.002, w * 0.7, N, 0.006);
      break;
    }
    case "toilet": {
      const tank = Math.min(0.2, d * 0.3);
      const seat = Math.min(0.42, h * 0.56);
      box("body", 0, seat + (h - seat) / 2, d / 2 - tank / 2, w * 0.9, h - seat, tank);
      box("trim", 0, h - 0.012, d / 2 - tank / 2, w * 0.94, 0.024, tank + 0.01);
      box("body", 0, seat * 0.4, d * 0.12, w * 0.5, seat * 0.8, d * 0.5);
      cyl("body", "y", 0, seat * 0.8, -d * 0.1, w * 0.92, seat * 0.4, (d - tank) * 0.92);
      cyl("trim", "y", 0, seat + 0.012, -d * 0.1, w * 0.96, 0.024, (d - tank) * 0.96);
      cyl("neon", "y", 0, seat + 0.026, -d * 0.1, w * 0.62, 0.004, (d - tank) * 0.62);
      break;
    }
    case "bathtub": {
      const t = 0.06;
      const rim = h * 0.78;
      box("dark", 0, rim * 0.2, 0, w - t, rim * 0.4, d - t);
      for (const s of [-1, 1]) {
        box("body", s * (w / 2 - t / 2), rim / 2, 0, t, rim, d);
        box("body", 0, rim / 2, s * (d / 2 - t / 2), w, rim, t);
        box("trim", s * (w / 2 - t / 2), rim - 0.01, 0, t, 0.02, d);
      }
      box("neon", 0, rim * 0.42, 0, w - t - 0.02, 0.01, d - t - 0.02);
      cyl("trim", "y", 0, rim + (h - rim) / 2, d / 2 - t, 0.03, h - rim, 0.03);
      box("trim", 0, h - 0.012, d / 2 - t - 0.08, 0.024, 0.024, 0.16);
      break;
    }
    case "washer":
    case "dryer": {
      const panel = Math.min(0.14, h * 0.16);
      const r = Math.min(w, h - panel) * 0.68;
      box("body", 0, h / 2, 0.005, w - 0.01, h, d - 0.01);
      box("dark", 0, h - panel / 2, front - 0.002, w - 0.04, panel - 0.02, 0.006);
      box("screen", id === "washer" ? w * 0.22 : -w * 0.22, h - panel / 2, front - 0.006, w * 0.26, panel * 0.42, 0.003);
      cyl("trim", "z", id === "washer" ? -w * 0.28 : w * 0.28, h - panel / 2, front - 0.012, panel * 0.5, panel * 0.5, 0.024);
      const cy = (h - panel) / 2;
      cyl("trim", "z", 0, cy, front - 0.008, r, r, 0.016);
      cyl("dark", "z", 0, cy, front - 0.014, r * 0.84, r * 0.84, 0.01);
      cyl(id === "washer" ? "glass" : "flame", "z", 0, cy, front - 0.02, r * 0.62, r * 0.62, 0.004);
      box("neon", 0, h - panel - 0.012, front - 0.002, w * 0.7, 0.01, 0.004);
      break;
    }
    case "couch":
    case "armchair": {
      const seat = Math.min(0.45, h * 0.52);
      const arm = Math.min(0.18, w * 0.16);
      const back = Math.min(0.22, d * 0.26);
      const fz = (-back) / 2;
      box("dark", 0, 0.04, 0.01, w - 0.06, 0.08, d - 0.08);
      box("body", 0, 0.08 + (seat - 0.2) / 2, 0, w, seat - 0.2, d);
      box("body", 0, seat + (h - seat) / 2 - 0.06, d / 2 - back / 2, w, h - seat + 0.12, back);
      for (const s of [-1, 1]) box("body", s * (w / 2 - arm / 2), seat * 0.62 + 0.04, 0, arm, seat * 1.24 - 0.08, d);
      const n = Math.max(1, Math.floor((w - 2 * arm) / 0.62 + 0.5));
      const cw = (w - 2 * arm) / n;
      for (let i = 0; i < n; i++) box("trim", -w / 2 + arm + cw * (i + 0.5), seat - 0.06, fz, cw - 0.02, 0.12, d - back - 0.02);
      box("neon", 0, 0.1, front - 0.002, w - 0.1, N, 0.006);
      break;
    }
    case "bed": {
      const frame = h * 0.4;
      const top = h * 0.8;
      const end = w >= d ? 1 : 0;
      const hx = end === 1 ? w / 2 - 0.04 : 0;
      const hz = end === 1 ? 0 : d / 2 - 0.04;
      box("wood", 0, frame / 2, 0, w, frame, d);
      box("body", 0, frame + (top - frame) / 2, 0, w - 0.04, top - frame, d - 0.04);
      box("wood", hx, h / 2, hz, end === 1 ? 0.08 : w, h, end === 1 ? d : 0.08);
      box("neon", hx - (end === 1 ? 0.05 : 0), h * 0.92, hz - (end === 1 ? 0 : 0.05), end === 1 ? 0.008 : w - 0.1, N, end === 1 ? d - 0.1 : 0.008);
      for (const s of [-1, 1]) box("trim", hx - (end === 1 ? 0.3 : 0) + (end === 1 ? 0 : s * w * 0.22), top + (h - top) * 0.4, hz - (end === 1 ? 0 : 0.3) + (end === 1 ? s * d * 0.22 : 0), end === 1 ? 0.34 : w * 0.38, (h - top) * 0.8, end === 1 ? d * 0.38 : 0.34);
      break;
    }
    case "tv": {
      const leg = Math.min(0.35, h * 0.3);
      const sh = h - leg;
      for (const sx of [-1, 1]) box("dark", sx * (w / 2 - 0.08), leg / 2, 0, 0.04, leg, d * 0.7);
      box("body", 0, leg + sh / 2, 0, w, sh, d);
      box("dark", -w * 0.1, leg + sh * 0.52, front - 0.002, w * 0.66, sh * 0.78, 0.006);
      box("screen", -w * 0.1, leg + sh * 0.52, front - 0.006, w * 0.56, sh * 0.64, 0.004);
      for (let i = 0; i < 2; i++) cyl("trim", "z", w * 0.34, leg + sh * (0.74 - i * 0.26), front - 0.012, 0.09, 0.09, 0.024);
      for (let i = 0; i < 4; i++) box("dark", w * 0.34, leg + sh * (0.34 - i * 0.05), front - 0.002, w * 0.16, 0.008, 0.004);
      box("neon", 0, leg + 0.02, front - 0.002, w - 0.06, 0.01, 0.004);
      break;
    }
    case "lamp": {
      const shade = Math.min(0.36, h * 0.24);
      cyl("dark", "y", 0, 0.02, 0, w * 0.7, 0.04, d * 0.7);
      cyl("trim", "y", 0, (h - shade) / 2, 0, 0.03, h - shade, 0.03);
      cyl("body", "y", 0, h - shade / 2, 0, w, shade, d);
      cyl("flame", "y", 0, h - shade * 0.6, 0, w * 0.34, shade * 0.4, d * 0.34);
      cyl("neon", "y", 0, h - shade - 0.004, 0, w * 1.02, 0.008, d * 1.02);
      break;
    }
    case "fireplace": {
      const mantel = Math.min(0.08, h * 0.08);
      const fh = (h - mantel) * 0.72;
      box("body", 0, (h - mantel) / 2, 0, w, h - mantel, d);
      box("trim", 0, h - mantel / 2, -0.02, w + 0.02, mantel, d + 0.04);
      box("dark", 0, fh / 2 + 0.03, front - 0.002, w * 0.64, fh, 0.006);
      for (const s of [-1, 1]) box("wood", s * w * 0.1, 0.09, front - 0.01, w * 0.26, 0.05, 0.05);
      box("flame", -w * 0.08, 0.03 + fh * 0.27, front - 0.008, w * 0.1, fh * 0.42, 0.004);
      box("flame", w * 0.08, 0.03 + fh * 0.2, front - 0.008, w * 0.08, fh * 0.32, 0.004);
      box("alert", 0, 0.03 + fh * 0.1, front - 0.01, w * 0.2, fh * 0.14, 0.004);
      box("neon", 0, h - mantel - 0.012, front - 0.002, w - 0.06, N, 0.006);
      break;
    }
    case "bbq": {
      const bowl = h * 0.72;
      const r = Math.min(w, d);
      for (const [sx, sz] of [[-1, -1], [1, -1], [0, 1]] as const) box("dark", sx * r * 0.3, bowl * 0.4, sz * r * 0.3, 0.03, bowl * 0.8, 0.03);
      cyl("trim", "y", 0, bowl * 0.34, 0, r * 0.7, 0.012, r * 0.7);
      cyl("body", "y", 0, bowl * 0.8, 0, r * 0.84, bowl * 0.28, r * 0.84);
      cyl("body", "y", 0, bowl + (h - bowl) * 0.24, 0, r * 0.98, (h - bowl) * 0.48, r * 0.98);
      cyl("flame", "y", 0, bowl + 0.004, 0, r * 0.88, 0.008, r * 0.88);
      cyl("body", "y", 0, bowl + (h - bowl) * 0.62, 0, r * 0.66, (h - bowl) * 0.28, r * 0.66);
      cyl("trim", "y", 0, h - 0.02, 0, 0.12, 0.04, 0.12);
      cyl("neon", "y", 0, bowl - 0.01, 0, r + 0.004, 0.008, r + 0.004);
      break;
    }
    case "gnome": {
      const r = Math.min(w, d);
      cyl("dark", "y", 0, h * 0.04, 0, r * 0.9, h * 0.08, r * 0.9);
      cyl("body", "y", 0, h * 0.26, 0, r * 0.8, h * 0.36, r * 0.8);
      cyl("trim", "y", 0, h * 0.5, 0, r * 0.66, h * 0.14, r * 0.66);
      box("trim", 0, h * 0.42, -r * 0.36, r * 0.4, h * 0.22, 0.03);
      cyl("neon", "y", 0, h * 0.2, 0, r * 0.84, 0.01, r * 0.84);
      cyl("alert", "y", 0, h * 0.62, 0, r * 0.68, h * 0.1, r * 0.68);
      cyl("alert", "y", 0, h * 0.72, 0, r * 0.46, h * 0.1, r * 0.46);
      cyl("alert", "y", 0, h * 0.82, 0, r * 0.28, h * 0.1, r * 0.28);
      cyl("alert", "y", 0, h * 0.93, 0, r * 0.12, h * 0.14, r * 0.12);
      break;
    }
    case "modular": {
      const stand = Math.min(0.5, h * 0.3);
      const rows = Math.max(2, Math.floor((h - stand) / 0.36));
      const rh = (h - stand) / rows;
      const cols = Math.max(3, Math.floor(w / 0.14));
      const cw = (w - 0.04) / cols;
      for (const s of [-1, 1]) box("dark", s * (w / 2 - 0.06), stand / 2, 0, 0.04, stand, d * 0.8);
      box("body", 0, stand + (h - stand) / 2, 0.01, w, h - stand, d - 0.02);
      for (let r = 0; r < rows; r++) {
        const y0 = stand + rh * r;
        box("trim", 0, y0 + 0.008, front - 0.002, w - 0.02, 0.012, 0.004);
        for (let c = 0; c < cols; c++) {
          const x = -w / 2 + 0.02 + cw * (c + 0.5);
          const i = r * cols + c;
          box("dark", x, y0 + rh / 2, front - 0.002, cw - 0.012, rh - 0.03, 0.006);
          cyl("trim", "z", x, y0 + rh * 0.68, front - 0.012, 0.03, 0.03, 0.02);
          cyl("trim", "z", x, y0 + rh * 0.42, front - 0.01, 0.018, 0.018, 0.012);
          box(i % 5 === 2 ? "alert" : "neon", x + cw * 0.28, y0 + rh * 0.86, front - 0.006, 0.01, 0.01, 0.004);
          box(i % 7 === 3 ? "screen" : "dark", x, y0 + rh * 0.2, front - 0.008, cw * 0.5, 0.012, 0.004);
        }
      }
      for (let i = 0; i < 4; i++) {
        const x = -w * 0.3 + i * w * 0.2;
        const drop = (h - stand) * (0.3 + ((i * 3) % 4) * 0.12);
        box(i % 2 === 0 ? "neon" : "alert", x, h - 0.06 - drop / 2, front - 0.024, 0.008, drop, 0.008);
      }
      break;
    }
    case "mixing": {
      const top = 0.05;
      const face = h - 0.024;
      const n = Math.max(4, Math.floor(w / 0.11));
      const cw = (w - 0.08) / n;
      for (const s of [-1, 1]) box("dark", s * (w / 2 - 0.05), (face - top) / 2, 0, 0.06, face - top, d - 0.06);
      box("body", 0, face - top / 2, 0, w, top, d);
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + 0.04 + cw * (i + 0.5);
        box("dark", x, face + 0.002, 0, cw - 0.012, 0.004, d - 0.06);
        box("trim", x, face + 0.008, -d * (0.1 + ((i * 5) % 4) * 0.08), cw * 0.5, 0.012, 0.03);
        for (let k = 0; k < 3; k++) cyl("trim", "y", x, face + 0.012, d * (0.1 + k * 0.1), 0.02, 0.02, 0.02);
        box(i % 6 === 4 ? "alert" : "neon", x, face + 0.006, d * 0.42, cw * 0.4, 0.004, 0.012);
      }
      break;
    }
    case "speaker": {
      const r = Math.min(w, h) * 0.72;
      box("body", 0, h / 2, 0, w, h, d);
      box("dark", 0, h / 2, front - 0.002, w - 0.03, h - 0.03, 0.004);
      cyl("trim", "z", 0, h * 0.34, front - 0.006, r, r, 0.008);
      cyl("dark", "z", 0, h * 0.34, front - 0.012, r * 0.86, r * 0.86, 0.008);
      cyl("trim", "z", 0, h * 0.34, front - 0.016, r * 0.3, r * 0.3, 0.006);
      cyl("trim", "z", 0, h * 0.78, front - 0.006, r * 0.4, r * 0.4, 0.008);
      cyl("dark", "z", 0, h * 0.78, front - 0.012, r * 0.26, r * 0.26, 0.006);
      box("neon", 0, h * 0.6, front - 0.006, w * 0.6, 0.01, 0.004);
      break;
    }
    case "amp": {
      const top = h - 0.024;
      box("body", 0, top / 2, 0, w, top, d);
      box("trim", 0, top * 0.42, front - 0.002, w - 0.04, top * 0.66, 0.004);
      box("dark", 0, top * 0.42, front - 0.006, w - 0.07, top * 0.6, 0.004);
      box("dark", 0, top * 0.87, front - 0.002, w - 0.04, top * 0.18, 0.004);
      for (let i = 0; i < 5; i++) cyl("trim", "z", -w * 0.34 + i * w * 0.14, top * 0.87, front - 0.012, 0.03, 0.03, 0.02);
      cyl("alert", "z", w * 0.38, top * 0.87, front - 0.008, 0.024, 0.024, 0.01);
      box("trim", 0, h - 0.012, 0, w * 0.3, 0.024, 0.03);
      box("neon", 0, top * 0.05, front - 0.002, w * 0.6, 0.008, 0.004);
      break;
    }
    case "turntable": {
      const r = Math.min(w, d) * 0.84;
      box("body", 0, h * 0.3, 0, w, h * 0.6, d);
      box("trim", 0, h * 0.64, 0, w, h * 0.08, d);
      cyl("trim", "y", -w * 0.1, h * 0.72, 0, r, h * 0.08, r);
      cyl("dark", "y", -w * 0.1, h * 0.78, 0, r * 0.94, h * 0.04, r * 0.94);
      cyl("alert", "y", -w * 0.1, h * 0.81, 0, r * 0.3, h * 0.02, r * 0.3);
      cyl("trim", "y", w * 0.36, h * 0.82, -d * 0.34, 0.03, h * 0.36, 0.03);
      box("trim", w * 0.2, h * 0.94, -d * 0.1, 0.012, h * 0.08, d * 0.5);
      box("neon", w * 0.34, h * 0.3, front - 0.002, w * 0.2, 0.008, 0.004);
      break;
    }
    case "piano": {
      const keys = Math.min(0.72, h * 0.58);
      const bed = Math.min(0.28, d * 0.46);
      box("body", 0, h / 2, d / 2 - (d - bed) / 2, w, h, d - bed);
      box("body", 0, keys - 0.04, -d / 2 + bed / 2, w, 0.08, bed);
      for (const s of [-1, 1]) box("body", s * (w / 2 - 0.03), keys / 2 - 0.04, -d / 2 + bed * 0.7, 0.06, keys - 0.08, 0.06);
      box("trim", 0, keys + 0.002, -d / 2 + bed / 2, w - 0.12, 0.008, bed - 0.06);
      const n = Math.max(8, Math.floor((w - 0.12) / 0.06));
      const kw = (w - 0.12) / n;
      for (let i = 0; i < n; i++) if (i % 7 !== 2 && i % 7 !== 6) box("dark", -w / 2 + 0.06 + kw * (i + 0.5) + kw / 2, keys + 0.012, -d / 2 + bed * 0.62, kw * 0.5, 0.012, bed * 0.5);
      box("neon", 0, keys + 0.06, -d / 2 + bed - 0.002, w - 0.14, N, 0.006);
      break;
    }
    case "arcade": {
      const deck = Math.min(0.95, h * 0.54);
      const marquee = Math.min(0.2, h * 0.12);
      box("body", 0, h / 2, d * 0.15, w, h, d * 0.7);
      box("body", 0, deck - 0.1, front + d * 0.11, w * 0.94, 0.14, d * 0.22);
      box("body", 0, (deck - 0.17) / 2, front + d * 0.11, w * 0.94, deck - 0.17, d * 0.22);
      box("dark", 0, deck - 0.02, front + d * 0.11, w * 0.86, 0.016, d * 0.18);
      cyl("trim", "y", -w * 0.22, deck + 0.04, front + d * 0.11, 0.02, 0.08, 0.02);
      cyl("alert", "y", -w * 0.22, deck + 0.09, front + d * 0.11, 0.04, 0.03, 0.04);
      for (let i = 0; i < 3; i++) cyl(i === 1 ? "neon" : "alert", "y", w * (0.04 + i * 0.12), deck + 0.002, front + d * 0.11, 0.04, 0.012, 0.04);
      box("dark", 0, deck + (h - marquee - deck) / 2, -d * 0.2 - 0.002, w * 0.84, h - marquee - deck - 0.04, 0.006);
      box("screen", 0, deck + (h - marquee - deck) / 2, -d * 0.2 - 0.006, w * 0.72, (h - marquee - deck) * 0.76, 0.004);
      box("neon", 0, h - marquee / 2, -d * 0.2 - 0.004, w * 0.86, marquee * 0.7, 0.008);
      break;
    }
    case "teatable": {
      const th = h * 0.76;
      const r = h - th;
      add(partsOf("table", w, th, d), 0, 0, 0);
      box("body", 0, th - 0.01, 0, w * 0.96, 0.03, d);
      const n = Math.max(2, Math.floor(w / 0.5));
      const cw = (w * 0.86) / n;
      for (let i = 0; i < n; i++) {
        const x = -w * 0.43 + cw * (i + 0.5);
        for (const s of [-1, 1]) {
          const z = s * d * 0.3;
          cyl("trim", "y", x, th + 0.012, z, r * 0.8, 0.012, r * 0.8);
          cyl(i % 3 === 1 ? "neon" : "body", "y", x, th + r * 0.2, z, r * 0.36, r * 0.3, r * 0.36);
          box("body", x + r * 0.22, th + r * 0.2, z, r * 0.14, r * 0.18, 0.01);
        }
        if (i % 2 === 0) add(partsOf("teapot", r * 1.2, r * 0.95, r * 0.9), x, th + 0.01, 0);
        else {
          cyl("alert", "y", x, th + r * 0.18, 0, r, r * 0.26, r);
          cyl("body", "y", x, th + r * 0.4, 0, r * 0.8, r * 0.18, r * 0.8);
        }
      }
      break;
    }
    case "teapot": {
      const r = Math.min(w * 0.62, d);
      cyl("body", "y", 0, h * 0.44, 0, r * 0.8, h * 0.2, r * 0.8);
      cyl("body", "y", 0, h * 0.26, 0, r, h * 0.3, r);
      cyl("body", "y", 0, h * 0.08, 0, r * 0.7, h * 0.16, r * 0.7);
      cyl("trim", "y", 0, h * 0.58, 0, r * 0.56, h * 0.06, r * 0.56);
      cyl("neon", "y", 0, h * 0.7, 0, 0.03, h * 0.12, 0.03);
      box("body", -w * 0.38, h * 0.36, 0, w * 0.24, 0.03, 0.03);
      box("body", -w * 0.47, h * 0.46, 0, 0.03, h * 0.16, 0.03);
      box("trim", w * 0.4, h * 0.46, 0, w * 0.04, h * 0.3, 0.02);
      box("trim", w * 0.34, h * 0.6, 0, w * 0.14, 0.02, 0.02);
      box("trim", w * 0.34, h * 0.3, 0, w * 0.14, 0.02, 0.02);
      break;
    }
    case "clock": {
      const base = h * 0.26;
      const head = Math.min(w, h * 0.3);
      box("body", 0, base / 2, 0, w, base, d);
      box("body", 0, base + (h - base - head) / 2, 0.01, w * 0.72, h - base - head, d * 0.8);
      box("body", 0, h - head / 2, 0, w, head, d);
      box("trim", 0, h - 0.015, 0, w + 0.02, 0.03, d + 0.02);
      box("dark", 0, base + (h - base - head) / 2, front + d * 0.1 - 0.002, w * 0.5, (h - base - head) * 0.8, 0.006);
      cyl("trim", "y", 0, base + (h - base - head) * 0.55, front + d * 0.1 - 0.012, 0.012, (h - base - head) * 0.46, 0.012);
      cyl("flame", "z", 0, base + (h - base - head) * 0.3, front + d * 0.1 - 0.012, w * 0.22, w * 0.22, 0.012);
      cyl("trim", "z", 0, h - head / 2, front - 0.004, head * 0.84, head * 0.84, 0.01);
      cyl("body", "z", 0, h - head / 2, front - 0.012, head * 0.76, head * 0.76, 0.006);
      box("dark", 0, h - head * 0.36, front - 0.018, 0.012, head * 0.28, 0.004);
      box("alert", head * 0.14, h - head * 0.56, front - 0.02, head * 0.3, 0.012, 0.004);
      box("neon", 0, base - 0.02, front - 0.002, w * 0.7, N, 0.006);
      break;
    }
    case "mushroom": {
      const r = Math.min(w, d);
      const stem = h * 0.56;
      cyl("trim", "y", 0, stem / 2, 0, r * 0.26, stem, r * 0.26);
      cyl("alert", "y", 0, stem + h * 0.06, 0, r, h * 0.12, r);
      cyl("alert", "y", 0, stem + h * 0.17, 0, r * 0.8, h * 0.1, r * 0.8);
      cyl("alert", "y", 0, stem + h * 0.27, 0, r * 0.52, h * 0.1, r * 0.52);
      cyl("alert", "y", 0, stem + h * 0.37, 0, r * 0.24, h * 0.08, r * 0.24);
      for (let i = 0; i < 5; i++) {
        const a = i * 1.257;
        cyl("body", "y", Math.cos(a) * r * 0.32, stem + h * (i % 2 === 0 ? 0.12 : 0.22) + 0.04, Math.sin(a) * r * 0.32, r * 0.14, 0.01, r * 0.14);
      }
      cyl("neon", "y", 0, stem - h * 0.02, 0, r * 0.96, 0.01, r * 0.96);
      break;
    }
    case "bottle": {
      const r = Math.min(w, d);
      cyl("glass", "y", 0, h * 0.3, 0, r, h * 0.6, r);
      cyl("neon", "y", 0, h * 0.2, 0, r * 0.82, h * 0.34, r * 0.82);
      cyl("glass", "y", 0, h * 0.72, 0, r * 0.4, h * 0.24, r * 0.4);
      cyl("wood", "y", 0, h * 0.91, 0, r * 0.44, h * 0.14, r * 0.44);
      box("body", 0, h * 0.34, -r / 2 - 0.002, r * 0.8, h * 0.26, 0.002);
      break;
    }
    case "door": {
      const frame = Math.min(0.08, w * 0.1);
      box("dark", 0, (h - frame) / 2, 0, w - 2 * frame, h - frame, d * 0.7);
      for (const s of [-1, 1]) box("body", s * (w / 2 - frame / 2), h / 2, 0, frame, h, d);
      box("body", 0, h - frame / 2, 0, w, frame, d);
      box("trim", w / 2 - frame - 0.08, h * 0.48, front + d * 0.15 - 0.02, 0.05, 0.05, 0.04);
      box("neon", 0, 0.006, front - 0.002, w - 2 * frame, 0.012, 0.012);
      break;
    }
    case "spiral": {
      const r = Math.min(w, d) / 2;
      const n = Math.max(6, Math.floor(h / 0.2));
      cyl("trim", "y", 0, h / 2, 0, 0.1, h, 0.1);
      for (let i = 0; i < n; i++) {
        const a = i * 0.7854;
        const y = 0.18 + i * ((h - 0.2) / n);
        box("body", Math.sin(a) * r * 0.55, y, -Math.cos(a) * r * 0.55, Math.abs(Math.sin(a)) * r * 0.5 + 0.22, 0.03, Math.abs(Math.cos(a)) * r * 0.5 + 0.22);
      }
      cyl("neon", "y", 0, h - 0.04, 0, 0.14, 0.08, 0.14);
      break;
    }
    case "mirror": {
      const frame = Math.min(0.07, w * 0.1);
      box("body", 0, h / 2, 0, w, h, d * 0.7);
      box("glass", 0, h / 2, front + d * 0.15 - 0.002, w - 2 * frame, h - 2 * frame, 0.004);
      box("dark", w * 0.12, h * 0.6, front + d * 0.15 - 0.005, 0.006, h * 0.5, 0.002);
      box("dark", w * 0.04, h * 0.48, front + d * 0.15 - 0.005, w * 0.3, 0.006, 0.002);
      box("neon", 0, h - frame * 0.5, front + d * 0.15 - 0.003, w - 0.04, N, 0.004);
      break;
    }
    case "hole": {
      const r = Math.min(w, d);
      cyl("neon", "y", 0, h * 0.2, 0, r, h * 0.4, r);
      cyl("body", "y", 0, h * 0.5, 0, r * 0.97, h * 0.4, r * 0.97);
      cyl("dark", "y", 0, h * 0.8, 0, r * 0.86, h * 0.4, r * 0.86);
      break;
    }
    case "card": {
      const bh = h * 0.68;
      box("body", 0, h - bh / 2 - 0.1, 0, w, bh, d * 0.5);
      for (const s of [-1, 1]) {
        box("dark", s * w * 0.2, (h - bh - 0.1) / 2, 0, 0.05, h - bh - 0.1, 0.05);
        box("alert", s * w * 0.32, h - 0.2 - (s < 0 ? 0 : bh * 0.72), front + d * 0.25 - 0.002, w * 0.12, w * 0.12, 0.004);
      }
      box("alert", 0, h - bh / 2 - 0.1, front + d * 0.25 - 0.002, w * 0.3, bh * 0.3, 0.004);
      cyl("body", "y", 0, h - 0.06, 0, Math.min(0.16, d + 0.08), 0.12, Math.min(0.16, d + 0.08));
      box("trim", w / 2 + 0.015, h / 2, 0, 0.02, h, 0.02);
      box("neon", w / 2 + 0.015, h - 0.04, 0, 0.04, 0.08, 0.04);
      break;
    }
    case "flamingo": {
      const bh = h * 0.56;
      cyl("dark", "y", 0, 0.01, 0, w * 0.6, 0.02, w * 0.6);
      cyl("neon", "y", 0, bh / 2, 0, 0.016, bh, 0.016);
      cyl("body", "z", 0, bh + 0.08, d * 0.08, w * 0.5, 0.18, d * 0.62);
      box("body", 0, bh + 0.18, -d * 0.16, 0.05, 0.05, d * 0.2);
      cyl("neon", "y", 0, bh + (h - bh) * 0.62, -d * 0.26, 0.03, (h - bh) * 0.6, 0.03);
      box("body", 0, h - 0.05, -d * 0.32, 0.07, 0.07, d * 0.2);
      box("dark", 0, h - 0.07, -d * 0.48, 0.03, 0.03, d * 0.1);
      break;
    }
  }
  return out;
}

// ── The games' neon and haze (wave 47) ───────────────────────────────
// Shared numbers for the web game (`@loom/house/three`, `neon: true`) and
// VR (`HouseBuilder`, `HouseLook`); the terminals' world view and the map
// editor draw neither.

/** The neon strips along every `wall` segment (both faces): a skirting
 *  strip `[0]` m over the floor and a cove strip `[1]` m under the top,
 *  each `NEON_STRIP_H` tall and `NEON_STRIP_PROUD` off the face. */
export const NEON_STRIP_AT: readonly [number, number] = [0.06, 0.05];
export const NEON_STRIP_H = 0.012;
export const NEON_STRIP_PROUD = 0.006;
/** The skirting's and the cove's colours. */
export const NEON_SKIRT = CYAN;
export const NEON_COVE = MAGENTA;
/** Neon is drawn this many times its colour (unlit, unfogged), so it blooms. */
export const NEON_GAIN = 2.2;

/** The haze layers: soft drifting sheets per floor, `[0]` m over its floor
 *  and `[1]` m under its ceiling, at these opacities, tiling every
 *  `HAZE_TILE_M` and drifting `HAZE_DRIFT` m/s (x, z) each; a game draws
 *  none on `low`, the floor one on `medium`, both on `high`. */
export const HAZE_AT: readonly [number, number] = [0.3, 0.35];
export const HAZE_OPACITY: readonly [number, number] = [0.2, 0.12];
export const HAZE_TILE_M = 4;
export const HAZE_DRIFT: readonly [readonly [number, number], readonly [number, number]] = [
  [0.03, 0.012],
  [-0.018, 0.022],
];
export const HAZE_COLOR = "#9a8cff";
/** The games' fog: the colour (the background too) and an exponential density per metre. */
export const HAZE_FOG = "#15123a";
export const HAZE_FOG_DENSITY = 0.07;

/** The neon's brightness at `t` s (0 … 1): steady, but every
 *  `NEON_FLICKER_S` it stutters for a third of a second. */
export const NEON_FLICKER_S = 9.7;
export function neonFlicker(t: number): number {
  const p = ((t % NEON_FLICKER_S) + NEON_FLICKER_S) % NEON_FLICKER_S;
  if (p >= 0.35) return 1;
  return Math.sin(p * 90) > 0 ? 1 : 0.35;
}
