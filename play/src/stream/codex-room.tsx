//! The Codex and the Quest Log rooms (wave 13): filing cabinets, not
//! streams. Every entry is a one-line row (title · about · how you got it),
//! collapsed until tapped, grouped by category, with a filter box and NEW
//! on what you haven't opened; the Quest Log puts what is in progress first
//! with its latest step, and folds what is done or failed.

import { useEffect, useMemo, useState } from "react";
import { usePlayHost } from "../host.ts";
import type { ChatMessage } from "../types.ts";
import { PersonAvatar } from "../ui/primitives.tsx";
import { useCardActions } from "./bubble.tsx";
import { codexGroups, codexRows, codexSub, markSeen, newEntries, questSections, type CodexRow, type QuestRow } from "./codex-groups.ts";

/** Show the filter box once the cabinet holds this many entries. */
export const CODEX_FILTER_AT = 4;

/** The newest system note in a pinned room (a wrong code, "You shared…")
 *  when nothing newer came after it — what the composer's last try said. */
function lastNote(messages: readonly ChatMessage[]): ChatMessage | null {
  const last = messages[messages.length - 1];
  return last !== undefined && last.kind === "system" && last.parentSeq == null ? last : null;
}

function seenKey(meId: string | null | undefined): string {
  return `loom.stream.codex-seen.${meId ?? "booth"}`;
}

