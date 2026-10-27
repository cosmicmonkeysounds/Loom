// Wave 30: the Cue designer's pure side — the templates always write a look
// the server takes, and the preview replays a plan the way the bulbs would.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LAMP_SETTLED,
  LOOK_TEMPLATES,
  addLook,
  hexToRgb,
  lampCss,
  lookFloor,
  lookFromTemplate,
  miredsToHex,
  planLook,
  previewAt,
  previewLength,
  setLookMode,
  validateLights,
  type LightPlan,
  type LightsConfig,
} from "../src/index.ts";

const FIX = join(import.meta.dirname, "fixtures");
const lights = JSON.parse(readFileSync(join(FIX, "lights-basic.json"), "utf8")) as LightsConfig;

describe("look templates", () => {
  const targets = [["everywhere"], ["desk-lamp"], ["server-strip"], ["heart"], ["hall-group"]];
  for (const t of LOOK_TEMPLATES) {
    for (const speed of [0.5, 1, 2]) {
      it(`${t} at ${speed}× is a look validateLights takes, for any target`, () => {
        for (const to of targets) {
          const next: LightsConfig = { ...lights, looks: { ...lights.looks, tpl: lookFromTemplate(t, { to, speed, color: "#123456", color2: "#abcdef", floor: lookFloor(lights, null, to) }) } };
          const v = validateLights(next);
          expect(v.problems).toEqual([]);
          expect(v.warnings.filter((w) => w.startsWith('looks["tpl"]'))).toEqual([]);
        }
      });
    }
  }

  it("holds a safety light's floor", () => {
    expect(lookFloor(lights, null, ["everywhere"])).toBe(50);
    expect(lookFloor(lights, null, ["desk-lamp"])).toBe(0);
    expect(lookFromTemplate("blackout", { to: ["heart"], floor: 40 }).set).toEqual({ state: "ON", brightness: 40, transition: 1 });
    expect(lookFromTemplate("blackout", { to: ["desk-lamp"] }).set).toEqual({ state: "OFF", transition: 1 });
    expect(lookFromTemplate("alarm", { to: ["heart"], floor: 40 }).steps![1]!.set.brightness).toBe(40);
  });

  it("keeps the knobs it is given", () => {
    const pulse = lookFromTemplate("pulse", { to: ["heart", "heart"], color: "#ff0000" });
    expect(pulse.to).toEqual(["heart"]);
    expect(pulse.loop).toBe(true);
    expect(pulse.steps![0]!.set.color).toBe("#ff0000");
    expect(lookFromTemplate("pulse", { to: ["heart"], speed: 2 }).period).toBe(1500);
    expect(lookFromTemplate("cycle", { to: ["heart"], color2: "#00ff00" }).steps![1]!.set.color).toBe("#00ff00");
    expect(lookFromTemplate("flash", { to: ["heart"] }).then).toBe("restore");
  });
});

