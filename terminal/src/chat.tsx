//! The thread — one conversation, rendered like a terminal log: the
//! character's lines in phosphor, the program's in a dimmer tone, and the
//! line being spoken revealed as far as the voice has got (`revealed` is
//! a character offset per message seq). Scrolls to the newest line. At the
//! heart a pick from the choice panel is the server's own `pick` line
//! (wave 28: posted for every pick, on the phone too, and kept across a
//! reload), drawn as YOU with the time, a deed (`act`) in brackets. A line
//! still queued for the voice waits behind one typing row.

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { waitBar } from "@loom/play/agent-wait-words.ts";
import type { AgentWait } from "@loom/play/agent-wait.ts";
import { useWaitWords } from "@loom/play/stream/wait-strip.tsx";
import type { Line } from "./pilot.ts";

/** The wait to draw: `name` is his display name in the guest's view. */
export interface WaitProps {
  name: string;
  wait: AgentWait;
}

/** Ten cells of block bar, phosphor-legible across a room. */
export function waitCells(w: Pick<AgentWait, "position" | "from">, cells = 10): string | null {
  const b = waitBar(w);
  if (b === null) return null;
  const on = Math.max(1, Math.min(cells, Math.round((b.done / b.total) * cells)));
  return `${"■".repeat(on)}${"□".repeat(cells - on)}`;
}

/**
 * Wave 42b (B5): the phone's "you are 7th in line" strip, as a system line
 * at the foot of the log (the typing row's place) — the same words
 * (`waitWords`, DRAFT w42) and a block bar. Not a message: it goes when he
 * starts answering (the typing row) or the wait ends.
 */
function WaitLine({ name, wait }: WaitProps) {
  const bar = waitCells(wait);
  // The estimate counts down; only the place is spoken.
  const [said, eta, tail] = useWaitWords(name, wait);
  return (
    <div className="line system wait" role="status" aria-live="polite">
      <span className="text">
        <span className="wait-glass" aria-hidden>
          ⌛{" "}
        </span>
        {said}
        <span aria-hidden>{eta}</span>
        {tail}
        {bar !== null && (
          <span className="wait-cells" aria-hidden>
            {`[${bar}]`}
          </span>
        )}
      </span>
    </div>
  );
}

function stamp(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** A line's class: a pick (wave 28) reads as an echo of the panel, a deed as an act. */
export function lineClass(m: Pick<Line, "theirs" | "kind" | "pick" | "act" | "pending">, partial: boolean): string {
  const pick = !m.theirs && m.pick === true ? ` echo${m.act === true ? " act" : ""}${m.pending === true ? " pending" : ""}` : "";
  return `line ${m.theirs ? "theirs" : "mine"} kind-${m.kind}${pick}${partial ? " partial" : ""}`;
}

/** Within this of the end (px), the thread follows new lines. */
export const FOLLOW_PX = 48;

type Scrolled = Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">;

/** Is the thread at its end? Scrolled back from it, new lines don't drag it down. */
export function atEnd(el: Scrolled): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_PX;
}

/**
 * Does the thread still follow after a scroll? Scrolling up stops it at once,
 * however little: at the end already is the only way to stay. A panel docking
 * under the thread or a long line landing leaves it short of the end too, and
 * those must never read as reading back.
 */
export function followAfter(was: boolean, before: number, el: Scrolled): boolean {
  if (el.scrollTop < before - 0.5) return el.scrollHeight - el.scrollTop - el.clientHeight <= 1;
  return atEnd(el) ? true : was;
}

/** The CRT's typewriter (wave 52b): characters a second at his normal pace.
 *  A shade quicker than his voice, so a sentence is down as he ends it. */
export const TYPE_CPS = 17;
/** This far behind his voice (a voice that started late), it types faster. */
const TYPE_LAG = 50;

/**
 * His words typing out. `cut` is as far as his voice has got: the end of the
 * sentence he's on. It stops there and waits for the next, and the sentence's
 * room is taken from the first letter, so no word jumps a line mid-type.
 */
export function Typed({ text, cut, cps, onType }: { text: string; cut: number; cps: number; onType?: () => void }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= cut) return;
    const t = window.setTimeout(() => setShown((n) => Math.min(cut, n + (cut - n > TYPE_LAG ? 3 : 1))), 1000 / cps);
    return () => window.clearTimeout(t);
  }, [shown, cut, cps]);
  useLayoutEffect(() => onType?.(), [shown, onType]);
  return (
    <>
      {text.slice(0, shown)}
      <span className="cursor">▮</span>
      <span className="type-rest">{text.slice(shown, cut)}</span>
    </>
  );
}

