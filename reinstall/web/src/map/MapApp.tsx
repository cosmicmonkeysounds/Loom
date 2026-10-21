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
//! The house speakers (wave 17) are drawn and placed on the same plan but
//! saved apart, in the event's `audio.json` (`GET` / `POST /api/mod/audio`,
//! its own `base` → 409): the Audio tab holds the interface, the matrix,
//! zones and cues. **Undo:** one history of `{house, audio}` pairs, so a
//! map edit, a speaker edit, and a room move that carries its speakers are
//! each one step, whichever was last. Another director's speaker save
//! adopted into the page is swapped into every entry (`rebaseHistory`):
//! the map's steps still undo, the speaker-only ones go. **Saving:** the
//! two files save separately — 💾 Save writes the map when it changed and
//! can be saved, then the speakers when they are valid against the map the
//! server will hold (`speakerSavePlan`); a speaker problem never greys a
//! valid map's save. A long poll on the speaker config (`audio-poll.ts`)
//! keeps the tests list live and catches another director's save.
//!
//! This file holds the state; the plan is `Canvas.tsx`, the toolbar
//! `Toolbar.tsx`, the fields `Inspector.tsx`, the other tabs and the
//! problem list `Panels.tsx`, and every edit a pure op (`edit.ts`,
//! `doors.ts`, `yards.ts`, `structure.ts`).

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { polyBounds, validateAudio, validateHouse } from "@loom/house";
import type { AudioConfig, HouseMap, PlayerState, Vec2 } from "@loom/house";
import { audioDownload, audioProblemList, duplicateSpeaker, followHouse, moveSpeaker, normalizeAudio, placeSpeaker, planOf, rebaseHistory, removeSpeaker, rotateSpeaker, sameAudio, saveAllPlan, speakerById, speakerSavePlan, speakersDropped, withSpeakersText, type Doc } from "./audio.ts";
import { fetchAudio, saveAudio, saveAudioToProject, testAudio, testRefusal, type AudioView } from "./audio-api.ts";
import { runAudioPoll } from "./audio-poll.ts";
import { AudioPanel } from "./AudioPanel.tsx";
import "./audio.css";
import { Setup } from "../app.tsx";
import { fetchHouse, fetchLocations, saveHouse, streamProbe, streamUrl, tokenAlive, type LoadedHouse } from "../api.ts";
import { baseOf, dropConfig, loadConfig, saveConfig, type ReinstallConfig } from "../config.ts";
import { applyFrame, houseVersionOf, openSpatialStream } from "../spatial.ts";
import { Desktop, Window } from "../wizard.tsx";
import { Canvas } from "./Canvas.tsx";
import { locationProblems, structuredProblems, walkabilityProblems, type StoryLocation } from "./check.ts";
import { moveDoorAlong } from "./doors.ts";
import { draftFromText, editableSource, moveRoom, moveTo, positionOf, remoteMapAction, removeThing, saveBaseOf, saveStateOf, setYaw, yawOf, type SaveState, type Selection } from "./edit.ts";
import { emptyHistory, pushed, redone, undone, type History } from "./history.ts";
import { Inspector } from "./Inspector.tsx";
import { JsonTab, PlayersTab, ProblemsPanel, TerminalsTab } from "./Panels.tsx";
import { snap2, SNAP_STEPS } from "./plan.ts";
import { addProp, duplicate, rotateBy, YAW_STEP } from "./props.ts";
import { addFloor, addRoom, blankHouse, cascadeOf, deleteRoomText, deletesWith, floorDefaults, moveStair, placeRect, removeRoom } from "./structure.ts";
import { flapsAdded, yardOf } from "./yards.ts";
import { Toolbar } from "./Toolbar.tsx";
import { checkModCode, editorTakesKey, MapUnlock } from "./unlock.ts";
import { floorOfSelection, selectionExists, TOOLS, type EditMode, type MapToolbarContext, type Placing, type Tool } from "./tools.ts";

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

