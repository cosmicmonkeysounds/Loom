//! The in-app Help window — the manual for guests (and the
//! performer station). Content lives in `docs/help/play/*.md`,
//! shared with the repo docs and bundled at build time; the shared engine in
//! `docs/help/helpdoc.ts` parses + searches it, this file only renders.
//!
//! Wave 26 (integration): this chunk bundles the **guest** articles only.
//! The `role: performer` ones (07, 13, 14, 19, 20, 21, 22) are left out of the glob
//! below and live in `help-staff.tsx`, which only the booth and the
//! director import, so no guest path ever downloads them.
//! `test/help-chunks.test.ts` keeps both lists equal to the front matter.

import { useMemo, useState } from "react";
import {
  buildHelp,
  inlineTokens,
  searchHelp,
  type HelpArticle,
  type HelpBlock,
} from "../../docs/help/helpdoc.ts";

/** The guest articles, raw (keyed by path). A new `role: performer`
 *  article must be added to the negatives here and to `help-staff.tsx`. */
export const GUEST_FILES = import.meta.glob(
  [
    "../../docs/help/play/*.md",
    "!../../docs/help/play/07-performers.md",
    "!../../docs/help/play/13-director-phone.md",
    "!../../docs/help/play/14-hosts.md",
    "!../../docs/help/play/19-house-workings.md",
    "!../../docs/help/play/20-house-desk.md",
    "!../../docs/help/play/21-talk-back.md",
    "!../../docs/help/play/22-language-filter.md",
  ],
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
) as Record<string, string>;

const GUEST_ARTICLES = buildHelp(GUEST_FILES).articles.filter((a) => !a.role || a.role === "guest");

/** The articles a guest sees (never a `role: performer` one). */
export function guestArticles(): HelpArticle[] {
  return GUEST_ARTICLES;
}

function Inline({ text }: { text: string }) {
  const tokens = useMemo(() => inlineTokens(text), [text]);
  return (
    <>
      {tokens.map((tok, i) => {
        if (tok.kind === "code") return <code key={i}>{tok.text}</code>;
        if (tok.kind === "bold") return <strong key={i}>{tok.text}</strong>;
        if (tok.kind === "italic") return <em key={i}>{tok.text}</em>;
        if (tok.kind === "link") return <span key={i}>{tok.text}</span>;
        return <span key={i}>{tok.text}</span>;
      })}
    </>
  );
}

function Block({ block }: { block: HelpBlock }) {
  switch (block.kind) {
    case "heading":
      return (
        <div className="help-h">
          <Inline text={block.text} />
        </div>
      );
    case "para":
      return (
        <p className="help-p">
          <Inline text={block.text} />
        </p>
      );
    case "code":
      return <pre className="help-code">{block.text}</pre>;
    case "quote":
      return (
        <div className="help-quote">
          <Inline text={block.text} />
        </div>
      );
    case "list":
      return block.ordered ? (
        <ol className="help-list">
          {block.items.map((it, i) => (
            <li key={i}>
              <Inline text={it} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="help-list">
          {block.items.map((it, i) => (
            <li key={i}>
              <Inline text={it} />
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <table className="help-table">
          <thead>
            <tr>
              {block.header.map((h, i) => (
                <th key={i}>
                  <Inline text={h} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>
                    <Inline text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "rule":
      return <hr className="help-rule" />;
  }
}

/** The guests' Help window (`help-lazy.tsx` fetches it on first open). */
export function HelpSheet({ onClose }: { onClose: () => void }) {
  return <HelpWindow articles={guestArticles()} onClose={onClose} />;
}

/** The Help window: a searchable topic list ⇄ article reader over `articles`. */
export function HelpWindow({ articles, onClose }: { articles: HelpArticle[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  const hits = useMemo(() => (query.trim() ? searchHelp(articles, query) : []), [articles, query]);
  const open = openSlug ? articles.find((a) => a.slug === openSlug) : undefined;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet help-sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{open ? open.title : "Help — how to play"}</h2>

        {open ? (
          <>
            <div className="help-body">
              {open.blocks.map((b, i) => (
                <Block key={i} block={b} />
              ))}
            </div>
            <button className="link" onClick={() => setOpenSlug(null)}>
              ‹ All topics
            </button>
          </>
        ) : (
          <>
            <input
              placeholder="Search help… (rooms, scan, decisions…)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="help-body">
              {query.trim() ? (
                hits.length === 0 ? (
                  <div className="muted">Nothing found for “{query.trim()}”.</div>
                ) : (
                  hits.map((h) => (
                    <button key={h.article.slug} className="help-topic" onClick={() => setOpenSlug(h.article.slug)}>
                      <strong>{h.article.title}</strong>
                      {h.snippet && <span className="muted">{h.snippet}</span>}
                    </button>
                  ))
                )
              ) : (
                articles.map((a) => (
                  <button key={a.slug} className="help-topic" onClick={() => setOpenSlug(a.slug)}>
                    <strong>{a.title}</strong>
                    <span className="muted">{firstLine(a)}</span>
                  </button>
                ))
              )}
            </div>
          </>
        )}

        <button className="link" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function firstLine(a: HelpArticle): string {
  const para = a.blocks.find((b) => b.kind === "para");
  if (!para || para.kind !== "para") return "";
  const text = para.text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "");
  return text.length > 90 ? text.slice(0, 90) + "…" : text;
}
