//! A ghost's glitchy swarm: the program's profile picture, cut into shards
//! that crawl round the body's capsule (`AVATAR_HEIGHT`, the collider, which
//! is never drawn) and tear back into a face that stares at the camera.
//!
//! The picture and the layout are data; everything that moves is in the
//! vertex shader, one draw call per ghost, so a house of ghosts costs a Quest
//! or an old tablet almost nothing. Only the body's recent path (`SwarmTrail`,
//! so the shards trail it and pile up when it stops) and where it looks come
//! from the CPU. Motion runs at `SWARM_STEP_HZ` on a per-shard phase: dropped
//! frames, not animation. A storm (a sudden scatter, wrong pieces of the
//! picture, split colours) starts at most once per `SWARM_STORM_S`, under the
//! glitch's 3 Hz limit (`terminal/CLAUDE.md`).
//!
//! The shards are opaque and cut with `discard`, so a transparent picture
//! keeps its outline, nothing sorts, and nothing overdraws. With no picture
//! they are static in the ghost's tint.
//!
//! `reinstall/vr/game/swarm.gdshader` + `ghosts.gd` are the Godot port. The
//! layout's packing (`aHome` + `aSize` = the instance transform, `aCell` =
//! COLOR, `aRand` = INSTANCE_CUSTOM) comes from that side: Godot has only
//! those slots. Change both together.

import { DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Float32BufferAttribute, ShaderMaterial, Vector3 } from "three";
import type { Color, Texture } from "three";
import type { Vec3 } from "../types.ts";

/** The face: this many cells a side, the whole picture. */
export const SWARM_FACE_GRID = 9;
/** The slivers that make the body. */
export const SWARM_BODY_SHARDS = 120;
/** Every shard of a ghost. */
export const SWARM_SHARDS = SWARM_FACE_GRID * SWARM_FACE_GRID + SWARM_BODY_SHARDS;
/** The face's side and centre height (metres): a head a little too big. */
export const SWARM_FACE_SIZE = 0.56;
export const SWARM_FACE_Y = 1.5;
/** The capsule the shards hold to (metres): the collider's radius. */
export const SWARM_RADIUS = 0.22;
export const SWARM_HEIGHT = 1.6;
/** How often the shards move (Hz) — the stutter. */
export const SWARM_STEP_HZ = 11;
/** A storm's slot (seconds): at most one starts per slot. */
export const SWARM_STORM_S = 0.9;
/** The points of the body's path the shards follow. */
export const SWARM_TRAIL = 8;
/** Seconds between two points of the path: the slowest shard is ~0.5 s late. */
export const SWARM_TRAIL_STEP_S = 0.07;
/** A jump this long (metres) is a teleport, not a walk: the trail starts again. */
export const SWARM_TELEPORT_M = 3;
/** The shader's clock wraps here (seconds) so its floats stay fine all night. */
export const SWARM_TIME_WRAP = 3600;

export interface SwarmShard {
  /** At rest, on the body (metres, the feet at the origin). */
  home: Vec3;
  /** Its width and height (metres). */
  size: [number, number];
  /** Its piece of the picture: u, v (v up, from the bottom-left), width, height. */
  cell: [number, number, number, number];
  /** Four values in 0…1 — the last one + 1 on a face shard. */
  rand: [number, number, number, number];
}

/** A small LCG: the same layout every time, here and in `ghosts.gd`. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** How far a body sliver sits from the axis at height `y`: a thin figure with shoulders. */
export function swarmRadiusAt(y: number): number {
  const t = Math.max(0, Math.min(1, y / SWARM_HEIGHT));
  return SWARM_RADIUS * (0.45 + 0.55 * Math.sin(Math.PI * Math.pow(t, 1.6)));
}

/** Every shard, the face's first (row by row from the bottom), then the body's. */
export function swarmLayout(): SwarmShard[] {
  const next = lcg(0x51a7);
  const shards: SwarmShard[] = [];
  const g = SWARM_FACE_GRID;
  const side = SWARM_FACE_SIZE / g;
  for (let row = 0; row < g; row++) {
    for (let col = 0; col < g; col++) {
      // A face shard also has a place in the body, up among the shoulders.
      const a = next() * Math.PI * 2;
      const y = 0.7 + next() * 0.85;
      const r = swarmRadiusAt(y) * (0.6 + 0.6 * next());
      shards.push({
        home: [Math.cos(a) * r, y, Math.sin(a) * r],
        size: [side, side],
        cell: [col / g, row / g, 1 / g, 1 / g],
        rand: [next(), next(), next(), 1 + next() * 0.999],
      });
    }
  }
  const widths = [1 / 4, 1 / 6, 1 / 8, 1 / 12];
  const heights = [1 / 32, 1 / 24, 1 / 16, 1 / 8];
  for (let i = 0; i < SWARM_BODY_SHARDS; i++) {
    const a = next() * Math.PI * 2;
    const y = 0.04 + next() * (SWARM_HEIGHT - 0.1);
    const r = swarmRadiusAt(y) * (0.45 + 0.6 * next());
    const du = widths[Math.floor(next() * widths.length)]!;
    const dv = heights[Math.floor(next() * heights.length)]!;
    // Scan lines of the picture, a little under the face's scale.
    const k = SWARM_FACE_SIZE * (0.35 + 0.35 * next());
    shards.push({
      home: [Math.cos(a) * r, y, Math.sin(a) * r],
      size: [du * k, dv * k],
      cell: [next() * (1 - du), next() * (1 - dv), du, dv],
      rand: [next(), next(), next(), next() * 0.999],
    });
  }
  return shards;
}

