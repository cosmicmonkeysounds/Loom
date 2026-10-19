//! "📎 GIVE HIM A FILE" — the heart terminal's file panel (wave 11, see
//! `files.ts`): the piloted program's codex entries with a Give each, a box
//! to type an unlock code, and the camera for a codex QR. While it is open
//! the line's leash holds (the app passes it as busy).

import { useState } from "react";
import type { CodexEntry, GuestView } from "@loom/play/types.ts";
import type { TerminalConfig } from "./config.ts";
import type { Pilot } from "./pilot.ts";
import { Scanner } from "./scanner.tsx";
import { filesOf, giveEntry, redeemCode, unlockOfScan } from "./files.ts";

type Note = { kind: "ok" | "bad"; text: string } | null;

export function FilePanel({ config, pilot, view, character, onClose }: { config: TerminalConfig; pilot: Pilot; view: GuestView | null; character: string; onClose: () => void }) {
  const [fresher, setFresher] = useState<CodexEntry[] | null>(null);
  const [given, setGiven] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  /** The entry a code just unlocked: offered first, to give. */
  const [unlocked, setUnlocked] = useState<string | null>(null);
  const files = filesOf(view, fresher);
  const who = character.toUpperCase();

  const give = async (e: CodexEntry) => {
    if (busy !== null) return;
    setBusy(e.id);
    const r = await giveEntry(config, pilot, e.id, character);
    setBusy(null);
    if (r.ok) {
      setGiven((g) => new Set(g).add(e.id));
      setNote({ kind: "ok", text: `GIVEN TO ${who}: ${e.title.toUpperCase()}` });
      if (unlocked === e.id) setUnlocked(null);
    } else setNote({ kind: "bad", text: `${who} DIDN'T TAKE IT — ${r.error.toUpperCase()}` });
  };

  const redeem = async (raw: string) => {
    if (busy !== null) return;
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
    setUnlocked(r.unlocked);
    const title = (r.codex ?? files).find((e) => e.id === r.unlocked)?.title ?? r.unlocked;
    setNote({ kind: "ok", text: `UNLOCKED: ${title.toUpperCase()} — GIVE IT TO ${who}?` });
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
        {first.map((e) => (
          <div key={e.id} className={`file-row${e.id === unlocked ? " fresh" : ""}`}>
            <span className="file-title">
              {e.title}
              {e.about !== null && <span className="small"> · about {e.about}</span>}
            </span>
            <button type="button" className="file-give" disabled={busy !== null || given.has(e.id)} onClick={() => void give(e)}>
              {given.has(e.id) ? "GIVEN" : busy === e.id ? "…" : "GIVE"}
            </button>
          </div>
        ))}
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
            active={busy === null}
            onCode={(text) => {
              const c = unlockOfScan(text);
              if (c === null) setNote({ kind: "bad", text: "THAT ISN'T A FILE'S QR" });
              else void redeem(c);
            }}
          />
        </div>
      )}
    </div>
  );
}
