//! (wave 39, C4) The game's post-processing — loaded lazily (`engine.ts`
//! imports it only once a tier wants it, so `low` never downloads it).
//! three's `EffectComposer`: the scene into a half-float target (4× MSAA on
//! `high`, WebGL2), `UnrealBloomPass` (the screens, the trail, Gerald, the
//! bulbs glow; half its resolution on `medium`), then one grade pass straight
//! to the screen: the renderer's own ACES filmic tone map (the same curve as
//! `low`'s, so a tier change doesn't shift the picture's exposure), sRGB,
//! a vignette and a light film grain, and on `high` a faint chromatic edge.

import { HalfFloatType, UnsignedByteType, Vector2, WebGLRenderTarget } from "three";
import type { Camera, Scene, WebGLRenderer } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { QualitySettings } from "./quality.ts";

/** The bloom: what glows (linear, before the tone map), how much, how wide. */
export const BLOOM = { threshold: 0.82, strength: { half: 0.55, full: 0.7 }, radius: 0.45 } as const;
/** The grade. */
export const GRADE = { vignette: 0.42, grain: 0.035, chroma: 0.006 } as const;

const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    exposure: { value: 1 },
    vignette: { value: 0 },
    grain: { value: 0 },
    chroma: { value: 0 },
    time: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float exposure;
    uniform float vignette;
    uniform float grain;
    uniform float chroma;
    uniform float time;
    varying vec2 vUv;

    // three's ACESFilmicToneMapping, so the post tiers match low's renderer tone map.
    vec3 rrtOdt(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 aces(vec3 color) {
      const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      color *= exposure / 0.6;
      color = outM * rrtOdt(inM * color);
      return clamp(color, 0.0, 1.0);
    }
    vec3 toSrgb(vec3 c) {
      vec3 lo = c * 12.92;
      vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
      return mix(lo, hi, step(vec3(0.0031308), c));
    }
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }
    void main() {
      vec2 c = vUv - 0.5;
      vec3 col;
      if (chroma > 0.0) {
        vec2 off = c * dot(c, c) * 4.0 * chroma;
        col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }
      col = toSrgb(aces(col));
      float r = length(c * vec2(1.0, 0.82));
      col *= 1.0 - vignette * smoothstep(0.28, 0.78, r);
      col += (hash(vUv * 917.0 + fract(time) * 61.0) - 0.5) * grain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export interface Post {
  render(dt: number): void;
  /** The canvas's CSS size (the pixel ratio is the renderer's). */
  setSize(w: number, h: number): void;
  /** (wave 49) The tone map's exposure, as `renderer.toneMappingExposure` on `low`. */
  setExposure(exposure: number): void;
  dispose(): void;
}

/** Can this context render to a half-float target (bloom needs the range)? */
function floatTargets(renderer: WebGLRenderer): boolean {
  const ext = renderer.extensions;
  return ext.has("EXT_color_buffer_float") || ext.has("EXT_color_buffer_half_float");
}

/** The pipeline for a tier (`s.post` true), at the renderer's size + pixel ratio. */
export function createPost(renderer: WebGLRenderer, scene: Scene, camera: Camera, s: QualitySettings): Post {
  const size = renderer.getSize(new Vector2());
  const pr = renderer.getPixelRatio();
  const float = floatTargets(renderer);
  const target = new WebGLRenderTarget(Math.max(1, Math.round(size.x * pr)), Math.max(1, Math.round(size.y * pr)), {
    type: float ? HalfFloatType : UnsignedByteType,
    samples: s.msaa,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  let bloom: UnrealBloomPass | null = null;
  if (s.bloom !== "off" && float) {
    const scale = s.bloom === "half" ? 0.5 : 1;
    bloom = new UnrealBloomPass(new Vector2(size.x * pr * scale, size.y * pr * scale), BLOOM.strength[s.bloom], BLOOM.radius, BLOOM.threshold);
    if (scale !== 1) {
      const set = bloom.setSize.bind(bloom);
      bloom.setSize = (w: number, h: number) => set(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
    }
    composer.addPass(bloom);
  }
  // The pass clones the uniforms: each pipeline has its own.
  const grade = new ShaderPass(GRADE_SHADER);
  const u = grade.material.uniforms;
  u["exposure"]!.value = renderer.toneMappingExposure;
  u["vignette"]!.value = s.film ? GRADE.vignette : 0;
  u["grain"]!.value = s.film ? GRADE.grain : 0;
  u["chroma"]!.value = s.chroma ? GRADE.chroma : 0;
  composer.addPass(grade);
  let time = 0;
  return {
    render(dt: number) {
      time += dt;
      u["time"]!.value = time;
      composer.render(dt);
    },
    setSize(w: number, h: number) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
    },
    setExposure(exposure: number) {
      u["exposure"]!.value = exposure;
    },
    dispose() {
      bloom?.dispose();
      grade.dispose();
      composer.dispose();
      target.dispose();
    },
  };
}
