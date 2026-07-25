//! The in-app Help window — an AOL-skinned manual for guests (and the
//! performer station). Content lives in `docs/help/play/*.md`,
//! shared with the repo docs and bundled at build time; the shared engine in
//! `docs/help/helpdoc.ts` parses + searches it, this file only renders.

import { useMemo, useState } from "react";
import {
  buildHelp,
  inlineTokens,
  searchHelp,
  type HelpArticle,
  type HelpBlock,
} from "../../docs/help/helpdoc.ts";

const files = import.meta.glob("../../docs/help/play/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const HELP = buildHelp(files);

/** The articles an audience sees: performers get everything. */
export function articlesFor(role: "guest" | "performer"): HelpArticle[] {
  return HELP.articles.filter((a) => !a.role || a.role === role);
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

/** The Help window: a searchable topic list ⇄ article reader. */
export function HelpSheet({ role, onClose }: { role: "guest" | "performer"; onClose: () => void }) {
  const articles = useMemo(() => articlesFor(role), [role]);
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