function CodexEntryRow({ row, isNew, open, onToggle }: { row: CodexRow; isNew: boolean; open: boolean; onToggle: () => void }) {
  const actions = useCardActions();
  const sub = codexSub(row);
  return (
    <li className={`stream-row ${open ? "open" : ""} ${row.msg.hidden ? "hidden" : ""}`}>
      <button type="button" className="stream-row-head" aria-expanded={open} onClick={onToggle}>
        <span className="stream-row-main">
          <span className="stream-row-title">{row.card.title}</span>
          {sub && <span className="stream-row-sub">{sub}</span>}
        </span>
        {isNew && <span className="stream-new">New</span>}
        <span className="stream-settled-caret" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="stream-row-body">
          {row.msg.text && <p className="codex-text">{row.msg.text}</p>}
          {actions.shareCodex && (
            <div className="stream-row-foot">
              <button type="button" className="w95-btn" onClick={() => actions.shareCodex!(row.card.entry, row.card.title)}>
                Share…
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function CodexRoom({ messages, meId, empty }: { messages: readonly ChatMessage[]; meId?: string | null; empty: string }) {
  const host = usePlayHost();
  const rows = useMemo(() => codexRows(messages), [messages]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [seen, setSeen] = useState<ReadonlySet<string> | null>(() => {
    try {
      const list = host.storage.load<string[]>(seenKey(meId));
      return Array.isArray(list) ? new Set(list) : null;
    } catch {
      return null;
    }
  });
  // This device's first look: keep a record at once (all but the newest
  // entry seen), so what is learned from now on is NEW.
  useEffect(() => {
    if (seen !== null || rows.length === 0) return;
    const next = markSeen(rows, null, null);
    setSeen(new Set(next));
    try {
      host.storage.save(seenKey(meId), next);
    } catch {
      /* a blocked store: the record lives for this visit */
    }
  }, [seen, rows, host, meId]);
  const fresh = newEntries(rows, seen);
  const groups = codexGroups(rows, query);
  const note = lastNote(messages);
  const toggle = (entry: string) => {
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(entry)) n.delete(entry);
      else n.add(entry);
      return n;
    });
    if (fresh.has(entry)) {
      const next = markSeen(rows, seen, entry);
      setSeen(new Set(next));
      try {
        host.storage.save(seenKey(meId), next);
      } catch {
        /* a full or blocked store: NEW just stays on */
      }
    }
  };
  const foldGroup = (title: string) =>
    setFolded((f) => {
      const n = new Set(f);
      if (n.has(title)) n.delete(title);
      else n.add(title);
      return n;
    });
  return (
    <div className="thread stream-cabinet">
      {rows.length >= CODEX_FILTER_AT && (
        <label className="stream-filter">
          <span className="stream-sr">Filter your Codex</span>
          <input type="search" className="w95-inset" placeholder={`Filter ${rows.length} entries…`} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      {rows.length === 0 && <div className="thread-empty">{empty}</div>}
      {rows.length > 0 && groups.length === 0 && <div className="thread-empty">Nothing in your Codex matches “{query}”.</div>}
      {groups.map((g) => {
        const isFolded = folded.has(g.title) && query === "";
        const newHere = g.rows.filter((r) => fresh.has(r.card.entry)).length;
        return (
          <section key={g.title} className="stream-group">
            <button type="button" className="stream-group-head" aria-expanded={!isFolded} onClick={() => foldGroup(g.title)}>
              <span className="stream-group-title">{g.title}</span>
              <span className="stream-group-count">
                {g.rows.length}
                {newHere > 0 ? ` · ${newHere} new` : ""}
              </span>
              <span className="stream-settled-caret" aria-hidden>
                {isFolded ? "▸" : "▾"}
              </span>
            </button>
            {!isFolded && (
              <ul className="stream-rows">
                {g.rows.map((r) => (
                  <CodexEntryRow key={r.card.entry} row={r} isNew={fresh.has(r.card.entry)} open={open.has(r.card.entry)} onToggle={() => toggle(r.card.entry)} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {note && (
        <p className="stream-cabinet-note" role="status">
          {note.text}
        </p>
      )}
    </div>
  );
}

// --- the Quest Log -------------------------------------------------------------------

const STEP_GLYPH: Record<string, string> = { complete: "✅", fail: "✖", update: "▸", start: "📜" };

function QuestEntry({ row, open, onToggle }: { row: QuestRow; open: boolean; onToggle: () => void }) {
  const q = row.root.quest!;
  const giver = row.root.from;
  return (
    <li className={`stream-row stream-quest ${row.status} ${open ? "open" : ""}`}>
      <button type="button" className="stream-row-head" aria-expanded={open} onClick={onToggle}>
        <span className="stream-row-main">
          <span className="stream-row-title">{q.title}</span>
          {/* The section says where it stands; the row says what happened last. */}
          {(row.latest || (!open && giver)) && <span className="stream-row-sub">{row.latest || `from ${giver.replace(/_/g, " ")}`}</span>}
        </span>
        <span className="stream-settled-caret" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="stream-row-body">
          {giver && (
            <div className="quest-giver">
              <PersonAvatar name={giver} size="sm" kind="character" /> from {giver.replace(/_/g, " ")}
            </div>
          )}
          {row.root.text && <p className="quest-text">{row.root.text}</p>}
          {row.steps.length > 0 && (
            <ol className="stream-steps">
              {row.steps.map((s) => (
                <li key={s.seq} className={`stream-step ${s.quest?.action ?? ""}`}>
                  <span aria-hidden>{STEP_GLYPH[s.quest?.action ?? ""] ?? "▸"} </span>
                  {s.text || (s.quest?.action === "complete" ? "Quest complete." : s.quest?.action === "fail" ? "Quest failed." : "")}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

function QuestSection({ title, rows, startOpen, open, onToggle }: { title: string; rows: QuestRow[]; startOpen: boolean; open: ReadonlySet<number>; onToggle: (seq: number) => void }) {
  const [shown, setShown] = useState(startOpen);
  if (rows.length === 0) return null;
  return (
    <section className="stream-group">
      <button type="button" className="stream-group-head" aria-expanded={shown} onClick={() => setShown((v) => !v)}>
        <span className="stream-group-title">{title}</span>
        <span className="stream-group-count">{rows.length}</span>
        <span className="stream-settled-caret" aria-hidden>
          {shown ? "▾" : "▸"}
        </span>
      </button>
      {shown && (
        <ul className="stream-rows">
          {rows.map((r) => (
            <QuestEntry key={r.root.seq} row={r} open={open.has(r.root.seq)} onToggle={() => onToggle(r.root.seq)} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function QuestRoom({ messages, empty }: { messages: readonly ChatMessage[]; empty: string }) {
  const sections = useMemo(() => questSections(messages), [messages]);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const toggle = (seq: number) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(seq)) n.delete(seq);
      else n.add(seq);
      return n;
    });
  const none = sections.active.length + sections.done.length + sections.failed.length === 0;
  return (
    <div className="thread stream-cabinet">
      {none && <div className="thread-empty">{empty}</div>}
      {!none && sections.active.length === 0 && <p className="stream-cabinet-note">Nothing in progress right now. New quests land here.</p>}
      <QuestSection title="In progress" rows={sections.active} startOpen open={open} onToggle={toggle} />
      <QuestSection title="Done" rows={sections.done} startOpen={false} open={open} onToggle={toggle} />
      <QuestSection title="Failed" rows={sections.failed} startOpen={false} open={open} onToggle={toggle} />
    </div>
  );
}