type Tab = "inspect" | "terminals" | "players" | "audio" | "json";

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
  const [history, setHistory] = useState<History<Doc>>(emptyHistory);
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<string | null>(null);
  const [floor, setFloor] = useState("");
  const [edit, setEdit] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  /** A palette prop (or a speaker) armed for the next click on the plan. */
  const [placing, setPlacing] = useState<Placing | null>(null);
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
  // The house speakers (`audio.json`): the draft, as last loaded / saved, the server's view.
  const [audio, setAudio] = useState<AudioConfig>(() => normalizeAudio(null));
  const [savedAudio, setSavedAudio] = useState<AudioConfig | null>(null);
  const [audioView, setAudioView] = useState<AudioView | null>(null);
  const [audioStatus, setAudioStatus] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [audioSaveState, setAudioSaveState] = useState<SaveState>({ kind: "idle" });
  /** `changed`: another director saved the speakers while this page held edits;
   *  `drafted`: the server's speakers came in after this page drafted some offline. */
  const [audioRemote, setAudioRemote] = useState<null | "changed" | "drafted">(null);
  const [projectStatus, setProjectStatus] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<ReadonlySet<string>>(() => new Set());
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const audioVersionRef = useRef<string | null>(null);
  const audioSaving = useRef(false);
  const audioDirtyRef = useRef(false);
  const testSeqRef = useRef(0);
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
    historyRef.current = emptyHistory();
    setHistory(historyRef.current);
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
  const audioDirty = useMemo(() => savedAudio !== null && !sameAudio(audio, savedAudio), [audio, savedAudio]);
  audioDirtyRef.current = audioDirty;

  /** The server's speaker config. A new one is adopted when the page holds
   *  no speaker edits (swapped into the undo history, so the map's steps
   *  stay); with edits the page says it changed elsewhere; drafted before
   *  the first answer (an outage), the draft stays, unsaved against it.
   *  True when the page took something (a config, a new test) — the long
   *  poll pauses after an answer that changed nothing. */
  const adoptAudio = useCallback((v: AudioView, force = false): boolean => {
    setAudioView(v);
    setAudioStatus("ok");
    let took = false;
    for (const t of v.tests) {
      if (t.seq > testSeqRef.current) {
        testSeqRef.current = t.seq;
        took = true;
      }
    }
    if (v.version === audioVersionRef.current && !force) return took;
    if (audioSaving.current && !force) return took;
    const first = audioVersionRef.current === null;
    if (audioDirtyRef.current && !force) {
      if (!first) {
        setAudioRemote("changed");
        return took;
      }
      audioVersionRef.current = v.version;
      setSavedAudio(v.audio);
      setAudioRemote("drafted");
      return true;
    }
    audioVersionRef.current = v.version;
    setSavedAudio(v.audio);
    setAudioRemote(null);
    setAudioSaveState((s) => (s.kind === "conflict" ? { kind: "idle" } : s));
    // The same speakers (a Save to project, a reload of what is shown): nothing to undo differently.
    if (sameAudio(v.audio, audioRef.current)) return true;
    const cur = draftRef.current;
    if (cur !== null) {
      historyRef.current = rebaseHistory(historyRef.current, { house: cur, audio: audioRef.current }, v.audio);
      setHistory(historyRef.current);
    }
    audioRef.current = v.audio;
    setAudio(v.audio);
    return true;
  }, []);

  const reloadAudio = useCallback(async () => {
    const r = await fetchAudio(base, config.token);
    if (r.kind === "ok") adoptAudio(r.view, true);
    else if (r.kind === "missing") setAudioStatus("missing");
    else setNotice(`Couldn't load the speakers (${r.error}).`);
  }, [base, config.token, adoptAudio]);

  // The speaker config: one GET, then a long poll (a save elsewhere, a test).
  useEffect(() => {
    let stop = false;
    const ctrl = new AbortController();
    void runAudioPoll({
      fetch: (q) => fetchAudio(base, config.token, { ...q, signal: ctrl.signal }),
      onView: (v) => adoptAudio(v),
      onMissing: () => {
        // A server before wave 17: draft against the default interface, never saved.
        setAudioStatus("missing");
        setSavedAudio((s) => s ?? audioRef.current);
      },
      onError: () => {
        setAudioStatus((s) => (s === "loading" ? "error" : s));
        setSavedAudio((s) => s ?? audioRef.current);
      },
      testSeq: () => testSeqRef.current,
      stopped: () => stop,
    });
    return () => {
      stop = true;
      ctrl.abort();
    };
  }, [base, config.token, adoptAudio]);

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
    }, { probe: streamProbe(base, config.token) });
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
    if (!edit) {
      setTool("select");
      setPlacing(null);
    }
  }, [edit]);
  useEffect(() => {
    if (tool !== "select") setPlacing(null);
  }, [tool]);
  useEffect(() => {
    try {
      window.localStorage.setItem(SNAP_KEY, String(snapStep));
    } catch {
      /* a convenience only */
    }
  }, [snapStep]);

  /** Apply a `{house, audio}` edit: `push` makes a new undo step, `replace` updates the running drag's. */
  const applyDoc = useCallback((next: Doc, mode: EditMode = "push") => {
    const cur = draftRef.current;
    if (cur === null || (next.house === cur && next.audio === audioRef.current)) return;
    if (mode === "push") {
      const h = pushed(historyRef.current, { house: cur, audio: audioRef.current });
      historyRef.current = h;
      setHistory(h);
    }
    if (next.house !== cur) {
      draftRef.current = next.house;
      setDraft(next.house);
      setText(stringify(next.house));
      setTextError(null);
      setSaveState((s) => (s.kind === "ok" ? { kind: "idle" } : s));
    }
    if (next.audio !== audioRef.current) {
      audioRef.current = next.audio;
      setAudio(next.audio);
      setAudioSaveState((s) => (s.kind === "ok" ? { kind: "idle" } : s));
    }
  }, []);

  /** A speaker edit (the map unchanged). */
  const applyAudio = useCallback((next: AudioConfig, mode: EditMode = "push") => {
    const cur = draftRef.current;
    if (cur !== null) applyDoc({ house: cur, audio: next }, mode);
  }, [applyDoc]);

  /** A map edit: the speakers standing in what moved go with it (`followHouse`), in the same step. */
  const apply = useCallback((next: HouseMap, mode: EditMode = "push") => {
    const cur = draftRef.current;
    if (cur === null || next === cur) return;
    applyDoc({ house: next, audio: followHouse(cur, next, audioRef.current) }, mode);
    // A door nobody placed is said out loud: the cut gave a room a flap into the yard.
    const flaps = flapsAdded(cur, next);
    if (flaps.length > 0) {
      const name = (id: string | null) => (id === null ? "outside" : (next.rooms.find((r) => r.id === id)?.label ?? id));
      setNotice(`Added ${flaps.map((d) => `a door from ${name(d.a)} into ${name(d.b)}`).join(" and ")} (a tent flap) — move or delete it if that's not where the way in is.`);
    }
  }, [applyDoc]);

  const step = useCallback((dir: "undo" | "redo") => {
    const cur = draftRef.current;
    if (cur === null) return;
    const r = (dir === "undo" ? undone : redone)(historyRef.current, { house: cur, audio: audioRef.current });
    if (r === null) return;
    historyRef.current = r.history;
    setHistory(r.history);
    draftRef.current = r.present.house;
    setDraft(r.present.house);
    setText(stringify(r.present.house));
    setTextError(null);
    audioRef.current = r.present.audio;
    setAudio(r.present.audio);
  }, []);

  // A selection the edit (or the undo) took away goes; the floor follows the history too.
  useEffect(() => {
    if (draft === null) return;
    if (sel !== null && !selectionExists(draft, sel, audio)) setSel(null);
    if (!draft.floors.some((f) => f.id === floor)) setFloor(draft.floors[0]?.id ?? "");
  }, [draft, sel, floor, audio]);

  /** Back to the saved map — the draft *and* the JSON text (which may be broken while the draft is not). */
  const revert = () => {
    if (saved === null) return;
    applyDoc({ house: saved, audio: savedAudio ?? audio });
    setText(stringify(saved));
    setTextError(null);
  };

  /** The speaker validity the save is gated on (against the draft map; the server re-checks against its own). */
  const audioCheck = useMemo(() => (draft === null ? null : validateAudio(audio, draft)), [audio, draft]);

  /** Save the speakers to the event (`base` = the version this page loaded → 409 when another save landed). */
  const saveSpeakers = async (): Promise<string | null> => {
    if (!audioDirty || audioStatus !== "ok") return null;
    if (!(await unlock())) return null;
    setAudioSaveState({ kind: "saving" });
    audioSaving.current = true;
    const sent = audio;
    try {
      const r = await saveAudio(base, config.token, sent, audioVersionRef.current);
      if (r.ok) {
        audioVersionRef.current = r.result.version;
        setSavedAudio(sent);
        setAudioView((v) => (v === null ? v : { ...v, audio: sent, version: r.result.version, source: "director" }));
        setAudioSaveState({ kind: "ok", warnings: r.result.warnings ?? [], version: r.result.version });
        return r.result.version;
      }
      if (r.status === 401 || r.status === 403) onRevoked();
      setAudioSaveState(r.conflict ? { kind: "conflict", version: r.version } : { kind: "error", error: r.error, problems: r.problems });
      if (r.conflict) setAudioRemote(null);
      return null;
    } finally {
      audioSaving.current = false;
    }
  };

  /** The speakers' validity against the map the server holds (they save alone only when this passes). */
  const audioCheckSaved = useMemo(() => (saved === null ? null : validateAudio(audio, saved)), [audio, saved]);
  const mapSaveable = textError === null && validation?.ok === true && editable;
  const speakerSave = speakerSavePlan({
    audioDirty,
    status: audioStatus,
    mapDirty: dirty,
    mapSaveable,
    validDraft: audioCheck?.ok === true,
    validSaved: audioCheckSaved?.ok === true,
  });
  const allPlan = saveAllPlan({ mapDirty: dirty, mapSaveable, speakers: speakerSave });

  /** 💾 Save: the map (when it changed and can be saved), then the speakers when they fit the map the server will hold. */
  const saveAll = async () => {
    if (allPlan.map && (await save()) === null) return;
    if (allPlan.speakers) await saveSpeakers();
    else if (audioDirty) {
      const why = speakerSave.why ?? (allPlan.map ? "they don't fit the map as saved — fix the speaker problems" : "fix the speaker problems first");
      setNotice(`${allPlan.map ? "Map saved — the" : "The"} speakers are not saved: ${why}.`);
    }
  };

  /** The Audio tab's save: the speakers alone when they fit the saved map, else the map first. */
  const saveFromAudioTab = async () => {
    if (speakerSave.alone) await saveSpeakers();
    else if (speakerSave.withMap && (await save()) !== null) await saveSpeakers();
  };

  const speakersToProject = async () => {
    if (!(await unlock())) return;
    setProjectStatus("Saving audio.json to the project…");
    const r = await saveAudioToProject(base, config.token);
    if (r.ok) {
      setProjectStatus(`Saved to the project as ${r.result.file}.`);
      await reloadAudio();
    } else setProjectStatus(r.status === 409 ? "This event has no project — Download JSON and commit it instead." : `Not saved to the project — ${r.error}.`);
  };

  const downloadSpeakers = () => {
    const { name, text: body } = audioDownload(audio);
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** 🔈: the router on the house Mac plays its tone + label there. */
  const testSpeaker = useCallback(
    async (target: { speaker: string } | { out: number }) => {
      if (!(await unlock())) return;
      const r = await testAudio(base, config.token, target);
      if (r.ok) {
        const what = "speaker" in target ? (speakerById(audioRef.current, target.speaker)?.name ?? target.speaker) : `output ${target.out}`;
        setNotice(`🔈 Test #${r.result.seq} sent: the router plays a tone and says “${what}” there (if it is running on the house Mac).`);
      } else setNotice(testRefusal(r, target));
    },
    [base, config.token, unlock],
  );

  const lightUp = useCallback((ids: readonly string[] | null) => setHighlight(new Set(ids ?? [])), []);

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
      const f = floorOfSelection(h, s, audioRef.current);
      if (f !== "") setFloor(f);
      select(s);
    },
    [select],
  );

  const deleteSelected = useCallback(() => {
    const h = draftRef.current;
    if (h === null || sel === null) return;
    if (sel.kind === "speaker") {
      applyAudio(removeSpeaker(audioRef.current, sel.id));
      setSel(null);
      return;
    }
    if (sel.kind === "room") {
      const room = h.rooms.find((r) => r.id === sel.id);
      if (room === undefined) return;
      // A yard goes whole: every piece it was cut into.
      const c = cascadeOf(h, deletesWith(h, sel.id));
      if (c.spawn) return setNotice(`The spawn is in this ${room.outdoor ? "yard" : "room"} — move the spawn to another room first.`);
      const out = removeRoom(h, sel.id);
      if ("error" in out) return setNotice(out.error);
      if (!window.confirm(withSpeakersText(deleteRoomText(room, c), speakersDropped(h, out.house, audioRef.current).length))) return;
      apply(out.house);
      setSel(null);
      return;
    }
    const next = removeThing(h, sel);
    if (next !== h) {
      apply(next);
      setSel(null);
    } else if (sel.kind === "duck") setNotice("A map needs at least one duck spot.");
  }, [sel, apply, applyAudio]);

  // Keys: ⌘Z / ⇧⌘Z (⌘Y) undo / redo, ⌘D duplicates, Delete removes,
  // arrows nudge (the snap step, Shift ×10), R / ⇧R turn 15° (with a
  // turnable selection; else R is the Room tool), [ / ] turn 5°, Esc
  // cancels a palette prop, then back to Select, then deselects; tool letters.
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
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (sel === null) return;
        if (sel.kind === "speaker") {
          const d = duplicateSpeaker(audioRef.current, h, sel.id, snapStep < 0.1 ? 0.25 : snapStep);
          if (d !== null) {
            applyAudio(d.audio);
            setSel({ kind: "speaker", id: d.id });
          }
          return;
        }
        const out = duplicate(h, sel, snapStep < 0.1 ? 0.25 : snapStep);
        if (out === null) return setNotice("Only a prop, a terminal, a speaker or a duck spot can be duplicated.");
        apply(out.house);
        setSel(out.sel);
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === "Escape") {
        if (placing !== null) setPlacing(null);
        else if (tool !== "select") setTool("select");
        else setSel(null);
        return;
      }
      if (e.key.toLowerCase() === "r" && tool === "select" && sel?.kind === "speaker") {
        e.preventDefault();
        applyAudio(rotateSpeaker(audioRef.current, sel.id, e.shiftKey ? -YAW_STEP : YAW_STEP));
        return;
      }
      if (e.key.toLowerCase() === "r" && tool === "select" && sel !== null && yawOf(h, sel) !== null) {
        e.preventDefault();
        apply(rotateBy(h, sel, e.shiftKey ? -YAW_STEP : YAW_STEP));
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
      if ((e.key === "[" || e.key === "]") && sel.kind === "speaker") {
        applyAudio(rotateSpeaker(audioRef.current, sel.id, e.key === "[" ? 5 : -5));
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
      else if (sel.kind === "speaker") {
        const s = speakerById(audioRef.current, sel.id);
        if (s !== undefined) {
          const at = planOf(s);
          applyAudio(moveSpeaker(audioRef.current, h, sel.id, snap2([at[0] + by[0], at[1] + by[1]], Math.min(snapStep, 0.01))));
        }
      }
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
  }, [edit, sel, tool, placing, snapStep, apply, applyAudio, step, deleteSelected]);

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
  const speakerProblems = audioProblemList(audio, house);
  const errors = [...(textError !== null ? [{ text: textError, sel: null, level: "error" as const }] : structuredProblems(house, validation?.problems ?? [])), ...speakerProblems.errors];
  const warnings = [...(walk ?? []), ...locationProblems(house, locations), ...speakerProblems.warnings];
  const busy = saveState.kind === "saving" || audioSaveState.kind === "saving";
  const canSave = (allPlan.map || allPlan.speakers) && !busy && editable;

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
        dirty={dirty || audioDirty}
        canSave={canSave}
        saving={saveState.kind === "saving" || audioSaveState.kind === "saving"}
        speakers={audioStatus !== "loading"}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        view3d={view3d}
        onView3d={setView3d}
        extras={toolbarExtras?.(ctx)}
        onFloor={(id) => {
          setFloor(id);
          if (sel !== null && floorOfSelection(house, sel, audio) !== id) setSel(null);
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
        placing={placing}
        onPlacing={(k) => {
          setTool("select");
          setPlacing(k);
        }}
        onSnap={setSnapStep}
        onAddSized={addSized}
        onUndo={() => step("undo")}
        onRedo={() => step("redo")}
        onRevert={revert}
        onBlank={() => {
          const n = audio.speakers.length;
          const keep = n === 0 ? "" : ` The ${n === 1 ? "speaker stays" : `${n} speakers stay`} in audio.json, flagged until ${n === 1 ? "it stands" : "they stand"} in a room again (drag ${n === 1 ? "it" : "them"} onto the new rooms).`;
          if (!window.confirm(`Start a new blank house (one floor and a yard)? The current map stays until you save — Undo brings it back.${keep}`)) return;
          const next = blankHouse(house.name, house.origin);
          // Not `apply`: a redraw never takes the physical speaker layout with it.
          applyDoc({ house: next, audio: audioRef.current });
          setFloor(next.floors[0]!.id);
          setSel(null);
        }}
        onSave={() => void saveAll()}
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

      {audioRemote !== null && (
        <div className="map-banner w98-raised">
          {audioRemote === "changed" ? "The speakers were changed elsewhere." : "The server's speakers came in after you drafted some while it was away — your draft is kept, unsaved."}
          <button className="w98-button" onClick={() => void reloadAudio()}>
            {audioRemote === "changed" ? "Reload the speakers (discard my speaker edits)" : "Use the server's speakers (drop my draft)"}
          </button>
          <button className="w98-button" onClick={() => setAudioRemote(null)}>
            {audioRemote === "changed" ? "Keep editing" : "Keep my draft"}
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

      <main className={`map-main${tab === "audio" ? " wide-side" : ""}`}>
        {view3d ? (
          <div className="map-canvas w98-sunken">
            <Suspense fallback={<p className="pad">Loading 3D…</p>}>
              <Preview3D house={validation?.ok ? (validation.house ?? null) : null} floor={floor} />
            </Suspense>
          </div>
        ) : (
          <Canvas
            house={house}
            floor={floor}
            edit={edit}
            tool={tool}
            snapStep={snapStep}
            sel={sel}
            players={players}
            onSelect={select}
            onEdit={apply}
            onNotice={setNotice}
            placing={placing}
            audio={audio}
            onEditAudio={applyAudio}
            highlight={highlight}
            onPlace={(at) => {
              if (placing === null) return;
              if (placing === "speaker") {
                const r = placeSpeaker(audio, house, floor, at);
                if (r === null) return setNotice("Click inside a room on this floor to hang the speaker.");
                applyAudio(r.audio);
                setPlacing(null);
                select({ kind: "speaker", id: r.id });
                return;
              }
              const r = addProp(house, placing, floor, at);
              if (r === null) return setNotice(`Click inside a room on this floor to place the ${placing}.`);
              apply(r.house);
              setPlacing(null);
              select({ kind: "prop", id: r.id });
            }}
          />
        )}

        <aside className="map-side">
          <div className="w98-tabs" role="tablist">
            {(
              [
                ["inspect", "Inspector"],
                ["terminals", `Terminals ${house.terminals.length}`],
                ["players", `Players ${players.size}`],
                ["audio", `🔊 Audio ${audio.speakers.length}`],
                ["json", "JSON"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={`w98-tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="map-panel w98-raised">
            {tab === "inspect" && (
              <Inspector
                house={house}
                sel={sel}
                edit={edit}
                locations={locations}
                commit={apply}
                onSelect={select}
                onNotice={setNotice}
                origin={origin}
                copy={copy}
                copied={copied}
                audio={audioStatus === "loading" ? null : audio}
                savedAudio={audioStatus === "ok" ? savedAudio : null}
                commitAudio={applyAudio}
                onTest={audioStatus === "ok" ? (t) => void testSpeaker(t) : undefined}
              />
            )}
            {tab === "audio" && (
              <AudioPanel
                audio={audio}
                saved={savedAudio}
                house={house}
                view={audioView}
                loadedVersion={audioVersionRef.current}
                status={audioStatus}
                edit={edit}
                dirty={audioDirty}
                valid={audioCheck?.ok === true}
                speakerSave={speakerSave}
                mapBusy={saveState.kind === "saving"}
                saveState={audioSaveState}
                commit={applyAudio}
                onSave={() => void saveFromAudioTab()}
                onSaveToProject={() => void speakersToProject()}
                onDownload={downloadSpeakers}
                onReload={() => {
                  if (audioDirty && !window.confirm("Reload the speakers from the server? Your speaker edits are dropped.")) return;
                  setAudioSaveState({ kind: "idle" });
                  void reloadAudio();
                }}
                onTest={(t) => void testSpeaker(t)}
                onHighlight={lightUp}
                onShowFloor={(ids) => {
                  const floors = ids.map((id) => floorOfSelection(house, { kind: "speaker", id }, audio)).filter((f) => f !== "");
                  if (floors.length > 0 && !floors.includes(floor)) setFloor(floors[0]!);
                }}
                onPick={reveal}
                projectStatus={projectStatus}
              />
            )}
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
                    const h = pushed(historyRef.current, { house: cur, audio: audioRef.current });
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
            onTab={(t) => setTab(t)}
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
