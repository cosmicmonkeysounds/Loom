//! Wave 41 (C3): a performer's opt-in to Jean Trabolta's letter. Performers
//! are never uploaded, so the booth asks them itself (no story line): a
//! small card on the booth's home, below the NOW card, never over a scan.
//! It shows until the performer sends an address or taps *No thanks* (kept
//! per event + character in the host's storage, every read and write
//! guarded); with one on file it folds to `✔ <address>` and Change /
//! Remove. `PrimeView.letter` absent (an older server, a booth with no
//! character) → nothing. `POST /api/prime/letter {email}`.

import { useEffect, useState } from "react";
import { usePlayHost } from "../host.ts";
import type { PrimeLetter } from "../types.ts";
import { EMAIL_MAX, emailResult } from "../widgets.tsx";
import { LETTER_COPY, LETTER_TITLE, letterCardState, letterDismissKey, letterErrorText, loadLetterDismissed, saveLetterDismissed } from "./letter-model.ts";

export function LetterCard({ letter, eventId, character, save }: { letter: PrimeLetter | undefined; eventId: string; character: string; save: ((email: string | null) => Promise<{ ok: true; email: string | null }>) | undefined }) {
  const host = usePlayHost();
  const key = letterDismissKey(eventId, character);
  const [dismissed, setDismissed] = useState(() => loadLetterDismissed(host.storage, key));
  // The server's own answer to the last save, until the view catches up.
  const [saved, setSaved] = useState<{ email: string | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewEmail = letter?.email ?? null;
  useEffect(() => {
    setSaved(null);
  }, [viewEmail]);
  useEffect(() => {
    setDismissed(loadLetterDismissed(host.storage, key));
  }, [host.storage, key]);
  const email = saved !== null ? saved.email : viewEmail;
  const state = letterCardState(letter, email, dismissed, editing);
  if (state === "none" || save === undefined) return null;

  const send = async (value: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const r = await save(value);
      setSaved({ email: r.email ?? value });
      setEditing(false);
      setText("");
      // Removing it is a "no thanks" too: the ask doesn't come back.
      if (value === null) {
        saveLetterDismissed(host.storage, key);
        setDismissed(true);
      }
    } catch (e) {
      setError(letterErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (state === "onFile") {
    return (
      <div className="booth-letter on-file" role="region" aria-label="Your letter">
        <span className="booth-letter-addr">✔ {email}</span>
        <button type="button" className="link" disabled={busy} onClick={() => (setText(email ?? ""), setEditing(true))}>
          Change
        </button>
        <button type="button" className="link" disabled={busy} onClick={() => void send(null)}>
          Remove
        </button>
        {error !== null && <span className="booth-err">{error}</span>}
      </div>
    );
  }

  const result = emailResult(text);
  const go = () => {
    if (result !== null && !busy) void send(String(result["email"]));
  };
  return (
    <div className="booth-letter" role="region" aria-label="A letter from Jean Trabolta">
      <div className="booth-letter-title">{LETTER_TITLE}</div>
      <p className="booth-letter-copy">{LETTER_COPY}</p>
      <div className="booth-letter-row">
        <input
          className="booth-letter-input"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={EMAIL_MAX}
          placeholder="you@example.com"
          aria-label="Your email"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
          }}
        />
        <button type="button" className="choice primary booth-letter-go" disabled={result === null || busy} onClick={go}>
          Send
        </button>
      </div>
      <div className="booth-letter-foot">
        {error !== null && <span className="booth-err">{error}</span>}
        {editing ? (
          <button type="button" className="link" onClick={() => (setEditing(false), setError(null))}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="link"
            onClick={() => {
              saveLetterDismissed(host.storage, key);
              setDismissed(true);
            }}
          >
            No thanks
          </button>
        )}
      </div>
    </div>
  );
}
