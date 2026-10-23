//! The map page's **💡 Lights** tab (wave 20, D7): the house lights' config
//! (`lights.json`) beside the plan — the fixtures (click to select, 💡 to
//! identify), the Zigbee2MQTT devices the house Mac's `lights` module
//! reports (the ones nobody placed yet first, **Pair new device** with its
//! countdown), zones (lit on the plan), and the **looks** the story's `cue X`
//! plays: targets, steps (on / brightness / colour / white / effect /
//! transition, Zigbee-safe spacing shown as you type), once / a few times /
//! loop / give the light back, ▶ Test look. Its own save (`base` → 409),
//! Save to project, Download JSON. Every edit is an op from `lights.ts`
//! handed to `commit` (one undo step each).

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { LIGHT_EFFECTS, LIGHT_MAX_REPEAT, resolveLightTargets, validateLights } from "@loom/house";
import type { HouseMap, LightEffect, LightLook, LightsConfig, LightState } from "@loom/house";
import { lightsConflictText, moduleBadge, type LightTestTarget, type LightsView, type Z2mDevice } from "./lights-api.ts";
import {
  addLightZone,
  addLook,
  addLookStep,
  capsText,
  deviceRows,
  duplicateLook,
  effectivePeriod,
  lastTint,
  lightTargetChip,
  lightTargetOptions,
  lookCoverage,
  lookMode,
  lookNameError,
  lookNameOf,
  lookProblems,
  minPeriod,
  minStepAt,
  pairSecondsLeft,
  patchLookStep,
  removeLightZone,
  removeLook,
  removeLookStep,
  renameLightZone,
  renameLook,
  setBoot,
  setLightZoneMember,
  setLookMode,
  setLookNote,
  setLookPeriod,
  setLookTargets,
  stepsOfLook,
  testable,
  type LightSave,
  type LightTargetKind,
  type LightTargetOption,
  type LookMode,
  type StatePatch,
} from "./lights.ts";
import type { SaveState, Selection } from "./edit.ts";
import { CommitText, Num } from "./Inspector.tsx";

/** How long *Pair new device* lets new Zigbee devices join (Z2M's own default is 254). */
export const PAIR_SECONDS = 120;

export interface LightsPanelProps {
  lights: LightsConfig;
  saved: LightsConfig | null;
  house: HouseMap;
  view: LightsView | null;
  loadedVersion: string | null;
  status: "loading" | "ok" | "missing" | "error";
  edit: boolean;
  dirty: boolean;
  lightSave: LightSave;
  mapBusy?: boolean;
  saveState: SaveState;
  /** The light selected on the plan (its device row offers "use for it"). */
  selected: string | null;
  commit: (l: LightsConfig) => void;
  onSave: () => void;
  onSaveToProject: () => void;
  onDownload: () => void;
  onReload: () => void;
  onTest: (t: LightTestTarget) => void;
  onPair: (seconds: number) => void;
  /** Arm the 💡 tool with this device: the next click on the plan places it. */
  onPlaceDevice: (d: Z2mDevice) => void;
  /** Give the selected light this device. */
  onUseDevice: (d: Z2mDevice) => void;
  onHighlight: (ids: readonly string[] | null) => void;
  onPick: (sel: Selection) => void;
  projectStatus: string | null;
}

const SOURCE_TEXT: Record<LightsView["source"], string> = {
  director: "a director's save",
  project: "the project's lights.json",
  env: "the LAN file (LOOM_LIGHTS)",
  default: "nothing configured yet",
};

const MODE_TEXT: Record<LookMode, string> = { once: "once", repeat: "a few times", loop: "loop until the next look", restore: "once, then give the light back" };

function Section({ title, count, children, open = true }: { title: string; count?: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="audio-section" open={open}>
      <summary>
        {title}
        {count !== undefined && <span className="muted"> · {count}</span>}
      </summary>
      <div className="audio-section-body">{children}</div>
    </details>
  );
}