/**
 * The body's recent path, as offsets from where it stands now: what makes
 * the swarm drag behind a walk. A teleport (a respawn) starts it again, so
 * no shard ever flies across the house.
 */
export class SwarmTrail {
  /** Offset of each point from the body now, nearest first (`SWARM_TRAIL` of them). */
  readonly offsets: Vec3[] = Array.from({ length: SWARM_TRAIL }, () => [0, 0, 0] as Vec3);
  private readonly past: Vec3[] = [];
  private since = 0;

  step(p: Vec3, dt: number): void {
    const last = this.past[0];
    const jumped = last !== undefined && Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > SWARM_TELEPORT_M;
    if (last === undefined || jumped) {
      this.past.length = 0;
      for (let i = 0; i < SWARM_TRAIL; i++) this.past.push([p[0], p[1], p[2]]);
      this.since = 0;
    } else {
      this.since += dt;
      if (this.since >= SWARM_TRAIL_STEP_S) {
        this.since %= SWARM_TRAIL_STEP_S;
        this.past.pop();
        this.past.unshift([p[0], p[1], p[2]]);
      }
    }
    for (let i = 0; i < SWARM_TRAIL; i++) {
      const at = i === 0 ? p : this.past[i]!;
      const o = this.offsets[i]!;
      o[0] = at[0] - p[0];
      o[1] = at[1] - p[1];
      o[2] = at[2] - p[2];
    }
  }
}

/** The quad + the per-shard data, for one ghost. */
export function swarmGeometry(): InstancedBufferGeometry {
  const geo = new InstancedBufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const shards = swarmLayout();
  const n = shards.length;
  const home = new Float32Array(n * 3);
  const size = new Float32Array(n * 2);
  const cell = new Float32Array(n * 4);
  const rand = new Float32Array(n * 4);
  shards.forEach((s, i) => {
    home.set(s.home, i * 3);
    size.set(s.size, i * 2);
    cell.set(s.cell, i * 4);
    rand.set(s.rand, i * 4);
  });
  geo.setAttribute("aHome", new InstancedBufferAttribute(home, 3));
  geo.setAttribute("aSize", new InstancedBufferAttribute(size, 2));
  geo.setAttribute("aCell", new InstancedBufferAttribute(cell, 4));
  geo.setAttribute("aRand", new InstancedBufferAttribute(rand, 4));
  geo.instanceCount = n;
  return geo;
}

