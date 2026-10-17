//! The house map page (`/reinstall/map`, §3): the plan of one floor at a
//! time — rooms, walls, doors, stairs, props, the terminals with their view
//! cones, the duck spots and the spawn — with every program in the
//! simulation live on it (and the duck it is hunting). Directors switch to
//! **Edit** to build the house from a survey: floors, rooms and yards
//! drawn as rectangles (or typed W × D), doors clicked onto walls (their
//! rooms read off the plan), stairs, the tent cut out of the yard on its
//! own; and to place terminals / duck spots / the spawn. Every draft is
//! checked live — `validateHouse`, a walk from the spawn to every duck
//! spot, the story's LOCATIONs — undo / redo cover every edit, the JSON
//! is a tab away, and a save goes to the event (`POST /api/mod/spatial/house`
//! with the `base` version it loaded; a 409 offers copy / reload).
//!
//! This file holds the state; the plan is `Canvas.tsx`, the toolbar
//! `Toolbar.tsx`, the fields `Inspector.tsx`, the other tabs and the
//! problem list `Panels.tsx`, and every edit a pure op (`edit.ts`,
//! `doors.ts`, `yards.ts`, `structure.ts`).

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { polyBounds, validateHouse } from "@loom/house";
import type { HouseMap, PlayerState, Vec2 } from "@loom/house";
import { Setup } from "../app.tsx";
import { fetchHouse, fetchLocations, saveHouse, streamUrl, tokenAlive, type LoadedHouse } from "../api.ts";
import { baseOf, dropConfig, loadConfig, saveConfig, type ReinstallConfig } from "../config.ts";
import { applyFrame, houseVersionOf, openSpatialStream } from "../spatial.ts";
import { Desktop, Window } from "../wizard.tsx";
import { Canvas } from "./Canvas.tsx";
import { locationProblems, structuredProblems, walkabilityProblems, type StoryLocation } from "./check.ts";
import { moveDoorAlong } from "./doors.ts";
import { draftFromText, editableSource, moveRoom, moveTo, positionOf, remoteMapAction, removeThing, saveBaseOf, saveStateOf, setYaw, yawOf, type SaveState, type Selection } from "./edit.ts";
import { EMPTY_HISTORY, pushed, redone, undone, type History } from "./history.ts";
import { Inspector } from "./Inspector.tsx";
import { JsonTab, PlayersTab, ProblemsPanel, TerminalsTab } from "./Panels.tsx";
import { snap2, SNAP_STEPS } from "./plan.ts";
import { addFloor, addRoom, blankHouse, cascadeOf, deleteRoomText, deletesWith, floorDefaults, moveStair, placeRect, removeRoom } from "./structure.ts";
import { flapsAdded, yardOf } from "./yards.ts";
import { Toolbar } from "./Toolbar.tsx";
import { checkModCode, editorTakesKey, MapUnlock } from "./unlock.ts";
import { floorOfSelection, selectionExists, TOOLS, type EditMode, type MapToolbarContext, type Tool } from "./tools.ts";

/** three.js only loads when the 3D preview is opened. */
const Preview3D = lazy(() => import("./Preview3D.tsx"));

export interface MapAppProps {
  /** Extra toolbar controls (the project bar), handed the editor's state. */
  toolbarExtras?: (ctx: MapToolbarContext) => ReactNode;
}

export function MapApp({ toolbarExtras }: MapAppProps = {}) {
  const [config, setConfig] = useState<ReinstallConfig | null>(() => loadConfig());
  const [notice, setNotice] = useState<string | null>(null);
  if (config === null) {
    return (
      <Desktop>
        <Setup
          current={null}
          notice={notice ?? "The map needs this device set up with the moderator passcode."}
          onDone={(c) => {
            saveConfig(c);
            setConfig(c);
          }}
          onForget={() => {}}
        />
      </Desktop>
    );
  }
  return (
    <MapEditor
      config={config}
      {...(toolbarExtras !== undefined ? { toolbarExtras } : {})}
      onRevoked={() => {
        dropConfig();
        setNotice("This device's access was revoked — enter the moderator passcode again.");
        setConfig(null);
      }}
    />
  );
}