export function Thread({
  lines,
  revealed,
  typing,
  character,
  guestName,
  earlier = false,
  empty,
  wait = null,
  typeCps = null,
}: {
  lines: Line[];
  /** How much of each of the character's messages to show (seq → chars). */
  revealed: ReadonlyMap<number, number>;
  typing: boolean;
  character: string;
  guestName: string;
  /** Older lines were left out (a room terminal shows this visit only): say so, once, on top. */
  earlier?: boolean;
  /** The empty thread's line (default: say something). */
  empty?: string;
  /** Wave 42b (B5): the guest's line is queued behind other programs. */
  wait?: WaitProps | null;
  /** His words type out as he says them at this many characters a second (null: as they always have). */
  typeCps?: number | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const scrolledTo = useRef(0);
  const last = lines[lines.length - 1];
  const lastReveal = last !== undefined ? revealed.get(last.seq) : undefined;
  // A line still queued for the voice (its reveal not started) is not drawn
  // yet: one typing row stands for all of them (B3), never a wall of empty cursors.
  const waiting = (m: Line) => m.theirs && revealed.get(m.seq) === 0;
  const queued = lines.some(waiting);

  /** Settle the follow against where the thread stands now. A render can land
   *  between someone's scroll and its event: it must not undo the scroll. */
  const look = (el: HTMLDivElement) => {
    following.current = followAfter(following.current, scrolledTo.current, el);
    scrolledTo.current = el.scrollTop;
  };
  const pin = () => {
    const el = box.current;
    if (el === null) return;
    look(el);
    if (following.current) {
      el.scrollTop = el.scrollHeight;
      scrolledTo.current = el.scrollTop;
    }
  };
  // Every render: a new line, a line revealed further, a line changed.
  useLayoutEffect(pin);
  // The box itself changing size moves its end too: a menu docking under it.
  useEffect(() => {
    const el = box.current;
    const RO = (window as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (el === null || RO === undefined) return;
    const ro = new RO(() => pin());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="thread" role="log" aria-live="polite" onScroll={(e) => look(e.currentTarget)}>
      {earlier && (
        <div className="line system earlier">
          <span className="text">— earlier messages are on your phone —</span>
        </div>
      )}
      {lines.length === 0 && (
        <div className="line system">
          <span className="text">{empty ?? `— direct line to ${character.toUpperCase()} open. say something. —`}</span>
        </div>
      )}
      {lines.map((m) => {
        if (waiting(m)) return null;
        const cut = revealed.get(m.seq);
        const text = cut === undefined ? m.text : m.text.slice(0, cut);
        const partial = cut !== undefined && cut < m.text.length;
        const who = m.theirs ? character : m.from === guestName || m.pick === true ? "you" : m.from;
        return (
          <div key={m.seq} className={lineClass(m, partial)} data-seq={m.seq}>
            <span className="meta">
              <span className="who">{who.toUpperCase()}</span>
              <span className="when">{stamp(m.ts)}</span>
            </span>
            <span className="text">
              {typeCps !== null && cut !== undefined ? (
                <Typed text={m.text} cut={cut} cps={typeCps} onType={pin} />
              ) : (
                <>
                  {text}
                  {partial && <span className="cursor">▮</span>}
                </>
              )}
            </span>
          </div>
        );
      })}
      {wait != null && !typing && !queued && <WaitLine {...wait} />}
      {(typing || queued) && (
        <div className="line theirs typing">
          <span className="meta">
            <span className="who">{character.toUpperCase()}</span>
          </span>
          <span className="text">
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

export function Composer({ onSend, disabled, onInput, placeholder }: { onSend: (text: string) => Promise<void>; disabled: boolean; onInput: () => void; placeholder: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (t === "" || disabled) return;
    setText("");
    setError(null);
    onInput();
    try {
      await onSend(t);
    } catch (err) {
      setError((err as Error).message);
      setText(t);
    }
    input.current?.focus();
  };
  return (
    <form className="composer" onSubmit={(e) => void submit(e)}>
      <span className="prompt">{">"}</span>
      <input
        ref={input}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="send"
        onChange={(e) => {
          setText(e.target.value);
          onInput();
        }}
        onFocus={onInput}
      />
      <button type="submit" disabled={disabled || text.trim() === ""}>
        SEND
      </button>
      {error && <div className="composer-error">{error}</div>}
    </form>
  );
}
