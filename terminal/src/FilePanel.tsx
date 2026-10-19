//! "📎 GIVE HIM A FILE" — the heart terminal's file panel (wave 11, see
//! `files.ts`): the piloted program's codex entries with a Give each, a box
//! to type an unlock code, and the camera for a codex QR. While it is open
//! the line's leash runs longer (`FILES_IDLE_MS`, see `idle.ts`); every tap,
//! key and camera read here feeds it (`onActivity`).
//!
//! A camera read is redeemed at most once (`scanStep`): the camera stops
//! after it, a read while a redeem is in flight is dropped, and a code this
//! panel already unlocked is shown again without asking the server — every
//! redeem is journaled, and a wrong one is a `wrong code` for the story.

import { useRef, useState } from "react";
import type { CodexEntry, GuestView } from "@loom/play/types.ts";
import type { TerminalConfig } from "./config.ts";
import type { Pilot } from "./pilot.ts";
import { Scanner } from "./scanner.tsx";
import { filesOf, foldCode, giveEntry, redeemCode, refusalOf, scanStep } from "./files.ts";

type Note = { kind: "ok" | "bad"; text: string } | null;

export function FilePanel({
  config,
  pilot,
  view,
  character,
  onClose,
  onActivity,
}: {
  config: TerminalConfig;
  pilot: Pilot;
  view: GuestView | null;
  character: string;
  onClose: () => void;
  /** Someone is using the panel (a camera read — taps and keys reach the leash on their own). */
  onActivity?: () => void;
}) {
  const [fresher, setFresher] = useState<CodexEntry[] | null>(null);
  const [given, setGiven] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusyState] = useState<string | null>(null);
  // The same, synchronously: two camera reads can land before a re-render.
  const busyRef = useRef<string | null>(null);
  const setBusy = (b: string | null) => {
    busyRef.current = b;
    setBusyState(b);
  };
  /** Codes this panel unlocked (folded code → entry id). */
  const redeemed = useRef(new Map<string, string>());
  const [note, setNote] = useState<Note>(null);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  /** The entry a code just unlocked: offered first, to give. */
  const [unlocked, setUnlocked] = useState<string | null>(null);
  const files = filesOf(view, fresher);
  const who = character.toUpperCase();

  const give = async (e: CodexEntry) => {
    if (busyRef.current !== null) return;
    setBusy(e.id);
    const r = await giveEntry(config, pilot, e.id, character);
    setBusy(null);
    if (r.ok) {
      setGiven((g) => new Set(g).add(e.id));
      setNote({ kind: "ok", text: `GIVEN TO ${who}: ${e.title.toUpperCase()}` });
      if (unlocked === e.id) setUnlocked(null);
    } else setNote({ kind: "bad", text: `${who} DIDN'T TAKE IT — ${r.error.toUpperCase()}` });
  };

  const offer = (entry: string, title: string, again: boolean, list: CodexEntry[] = files) => {
    setUnlocked(entry);
    const e = list.find((f) => f.id === entry);
    const no = e !== undefined ? refusalOf(e, character) : null;
    const head = `${again ? "ALREADY UNLOCKED" : "UNLOCKED"}: ${title.toUpperCase()}`;
    setNote({ kind: "ok", text: no === null ? `${head} — GIVE IT TO ${who}?` : `${head} — IT'S IN YOUR CODEX (${no.toUpperCase()})` });
  };

  const redeem = async (raw: string) => {
    if (busyRef.current !== null) return;
    const known = redeemed.current.get(foldCode(raw));
    if (known !== undefined) {
      setCode("");
      offer(known, files.find((e) => e.id === known)?.title ?? known, true);
      return;
    }
    setBusy("redeem");
    const r = await redeemCode(config, pilot, raw);
    setBusy(null);
    if (!r.ok) {
      setNote({ kind: "bad", text: r.error.toUpperCase() });
      return;
    }
    if (r.codex !== null) setFresher(r.codex);
    if (r.unlocked === null) {
      setNote({ kind: "bad", text: "NO NEW FILE FOR THAT CODE — WRONG, OR ALREADY IN YOUR CODEX" });
      return;
    }
    setCode("");
    redeemed.current.set(foldCode(raw), r.unlocked);
    const list = r.codex !== null ? filesOf(view, r.codex) : files;
    offer(r.unlocked, list.find((e) => e.id === r.unlocked)?.title ?? r.unlocked, false, list);
  };

  const first = unlocked === null ? files : [...files.filter((e) => e.id === unlocked), ...files.filter((e) => e.id !== unlocked)];

  return (
    <div className="file-panel" role="dialog" aria-label={`give ${character} a file`}>
      <div className="file-head">
        <span>📎 GIVE {who} A FILE</span>
        <button type="button" className="link" onClick={onClose}>
          BACK TO THE LINE
        </button>
      </div>
      {note !== null && <div className={`file-note ${note.kind}`}>{note.text}</div>}
      <div className="file-list">
        {first.length === 0 && <div className="small">your Codex is empty — type a code or scan a file's QR below</div>}
        {first.map((e) => {
          const no = refusalOf(e, character);
          return (
            <div key={e.id} className={`file-row${e.id === unlocked ? " fresh" : ""}${no !== null ? " kept" : ""}`}>
              <span className="file-title">
                {e.title}
                {e.about !== null && <span className="small"> · about {e.about}</span>}
              </span>
              {no !== null ? (
                <span className="file-kept small">{no.toUpperCase()}</span>
              ) : (
                <button type="button" className="file-give" disabled={busy !== null || given.has(e.id)} onClick={() => void give(e)}>
                  {given.has(e.id) ? "GIVEN" : busy === e.id ? "…" : "GIVE"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <form
        className="typed file-code"
        onSubmit={(ev) => {
          ev.preventDefault();
          void redeem(code);
        }}
      >
        <input value={code} onChange={(ev) => setCode(ev.target.value)} placeholder="TYPE A CODE" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
        <button type="submit" disabled={busy !== null || code.trim() === ""}>
          UNLOCK
        </button>
        <button type="button" className="link" onClick={() => setScanning((v) => !v)}>
          {scanning ? "STOP CAMERA" : "SCAN A FILE'S QR"}
        </button>
      </form>
      {scanning && (
        <div className="scan-frame file-scan">
          <Scanner
            facing={config.camera}
            active
            onCode={(text) => {
              onActivity?.();
              const step = scanStep(text, { busy: busyRef.current !== null, redeemed: redeemed.current });
              if (step.kind === "bad") setNote({ kind: "bad", text: "THAT ISN'T A FILE'S QR" });
              else if (step.kind === "again") offer(step.entry, files.find((e) => e.id === step.entry)?.title ?? step.entry, true);
              else if (step.kind === "redeem") {
                // One read per SCAN tap: a QR held to the lens would
                // otherwise be redeemed again every few seconds.
                setScanning(false);
                void redeem(step.code);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
