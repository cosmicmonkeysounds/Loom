//! The house map schema (version 1) and the spatial wire types — the one
//! vocabulary the event server, the web game, the terminals and the Godot
//! port share. Normative: `docs/loom-reinstall.md` §1.1 (schema), §1.2
//! (geometry), §2 (routes + stream).
//!
//! **House frame.** Metres, right-handed, Y up: `+x` = east, `+y` = up,
//! `+z` = south (north is `−z`). A plan point is `[x, z]`. Yaw is degrees
//! about `+y`, `0` = facing north, positive = counter-clockwise seen from
//! above (turning left) — three.js's / Godot's `rotation.y` for a node whose
//! forward is `−z`.

/** A plan point `[x, z]`. */
export type Vec2 = [number, number];
/** A point `[x, y, z]` in house coordinates. */
export type Vec3 = [number, number, number];

/** A stair's rising direction: the edge of its rect at the upper elevation. */
export type Compass = "n" | "s" | "e" | "w";

export interface HouseMap {
  version: 1;
  /** "Trapped in the Internet — the house". */
  name: string;
  /** Human description of the surveyed origin. */
  origin: string;
  /** The map page's variant button label ("Tent", "Shed"); optional — not
   *  geometry, the games ignore it. */
  variant?: string;
  /** ≥ 1. */
  floors: Floor[];
  /** ≥ 1. */
  rooms: Room[];
  doors: Door[];
  stairs: Stair[];
  terminals: TerminalSpot[];
  /** ≥ 1 spot. */
  duck: { spots: DuckSpot[] };
  spawn: Spawn;
  props: Prop[];
  /** House → space transforms ("vr", "web"); a missing one is the identity. */
  spaces: Record<string, SpaceTransform>;
  style?: HouseStyle;
}

export interface HouseStyle {
  /** Fence height, metres (default 1.0). */
  fence?: number;
  /** Rendering-only wall thickness, metres (default 0.1). */
  wallThickness?: number;
  /** Default door height, metres (default 2.0). */
  doorHeight?: number;
}

export interface Floor {
  id: string;
  label: string;
  /** World y of the floor surface. */
  elevation: number;
  /** Default room height. */
  height: number;
}

export interface Room {
  id: string;
  label: string;
  floor: string;
  /** The Loom LOCATION it is in the story ("The Start Bar"). Not validated here. */
  location?: string;
  /** Rectilinear (every edge axis-aligned), ≥ 4 vertices, simple, either winding. */
  poly: Vec2[];
  /** Default: its floor's height. */
  height?: number;
  /** No ceiling; unshared edges become a fence. */
  outdoor?: boolean;
  /** "#rrggbb" — floor tint. */
  color?: string;
}

/**
 * A gap in the wall between rooms `a` and `b` (`b = null`: to the outside),
 * on `a`'s floor; `at` lies on the shared wall line (± 0.02 m).
 */
export interface Door {
  id: string;
  a: string;
  b: string | null;
  at: Vec2;
  width: number;
  height?: number;
  /** The id of a "king" prop that guards this door: the games draw a closed leaf in the gap and keep it shut until that king falls. */
  guard?: string;
}

/**
 * `from` = the lower room, `to` = the upper room; `rect` = `[x0, z0, x1, z1]`
 * (x0 < x1, z0 < z1), inside both rooms' footprints. The ramp rises toward
 * `up`. The rect is a hole in the upper floor (and the lower room's ceiling).
 */
export interface Stair {
  id: string;
  from: string;
  to: string;
  rect: [number, number, number, number];
  up: Compass;
}

/** `pos` = the screen's centre on the real wall; `yaw` = the way it faces (into the room). */
export interface TerminalSpot {
  id: string;
  name: string;
  room: string;
  pos: Vec3;
  /** The way the screen faces (into the room), degrees — §1 yaw convention. */
  yaw: number;
  /** The mount camera's pitch, degrees (+ = up). Unset: the terminal's default (a little down). */
  pitch?: number;
  /**
   * The mount camera's **vertical** field of view in degrees, exactly as
   * three.js's `PerspectiveCamera.fov`. Unset: `DEFAULT_SPOT_FOV` (70).
   * The horizontal fov depends on the screen's aspect —
   * `horizontalFov(fov, aspect)`, ≈ 96.5° for 70° on a 16:10 tablet.
   */
  fov?: number;
  /**
   * What the tablet on this spot shows (`TERMINAL_VIEWS`, `terminal`'s
   * `view`). Unset: `auto`. A terminal set up from the map takes it.
   */
  view?: TerminalViewName;
  /**
   * A room terminal: asleep until the story opens its room's LOCATION to
   * everyone, then speaks the character's lines said there. Unset: false.
   */
  speaks?: boolean;
}

/** A terminal screen type — the values of `TERMINAL_VIEWS`. */
export type TerminalViewName = "auto" | "world" | "face" | "mirror" | "tv" | "chess" | "shadow" | "casino";

/** `pos` = where the duck sits (its feet). */
export interface DuckSpot {
  id: string;
  room: string;
  pos: Vec3;
}