const GROUPS: { kind: LightTargetKind; label: string }[] = [
  { kind: "everywhere", label: "Everywhere" },
  { kind: "zone", label: "Zones" },
  { kind: "location", label: "Story LOCATIONs" },
  { kind: "room", label: "Map rooms" },
  { kind: "fixture", label: "Lights" },
];

/** A target list as chips with an "+ add…" picker. */
function Targets({ value, options, disabled, onChange, empty = "nothing" }: { value: readonly string[]; options: readonly LightTargetOption[]; disabled: boolean; onChange: (to: string[]) => void; empty?: string }) {
  return (
    <span className="targets">
      {value.length === 0 && <span className="muted small">{empty}</span>}
      {value.map((t) => {
        const chip = lightTargetChip(options, t);
        return (
          <span key={t} className={`chip${chip.kind === null ? " unknown" : ` k-${chip.kind}`}`} title={chip.kind === null ? `“${t}” names no light, zone, room or LOCATION` : t}>
            {chip.text}
            {!disabled && (
              <button className="chip-x" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
                ×
              </button>
            )}
          </span>
        );
      })}
      {!disabled && (
        <select className="w98-input add-target" value="" aria-label="Add a target" onChange={(e) => e.target.value !== "" && onChange([...value, e.target.value])}>
          <option value="">+ add…</option>
          {GROUPS.map((g) => {
            const opts = options.filter((o) => o.kind === g.kind && !value.includes(o.value));
            return opts.length === 0 ? null : (
              <optgroup key={g.kind} label={g.label}>
                {opts.map((o) => (
                  <option key={`${o.kind}:${o.value}`} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      )}
    </span>
  );
}

const ago = (at: number, now: number): string => {
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
};
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function LightsPanel(p: LightsPanelProps) {
  const { lights, house, edit, commit } = p;
  const off = !edit;
  const [now, setNow] = useState(() => Date.now());
  const [newLook, setNewLook] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const { onHighlight } = p;
  useEffect(() => () => onHighlight(null), [onHighlight]);
  const options = useMemo(() => lightTargetOptions(lights, house, p.view?.locations ?? null), [lights, house, p.view]);
  const check = useMemo(() => validateLights(lights, house), [lights, house]);
  const coverage = lookCoverage(lights, p.view?.looks ?? []);
  const devices = p.view?.devices ?? [];
  const rows = deviceRows(devices, lights);
  const pairLeft = pairSecondsLeft(p.view?.pair ?? null, now);
  const badge = moduleBadge(p.view?.module ?? null, now);
  const busy = p.saveState.kind === "saving" || p.mapBusy === true;
  const plan = p.lightSave;
  const saveable = (plan.alone || plan.withMap) && !busy;
  const withMap = !plan.alone && plan.withMap;
  const reach = (to: readonly string[]) => resolveLightTargets(lights, house, to).fixtures;
  const savedLook = (name: string): boolean => p.saved !== null && JSON.stringify(p.saved.looks[name]) === JSON.stringify(lights.looks[name]);
  const selected = p.selected !== null ? lights.fixtures.find((f) => f.id === p.selected) : undefined;
  const tests = p.view?.tests ?? [];

  const createLook = (raw: string) => {
    const name = lookNameOf(raw);
    const r = addLook(lights, name, lights.zones.length > 0 ? [lights.zones[0]!.id] : lights.fixtures.length > 0 ? [lights.fixtures[0]!.id] : []);
    if ("error" in r) return r.error;
    commit(r.lights);
    setOpen(r.name);
    setNewLook("");
    return null;
  };
  const newLookError = newLook.trim() === "" ? null : lookNameError(lights, lookNameOf(newLook));

  return (
    <div className="audio-panel lights-panel">
      <div className="audio-head">
        <b>💡 House lights</b> <span className="muted">lights.json</span>
        {p.view !== null && (
          <span className="muted small">
            {" "}
            · from {SOURCE_TEXT[p.view.source]} · v{p.loadedVersion ?? p.view.version}
            {p.loadedVersion !== null && p.loadedVersion !== p.view.version && <b className="bad-text"> (the server's is v{p.view.version})</b>}
          </span>
        )}
        {p.dirty && <b className="small"> · unsaved</b>}
        <span className={`small ${badge.ok ? "good-text" : "bad-text"}`} title="stagehand's lights module on the house Mac: it plays the looks and the tests"> · {badge.text}</span>
        <div className="button-row">
          <button className="w98-button default" disabled={!saveable} onClick={p.onSave} title={plan.why !== null ? `Not now — ${plan.why}` : withMap ? "A light hangs in a room the saved map doesn't have yet: the map is saved first, then the lights" : "Save the lights to the event (the module follows at once)"}>
            {busy ? "Saving…" : withMap ? "💾 Save map + lights" : "💾 Save lights"}
          </button>
          <button className="w98-button small" disabled={p.status !== "ok" || p.dirty} onClick={p.onSaveToProject} title={p.dirty ? "Save the lights first" : "Write the lights into the project as lights.json — the next launch and every co-writer see them"}>
            Save to project
          </button>
          <button className="w98-button small" onClick={p.onDownload} title="Download the lights as lights.json">
            Download JSON
          </button>
          <button className="w98-button small" disabled={p.status === "loading"} onClick={p.onReload} title={p.dirty ? "Reload from the server (drops your light edits)" : "Reload from the server"}>
            Reload
          </button>
        </div>
        {p.projectStatus !== null && <div className="small">{p.projectStatus}</div>}
        {p.status === "missing" && <p className="audio-note bad-text">This server has no lights routes (it predates wave 20): lights can be drafted and downloaded, not saved or tested. The map still saves.</p>}
        {p.status === "error" && <p className="audio-note bad-text">Couldn't reach the lights config — showing the last one loaded.</p>}
        {p.dirty && plan.why !== null && p.status === "ok" && <p className="audio-note bad-text">Lights can't be saved yet: {plan.why}.</p>}
        {p.saveState.kind === "conflict" && (
          <div className="audio-note bad-text">
            {lightsConflictText(p.saveState.version)}
            <div className="button-row">
              <button className="w98-button default" onClick={p.onReload}>
                Reload the lights (discard my edits)
              </button>
            </div>
          </div>
        )}
        {p.saveState.kind === "error" && (
          <div className="audio-note bad-text">
            Lights not saved — {p.saveState.error}
            {p.saveState.problems.length > 0 && (
              <ul>
                {p.saveState.problems.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {p.saveState.kind === "ok" && <div className="audio-note good-text">Lights saved as v{p.saveState.version}.</div>}
      </div>

      <Section title="Getting a bulb working" open={lights.fixtures.length === 0 || lights.fixtures.some((f) => f.device === "")}>
        <ol className="small lights-steps">
          <li className={p.view?.module?.online === true ? "done" : ""}>The lights module is running on the house Mac ({badge.text}).</li>
          <li className={devices.length > 0 ? "done" : ""}>Pair the bulb: press <b>Pair new device</b> below, then reset the bulb (most bulbs: switch it off and on 5–6 times) — it shows up under Devices marked ★ new.</li>
          <li className={lights.fixtures.length > 0 ? "done" : ""}>Place it: <b>💡 Light</b> in the toolbar (or ★ new → Place it) and click where it hangs.</li>
          <li className={lights.fixtures.length > 0 && lights.fixtures.every((f) => f.device !== "") ? "done" : ""}>Give it its device (the inspector's device list), tick <b>safety light</b> if people see by it.</li>
          <li className={p.saved !== null && lights.fixtures.some((f) => testable(p.saved, f)) ? "done" : ""}>💾 Save, then <b>💡 Identify</b> and the colour swatches in the inspector. When it answers, write the looks and ▶ Test each.</li>
        </ol>
      </Section>

      <Section title="Lights" count={lights.fixtures.length}>
        {lights.fixtures.length === 0 && <p className="muted small">No lights placed. Use 💡 Light in the toolbar, or + Light here on a room.</p>}
        <ul className="light-rows">
          {lights.fixtures.map((f) => {
            const tint = lastTint(tests, f.id);
            const room = house.rooms.find((r) => r.id === f.room);
            return (
              <li key={f.id} className={`light-row${p.selected === f.id ? " on" : ""}`} onMouseEnter={() => onHighlight([f.id])} onMouseLeave={() => onHighlight(null)}>
                <button className="link" onClick={() => p.onPick({ kind: "light", id: f.id })} title="Select it on the plan">
                  <span className="dot" style={tint !== null ? { background: tint } : undefined} /> {f.name}
                </button>
                <span className="muted small">
                  {room?.label ?? `⚠ ${f.room}`} · {f.device === "" ? <b className="bad-text">no device</b> : f.device}
                  {f.safety === true && " · 🛡 safety"}
                </span>
                <button className="w98-button small" disabled={!testable(p.saved, f)} onClick={() => p.onTest({ fixture: f.id })} title={testable(p.saved, f) ? "Identify: the bulb pulses" : "Save it with its device first"}>
                  💡
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Devices (Zigbee2MQTT)" count={p.view?.devicesAt != null ? `reported ${ago(p.view.devicesAt, now)}` : "none reported"}>
        <div className="button-row">
          {pairLeft > 0 ? (
            <>
              <b className="pairing">📡 Pairing open · {clock(pairLeft)} left</b>
              <button className="w98-button small" onClick={() => p.onPair(0)}>
                Stop pairing
              </button>
            </>
          ) : (
            <button className="w98-button" disabled={p.status !== "ok"} onClick={() => p.onPair(PAIR_SECONDS)} title={`Let new Zigbee devices join for ${PAIR_SECONDS / 60} minutes (Zigbee2MQTT's permit join, through the lights module)`}>
              📡 Pair new device
            </button>
          )}
        </div>
        {pairLeft > 0 && <p className="audio-note small">Reset the bulb now (switch it off and on 5–6 times, a second each, or as its box says). It joins within a minute and appears here as ★ new. Rename it in Zigbee2MQTT if you like — the name here follows the list.</p>}
        {p.view?.module == null || !p.view.module.online ? <p className="audio-note bad-text small">The lights module isn't polling, so pairing and tests won't reach Zigbee: check stagehand's lights job on the house Mac.</p> : null}
        {rows.length === 0 && <p className="muted small">No devices reported yet. The module posts Zigbee2MQTT's device list when it starts and whenever it changes.</p>}
        <ul className="device-rows">
          {rows.map((r) => (
            <li key={r.device.friendly} className={!r.light ? "muted" : undefined}>
              <span>
                {r.light && r.placed.length === 0 && r.device.type !== "Group" && <b className="good-text">★ new </b>}
                <code>{r.device.friendly}</code>
              </span>
              <span className="small muted">
                {[r.device.vendor, r.device.model].filter((x) => x !== null).join(" ")} · {r.device.type === "Group" ? `group of ${r.device.members?.length ?? 0}` : capsText(r.device.caps)}
                {r.placed.length > 0 && ` · placed as ${r.placed.join(", ")}`}
              </span>
              {r.light && edit && (
                <span className="button-row tight">
                  {r.placed.length === 0 && (
                    <button className="w98-button small" onClick={() => p.onPlaceDevice(r.device)} title="Arm 💡 Light with this device: click where it hangs on the plan">
                      Place it
                    </button>
                  )}
                  {selected !== undefined && selected.device !== r.device.friendly && (
                    <button className="w98-button small" onClick={() => p.onUseDevice(r.device)} title={`Give ${selected.name} this device`}>
                      Use for {selected.name}
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Zones" count={lights.zones.length} open={lights.zones.length > 0}>
        {lights.zones.map((z) => (
          <div key={z.id} className="zone-row" onMouseEnter={() => onHighlight(z.fixtures)} onMouseLeave={() => onHighlight(null)}>
            <CommitText label={<span className="muted small">{z.id}</span>} value={z.name} disabled={off} onCommit={(v) => commit(renameLightZone(lights, z.id, v))} />
            <span className="zone-pick">
              {lights.fixtures.map((f) => (
                <label key={f.id} className="radio checkbox">
                  <input type="checkbox" checked={z.fixtures.includes(f.id)} disabled={off} onChange={(e) => commit(setLightZoneMember(lights, z.id, f.id, e.target.checked))} /> {f.name}
                </label>
              ))}
            </span>
            {edit && (
              <button className="w98-button small" onClick={() => commit(removeLightZone(lights, z.id))}>
                Delete zone
              </button>
            )}
          </div>
        ))}
        {edit && (
          <button className="w98-button small" onClick={() => commit(addLightZone(lights, "Zone").lights)}>
            + Zone
          </button>
        )}
      </Section>

      <Section title="Looks (the story's cue names)" count={Object.keys(lights.looks).length}>
        <label className="field">
          boot look <span className="muted small">(on the module's start and after a story reset)</span>
          <select className="w98-input" value={lights.boot ?? ""} disabled={off} onChange={(e) => commit(setBoot(lights, e.target.value === "" ? null : e.target.value))}>
            <option value="">— none —</option>
            {Object.keys(lights.looks).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {coverage.unwritten.length > 0 && (
          <div className="small">
            The story cues these with no look yet:{" "}
            {coverage.unwritten.map((n) => (
              <button key={n} className="w98-button small" disabled={off} onClick={() => createLook(n)} title={`Write the look the story's “cue ${n}” plays`}>
                + {n}
              </button>
            ))}
          </div>
        )}
        {edit && (
          <div className="num-row">
            <input className="w98-input" placeholder="new look, e.g. heart_wake" value={newLook} onChange={(e) => setNewLook(e.target.value)} onKeyDown={(e) => e.key === "Enter" && newLookError === null && newLook.trim() !== "" && createLook(newLook)} aria-label="New look's name" />
            <button className="w98-button small" disabled={newLook.trim() === "" || newLookError !== null} onClick={() => createLook(newLook)}>
              + Look
            </button>
            {newLookError !== null && <span className="bad-text small">{newLookError}</span>}
          </div>
        )}
        {Object.entries(lights.looks).map(([name, look]) => (
          <LookEditor
            key={name}
            name={name}
            look={look}
            lights={lights}
            open={open === name}
            onToggle={(o) => setOpen(o ? name : null)}
            options={options}
            off={off}
            cued={(p.view?.looks ?? []).includes(name)}
            problems={lookProblems(check.problems, name)}
            warnings={lookProblems(check.warnings, name)}
            reach={reach}
            saved={savedLook(name)}
            canTest={p.status === "ok"}
            commit={commit}
            onTest={() => p.onTest({ look: name })}
            onHighlight={onHighlight}
            onOpenName={setOpen}
          />
        ))}
      </Section>

      <Section title="Recent tests" count={tests.length} open={tests.length > 0}>
        {tests.length === 0 ? (
          <p className="muted small">None in the last minute.</p>
        ) : (
          <ul className="small">
            {[...tests].reverse().map((t) => (
              <li key={t.seq}>
                #{t.seq} · {t.look !== null ? `look ${t.look}` : t.set !== null ? `${t.fixture} ← ${describeState(t.set)}` : `identify ${t.fixture}`} · {t.by} · {ago(t.at, now)}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** "ON · 254 · #FF0000 · 0.3 s" */
export function describeState(s: LightState): string {
  return [s.state, s.brightness !== undefined ? `bri ${s.brightness}` : null, s.color ?? null, s.color_temp !== undefined ? `${s.color_temp} mired` : null, s.effect ?? null, s.transition !== undefined ? `${s.transition} s` : null].filter((x) => x !== null && x !== undefined).join(" · ");
}

function LookEditor(p: {
  name: string;
  look: LightLook;
  lights: LightsConfig;
  open: boolean;
  onToggle: (open: boolean) => void;
  options: readonly LightTargetOption[];
  off: boolean;
  cued: boolean;
  problems: string[];
  warnings: string[];
  reach: (to: readonly string[]) => string[];
  saved: boolean;
  canTest: boolean;
  commit: (l: LightsConfig) => void;
  onTest: () => void;
  onHighlight: (ids: readonly string[] | null) => void;
  onOpenName: (name: string) => void;
}) {
  const { name, look, lights, off, commit } = p;
  const steps = stepsOfLook(look);
  const mode = lookMode(look);
  const min = minPeriod(look, lights);
  const reached = p.reach(look.to);
  return (
    <details className={`look${p.problems.length > 0 ? " bad" : ""}`} open={p.open} onToggle={(e) => p.onToggle((e.currentTarget as HTMLDetailsElement).open)} onMouseEnter={() => p.onHighlight(reached)} onMouseLeave={() => p.onHighlight(null)}>
      <summary>
        <code>{name}</code> <span className="muted small">· {steps.length} step{steps.length === 1 ? "" : "s"} · {MODE_TEXT[mode]} · {reached.length} light{reached.length === 1 ? "" : "s"}</span>
        {!p.cued && <span className="muted small"> · not cued by the story</span>}
        {p.problems.length > 0 && <b className="bad-text small"> · ⚠ {p.problems.length}</b>}
      </summary>
      <div className="look-body">
        <CommitText
          label="name (the story's cue name)"
          value={name}
          disabled={off}
          onCommit={(v) => {
            const n = lookNameOf(v);
            if (lookNameError(lights, n, name) !== null) return;
            commit(renameLook(lights, name, n));
            p.onOpenName(n);
          }}
        />
        <div className="field">
          plays on <Targets value={look.to} options={p.options} disabled={off} onChange={(to) => commit(setLookTargets(lights, name, to))} />
        </div>
        <div className="num-row">
          <label className="num">
            ends
            <select className="w98-input" value={mode} disabled={off} onChange={(e) => commit(setLookMode(lights, name, e.target.value as LookMode, look.repeat ?? 2))}>
              {(Object.keys(MODE_TEXT) as LookMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_TEXT[m]}
                </option>
              ))}
            </select>
          </label>
          {mode === "repeat" && <Num label={`times (2–${LIGHT_MAX_REPEAT})`} value={look.repeat ?? 2} step={1} disabled={off} onChange={(v) => v !== null && commit(setLookMode(lights, name, "repeat", v))} />}
          {mode !== "once" && (
            <Num label={mode === "restore" ? "give back after ms" : "period ms"} value={look.period ?? null} step={100} placeholder={String(effectivePeriod(look))} disabled={off} onChange={(v) => commit(setLookPeriod(lights, name, v))} />
          )}
        </div>
        {min !== null && effectivePeriod(look) < min && <div className="bad-text small">At least {min} ms here, so Zigbee keeps up across the {mode === "restore" ? "give-back" : "wrap"}.</div>}
        <table className="steps">
          <thead>
            <tr>
              <th>at ms</th>
              <th>on</th>
              <th>bright</th>
              <th>colour</th>
              <th>white</th>
              <th>effect</th>
              <th>fade s</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {steps.map((s, i) => (
              <StepRow key={i} i={i} steps={steps} off={off} onPatch={(patch) => commit(patchLookStep(lights, name, i, patch))} onRemove={steps.length > 1 ? () => commit(removeLookStep(lights, name, i)) : null} />
            ))}
          </tbody>
        </table>
        {!off && (
          <button className="w98-button small" onClick={() => commit(addLookStep(lights, name))} title="A step after the last, far enough apart for a colour change">
            + Step
          </button>
        )}
        {p.problems.map((x, i) => (
          <div key={`p${i}`} className="bad-text small">
            ⚠ {x}
          </div>
        ))}
        {p.warnings.map((x, i) => (
          <div key={`w${i}`} className="muted small">
            ⓘ {x}
          </div>
        ))}
        <CommitText label="note" value={look.note ?? ""} disabled={off} onCommit={(v) => commit(setLookNote(lights, name, v))} />
        <div className="button-row">
          <button className="w98-button" disabled={!p.saved || !p.canTest} onClick={p.onTest} title={p.saved ? "The lights module plays it now" : "Save the lights first — the module plays the saved look"}>
            ▶ Test look{p.saved ? "" : " (save first)"}
          </button>
          {!off && (
            <>
              <button
                className="w98-button small"
                onClick={() => {
                  const d = duplicateLook(lights, name);
                  if (d !== null) {
                    commit(d.lights);
                    p.onOpenName(d.name);
                  }
                }}
              >
                Duplicate
              </button>
              <button className="w98-button small" onClick={() => window.confirm(`Delete the look “${name}”? The story's “cue ${name}” will then play nothing on the lights.`) && commit(removeLook(lights, name))}>
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </details>
  );
}

function StepRow({ i, steps, off, onPatch, onRemove }: { i: number; steps: ReturnType<typeof stepsOfLook>; off: boolean; onPatch: (p: { at?: number; set?: StatePatch }) => void; onRemove: (() => void) | null }) {
  const s = steps[i]!;
  const set = s.set;
  const earliest = minStepAt(steps, i);
  const early = i > 0 && s.at < earliest;
  return (
    <tr className={early ? "bad" : undefined}>
      <td>
        <Num label="" value={s.at} step={50} disabled={off} onChange={(v) => v !== null && onPatch({ at: v })} />
        {early && <div className="bad-text small">≥ {earliest}</div>}
        {s.to !== undefined && <div className="muted small">only {s.to.join(", ")}</div>}
      </td>
      <td>
        <select className="w98-input" value={set.state ?? ""} disabled={off} onChange={(e) => onPatch({ set: { state: e.target.value === "" ? null : (e.target.value as "ON" | "OFF") } })} aria-label="On / off">
          <option value="">—</option>
          <option value="ON">on</option>
          <option value="OFF">off</option>
        </select>
      </td>
      <td>
        <Num label="" value={set.brightness ?? null} step={10} placeholder="—" disabled={off} onChange={(v) => onPatch({ set: { brightness: v === null ? null : Math.max(0, Math.min(254, Math.round(v))) } })} />
      </td>
      <td>
        <span className="colour-cell">
          <input type="checkbox" checked={set.color !== undefined} disabled={off} aria-label="Set a colour" onChange={(e) => onPatch({ set: { color: e.target.checked ? "#FFFFFF" : null } })} />
          {set.color !== undefined && <input type="color" value={set.color.toLowerCase()} disabled={off} onChange={(e) => onPatch({ set: { color: e.target.value.toUpperCase() } })} aria-label="Colour" />}
        </span>
      </td>
      <td>
        <Num label="" value={set.color_temp ?? null} step={10} placeholder="mired" disabled={off} onChange={(v) => onPatch({ set: { color_temp: v === null ? null : Math.max(150, Math.min(500, Math.round(v))) } })} />
      </td>
      <td>
        <select className="w98-input" value={set.effect ?? ""} disabled={off} onChange={(e) => onPatch({ set: { effect: e.target.value === "" ? null : (e.target.value as LightEffect) } })} aria-label="Effect">
          <option value="">—</option>
          {LIGHT_EFFECTS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </td>
      <td>
        <Num label="" value={set.transition ?? null} step={0.1} placeholder="—" disabled={off} onChange={(v) => onPatch({ set: { transition: v === null ? null : Math.max(0, Math.min(30, v)) } })} />
      </td>
      <td>
        {!off && onRemove !== null && (
          <button className="w98-button small" onClick={onRemove} aria-label={`Remove step ${i + 1}`}>
            ×
          </button>
        )}
      </td>
    </tr>
  );
}
