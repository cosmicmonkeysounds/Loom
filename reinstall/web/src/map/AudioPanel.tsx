//! The map page's **Audio** tab (wave 17): the house speakers' config
//! (`audio.json`) beside the plan — the interface (device, the 16 inputs
//! with what each carries, the 16 outputs with the speakers on each), the
//! input → output routing matrix (tap a cell for 0 dB, a gain per cell),
//! zones (lit on the plan), every story sound's targets, the announcement
//! and TV voice targets, a Test per speaker / output, and its own save
//! (`base` → 409), Save to project and Download JSON. Every edit is an op
//! from `audio.ts` handed to `commit` (one undo step each).

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AUDIO_INPUT_KINDS, resolveTargets, roomById } from "@loom/house";
import type { AudioConfig, AudioInputKind, HouseMap } from "@loom/house";
import { audioConflictText, testAge, type AudioTestRow, type AudioView } from "./audio-api.ts";
import {
  addZone,
  cellGain,
  cueRows,
  inputLabel,
  outputLabel,
  outputUsers,
  patchInput,
  patchOutput,
  patchZone,
  removeZone,
  setAnnounce,
  setCell,
  setCueGain,
  setCueTargets,
  setDevice,
  setTvVoice,
  setZoneMember,
  targetChip,
  targetOptions,
  toggleCell,
  type SpeakerSave,
  type TargetKind,
  type TargetOption,
} from "./audio.ts";
import type { SaveState, Selection } from "./edit.ts";
import { CommitText, Num } from "./Inspector.tsx";

export interface AudioPanelProps {
  audio: AudioConfig;
  /** The speakers as last loaded / saved (Test needs a saved speaker). */
  saved: AudioConfig | null;
  house: HouseMap;
  /** The server's last answer (null: none yet / a server without the routes). */
  view: AudioView | null;
  /** The version the draft was loaded / saved as (the server's may be newer). */
  loadedVersion: string | null;
  /** `missing`: the server has no speaker routes; `error`: away. */
  status: "loading" | "ok" | "missing" | "error";
  edit: boolean;
  dirty: boolean;
  /** `validateAudio` passes on the draft. */
  valid: boolean;
  /** How the speakers can be saved now (alone, after the map, or why not). */
  speakerSave: SpeakerSave;
  /** The map is being saved (the speakers may follow it). */
  mapBusy?: boolean;
  saveState: SaveState;
  commit: (a: AudioConfig) => void;
  onSave: () => void;
  onSaveToProject: () => void;
  onDownload: () => void;
  onReload: () => void;
  onTest: (target: { speaker: string } | { out: number }) => void;
  /** Light these speakers on the plan (null: none). */
  onHighlight: (ids: readonly string[] | null) => void;
  /** A zone was pinned: show a floor its speakers stand on (when none is on the one shown). */
  onShowFloor?: (ids: readonly string[]) => void;
  onPick: (sel: Selection) => void;
  /** The project bar's status (Save to project). */
  projectStatus: string | null;
}

const SOURCE_TEXT: Record<AudioView["source"], string> = {
  director: "a director's save",
  project: "the project's audio.json",
  env: "the LAN file (LOOM_AUDIO)",
  default: "nothing configured yet (the default interface)",
};

const KIND_TEXT: Record<AudioInputKind, string> = { software: "software (house Mac / QLab)", mic: "mic", line: "line (a device)" };
const RATES = [44100, 48000, 88200, 96000];

/** A collapsible section, open by default, remembered while the tab is up. */
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

const GROUPS: { kind: TargetKind; label: string }[] = [
  { kind: "everywhere", label: "Everywhere" },
  { kind: "zone", label: "Zones" },
  { kind: "location", label: "Story LOCATIONs" },
  { kind: "room", label: "Map rooms" },
  { kind: "speaker", label: "Speakers" },
];