/** A key landing in a field that takes text (not a checkbox or a button). */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) return true;
  return target instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "color", "range"].includes(target.type);
}

type Tab = "inspect" | "terminals" | "players" | "json";

const stringify = (h: HouseMap): string => JSON.stringify(h, null, 2);

/** The snap step a director picked last, per device (a convenience: never required). */
const SNAP_KEY = "loom-reinstall-map-snap";
function loadSnap(): number {
  try {
    const v = Number(window.localStorage.getItem(SNAP_KEY));
    return (SNAP_STEPS as readonly number[]).includes(v) ? v : 0.05;
  } catch {
    return 0.05;
  }
}

function MapEditor({ config, onRevoked, toolbarExtras }: { config: ReinstallConfig; onRevoked: () => void; toolbarExtras?: (ctx: MapToolbarContext) => ReactNode }) {
  const base = baseOf(config);
  const [loaded, setLoaded] = useState<LoadedHouse | null>(null);
  const [saved, setSaved] = useState<HouseMap | null>(null);
  const [draft, setDraft] = useState<HouseMap | null>(null);
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<string | null>(null);
  const [floor, setFloor] = useState("");
  const [edit, setEdit] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [snapStep, setSnapStep] = useState(loadSnap);
  const [sel, setSel] = useState<Selection | null>(null);
  const [tab, setTab] = useState<Tab>("inspect");
  const [players, setPlayers] = useState<ReadonlyMap<string, PlayerState>>(new Map());
  const [live, setLive] = useState(false);
  const [remoteChanged, setRemoteChanged] = useState(false);
  /** The server's map version as last announced (`hello` / `house` frames). */
  const [remoteVersion, setRemoteVersion] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [copied, setCopied] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [locations, setLocations] = useState<StoryLocation[] | null>(null);
  const [view3d, setView3d] = useState(false);
  const saving = useRef(false);
  /** The passcode re-check before this page load's first write (W-15). */
  const lock = useMemo(() => new MapUnlock((code) => checkModCode(code, config.eventId)), [config.eventId]);
  const [asking, setAsking] = useState<{ round: number; error: string | null; answer: (code: string | null) => void } | null>(null);
  const askingRef = useRef(false);
  askingRef.current = asking !== null;
  const unlock = useCallback(async () => {
    let round = 0;
    // The dialog stays up while a code is checked; a wrong one asks again in it.
    const ok = await lock.ensure((error) => new Promise<string | null>((answer) => setAsking({ round: ++round, error, answer })));
    setAsking(null);
    return ok;
  }, [lock]);
  const versionRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  /** The draft and history as of the last render — edits arrive from
   *  event handlers that may run between renders. */
  const draftRef = useRef<HouseMap | null>(null);
  draftRef.current = draft;
  const historyRef = useRef(history);
  historyRef.current = history;

  const loadedRef = useRef<LoadedHouse | null>(null);
  const load = useCallback(async () => {
    const l = await fetchHouse(base, config.token);
    // A blip on a reload never swaps the event's map for the stand-in.
    if (l.source === "bundled" && loadedRef.current !== null && loadedRef.current.source !== "bundled") return;
    loadedRef.current = l;
    setLoaded(l);
    versionRef.current = l.version;
    setSaved(l.house);
    setDraft(l.house);
    setText(stringify(l.house));
    setTextError(null);
    setHistory(EMPTY_HISTORY);
    setRemoteChanged(false);
    setSaveState((s) => (s.kind === "conflict" ? { kind: "idle" } : s));
    setFloor((f) => (l.house.floors.some((x) => x.id === f) ? f : (l.house.floors[0]?.id ?? "")));
    void fetchLocations(config).then(setLocations);
  }, [base, config]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  dirtyRef.current = dirty || textError !== null;

  // The live players, and the map changing under us.
  useEffect(() => {
    const s = openSpatialStream(streamUrl(base, config.token, `Map · ${config.name}`), {
      onFrame: (f) => {
        setPlayers((p) => applyFrame(p, f));
        // A save elsewhere (`house`), or a (re)connect (`hello`): a missed
        // save, or a page that came up on the bundled stand-in, catches up.
        const announced = houseVersionOf(f);
        if (announced !== null) setRemoteVersion(announced);
        const act = remoteMapAction(announced, versionRef.current, { saving: saving.current, dirty: dirtyRef.current });
        if (act === "warn") setRemoteChanged(true);
        else if (act === "reload") void load();
      },
      onState: setLive,
      // A refused stream may only be a server that is away: ask before
      // forgetting the device's access.
      onDead: () => void tokenAlive(config).then((ok) => !ok && onRevoked()),
    });
    return () => s.close();
  }, [base, config, load, onRevoked]);

  const validation = useMemo(() => (draft === null ? null : validateHouse(draft)), [draft]);
  // The walk check needs a valid map (`route` assumes one); it is the heavy part, so only on a changed valid map.
  const walk = useMemo(() => (validation?.ok && validation.house !== undefined ? walkabilityProblems(validation.house) : null), [validation]);
  /** Only the event's own map (or the show's, served by the server) is editable. */
  const editable = loaded !== null && editableSource(loaded.source);
  useEffect(() => {
    if (!editable) setEdit(false);
  }, [editable]);
  useEffect(() => {
    if (!edit) setTool("select");
  }, [edit]);
  useEffect(() => {
    try {
      window.localStorage.setItem(SNAP_KEY, String(snapStep));
    } catch {
      /* a convenience only */
    }
  }, [snapStep]);

  /** Apply an edit: `push` makes a new undo step, `replace` updates the running drag's. */
  const apply = useCallback((next: HouseMap, mode: EditMode = "push") => {
    const cur = draftRef.current;
    if (cur === null || next === cur) return;
    if (mode === "push") {
      const h = pushed(historyRef.current, cur);
      historyRef.current = h;
      setHistory(h);
    }
    draftRef.current = next;
    setDraft(next);
    setText(stringify(next));
    setTextError(null);
    setSaveState((s) => (s.kind === "ok" ? { kind: "idle" } : s));
    // A door nobody placed is said out loud: the cut gave a room a flap into the yard.
    const flaps = flapsAdded(cur, next);
    if (flaps.length > 0) {
      const name = (id: string | null) => (id === null ? "outside" : (next.rooms.find((r) => r.id === id)?.label ?? id));
      setNotice(`Added ${flaps.map((d) => `a door from ${name(d.a)} into ${name(d.b)}`).join(" and ")} (a tent flap) — move or delete it if that's not where the way in is.`);
    }
  }, []);

  const step = useCallback((dir: "undo" | "redo") => {
    const cur = draftRef.current;
    if (cur === null) return;
    const r = (dir === "undo" ? undone : redone)(historyRef.current, cur);
    if (r === null) return;
    historyRef.current = r.history;
    setHistory(r.history);
    draftRef.current = r.present;
    setDraft(r.present);
    setText(stringify(r.present));
    setTextError(null);
  }, []);

  // A selection the edit (or the undo) took away goes; the floor follows the history too.
  useEffect(() => {
    if (draft === null) return;
    if (sel !== null && !selectionExists(draft, sel)) setSel(null);
    if (!draft.floors.some((f) => f.id === floor)) setFloor(draft.floors[0]?.id ?? "");
  }, [draft, sel, floor]);

  /** Back to the saved map — the draft *and* the JSON text (which may be broken while the draft is not). */
  const revert = () => {
    if (saved === null) return;
    apply(saved);
    setText(stringify(saved));
    setTextError(null);
  };

  const save = async (): Promise<string | null> => {
    if (draft === null || !validation?.ok || !editable) return null;
    if (!(await unlock())) return null;
    setSaveState({ kind: "saving" });
    saving.current = true;
    try {
      // Based on the version this page loaded: a director who saved in
      // between gets a 409 here instead of being silently overwritten.
      const r = await saveHouse(config, validation.house ?? draft, saveBaseOf(loadedRef.current));
      if (r.ok) {
        versionRef.current = r.result.version;
        setSaved(validation.house ?? draft);
        setDraft(validation.house ?? draft);
        // The next save is based on the version this one made.
        const cur = loadedRef.current;
        if (cur !== null) {
          const next: LoadedHouse = { ...cur, version: r.result.version, source: "event" };
          loadedRef.current = next;
          setLoaded(next);
        }
      } else {
        if (r.status === 401 || r.status === 403) onRevoked();
        // The conflict panel says it all (and offers the reload).
        if (r.conflict) setRemoteChanged(false);
      }
      setSaveState(saveStateOf(r));
      return r.ok ? r.result.version : null;
    } catch (e) {
      setSaveState({ kind: "error", error: (e as Error).message, problems: [] });
      return null;
    } finally {
      saving.current = false;
    }
  };

  const select = useCallback((s: Selection | null) => {
    setSel(s);
    if (s !== null) setTab("inspect");
  }, []);

  /** Select a thing, switching to its floor. */
  const reveal = useCallback(
    (s: Selection) => {
      const h = draftRef.current;
      if (h === null) return;
      const f = floorOfSelection(h, s);
      if (f !== "") setFloor(f);
      select(s);
    },
    [select],
  );

  const deleteSelected = useCallback(() => {
    const h = draftRef.current;
    if (h === null || sel === null) return;
    if (sel.kind === "room") {
      const room = h.rooms.find((r) => r.id === sel.id);
      if (room === undefined) return;
      // A yard goes whole: every piece it was cut into.
      const c = cascadeOf(h, deletesWith(h, sel.id));
      if (c.spawn) return setNotice(`The spawn is in this ${room.outdoor ? "yard" : "room"} — move the spawn to another room first.`);
      if (!window.confirm(deleteRoomText(room, c))) return;
      const out = removeRoom(h, sel.id);
      if ("error" in out) return setNotice(out.error);
      apply(out.house);
      setSel(null);
      return;
    }
    const next = removeThing(h, sel);
    if (next !== h) {
      apply(next);
      setSel(null);
    } else if (sel.kind === "duck") setNotice("A map needs at least one duck spot.");
  }, [sel, apply]);

  // Keys: ⌘Z / ⇧⌘Z (⌘Y) undo / redo, Delete removes, arrows nudge (the
  // snap step, Shift ×10), [ / ] turn, Esc back to Select, tool letters.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!editorTakesKey({ typing: isTyping(e.target), editing: edit, asking: askingRef.current })) return;
      const h = draftRef.current;
      if (h === null) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        step(e.shiftKey ? "redo" : "undo");
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        step("redo");
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === "Escape") {
        if (tool !== "select") setTool("select");
        else setSel(null);
        return;
      }
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t !== undefined && !e.shiftKey) {
        setTool(t.id);
        return;
      }
      if (sel === null) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (e.key === "[" || e.key === "]") {
        const yaw = yawOf(h, sel);
        if (yaw !== null) apply(setYaw(h, sel, yaw + (e.key === "[" ? 5 : -5)));
        return;
      }
      const d = e.shiftKey ? snapStep * 10 : snapStep;
      const v: Record<string, Vec2> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] };
      const by = v[e.key];
      if (by === undefined) return;
      e.preventDefault();
      if (sel.kind === "room") {
        // Like a drag: a yard cut into pieces never moves piece by piece.
        if (yardOf(h, sel.id).length > 1) setNotice("A yard cut into pieces moves with the rooms standing in it — move those, or Fill the yard.");
        else apply(moveRoom(h, sel.id, by[0], by[1]));
      }
      else if (sel.kind === "stair") apply(moveStair(h, sel.id, by[0], by[1]));
      else if (sel.kind === "door") {
        const door = h.doors.find((x) => x.id === sel.id);
        if (door !== undefined) apply(moveDoorAlong(h, sel.id, [door.at[0] + by[0], door.at[1] + by[1]], snapStep / 10));
      } else {
        const pos = positionOf(h, sel);
        if (pos !== null) apply(moveTo(h, sel, snap2([pos[0] + by[0], pos[2] + by[1]], Math.min(snapStep, 0.01))));
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [edit, sel, tool, snapStep, apply, step, deleteSelected]);

  useEffect(() => {
    if (copied === null) return;
    const t = window.setTimeout(() => setCopied(null), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);
  useEffect(() => {
    if (notice === null) return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  if (draft === null || loaded === null) {
    return (
      <Desktop>
        <Window title="House map" icon="🗺">
          <p className="pad">Loading the house…</p>
        </Window>
      </Desktop>
    );
  }

  const house = draft;
  const origin = window.location.origin;
  const copy = (key: string, value: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => setCopied(key),
      () => setCopied(null),
    );
  };
  const errors = textError !== null ? [{ text: textError, sel: null, level: "error" as const }] : structuredProblems(house, validation?.problems ?? []);
  const warnings = [...(walk ?? []), ...locationProblems(house, locations)];
  const canSave = dirty && textError === null && validation?.ok === true && saveState.kind !== "saving" && editable;

  const addSized = (w: number, d: number) => {
    const selRoom = sel?.kind === "room" ? house.rooms.find((r) => r.id === sel.id && r.floor === floor) : undefined;
    // Not beside a selected room: east of everything on the floor (or at the origin).
    const onFloor = house.rooms.filter((r) => r.floor === floor);
    const east = onFloor.length === 0 ? null : onFloor.map((r) => polyBounds(r.poly)).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
    const at: Vec2 = east === null ? [0, 0] : [east[2] + 1, east[1]];
    const r = addRoom(house, floor, placeRect(house, w, d, selRoom?.id ?? null, at), { outdoor: tool === "yard" });
    apply(r.house);
    select({ kind: "room", id: r.id });
  };

  const ctx: MapToolbarContext = {
    house,
    saved,
    loaded,
    config,
    base,
    players: players.size,
    remoteVersion,
    dirty: dirty || textError !== null,
    valid: validation?.ok === true && textError === null && editable,
    adopt: (next) => apply(next),
    reload: load,
    save,
    unlock,
  };

  return (
    <div className="map-page">
      <Toolbar
        house={house}
        floor={floor}
        players={players}
        loaded={loaded}
        live={live}
        edit={edit}
        editable={editable}
        tool={tool}
        snapStep={snapStep}
        dirty={dirty}
        canSave={canSave}
        saving={saveState.kind === "saving"}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        view3d={view3d}
        onView3d={setView3d}
        extras={toolbarExtras?.(ctx)}
        onFloor={(id) => {
          setFloor(id);
          if (sel !== null && floorOfSelection(house, sel) !== id) setSel(null);
        }}
        onFloorInspect={(id) => select({ kind: "floor", id })}
        onAddFloor={() => {
          const r = addFloor(house, floorDefaults(house));
          apply(r.house);
          setFloor(r.id);
          select({ kind: "floor", id: r.id });
        }}
        onEdit={setEdit}
        onTool={setTool}
        onSnap={setSnapStep}
        onAddSized={addSized}
        onUndo={() => step("undo")}
        onRedo={() => step("redo")}
        onRevert={revert}
        onBlank={() => {
          if (!window.confirm("Start a new blank house (one floor and a yard)? The current map stays until you save — Undo brings it back.")) return;
          const next = blankHouse(house.name, house.origin);
          apply(next);
          setFloor(next.floors[0]!.id);
          setSel(null);
        }}
        onSave={() => void save()}
      />

      {!editable && (
        <div className="map-banner w98-raised">
          Couldn't reach the server — showing the bundled show map (read-only).
          <button className="w98-button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {remoteChanged && (
        <div className="map-banner w98-raised">
          The map was changed elsewhere.
          <button className="w98-button" onClick={() => void load()}>
            Reload (discard my edits)
          </button>
          <button className="w98-button" onClick={() => setRemoteChanged(false)}>
            Keep editing
          </button>
        </div>
      )}

      {notice !== null && (
        <div className="map-banner notice w98-raised" role="status">
          {notice}
          <button className="w98-button small" onClick={() => setNotice(null)}>
            OK
          </button>
        </div>
      )}

      <main className="map-main">
        {view3d ? (
          <div className="map-canvas w98-sunken">
            <Suspense fallback={<p className="pad">Loading 3D…</p>}>
              <Preview3D house={validation?.ok ? (validation.house ?? null) : null} floor={floor} />
            </Suspense>
          </div>
        ) : (
          <Canvas house={house} floor={floor} edit={edit} tool={tool} snapStep={snapStep} sel={sel} players={players} onSelect={select} onEdit={apply} onNotice={setNotice} />
        )}

        <aside className="map-side">
          <div className="w98-tabs" role="tablist">
            {(
              [
                ["inspect", "Inspector"],
                ["terminals", `Terminals (${house.terminals.length})`],
                ["players", `Players (${players.size})`],
                ["json", "JSON"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={`w98-tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="map-panel w98-raised">
            {tab === "inspect" && <Inspector house={house} sel={sel} edit={edit} locations={locations} commit={apply} onSelect={select} onNotice={setNotice} origin={origin} copy={copy} copied={copied} />}
            {tab === "terminals" && <TerminalsTab house={house} origin={origin} sel={sel} copy={copy} copied={copied} onPick={(s) => reveal(s)} />}
            {tab === "players" && <PlayersTab house={house} players={players} onFloor={setFloor} />}
            {tab === "json" && (
              <JsonTab
                text={text}
                edit={edit}
                onText={(value) => {
                  setText(value);
                  setSaveState((st) => (st.kind === "ok" ? { kind: "idle" } : st));
                  const r = draftFromText(value);
                  if (!r.ok) return setTextError(r.error);
                  setTextError(null);
                  const cur = draftRef.current;
                  if (cur !== null) {
                    const h = pushed(historyRef.current, cur);
                    historyRef.current = h;
                    setHistory(h);
                  }
                  draftRef.current = r.house;
                  setDraft(r.house);
                }}
              />
            )}
          </div>

          <ProblemsPanel
            errors={errors}
            warnings={warnings}
            checking={walk === null}
            saveState={saveState}
            copied={copied}
            onPick={reveal}
            onCopyDraft={() => copy("draft", stringify(house))}
            onReload={() => void load()}
          />
        </aside>
      </main>
      {asking !== null && <PasscodeDialog round={asking.round} error={asking.error} onAnswer={asking.answer} />}
    </div>
  );
}

/** "Type the moderator passcode" before the page's first save or switch. */
function PasscodeDialog({ round, error, onAnswer }: { round: number; error: string | null; onAnswer: (code: string | null) => void }) {
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => setChecking(false), [round]);
  // Disabling the input while a code is checked blurs it: take focus back for the retry.
  useEffect(() => {
    if (!checking) input.current?.focus();
  }, [checking, round]);
  return (
    <div className="unlock-modal">
      <Window title="House map — moderator passcode" className="unlock-window">
        <form
          className="unlock-body"
          onSubmit={(e) => {
            e.preventDefault();
            setChecking(true);
            onAnswer(code);
          }}
        >
          <p>Saving or switching the live map needs the moderator passcode (once per page load).</p>
          <input ref={input} className="w98-input" type="password" autoFocus autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Moderator passcode" disabled={checking} />
          {error !== null && <div className="w98-error">⚠ {error}</div>}
          <div className="unlock-actions">
            <button type="submit" className="w98-button default" disabled={checking || code.trim() === ""}>
              OK
            </button>
            <button type="button" className="w98-button" onClick={() => onAnswer(null)} disabled={checking}>
              Cancel
            </button>
          </div>
        </form>
      </Window>
    </div>
  );
}