const vertexShader = /* glsl */ `
#define TAU 6.2831853
attribute vec3 aHome;
attribute vec2 aSize;
attribute vec4 aCell;
attribute vec4 aRand;
uniform float uTime;
uniform float uSeed;
uniform float uPresent;
uniform float uFlip;
uniform vec3 uLook;
uniform vec3 uTrail[${SWARM_TRAIL}];
varying vec2 vUv;
varying float vBurn;

float hash(float n) { return fract(sin(n) * 43758.5453); }

vec3 trailAt(float lag) {
  float f = clamp(lag, 0.0, 1.0) * ${(SWARM_TRAIL - 1).toFixed(1)};
  int i = int(floor(f));
  return mix(uTrail[i], uTrail[i < ${SWARM_TRAIL - 1} ? i + 1 : i], f - floor(f));
}

void main() {
  float isFace = step(1.0, aRand.w);
  float r = aRand.w - isFace;
  float tick = floor(uTime * ${SWARM_STEP_HZ.toFixed(1)} + aRand.x * 3.0);
  float t = tick / ${SWARM_STEP_HZ.toFixed(1)};
  float slot = floor(uTime / ${SWARM_STORM_S.toFixed(2)} + uSeed);
  float storm = step(0.7, hash(slot * 1.37 + uSeed));

  // The body: each shard circles the axis in fits, some the wrong way.
  float radius = length(aHome.xz);
  float dir = aRand.y < 0.5 ? -1.0 : 1.0;
  float angle = atan(aHome.z, aHome.x) + dir * t * (0.4 + 1.4 * aRand.z);
  float y = aHome.y + 0.05 * sin(t * (1.0 + 3.0 * aRand.y) + aRand.z * TAU);
  radius *= 0.85 + 0.3 * hash(tick * 0.13 + aRand.y * 37.0);

  // A fifth of it runs down and crawls away over the floor.
  float drip = step(0.8, r) * (1.0 - isFace);
  if (drip > 0.5) {
    float p = fract(t * (0.1 + 0.2 * aRand.z) + aRand.x);
    y *= 1.0 - p * p;
    radius += p * p * p * 0.5;
  }

  // Late shards hang back along the path, the feet latest.
  float lag = (1.0 - y / ${SWARM_HEIGHT.toFixed(2)}) * 0.55 + aRand.y * 0.45;
  vec3 body = vec3(cos(angle) * radius, y, sin(angle) * radius) + trailAt(lag);

  // One in a hundred ticks a shard is somewhere else; in a storm, many.
  float away = step(1.0 - mix(0.01, 0.12, storm), hash(tick * 0.37 + aRand.y * 91.0));
  if (away > 0.5) {
    float a = hash(tick + aRand.z * 11.0) * TAU;
    float d = 0.3 + 0.7 * hash(tick * 0.71 + aRand.x * 5.0);
    body += vec3(cos(a) * d, (hash(tick * 0.23 + r) - 0.5) * 0.6, sin(a) * d);
  }
  body.x += storm * (hash(floor(y * 14.0) + tick * 0.5) - 0.5) * 0.3;

  vec4 view = modelViewMatrix * vec4(body, 1.0);

  // The face: tears together when something comes close, or when it feels
  // like it, and always towards the camera. Where it looks only leans it.
  vec3 headAt = vec3(0.0, ${SWARM_FACE_Y.toFixed(2)}, 0.0) + uLook * 0.12 + trailAt(0.1);
  vec4 head = modelViewMatrix * vec4(headAt, 1.0);
  float near = 1.0 - smoothstep(2.2, 4.6, length(head.xyz));
  float mood = smoothstep(0.15, 0.7, sin(t * 0.7 + uSeed * 3.0));
  float gather = clamp(max(mood, near) - 0.3 * storm, 0.0, 1.0);
  float g = isFace * smoothstep(aRand.y * 0.6, aRand.y * 0.6 + 0.4, gather);
  vec2 faceAt = (aCell.xy + aCell.zw * 0.5 - 0.5) * ${SWARM_FACE_SIZE.toFixed(2)};
  // Rows slide out of true, in bursts.
  float row = floor(aCell.y * ${SWARM_FACE_GRID.toFixed(1)} + 0.5);
  float rowTick = floor(uTime * ${SWARM_STEP_HZ.toFixed(1)});
  float tear = step(mix(0.9, 0.55, storm), hash(row * 3.1 + rowTick * 0.17 + uSeed));
  faceAt.x += tear * (hash(row + rowTick * 0.31) - 0.5) * 0.42;
  vec4 face = head + vec4(faceAt, aRand.z * 0.03, 0.0);
  view = mix(view, face, g);

  // A shard the ghost has dropped this frame collapses to nothing.
  float here = step(aRand.x * 0.999, uPresent);
  float big = 1.0 + (1.0 - g) * storm * step(0.8, aRand.z) * 1.5;
  view.xy += position.xy * aSize * big * here;
  gl_Position = projectionMatrix * view;

  // In a storm some shards show the wrong piece of the picture.
  float wrong = storm * step(0.65, hash(tick * 0.11 + aRand.z * 17.0));
  float left = wrong > 0.5 ? mod(aCell.x + hash(aRand.x * 23.0), 1.0 - aCell.z) : aCell.x;
  vec2 uv = vec2(left, aCell.y) + (position.xy + 0.5) * aCell.zw;
  vUv = vec2(uFlip < 0.0 ? 1.0 - uv.x : uv.x, uv.y);
  vBurn = wrong + (1.0 - wrong) * storm * step(0.8, aRand.y);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform float uWorn;
uniform vec3 uTint;
varying vec2 vUv;
varying float vBurn;

float noise(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 c;
  if (uWorn > 0.5) {
    vec4 tex = texture2D(uMap, vUv);
    if (tex.a < 0.4) discard;
    c = tex.rgb;
    if (vBurn > 0.5) {
      // The colours come apart.
      c.r = texture2D(uMap, vUv + vec2(0.04, 0.0)).r;
      c.b = texture2D(uMap, vUv - vec2(0.04, 0.0)).b;
    }
  } else {
    c = uTint * (0.25 + 0.75 * noise(floor(vUv * 48.0)));
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

export interface SwarmUniforms {
  uTime: { value: number };
  uSeed: { value: number };
  uPresent: { value: number };
  uFlip: { value: number };
  uLook: { value: Vector3 };
  uTrail: { value: Vector3[] };
  uMap: { value: Texture | null };
  uWorn: { value: number };
  uTint: { value: Color };
}

export function swarmMaterial(seed: number, tint: Color): ShaderMaterial & { uniforms: SwarmUniforms } {
  const uniforms: SwarmUniforms = {
    uTime: { value: 0 },
    uSeed: { value: seed },
    uPresent: { value: 1 },
    uFlip: { value: 1 },
    uLook: { value: new Vector3(0, 0, -1) },
    uTrail: { value: Array.from({ length: SWARM_TRAIL }, () => new Vector3()) },
    uMap: { value: null },
    uWorn: { value: 0 },
    uTint: { value: tint },
  };
  const m = new ShaderMaterial({ vertexShader, fragmentShader, uniforms: uniforms as unknown as ShaderMaterial["uniforms"], side: DoubleSide, toneMapped: false });
  m.name = "avatar:swarm";
  return m as ShaderMaterial & { uniforms: SwarmUniforms };
}