/** A target list as chips (× removes) with an "+ add…" picker grouped by kind. */
export function Targets({ value, options, disabled, onChange, empty = "nowhere" }: { value: readonly string[]; options: readonly TargetOption[]; disabled: boolean; onChange: (to: string[]) => void; empty?: string }) {
  return (
    <span className="targets">
      {value.length === 0 && <span className="muted small">{empty}</span>}
      {value.map((t) => {
        const chip = targetChip(options, t);
        return (
          <span key={t} className={`chip${chip.kind === null ? " unknown" : ` k-${chip.kind}`}`} title={chip.kind === null ? `“${t}” names no zone, room, LOCATION or speaker` : t}>
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
        <select
          className="w98-input add-target"
          value=""
          aria-label="Add a target"
          onChange={(e) => {
            if (e.target.value !== "") onChange([...value, e.target.value]);
          }}
        >
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

/** What a test row names. */
function testText(audio: AudioConfig, t: AudioTestRow): string {
  if (t.speaker !== null) return `speaker ${audio.speakers.find((s) => s.id === t.speaker)?.name ?? t.speaker}`;
  return `output ${t.out} (${outputLabel(audio, t.out ?? 0)})`;
}

export function AudioPanel(p: AudioPanelProps) {
  const { audio, house, edit, commit } = p;
  const [cell, setCellSel] = useState<{ in: number; out: number } | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, []);
  const options = useMemo(() => targetOptions(audio, house, p.view !== null && p.view.locations.length > 0 ? p.view.locations : null), [audio, house, p.view]);
  const rows = useMemo(() => cueRows(audio, p.view?.sounds ?? []), [audio, p.view]);
  const reach = (to: readonly string[]) => resolveTargets(audio, house, to).speakers;
  // A pinned zone stays lit; hovering anything else lights that for a moment.
  const hover = (ids: readonly string[] | null) => p.onHighlight(ids ?? pinnedIds);
  const { onHighlight } = p;
  const pinnedIds = pinned === null ? null : (audio.zones.find((z) => z.id === pinned)?.speakers ?? []);
  const pinnedKey = pinnedIds === null ? null : pinnedIds.join("|");
  useEffect(() => {
    onHighlight(pinnedKey === null ? null : pinnedKey.split("|").filter((x) => x !== ""));
  }, [pinnedKey, onHighlight]);
  useEffect(() => () => onHighlight(null), [onHighlight]);

  const nIn = audio.device.inputs;
  const nOut = audio.device.outputs;
  const ins = Array.from({ length: nIn }, (_, i) => i + 1);
  const outs = Array.from({ length: nOut }, (_, i) => i + 1);
  const savedIds = new Set(p.saved?.speakers.map((s) => s.id) ?? []);
  const off = !edit;
  const busy = p.saveState.kind === "saving" || p.mapBusy === true;
  const plan = p.speakerSave;
  const saveable = (plan.alone || plan.withMap) && !busy;
  /** A speaker stands in a room only the draft map has: the map goes first. */
  const withMap = !plan.alone && plan.withMap;
  const cellG = cell !== null ? cellGain(audio, cell.in, cell.out) : null;

  return (
    <div className="audio-panel">
      <div className="audio-head">
        <b>🔊 House speakers</b> <span className="muted">audio.json</span>
        {p.view !== null && (
          <span className="muted small">
            {" "}
            · from {SOURCE_TEXT[p.view.source]} · v{p.loadedVersion ?? p.view.version}
            {p.loadedVersion !== null && p.loadedVersion !== p.view.version && <b className="bad-text"> (the server's is v{p.view.version})</b>}
          </span>
        )}
        {p.dirty && <b className="small"> · unsaved</b>}
        <div className="button-row">
          <button
            className="w98-button default"
            disabled={!saveable}
            onClick={p.onSave}
            title={
              plan.why !== null
                ? `Not now — ${plan.why}`
                : withMap
                  ? "A speaker stands in a room the saved map doesn't have yet: the map is saved first, then the speakers"
                  : "Save the speakers to the event (the router follows at once)"
            }
          >
            {busy ? "Saving…" : withMap ? "💾 Save map + speakers" : "💾 Save speakers"}
          </button>
          <button className="w98-button small" disabled={p.status !== "ok" || p.dirty} onClick={p.onSaveToProject} title={p.dirty ? "Save the speakers first" : "Write the speakers into the project as audio.json — the next launch and every co-writer see them"}>
            Save to project
          </button>
          <button className="w98-button small" onClick={p.onDownload} title="Download the speakers as audio.json">
            Download JSON
          </button>
          <button className="w98-button small" disabled={p.status === "loading"} onClick={p.onReload} title={p.dirty ? "Reload from the server (drops your speaker edits)" : "Reload from the server"}>
            Reload
          </button>
        </div>
        {p.projectStatus !== null && <div className="small">{p.projectStatus}</div>}
        {p.status === "missing" && <p className="audio-note bad-text">This server has no speaker routes (it predates wave 17): the speakers can be drafted and downloaded, not saved. The map still saves.</p>}
        {p.dirty && plan.why !== null && p.status !== "missing" && <p className="audio-note bad-text">Speakers can't be saved yet: {plan.why}. 💾 still saves the map.</p>}
        {withMap && !busy && <p className="audio-note">A speaker stands in a room the saved map doesn't have yet — saving writes the map first, then the speakers.</p>}
        {p.status === "error" && <p className="audio-note bad-text">Couldn't reach the speaker config — showing the last one loaded.</p>}
        {p.saveState.kind === "conflict" && (
          <div className="audio-note bad-text">
            {audioConflictText(p.saveState.version)}
            <div className="button-row">
              <button className="w98-button default" onClick={p.onReload}>
                Reload the speakers (discard my edits)
              </button>
            </div>
          </div>
        )}
        {p.saveState.kind === "error" && (
          <div className="audio-note bad-text">
            Speakers not saved — {p.saveState.error}
            {p.saveState.problems.length > 0 && (
              <ul>
                {p.saveState.problems.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {p.saveState.kind === "ok" && <div className="audio-note good-text">Speakers saved as v{p.saveState.version}.</div>}
      </div>
      {audio.note !== undefined && audio.note !== "" && (
        <details className="audio-note">
          <summary>📝 {audio.note.length > 70 ? `${audio.note.slice(0, 68).trimEnd()}…` : audio.note}</summary>
          {audio.note.length > 70 && audio.note}
        </details>
      )}

      <Section title="Interface" count={`${nIn} in · ${nOut} out`}>
        <div className="num-row">
          <CommitText label="device (a CoreAudio name substring)" value={audio.device.name} disabled={off} placeholder="MOTU" onCommit={(v) => commit(setDevice(audio, { name: v.trim() }))} />
        </div>
        <div className="num-row">
          <Num label="inputs" value={nIn} step={1} disabled={off} onChange={(v) => v !== null && commit(setDevice(audio, { inputs: Math.round(v) }))} />
          <Num label="outputs" value={nOut} step={1} disabled={off} onChange={(v) => v !== null && commit(setDevice(audio, { outputs: Math.round(v) }))} />
          <label className="num">
            rate
            <select className="w98-input" value={audio.device.rate ?? 48000} disabled={off} onChange={(e) => commit(setDevice(audio, { rate: Number(e.target.value) }))}>
              {[...new Set([...RATES, audio.device.rate ?? 48000])].map((r) => (
                <option key={r} value={r}>
                  {r / 1000} kHz
                </option>
              ))}
            </select>
          </label>
        </div>
      </Section>

      <Section title="Speakers" count={audio.speakers.length}>
        {audio.speakers.length === 0 && <p className="muted small">None yet — 🔊 Speaker in the toolbar (Edit), then click where it hangs; or “+ Speaker here” on a room.</p>}
        <table className="audio-table">
          <tbody>
            {audio.speakers.map((s) => (
              <tr key={s.id} onMouseEnter={() => hover([s.id])} onMouseLeave={() => hover(null)}>
                <td>
                  <button className="linkish" onClick={() => p.onPick({ kind: "speaker", id: s.id })} title="Select it on the plan">
                    {s.name}
                  </button>
                  <div className="muted small">{roomById(house, s.room)?.label ?? `⚠ ${s.room}`}</div>
                </td>
                <td className="small">{s.out.length === 0 ? <span className="bad-text">no output</span> : s.out.map((ch) => <span key={ch} className="ch-badge" title={outputLabel(audio, ch)}>{ch}</span>)}</td>
                <td>
                  <button className="w98-button small" disabled={!savedIds.has(s.id) || p.status !== "ok"} onClick={() => p.onTest({ speaker: s.id })} title={savedIds.has(s.id) ? `A tone + “${s.name}” on it` : "Save the speakers first"}>
                    🔈
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Outputs" count="to the speakers">
        <table className="audio-table">
          <tbody>
            {outs.map((ch) => {
              const users = outputUsers(audio, ch);
              return (
                <tr key={ch} onMouseEnter={() => hover(users.map((s) => s.id))} onMouseLeave={() => hover(null)}>
                  <td className="ch">{ch}</td>
                  <td>
                    <LabelField value={outputLabel(audio, ch)} disabled={off} aria={`Output ${ch} label`} onCommit={(v) => commit(patchOutput(audio, ch, { label: v }))} />
                  </td>
                  <td className="small">
                    {users.length === 0 ? (
                      <span className="muted">no speaker</span>
                    ) : (
                      users.map((s) => (
                        <button key={s.id} className={`chip k-speaker${users.length > 1 ? " warn" : ""}`} onClick={() => p.onPick({ kind: "speaker", id: s.id })} title={users.length > 1 ? "More than one speaker on this output" : "Select it"}>
                          🔊 {s.name}
                        </button>
                      ))
                    )}
                  </td>
                  <td>
                    <button className="w98-button small" disabled={p.status !== "ok"} onClick={() => p.onTest({ out: ch })} title={`A tone + “output ${ch}” on it`}>
                      🔈
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section title="Inputs" count="what feeds the interface" open={false}>
        <table className="audio-table">
          <tbody>
            {ins.map((ch) => {
              const c = audio.inputs.find((x) => x.ch === ch);
              return (
                <tr key={ch}>
                  <td className="ch">{ch}</td>
                  <td>
                    <LabelField value={inputLabel(audio, ch)} disabled={off} aria={`Input ${ch} label`} onCommit={(v) => commit(patchInput(audio, ch, { label: v }))} />
                  </td>
                  <td>
                    <select className="w98-input" value={c?.kind ?? "line"} disabled={off} aria-label={`Input ${ch} kind`} onChange={(e) => commit(patchInput(audio, ch, { kind: e.target.value as AudioInputKind }))}>
                      {AUDIO_INPUT_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {KIND_TEXT[k]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section title="Routing" count={`${audio.routes.reduce((n, r) => n + r.out.length, 0)} patched · inputs × outputs`}>
        <p className="muted small">The interface's mixer: tap a cell to send that input to that output at 0 dB (tap again: off); the cell's gain is below. Software inputs played by the router reach speakers by their cues instead.</p>
        <div className="matrix-wrap">
          <div className="matrix" style={{ gridTemplateColumns: `minmax(6.5em, auto) repeat(${nOut}, 1.9em)` }} role="grid" aria-label="Routing matrix">
            <div className="corner muted small">in ↓ out →</div>
            {outs.map((o) => (
              <div key={`h${o}`} className={`mh${cell?.out === o ? " on" : ""}`} title={outputLabel(audio, o)}>
                {o}
              </div>
            ))}
            {ins.map((i) => (
              <MatrixRow key={i} i={i} outs={outs} audio={audio} cell={cell} off={off} onCell={(o) => {
                setCellSel({ in: i, out: o });
                if (!off) commit(toggleCell(audio, i, o));
              }} onFocus={(o) => setCellSel({ in: i, out: o })} />
            ))}
          </div>
        </div>
        {cell !== null && (
          <div className="num-row cell-gain">
            <span className="small">
              <b>{inputLabel(audio, cell.in)}</b> ({cell.in}) → <b>{outputLabel(audio, cell.out)}</b> ({cell.out}): {cellG === null ? "off" : `${cellG > 0 ? "+" : ""}${cellG} dB`}
            </span>
            <Num label="gain dB" value={cellG} step={1} placeholder="off" disabled={off} onChange={(v) => commit(setCell(audio, cell.in, cell.out, v))} />
          </div>
        )}
      </Section>

      <Section title="Zones" count={`${audio.zones.length} + everywhere`}>
        <p className="muted small">Groups of speakers a cue can name. “everywhere” is every speaker and needs no zone. Tap ◉ to keep a zone lit on the plan.</p>
        {audio.zones.map((z) => (
          <div key={z.id} className={`zone-row${pinned === z.id ? " on" : ""}`} onMouseEnter={() => hover(z.speakers)} onMouseLeave={() => hover(null)}>
            <div className="zone-head">
              <button className={`w98-button small${pinned === z.id ? " pressed" : ""}`} aria-pressed={pinned === z.id} onClick={() => {
                  setPinned(pinned === z.id ? null : z.id);
                  if (pinned !== z.id) p.onShowFloor?.(z.speakers);
                }} title="Light it on the plan">
                ◉
              </button>
              <LabelField value={z.name} disabled={off} aria={`Zone ${z.id} name`} onCommit={(v) => commit(patchZone(audio, z.id, { name: v }))} />
              <code className="small">{z.id}</code>
              {!off && (
                <button className="w98-button small" onClick={() => commit(removeZone(audio, z.id))} title="Delete the zone (cues naming it lose it)">
                  ✕
                </button>
              )}
            </div>
            <div className="zone-members">
              {audio.speakers.length === 0 && <span className="muted small">No speakers yet.</span>}
              {audio.speakers.map((s) => (
                <label key={s.id} className="radio checkbox small">
                  <input type="checkbox" checked={z.speakers.includes(s.id)} disabled={off} onChange={(e) => commit(setZoneMember(audio, z.id, s.id, e.target.checked))} /> {s.name}
                </label>
              ))}
            </div>
          </div>
        ))}
        {!off && (
          <button className="w98-button small" onClick={() => commit(addZone(audio, `Zone ${audio.zones.length + 1}`).audio)}>
            + Zone
          </button>
        )}
      </Section>

      <Section title="Story sounds" count={`${rows.filter((r) => r.inStory).length} in the story`}>
        <p className="muted small">Where each <code>sound X</code> plays. With no targets the router uses the line's <code>in &lt;Place&gt;</code> / <code>rooms:</code>, else the beat's setting.{p.view === null || p.view.sounds.length === 0 ? " (No story loaded: only the cues already in the file.)" : ""}</p>
        <table className="audio-table cues">
          <tbody>
            {rows.map((r) => {
              const to = r.cue?.to ?? [];
              return (
                <tr key={r.name} className={r.inStory ? undefined : "stale"} onMouseEnter={() => hover(reach(to))} onMouseLeave={() => hover(null)}>
                  <td>
                    <code>{r.name}</code>
                    {!r.inStory && <div className="muted small">not in the story</div>}
                  </td>
                  {r.chime ? (
                    // The chime rings with the announcements: its speakers are theirs (LA-2).
                    <td colSpan={2} className="muted small">
                      <span>rings with the announcements: its speakers are the ones under Announcements below</span>
                      {r.cue !== null && (
                        <button type="button" className="small" disabled={off} onClick={() => commit(setCueTargets(audio, r.name, []))}>
                          Drop the unused cue
                        </button>
                      )}
                    </td>
                  ) : (
                    <>
                      <td>
                        <Targets value={to} options={options} disabled={off} empty="(the line's room / the beat's setting)" onChange={(next) => commit(setCueTargets(audio, r.name, next))} />
                      </td>
                      <td className="gain">
                        {r.cue !== null && <Num label="dB" value={r.cue.gain ?? 0} step={1} disabled={off} onChange={(v) => commit(setCueGain(audio, r.name, v))} />}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section title="Announcements and the TV voice">
        <div className="field" onMouseEnter={() => hover(reach(audio.announce?.to ?? []))} onMouseLeave={() => hover(null)}>
          house announcements (<code>do announce</code>, when the router plays them)
          <Targets value={audio.announce?.to ?? []} options={options} disabled={off} empty="(the router's default)" onChange={(to) => commit(setAnnounce(audio, to))} />
          <label className="radio checkbox small">
            <input type="checkbox" checked={audio.announce?.chime ?? true} disabled={off} onChange={(e) => commit(setAnnounce(audio, audio.announce?.to ?? [], e.target.checked))} /> chime first
          </label>
        </div>
        <div className="field" onMouseEnter={() => hover(reach(audio.voice?.tv ?? []))} onMouseLeave={() => hover(null)}>
          the TV's voice also reaches <span className="muted small">(set on the interface's mixer today)</span>
          <Targets value={audio.voice?.tv ?? []} options={options} disabled={off} empty="(only the TV)" onChange={(to) => commit(setTvVoice(audio, to))} />
        </div>
      </Section>

      <Section title="Recent tests" count={p.view?.tests.length ?? 0} open={(p.view?.tests.length ?? 0) > 0}>
        {(p.view?.tests ?? []).length === 0 ? (
          <p className="muted small">Tests sent from here (🔈) show for a minute; the router on the house Mac plays them.</p>
        ) : (
          <ul className="test-list small">
            {[...(p.view?.tests ?? [])].reverse().map((t) => (
              <li key={t.seq}>
                #{t.seq} · {testText(audio, t)} · {testAge(t.at, now)}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** One input row of the matrix (its cells as buttons). */
function MatrixRow({ i, outs, audio, cell, off, onCell, onFocus }: { i: number; outs: number[]; audio: AudioConfig; cell: { in: number; out: number } | null; off: boolean; onCell: (o: number) => void; onFocus: (o: number) => void }) {
  return (
    <>
      <div className={`mr${cell?.in === i ? " on" : ""}`} title={inputLabel(audio, i)}>
        <span className="ch">{i}</span> {inputLabel(audio, i)}
      </div>
      {outs.map((o) => {
        const g = cellGain(audio, i, o);
        const sel = cell?.in === i && cell.out === o;
        return (
          <button
            key={o}
            className={`mc${g !== null ? " routed" : ""}${sel ? " sel" : ""}${cell !== null && (cell.in === i || cell.out === o) ? " cross" : ""}`}
            aria-pressed={g !== null}
            aria-label={`${inputLabel(audio, i)} to ${outputLabel(audio, o)}: ${g === null ? "off" : `${g} dB`}`}
            title={`${i} ${inputLabel(audio, i)} → ${o} ${outputLabel(audio, o)}: ${g === null ? "off" : `${g} dB`}${off ? "" : " (tap to toggle)"}`}
            onClick={() => onCell(o)}
            onFocus={() => onFocus(o)}
          >
            {g === null ? "" : g === 0 ? "●" : g > 0 ? `+${g}` : g}
          </button>
        );
      })}
    </>
  );
}

/** A label field that commits on Enter / blur. */
function LabelField({ value, disabled, aria, onCommit }: { value: string; disabled: boolean; aria: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="w98-input label-field"
      value={text}
      disabled={disabled}
      aria-label={aria}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        else if (e.key === "Escape") setText(value);
      }}
    />
  );
}
