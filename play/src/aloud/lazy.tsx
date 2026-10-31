// The teleprompter's eager part (wave 55): the guest's first load. `useAloud`
// keeps how far this reader has read (host storage, per sign-in); `AloudSlot`
// covers the app until the script is read to its ✓ Done, with the lazy
// `prompter.tsx` (the pop-up and the view). A chunk that won't load is the
// same script as a plain list: a reader is never left with nothing.

import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { maxSeqOf } from "../alerts.ts";
import type { StartItem } from "../chrome/start-menu.tsx";
import type { SessionStorage } from "../host.ts";
import { ChunkBoundary, retryableLazy } from "../lazy-chunk.tsx";
import type { ChatMessage } from "../types.ts";
import { lastSeq, markFloor, scriptOf, unreadLines, type ScriptSection } from "./model.ts";
import type { PrompterProps } from "./prompter.tsx";
import { PrompterStore, sceneRole, sceneScript, type PrompterPost } from "./shared.ts";

const loadSurface = () => import("./prompter.tsx").then((m) => ({ default: m.AloudSurface }));
const Surface = retryableLazy<PrompterProps>(loadSurface);
/** How often a phone on the script says so (the server's `HERE_EVERY_MS`). */
const HERE_MS = 4_000;
/** Wave 59: no session gave a store (a test, an older caller). */
const NO_STORE = new PrompterStore();

/** Wave 59: the scene on the server, while one is on. */
export interface SharedScene {
  id: number;
  store: PrompterStore;
  me: string;
  post: PrompterPost;
  /** What this phone is to it. */
  role: "reader" | "owner" | "host";
  /** The scene's own lines: what the prompter shows while it is on. */
  script: ScriptSection[];
}

export interface Aloud {
  script: ScriptSection[];
  /** Wave 59: the shared scene, or null (the phone's own script, as in wave 55). */
  shared: SharedScene | null;
  /** Wave 59: someone else's script has a line of yours: a small card, not the phone. */
  card: boolean;
  dropCard: () => void;
  /** The last line read. */
  mark: number;
  /** This reader's lines past the mark. */
  unread: number;
  /** The teleprompter is on screen. */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** ✓ Done: everything so far is read. */
  done: () => void;
  /** The pop-up or the teleprompter is over the app. */
  covering: boolean;
}

export function useAloud(o: { messages: ReadonlyMap<number, ChatMessage>; me: string | null; token: string | null; storage: SessionStorage; clock: number | undefined; prefetch?: boolean; prompter?: PrompterStore | undefined; post?: PrompterPost | undefined }): Aloud {
  const { messages, me, storage } = o;
  const store = o.prompter ?? NO_STORE;
  const sceneId = useSyncExternalStore(store.subscribe, store.sceneId, store.sceneId);
  const key = `loom.aloud.${o.token ?? ""}`;
  const [saved, setSaved] = useState<{ key: string; mark: number | null }>(() => ({ key, mark: storage.load<number>(key) }));
  const [open, setOpen] = useState(false);
  const script = useMemo(() => (me !== null ? scriptOf(messages.values(), me) : []), [messages, messages.size, me]);
  const stored = saved.key === key ? saved.mark : storage.load<number>(key);
  const last = lastSeq(script);
  const known = script.length > 0 && o.clock !== undefined;
  // A new phone starts from now, and keeps that place: a mark that moved
  // with the clock would let an unread line age away. One past every message
  // belongs to a run the story has since restarted (past the script alone
  // is a director hiding a line, which must not raise the whole night).
  const mark = stored === null ? (known ? markFloor(script, o.clock!) : 0) : stored > maxSeqOf(messages.values()) ? 0 : stored;
  const keep = (next: number) => {
    storage.save(key, next);
    setSaved({ key, mark: next });
  };
  useEffect(() => {
    if (stored === null && known) keep(mark);
  });
  useEffect(() => {
    if (o.prefetch !== true) return;
    const t = window.setTimeout(() => void loadSurface().catch(() => {}), 3_000);
    return () => window.clearTimeout(t);
  }, [o.prefetch]);
  const unread = unreadLines(script, mark).length;
  const role = sceneId !== 0 ? sceneRole(store.script, me) : null;
  const shared = useMemo<SharedScene | null>(() => {
    const sc = store.script;
    return role !== null && sc !== null && me !== null && o.post !== undefined ? { id: sceneId, store, me, post: o.post, role, script: sceneScript(sc, me) } : null;
  }, [sceneId, role, me, o.post, store]);
  const covering = open || unread > 0;
  // Wave 59: a phone showing the script says so, or his lines don't wait for it.
  const post = useRef(o.post);
  post.current = o.post;
  useEffect(() => {
    if (sceneId === 0 || !covering) return;
    const beat = () => {
      if (document.visibilityState === "visible") void post.current?.({ scene: sceneId, op: "here", open })?.catch(() => {});
    };
    beat();
    const t = window.setInterval(beat, HERE_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [sceneId, covering, open]);
  // A scene someone ended is read: its pop-up goes on every phone in it.
  const [cardGone, setCardGone] = useState(0);
  const lastEnded = useRef<number | null>(null);
  useEffect(() => {
    const e = store.ended;
    if (sceneId !== 0 || e === null || lastEnded.current === e.id) return;
    lastEnded.current = e.id;
    if (!e.superseded && script.length > 0) keep(last);
    // Forgotten by a restart, a reader carries on with their own script.
    if (!e.superseded || script.length === 0) setOpen(false);
  }, [sceneId]);
  return {
    script,
    shared,
    card: shared?.role === "owner" && cardGone !== sceneId,
    dropCard: () => setCardGone(sceneId),
    mark,
    unread,
    open,
    setOpen,
    done: () => {
      if (script.length > 0) keep(last);
      setOpen(false);
      setCardGone(sceneId);
      if (shared !== null) void shared.post({ scene: shared.id, op: "done" }).catch(() => {});
    },
    covering,
  };
}

/** ⊞ Start's `📜 My script` (DRAFT w55), once there is one. */
export function aloudStartItem(a: Aloud): StartItem | null {
  return a.script.length > 0 ? { id: "aloud", icon: "📜", label: "My script", onClick: () => a.setOpen(true) } : null;
}

/** The chunk didn't load: the same words, a list to scroll. */
function AloudPlain({ a }: { a: Aloud }) {
  return (
    <div className="aloud-plain" role="alert">
      {/* DRAFT w55 */}
      <b>📜 READ THIS OUT LOUD</b>
      <div className="aloud-plain-text">
        {a.script.flatMap((s) => s.lines.filter((l) => l.seq > a.mark)).map((l) => (
          <p key={l.seq} className={l.mine ? "aloud-line mine" : "aloud-line cue"}>
            {l.text}
          </p>
        ))}
      </div>
      <button type="button" className="aloud-done" onClick={a.done}>
        ✓ Done reading
      </button>
    </div>
  );
}

export function AloudSlot({ a, sound, storage }: PrompterProps) {
  const S = Surface.current();
  if (!a.covering && !a.card) return null;
  return (
    <ChunkBoundary fallback={() => <AloudPlain a={a} />}>
      <Suspense fallback={<div className="aloud-prompter" />}>
        <S a={a} sound={sound} storage={storage} />
      </Suspense>
    </ChunkBoundary>
  );
}