export interface Spawn {
  room: string;
  pos: Vec3;
  yaw: number;
}

export type PropKind = "box" | "cylinder" | "screen" | "label" | "king";

export interface Prop {
  id: string;
  room: string;
  kind: PropKind;
  /** Centre of the base. */
  pos: Vec3;
  /** `[w (x), h (y), d (z)]` before yaw. */
  size: Vec3;
  yaw?: number;
  color?: string;
  label?: string;
  /** Collides. Default: true for box / cylinder / king, false otherwise (`propSolid`). */
  solid?: boolean;
  /** kind "king" only: his maximum hit points, an integer 1–99 (default 4) —
   *  one shared bar for every guest; at 0 he has fallen ("pawns only"). */
  hp?: number;
  /** kind "king" only: the story world path (`Night.king_hp`) that holds his
   *  CURRENT hit points — the server writes it on each validated hit, a
   *  director sets it. Absent: the spatial hub holds them in memory,
   *  starting at `hp`. A missing or non-number value reads as `hp`. */
  health?: string;
  /** kind "king" only: the story signals posted about him — the chess
   *  terminal's `won` / `lost` / `drawn`, the server's `hit` / `fallen`
   *  (defaults `KING_SIGNALS`). */
  signals?: { won?: string; lost?: string; drawn?: string; hit?: string; fallen?: string };
  /** kind "king" only: when a checkmate counts — a numeric world var at or
   *  above `min` (the screen state's `king.armed`); absent = unknown. */
  armed?: { path: string; min: number };
}

/** The one shared King of an event (C2): `hp` of `max` left, `fallen` ⇔
 *  `hp ≤ 0`. `id` is the king prop's id. */
export interface KingState {
  id: string;
  hp: number;
  max: number;
  fallen: boolean;
}

/** `world = Ry(yaw) · (scale · house) + offset`. */
export interface SpaceTransform {
  offset: Vec3;
  yaw: number;
  scale: number;
}

// ── Geometry (§1.2) ──────────────────────────────────────────────────

export type WallKind = "wall" | "fence" | "lintel" | "rail";

export interface WallSegment {
  floor: string;
  /** "x": the wall runs along x at z = c; "z": along z at x = c. */
  axis: "x" | "z";
  c: number;
  lo: number;
  hi: number;
  /** World y. */
  bottom: number;
  top: number;
  kind: WallKind;
}

/** One walkable floor (or a ceiling) of one room, holes cut for stairs. */
export interface FloorPlane {
  room: string;
  floor: string;
  kind: "floor" | "ceiling";
  /** World y. */
  y: number;
  poly: Vec2[];
  /** Stair rects as 4-point polygons. */
  holes: Vec2[][];
  outdoor: boolean;
  color?: string;
}

/** A stair's sloped quad. */
export interface Ramp {
  stair: string;
  from: string;
  to: string;
  up: Compass;
  rect: [number, number, number, number];
  /** `from`'s floor elevation (the foot). */
  low: number;
  /** `to`'s floor elevation (the head). */
  high: number;
  /** In plan order `[x0,z0] [x1,z0] [x1,z1] [x0,z1]`, each at its ramp height. */
  corners: [Vec3, Vec3, Vec3, Vec3];
}

export interface Located {
  floor: string;
  room: string | null;
}

/** A route waypoint (a door, a stair foot / head) — §1.2 "Route". */
export interface Portal {
  kind: "door" | "foot" | "head";
  /** The door or stair id. */
  id: string;
  pos: Vec3;
  rooms: string[];
}

// ── Validation ───────────────────────────────────────────────────────

export interface Validation {
  ok: boolean;
  problems: string[];
  /** The normalized map, when `ok`. */
  house?: HouseMap;
}

// ── Wire types (§2) ──────────────────────────────────────────────────

export type SpatialWorld = "vr" | "web";

/** A pose in house coordinates. */
export interface PlayerPose {
  p: Vec3;
  yaw: number;
  pitch: number;
}

/** `POST /api/spatial/pose` body. */
export interface PoseBody {
  p: Vec3;
  yaw: number;
  pitch?: number;
  t?: number;
}

export interface Assignment {
  /** Session id (public). */
  session: string;
  /** Session token (secret) — `x-loom-token` on the game's own calls. */
  token: string;
  /** The program. */
  guest: string;
  name: string;
  world: SpatialWorld;
  device: string;
  station: string | null;
  /** Corrupted — finding the duck releases them. */
  captured: boolean;
  duck: DuckSpot;
  spawn: Spawn;
  houseVersion: string;
  /** The program's profile picture: an `AvatarBook` key, served at
   *  `/e/<eventId>/api/avatar/<key>`; null / missing = no picture. */
  avatar?: string | null;
  /** This visit already hit the King: a re-scan after Leave, a director's
   *  end or a timeout is still the same visit until the duck is found, so
   *  ⚔ starts spent. Missing (an old server) = not yet. */
  kingHit?: boolean;
}

