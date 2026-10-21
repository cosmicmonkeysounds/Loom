//! The Codex and the Quest Log rooms (wave 13): filing cabinets, not
//! streams. Every entry is a one-line row (title · about · how you got it),
//! collapsed until tapped, grouped by category, with a filter box and NEW
//! on what you haven't opened; the Quest Log puts what is in progress first
//! with its latest step, and folds what is done or failed.

import { useEffect, useMemo, useRef, useState } from "react";
import { usePlayHost } from "../host.ts";
import { CODEX_SEEN_MS, loadSeen, saveSeen } from "./codex-seen.ts";
import type { ChatMessage } from "../types.ts";
import { PersonAvatar } from "../ui/primitives.tsx";
import { useCardActions } from "./bubble.tsx";
import { codexGroups, codexMatches, codexRows, codexSub, markSeen, newEntries, questSections, type CodexRow, type QuestRow } from "./codex-groups.ts";

/** Show the filter box once the cabinet holds this many entries. */
export const CODEX_FILTER_AT = 4;

/** The newest system note in a pinned room (a wrong code, "You shared…")
 *  when nothing newer came after it — what the composer's last try said. */
function lastNote(messages: readonly ChatMessage[]): ChatMessage | null {
  const last = messages[messages.length - 1];
  return last !== undefined && last.kind === "system" && last.parentSeq == null ? last : null;
}

export { CODEX_SEEN_MS, codexUnseen } from "./codex-seen.ts";

function CodexEntryRow({ row, isNew, open, onToggle }: { row: CodexRow; isNew: boolean; open: boolean; onToggle: () => void }) {
  const actions = useCardActions();
  const sub = codexSub(row);
  return (
    <li data-codex-entry={row.card.entry} className={`stream-row ${open ? "open" : ""} ${row.msg.hidden ? "hidden" : ""}`}>
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

/** What the cabinet must change to show `entry` (wave 18b, R1: a scan
 *  lands on its entry): null while the entry isn't in the rows yet (its card
 *  may come in on the stream just after the redeem answered — try again on
 *  the next rows), else the group to unfold and whether the filter box has
 *  to be cleared (it hides the entry). */
export function focusPlan(rows: readonly CodexRow[], entry: string, query: string): { group: string; clearQuery: boolean } | null {
  const row = rows.find((r) => r.card.entry === entry);
  if (row === undefined) return null;
  return { group: row.category, clearQuery: query !== "" && !codexMatches(row, query) };
}

export function CodexRoom({ messages, meId, empty, focusEntry }: { messages: readonly ChatMessage[]; meId?: string | null; empty: string; focusEntry?: string | null }) {
  const host = usePlayHost();
  const rows = useMemo(() => codexRows(messages), [messages]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(focusEntry ? [focusEntry] : []));
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  // What was seen when the room opened: NEW stays on what it was NEW for,
  // for this whole visit (and on anything that lands while it is open).
  const [seen, setSeen] = useState<ReadonlySet<string> | null>(() => loadSeen(host.storage, meId));
  // Wave 18 (rule 6): two seconds on screen and everything shown is seen —
  // stored at once, so the next open (and Mission's tile) agree.
  const shown = useRef(rows);
  shown.current = rows;
  useEffect(() => {
    const t = setTimeout(() => {
      const base = loadSeen(host.storage, meId) ?? new Set<string>();
      const next = new Set(base);
      for (const r of shown.current) next.add(r.card.entry);
      saveSeen(host.storage, meId, [...next]);
    }, CODEX_SEEN_MS);
    return () => clearTimeout(t);
  }, [host, meId]);
  // A Codex entry exit (`go codex: <Entry>`, a scan's dialog) opens on that
  // entry: open its row, unfold its group, clear a filter that hides it, and
  // scroll to it. Wave 18b (R1): retried as the rows change until the entry
  // is there (its card can land on the stream just after the redeem), and
  // looked up under this room's own root — never `document`, which an
  // embedded player's shadow root hides it from.
  const root = useRef<HTMLDivElement>(null);
  const focusing = useRef<string | null>(null);
  useEffect(() => {
    focusing.current = focusEntry ?? null;
  }, [focusEntry]);
  useEffect(() => {
    const entry = focusing.current;
    if (entry === null) return;
    const plan = focusPlan(rows, entry, query);
    if (plan === null) return;
    setOpen((o) => (o.has(entry) ? o : new Set(o).add(entry)));
    setFolded((f) => {
      if (!f.has(plan.group)) return f;
      const n = new Set(f);
      n.delete(plan.group);
      return n;
    });
    if (plan.clearQuery) setQuery("");
    // Scroll once the row has rendered (after the state above).
    const t = window.setTimeout(() => {
      const list = root.current?.querySelectorAll<HTMLElement>("[data-codex-entry]");
      if (list === undefined) return;
      for (let i = 0; i < list.length; i++) {
        const el = list[i]!;
        if (el.getAttribute("data-codex-entry") !== entry) continue;
        el.scrollIntoView?.({ block: "center" });
        focusing.current = null;
        return;
      }
    }, 30);
    return () => window.clearTimeout(t);
  }, [focusEntry, rows, query]);
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
      const stored = new Set(loadSeen(host.storage, meId) ?? []);
      stored.add(entry);
      saveSeen(host.storage, meId, [...stored]);
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
    <div className="thread stream-cabinet" ref={root}>
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
