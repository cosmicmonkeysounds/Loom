// The in-app Help overlay: a searchable manual for the Loom language and the
// editor itself. Content lives in `docs/help/authoring/*.md`
// (shared with the repo docs); this component is layout + search UX only.
//
// Open with ⌘/ or F1, the `?` button in the TopBar, or the command palette.

import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { useHelp } from '@/store/help'
import {
  helpArticle,
  helpSearch,
  helpSections,
  inlineTokens,
  type HelpArticle,
  type HelpBlock,
} from '@/lib/help-content'

/** True when the keydown originated in a text-entry surface. */
function inTextSurface(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  return (
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.isContentEditable ||
    Boolean(t.closest('.cm-editor'))
  )
}

function Inline({ text, onNavigate }: { text: string; onNavigate: (slug: string) => void }) {
  const tokens = useMemo(() => inlineTokens(text), [text])
  return (
    <>
      {tokens.map((tok, i) => {
        if (tok.kind === 'code')
          return (
            <code key={i} className="px-1 py-0.5 rounded bg-white/10 text-amber-200/90 text-[0.92em] font-mono">
              {tok.text}
            </code>
          )
        if (tok.kind === 'bold')
          return (
            <strong key={i} className="font-semibold text-zinc-100">
              {tok.text}
            </strong>
          )
        if (tok.kind === 'italic') return <em key={i}>{tok.text}</em>
        if (tok.kind === 'link') {
          const external = /^[a-z]+:\/\//.test(tok.href)
          if (external)
            return (
              <a key={i} href={tok.href} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                {tok.text}
              </a>
            )
          return (
            <button
              key={i}
              type="button"
              onClick={() => onNavigate(tok.href)}
              className="text-blue-400 hover:underline"
            >
              {tok.text}
            </button>
          )
        }
        return <span key={i}>{tok.text}</span>
      })}
    </>
  )
}

