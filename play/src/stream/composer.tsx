//! The composer (moved out of `chat.tsx` in wave 13) and why it is gone.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Channel } from "../types.ts";

/** The longest line the server takes on `/api/guest/say` and
 *  `/api/prime/say` (C5: longer is a 413) — the box stops there. */
export const CHAT_TEXT_MAX = 2000;

/**
 * A roomy auto-growing text box + Send button. Used in channels + thread
 * replies. Grows with what you type (up to a cap) so you can always see the
 * whole message — Enter sends, Shift+Enter drops a newline.
 */
export function Composer({
  onSend,
  placeholder,
  disabled,
  sendLabel,
  extra,
  initial,
  onText,
  autoFocus,
}: {
  /** Return the send's promise to keep the text until the server takes it:
   *  a refusal (slow mode, paused doors, can't post) leaves it in the box. */
  onSend: (text: string) => unknown;
  placeholder?: string;
  disabled?: boolean;
  /** The button's word ("Send"; the Codex says "Unlock"). */
  sendLabel?: string;
  /** A button before the box (the Codex's 📷 Scan). */
  extra?: ReactNode;
  /** Wave 26 (P1): the draft to start from, and every change to it, so a
   *  half-typed line survives the composer folding to its button. */
  initial?: string;
  onText?: (text: string) => void;
  /** Wave 26 (P1): focus on mount — inside the tap that unfolded it, so the
   *  phone's keyboard opens (a layout effect runs inside `flushSync`). */
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(initial ?? "");
  useEffect(() => onText?.(text), [text, onText]);
  useLayoutEffect(() => {
    if (autoFocus === true) ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Reflow the textarea to fit its content (bounded by the CSS max-height).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  const send = () => {
    if (sending) return;
    const sent = text;
    const pending = sendFromComposer(sent, onSend);
    if (pending === null) return;
    setSending(true);
    void pending.then((clear) => {
      setSending(false);
      // Only clear what was sent: never words typed while it was in flight.
      if (clear) setText((now) => (now === sent ? "" : now));
    });
  };
  return (
    <div className="composer">
      {extra}
      <textarea
        ref={ref}
        className="composer-input"
        rows={1}
        value={text}
        placeholder={placeholder ?? "Say something…"}
        maxLength={CHAT_TEXT_MAX}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      {/* Send keeps the focus in the box (a chat app's Send): the keyboard
          stays up, nothing moves under the finger, the next line is ready. */}
      <button className="choice composer-send" onMouseDown={keepFocus} onClick={send} disabled={disabled || sending}>
        {sendLabel ?? "Send"}
      </button>
    </div>
  );
}

/** A mousedown that leaves the focus where it is (the box keeps it). */
export function keepFocus(e: { preventDefault: () => void }): void {
  e.preventDefault();
}

/** Send a composer's text: `null` for nothing to send, else whether to
 *  clear the box — once the send resolves, never after a refusal (the
 *  caller has already said why; the guest keeps their words to retry). */
export function sendFromComposer(raw: string, onSend: (text: string) => unknown): Promise<boolean> | null {
  const t = raw.trim();
  if (t === "") return null;
  let result: unknown;
  try {
    result = onSend(t);
  } catch {
    return Promise.resolve(false);
  }
  if (result !== null && typeof result === "object" && typeof (result as { then?: unknown }).then === "function") {
    return (result as Promise<unknown>).then(
      () => true,
      () => false,
    );
  }
  return Promise.resolve(true);
}

/** A restricted (marked) program standing in a room may not post there (B4). */
export const RESTRICTED_ROOM_NOTE = "⛔ You're restricted — you can only talk in your direct messages.";

/** A DM with a character nobody voices — no performer, no agent (wave 13). */
export const NOBODY_READS_NOTE = "This program doesn't read replies.";

/** Why the composer is gone: restricted where you stand, elsewhere, a DM
 *  nobody reads, or read-only. */
export function cantPostNote(channel: Pick<Channel, "kind" | "member" | "here">): string {
  if (channel.kind === "dm") return NOBODY_READS_NOTE;
  if (channel.kind !== "location") return "This room is read-only.";
  // Standing here and still refused: only restriction does that.
  if (channel.member === true || channel.here === true) return RESTRICTED_ROOM_NOTE;
  return "You're not in this room — walk there to talk here.";
}