export interface PlayerState {
  session: string;
  guest: string;
  name: string;
  world: SpatialWorld;
  device: string;
  p: Vec3;
  yaw: number;
  pitch: number;
  room: string | null;
  floor: string;
  duck: DuckSpot;
  found: boolean;
  startedAt: number;
  /** The profile picture's avatar key (`/e/<eventId>/api/avatar/<key>`),
   *  resolved live; null / missing (an old server) = the plain capsule. */
  avatar?: string | null;
}

export type LeaveReason = "ended" | "found" | "timeout" | "replaced" | "reset";

export interface PoseUpdate {
  session: string;
  p: Vec3;
  yaw: number;
  pitch: number;
  room: string | null;
  floor: string;
}

/** `GET /api/spatial/stream` frames: event name → data. */
export interface SpatialFrames {
  /** `king`: the shared King (null = the map has none; missing = an old
   *  server, no shared King). */
  hello: { eventId: string; houseVersion: string; players: PlayerState[]; king?: KingState | null };
  join: { player: PlayerState };
  poses: { t: number; players: PoseUpdate[] };
  /** `captured`: the program is still captured after the find (C4b) — a
   *  find the story refused (the banishment): no egg, no release. */
  found: { session: string; guest: string; name: string; duck: DuckSpot; released: boolean; captured: boolean };
  leave: { session: string; reason: LeaveReason };
  house: { version: string };
  /** A map save moved (or re-dealt) a live player's duck. */
  duck: { session: string; duck: DuckSpot };
  reset: { kind: string };
  /** The shared King changed (a hit, a director's edit, a map swap). `by`:
   *  the display name of the guest whose hit changed it; null otherwise. */
  king: KingState & { by?: string | null };
  /** A live player's profile picture changed (or its lookup landed). */
  avatar: { session: string; avatar: string | null };
}

export type SpatialFrameName = keyof SpatialFrames;

/** A decoded stream frame, discriminated by `event`. */
export type SpatialFrame = {
  [K in SpatialFrameName]: { event: K; data: SpatialFrames[K] };
}[SpatialFrameName];

/** Where an event's map came from (`docs/loom-reinstall.md` §1.3): a
 *  director's save for this event, the project's map file snapshotted at
 *  launch (its active variant), or the show's file (`LOOM_HOUSE`). */
export type HouseSource = "event" | "project" | "show";

/** `GET /api/spatial/house`. */
export interface HouseResponse {
  house: HouseMap;
  version: string;
  source: HouseSource;
  /** The session's duck, on the session-token read. */
  duck?: DuckSpot;
  /** The shared King on the session-token read (null = none; missing = an old server). */
  king?: KingState | null;
}

/** `POST /api/spatial/king/hit` (200) and `POST /api/mod/spatial/king` (200). */
export interface KingHitResult {
  ok: true;
  king: KingState;
}

/** `POST /api/mod/spatial/house` (200). */
export interface SaveHouseResult {
  ok: true;
  version: string;
  warnings: string[];
}

/** One whole-map variant of an event (`house.json`, `house.shed.json`, …),
 *  `GET /api/mod/spatial/variants`. `name` is the map's own `name` (else
 *  the file's); `label` its `variant` field, when it has one; `ok` /
 *  `problems` are `validateHouse`'s verdict. */
export interface MapVariant {
  file: string;
  name: string;
  label?: string;
  active: boolean;
  ok: boolean;
  problems: string[];
}

/** `GET /api/mod/spatial/variants`. `from`: the project's snapshot, or the
 *  show file's directory (an event with no project map files). `edited`: a
 *  director's save is in force over the active variant (a switch drops it).
 *  `project`: the event belongs to a project ("Save to project" works).
 *  `version`: the map the event plays now — the `base` a switch confirmed
 *  off this list sends back (an older server leaves it out). */
export interface MapVariantsResponse {
  variants: MapVariant[];
  from: "project" | "show";
  edited: boolean;
  project: boolean;
  version?: string;
}

/** `POST /api/mod/spatial/variant` (200). `dropped`: a director's save was
 *  in force and is gone (the variant replaced it). */
export interface SwitchVariantResult extends SaveHouseResult {
  file: string;
  dropped: boolean;
}

/** `POST /api/mod/spatial/house/project` (200). */
export interface SaveToProjectResult {
  ok: true;
  file: string;
  version: string;
}

/** `GET /api/mod/spatial/stations` rows. */
export interface StationInfo {
  id: string;
  name: string;
  world: SpatialWorld;
  online: boolean;
  busy: { session: string; guest: string; name: string } | null;
}

/** `GET /api/mod/spatial/candidates` rows. */
export interface SpatialCandidate {
  id: string;
  name: string;
  captured: boolean;
  /** Marked by the story (restricted) but not yet captured: Play here
   *  begins their reinstallation. */
  restricted: boolean;
  location: string | null;
  /** The program's profile picture's avatar key; null / missing = none. */
  avatar?: string | null;
}

/** `POST /api/spatial/found` (200). */
export interface FoundResult {
  ok: true;
  released: boolean;
  already: boolean;
  /** Still captured after the find (C4): the story kept the program. */
  captured: boolean;
}
