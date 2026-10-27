//! The thread — one conversation, rendered like a terminal log: the
//! character's lines in phosphor, the program's in a dimmer tone, and the
//! line being spoken revealed as far as the voice has got (`revealed` is
//! a character offset per message seq). Scrolls to the newest line. At the
//! heart a pick from the choice panel is the server's own `pick` line
//! (wave 28: posted for every pick, on the phone too, and kept across a
//! reload), drawn as YOU with the time, a deed (`act`) in brackets. A line
//! still queued for the voice waits behind one typing row.

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Line } from "./pilot.ts";

function stamp(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** A line's class: a pick (wave 28) reads as an echo of the panel, a deed as an act. */
export function lineClass(m: Pick<Line, "theirs" | "kind" | "pick" | "act" | "pending">, partial: boolean): string {
  const pick = !m.theirs && m.pick === true ? ` echo${m.act === true ? " act" : ""}${m.pending === true ? " pending" : ""}` : "";
  return `line ${m.theirs ? "theirs" : "mine"} kind-${m.kind}${pick}${partial ? " partial" : ""}`;
}

export function Thread({
  lines,
  revealed,
  typing,
  character,
  guestName,
  earlier = false,
  empty,
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
}) {
  const end = useRef<HTMLDivElement>(null);
  const last = lines[lines.length - 1];
  const lastReveal = last !== undefined ? revealed.get(last.seq) : undefined;
  // A line still queued for the voice (its reveal not started) is not drawn
  // yet: one typing row stands for all of them (B3), never a wall of empty cursors.
  const waiting = (m: Line) => m.theirs && revealed.get(m.seq) === 0;
  const queued = lines.some(waiting);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lines.length, typing, lastReveal, queued]);
  return (
    <div className="thread" role="log" aria-live="polite">
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
          <div key={m.seq} className={lineClass(m, partial)}>
            <span className="meta">
              <span className="who">{who.toUpperCase()}</span>
              <span className="when">{stamp(m.ts)}</span>
            </span>
            <span className="text">
              {text}
              {partial && <span className="cursor">▮</span>}
            </span>
          </div>
        );
      })}
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
      <div ref={end} />
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