describe("the preview", () => {
  const plan = (name: string, l: LightsConfig = lights): LightPlan => planLook(l, null, name)!;

  it("colours: hex, mireds, and a lamp dimmed by its brightness", () => {
    expect(hexToRgb("#ff8000")).toEqual([255, 128, 0]);
    expect(hexToRgb("nope")).toEqual([255, 255, 255]);
    const warm = hexToRgb(miredsToHex(450));
    const cold = hexToRgb(miredsToHex(153));
    expect(warm[0]).toBe(255);
    expect(warm[2]).toBeLessThan(cold[2]);
    expect(lampCss({ brightness: 254, color: "#ff0000", effect: null })).toBe("#ff0000");
    expect(lampCss({ brightness: 0, color: "#ff0000", effect: null })).toBe("#140000");
  });

  it("fades a value over its transition, from wherever the lamp is", () => {
    const l = addLook({ ...lights, looks: {} }, "x", ["hall-group"]);
    if ("error" in l) throw new Error(l.error);
    const cfg: LightsConfig = { ...l.lights, looks: { x: { to: ["hall-group"], steps: [{ at: 0, set: { state: "ON", brightness: 254, color: "#ff0000", transition: 1 } }, { at: 2000, set: { state: "OFF", transition: 2 } }] } } };
    const p = plan("x", cfg);
    const at = (t: number) => previewAt(p, ["hall-group"], t)["hall-group"]!;
    expect(at(0).brightness).toBe(LAMP_SETTLED.brightness);
    expect(at(500).brightness).toBe(Math.round(LAMP_SETTLED.brightness + (254 - LAMP_SETTLED.brightness) / 2));
    expect(at(1000)).toEqual({ brightness: 254, color: "#ff0000", effect: null });
    expect(at(3000).brightness).toBe(127);
    expect(at(4000).brightness).toBe(0);
    expect(at(4000).color).toBe("#ff0000");
    expect(previewLength(p)).toBe(4000);
  });

  it("keeps a safety light at its floor (the plan is clamped)", () => {
    const p = plan("upstairs_off");
    const all = previewAt(p, ["server-room-rgb", "attic-bulb", "desk-lamp"], 60_000, {});
    expect(all["server-room-rgb"]).toEqual(LAMP_SETTLED);
    expect(all["attic-bulb"]!.brightness).toBe(0);
    const down = planLook({ ...lights, looks: { d: { to: ["heart"], set: { state: "OFF", transition: 0 } } } }, null, "d")!;
    expect(previewAt(down, ["server-room-rgb"], 10)["server-room-rgb"]!.brightness).toBe(40);
  });

  it("replays repeats and loops, and gives the light back after a restore look", () => {
    const loopy = { ...lights, looks: { p: lookFromTemplate("pulse", { to: ["desk-lamp"], color: "#00ff00" }) } };
    const p = plan("p", loopy);
    expect(previewLength(p)).toBe(null);
    const a = previewAt(p, ["desk-lamp"], 1500)["desk-lamp"]!;
    const b = previewAt(p, ["desk-lamp"], 1500 + 3000 * 40)["desk-lamp"]!;
    expect(a).toEqual(b);
    expect(a.brightness).toBe(254);
    const twice = { ...lights, looks: { r: { to: ["desk-lamp"], steps: [{ at: 0, set: { brightness: 254, transition: 0 } }, { at: 500, set: { brightness: 10, transition: 0 } }], period: 1000 } } };
    const r = plan("r", setLookMode(twice, "r", "repeat", 2));
    expect(r.period).toBe(1500); // a repeat on Zigbee is held to 1.5 s
    expect(previewAt(r, ["desk-lamp"], 1200)["desk-lamp"]!.brightness).toBe(10);
    expect(previewAt(r, ["desk-lamp"], 1600)["desk-lamp"]!.brightness).toBe(254);
    expect(previewAt(r, ["desk-lamp"], 2100)["desk-lamp"]!.brightness).toBe(10);
    expect(previewAt(r, ["desk-lamp"], 9000)["desk-lamp"]!.brightness).toBe(10);
    const flash = { ...lights, looks: { f: lookFromTemplate("flash", { to: ["desk-lamp"] }) } };
    const fp = plan("f", flash);
    const start = { "desk-lamp": { brightness: 30, color: "#0000ff", effect: null } };
    expect(previewAt(fp, ["desk-lamp"], 100, start)["desk-lamp"]!.brightness).toBe(254);
    expect(previewAt(fp, ["desk-lamp"], fp.period! + 1000, start)["desk-lamp"]).toEqual(start["desk-lamp"]);
  });

  it("draws the firmware effects roughly, and stops them", () => {
    const cfg: LightsConfig = { ...lights, looks: { e: { to: ["desk-lamp"], steps: [{ at: 0, set: { state: "ON", brightness: 200, effect: "okay" } }, { at: 3000, set: { effect: "blink" } }, { at: 3300, set: { effect: "stop_effect" } }] } } };
    const p = plan("e", cfg);
    expect(previewAt(p, ["desk-lamp"], 100)["desk-lamp"]).toEqual({ brightness: 254, color: "#00ff00", effect: "okay" });
    expect(previewAt(p, ["desk-lamp"], 2000)["desk-lamp"]!.effect).toBe(null);
    expect(previewAt(p, ["desk-lamp"], 3100)["desk-lamp"]).toMatchObject({ brightness: 0, effect: "blink" });
    expect(previewAt(p, ["desk-lamp"], 3400)["desk-lamp"]).toMatchObject({ brightness: 200, effect: null });
  });
});