function Block({ block, onNavigate }: { block: HelpBlock; onNavigate: (slug: string) => void }) {
  switch (block.kind) {
    case 'heading': {
      const cls =
        block.level <= 2
          ? 'text-base font-semibold text-zinc-100 mt-6 mb-2 first:mt-0'
          : 'text-sm font-semibold text-zinc-200 mt-4 mb-1.5'
      return (
        <div id={`help-${block.id}`} className={cls}>
          <Inline text={block.text} onNavigate={onNavigate} />
        </div>
      )
    }
    case 'para':
      return (
        <p className="text-sm text-zinc-300 leading-relaxed mb-3">
          <Inline text={block.text} onNavigate={onNavigate} />
        </p>
      )
    case 'code':
      return (
        <pre className="mb-3 rounded-md border border-white/10 bg-black/40 px-3 py-2.5 overflow-x-auto text-[12.5px] leading-relaxed font-mono text-emerald-100/90 whitespace-pre">
          {block.text}
        </pre>
      )
    case 'quote':
      return (
        <blockquote className="mb-3 border-l-2 border-blue-400/50 pl-3 text-sm text-zinc-400 leading-relaxed">
          <Inline text={block.text} onNavigate={onNavigate} />
        </blockquote>
      )
    case 'list':
      return block.ordered ? (
        <ol className="mb-3 list-decimal pl-5 space-y-1 text-sm text-zinc-300 leading-relaxed">
          {block.items.map((it, i) => (
            <li key={i}>
              <Inline text={it} onNavigate={onNavigate} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="mb-3 list-disc pl-5 space-y-1 text-sm text-zinc-300 leading-relaxed">
          {block.items.map((it, i) => (
            <li key={i}>
              <Inline text={it} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      )
    case 'table':
      return (
        <div className="mb-3 overflow-x-auto rounded-md border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white/5">
                {block.header.map((h, i) => (
                  <th key={i} className="px-3 py-1.5 text-left font-medium text-zinc-200 whitespace-nowrap">
                    <Inline text={h} onNavigate={onNavigate} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="border-t border-white/5 align-top">
                  {row.map((cell, j) => (
                    <td key={j} className="px-3 py-1.5 text-zinc-300">
                      <Inline text={cell} onNavigate={onNavigate} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'rule':
      return <hr className="my-4 border-white/10" />
  }
}

function Article({ article, onNavigate }: { article: HelpArticle; onNavigate: (slug: string) => void }) {
  return (
    <div data-testid="help-article">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1">{article.section}</div>
      <h1 className="text-lg font-semibold text-zinc-100 mb-4">{article.title}</h1>
      {article.blocks.map((b, i) => (
        <Block key={i} block={b} onNavigate={onNavigate} />
      ))}
    </div>
  )
}

export function HelpOverlay() {
  const open = useHelp((s) => s.open)

  // ⌘/ (or Ctrl+/) toggles; F1 opens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if ((mod && e.key === '/') || (e.key === 'F1' && !inTextSurface(e))) {
        e.preventDefault()
        useHelp.getState().toggleHelp()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The dialog mounts fresh on each open, so its search state starts clean.
  if (!open) return null
  return <HelpDialog />
}

function HelpDialog() {
  const slug = useHelp((s) => s.slug)
  const openHelp = useHelp((s) => s.openHelp)
  const closeHelp = useHelp((s) => s.closeHelp)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const article = helpArticle(slug)
  const hits = useMemo(() => (query.trim() ? helpSearch(query) : []), [query])
  const searching = query.trim().length > 0

  // Escape closes (or clears an active search first), wherever focus is.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (searching) setQuery('')
      else closeHelp()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [searching, closeHelp])

  // Scroll the article pane back to the top on navigation.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
  }, [slug])

  const navigate = (to: string) => {
    setQuery('')
    openHelp(to)
  }

  const pick = (i: number) => {
    const hit = hits[i]
    if (hit) navigate(hit.article.slug)
  }

  return (
    <div
      data-testid="help-overlay"
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6"
      onClick={closeHelp}
    >
      <div
        role="dialog"
        aria-modal
        aria-label="Help"
        className="w-[880px] max-w-[94vw] h-[82vh] bg-zinc-900 border border-white/10 rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: title + search + close */}
        <div className="px-4 py-2.5 border-b border-white/10 flex items-center gap-3 shrink-0">
          <span className="text-sm font-semibold text-zinc-100">Help</span>
          <div className="flex-1 relative">
            <input
              ref={searchRef}
              data-testid="help-search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelected(0)
              }}
              onKeyDown={(e) => {
                if (!searching) return
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSelected((i) => Math.min(hits.length - 1, i + 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSelected((i) => Math.max(0, i - 1))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  pick(selected)
                }
              }}
              placeholder="Search the manual…  (syntax, shortcuts, concepts)"
              className="w-full px-3 py-1.5 bg-white/5 rounded-md text-sm text-white outline-none border border-white/10 focus:border-blue-400/50 placeholder:text-zinc-600"
            />
          </div>
          <kbd className="text-[10px] font-mono text-zinc-600">⌘/</kbd>
          <button
            type="button"
            onClick={closeHelp}
            title="Close (Esc)"
            className="text-zinc-500 hover:text-zinc-200 text-lg leading-none px-1"
          >
            ×
          </button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* Sidebar: sections → articles */}
          <nav
            data-testid="help-nav"
            className="w-56 shrink-0 border-r border-white/10 overflow-y-auto py-2 bg-zinc-900/50"
          >
            {helpSections.map((sec) => (
              <div key={sec.title} className="mb-3">
                <div className="px-4 py-1 text-[11px] uppercase tracking-wide text-zinc-500">{sec.title}</div>
                {sec.articles.map((a) => (
                  <button
                    key={a.slug}
                    type="button"
                    data-testid={`help-nav-${a.slug}`}
                    onClick={() => navigate(a.slug)}
                    className={clsx(
                      'w-full text-left px-4 py-1 text-[13px] truncate',
                      !searching && article?.slug === a.slug
                        ? 'bg-blue-500/15 text-blue-200'
                        : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5',
                    )}
                  >
                    {a.title}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          {/* Main pane: search results or article */}
          <div ref={bodyRef} className="flex-1 min-w-0 overflow-y-auto px-6 py-5">
            {searching ? (
              <div data-testid="help-results">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">
                  {hits.length === 0 ? 'No matches' : `${hits.length} match${hits.length === 1 ? '' : 'es'}`}
                </div>
                <ul>
                  {hits.map((h, i) => (
                    <li key={h.article.slug}>
                      <button
                        type="button"
                        onMouseEnter={() => setSelected(i)}
                        onClick={() => pick(i)}
                        className={clsx(
                          'w-full text-left px-3 py-2 rounded-md mb-1',
                          i === selected ? 'bg-white/10' : 'hover:bg-white/5',
                        )}
                      >
                        <div className="text-sm text-zinc-100">
                          {h.article.title}
                          <span className="ml-2 text-[11px] text-zinc-500">{h.article.section}</span>
                        </div>
                        {h.snippet && <div className="text-xs text-zinc-400 truncate mt-0.5">{h.snippet}</div>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : article ? (
              <Article article={article} onNavigate={navigate} />
            ) : (
              <div className="text-sm text-zinc-500">No article selected.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
