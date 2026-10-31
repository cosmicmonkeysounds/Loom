// The teleprompter's eager part (wave 55): the guest's first load. `useAloud`
// keeps how far this reader has read (host storage, per sign-in); `AloudSlot`
// covers the app until the script is read to its ✓ Done, with the lazy
// `prompter.tsx` (the pop-up and the view). A chunk that won't load is the
// same script as a plain list: a reader is never left with nothing.

import { Suspense, useEffect, useMemo, useState } from "react";
import { maxSeqOf } from "../alerts.ts";
import type { StartItem } from "../chrome/start-menu.tsx";
import type { SessionStorage } from "../host.ts";
import { ChunkBoundary, retryableLazy } from "../lazy-chunk.tsx";
import type { ChatMessage } from "../types.ts";
import { lastSeq, markFloor, scriptOf, unreadLines, type ScriptSection } from "./model.ts";
import type { PrompterProps } from "./prompter.tsx";

const loadSurface = () => import("./prompter.tsx").then((m) => ({ default: m.AloudSurface }));
const Surface = retryableLazy<PrompterProps>(loadSurface);

export interface Aloud {
  script: ScriptSection[];
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

export function useAloud(o: { messages: ReadonlyMap<number, ChatMessage>; me: string | null; token: string | null; storage: SessionStorage; clock: number | undefined; prefetch?: boolean }): Aloud {
  const { messages, me, storage } = o;
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
  return {
    script,
    mark,
    unread,
    open,
    setOpen,
    done: () => {
      keep(last);
      setOpen(false);
    },
    covering: open || unread > 0,
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
  if (!a.covering) return null;
  return (
    <ChunkBoundary fallback={() => <AloudPlain a={a} />}>
      <Suspense fallback={<div className="aloud-prompter" />}>
        <S a={a} sound={sound} storage={storage} />
      </Suspense>
    </ChunkBoundary>
  );
}
