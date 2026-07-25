//! The in-app help engine shared by the editor (`loom-app`) and the
//! participant app (`loom-play`). Pure and dependency-free: it parses the
//! markdown articles that live next to it (see `authoring/` + `play/`),
//! builds a sectioned table of contents, and answers search queries.
//!
//! Each app loads its collection with
//! `import.meta.glob('../../docs/help/<collection>/*.md', { query: '?raw', … })`
//! and renders the block/inline token streams with its own styling — the
//! content and the search behaviour stay identical across apps.
//!
//! Article format: markdown with a small frontmatter header —
//!
//! ```
//! ---
//! title: Choices & branching
//! section: Language
//! order: 21
//! keywords: choice, sticky, divert, branch
//! role: performer          (optional — play app: guest | performer)
//! ---
//! ```

export type HelpBlock =
  | { kind: 'heading'; level: number; text: string; id: string }
  | { kind: 'para'; text: string }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' }

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  /** `href` is either an article slug (internal cross-link) or a URL. */
  | { kind: 'link'; text: string; href: string }

export type HelpArticle = {
  /** Stable id — the filename without its numeric prefix or extension. */
  slug: string
  title: string
  section: string
  order: number
  keywords: string[]
  /** Optional audience gate (play app: 'guest' | 'performer'). */
  role?: string
  blocks: HelpBlock[]
  /** Lower-cased plain text of the whole body, for search. */
  plain: string
}

export type HelpSection = { title: string; articles: HelpArticle[] }

export type HelpHit = {
  article: HelpArticle
  score: number
  /** A short body excerpt around the first match (empty on title-only hits). */
  snippet: string
}

/** `authoring/30-characters.md` → slug `characters`. */
export function slugForPath(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.md$/, '').replace(/^\d+-/, '')
}

function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Strip markdown inline syntax for indexing/snippets. */
function plainText(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
}

// ── Frontmatter ──────────────────────────────────────────────────────────────

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {}
  if (!raw.startsWith('---')) return { meta, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return { meta, body: raw }
  for (const line of raw.slice(3, end).split('\n')) {
    const i = line.indexOf(':')
    if (i < 0) continue
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { meta, body: raw.slice(end + 4) }
}

// ── Block parser ─────────────────────────────────────────────────────────────

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '\\' && trimmed[i + 1] === '|') {
      cur += '|'
      i++
    } else if (ch === '|') {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur.trim())
  return cells
}

export function parseBlocks(body: string): HelpBlock[] {
  const lines = body.split('\n')
  const at = (n: number): string => lines[n] ?? ''
  const blocks: HelpBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = at(i)
    const t = line.trim()

    if (t === '') {
      i++
      continue
    }

    // Fenced code block. The closing fence must be at least as long as the
    // opener, so a ````-fenced block can contain literal ``` lines.
    const fence = t.match(/^(`{3,})(\w*)/)
    if (fence) {
      const close = fence[1] ?? '```'
      const lang = fence[2] ?? ''
      const buf: string[] = []
      i++
      while (i < lines.length && !at(i).trim().startsWith(close)) {
        buf.push(at(i))
        i++
      }
      i++ // closing fence
      blocks.push({ kind: 'code', lang, text: buf.join('\n') })
      continue
    }

    // Heading.
    const h = t.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      const text = (h[2] ?? '').trim()
      blocks.push({ kind: 'heading', level: (h[1] ?? '#').length, text, id: headingId(text) })
      i++
      continue
    }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      blocks.push({ kind: 'rule' })
      i++
      continue
    }

    // Table: a `|`-led line followed by a separator row.
    if (t.startsWith('|') && i + 1 < lines.length && /^\|?[\s:|-]+\|?$/.test(at(i + 1).trim()) && at(i + 1).includes('-')) {
      const header = splitTableRow(t)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && at(i).trim().startsWith('|')) {
        rows.push(splitTableRow(at(i)))
        i++
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    // Blockquote.
    if (t.startsWith('>')) {
      const buf: string[] = []
      while (i < lines.length && at(i).trim().startsWith('>')) {
        buf.push(at(i).trim().replace(/^>\s?/, ''))
        i++
      }
      blocks.push({ kind: 'quote', text: buf.join(' ').trim() })
      continue
    }

    // List (unordered `- ` or ordered `1. `); an indented continuation line
    // folds into the previous item.
    const isUl = t.startsWith('- ')
    const isOl = /^\d+\.\s/.test(t)
    if (isUl || isOl) {
      const ordered = isOl
      const items: string[] = []
      while (i < lines.length) {
        const raw = at(i)
        const it = raw.trim()
        if (it.startsWith('- ') || /^\d+\.\s/.test(it)) {
          items.push(it.replace(/^(-|\d+\.)\s+/, ''))
          i++
        } else if (it !== '' && /^\s+\S/.test(raw) && items.length > 0) {
          items.push((items.pop() ?? '') + ' ' + it)
          i++
        } else {
          break
        }
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    // Paragraph: gather until a blank line or a structural opener.
    const buf: string[] = []
    while (i < lines.length) {
      const p = at(i).trim()
      if (
        p === '' ||
        p.startsWith('#') ||
        p.startsWith('```') ||
        p.startsWith('>') ||
        p.startsWith('- ') ||
        p.startsWith('|') ||
        /^\d+\.\s/.test(p) ||
        /^(-{3,}|\*{3,})$/.test(p)
      )
        break
      buf.push(p)
      i++
    }
    if (buf.length > 0) blocks.push({ kind: 'para', text: buf.join(' ') })
  }
  return blocks
}

// ── Inline tokenizer ─────────────────────────────────────────────────────────

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]*\]\([^)]*\))/g

export function inlineTokens(text: string): InlineToken[] {
  const out: InlineToken[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push({ kind: 'text', text: text.slice(last, idx) })
    const tok = m[0]
    if (m[1]) out.push({ kind: 'code', text: tok.slice(1, -1) })
    else if (m[2]) out.push({ kind: 'bold', text: tok.slice(2, -2) })
    else if (m[3]) out.push({ kind: 'italic', text: tok.slice(1, -1) })
    else if (m[4]) out.push({ kind: 'italic', text: tok.slice(1, -1) })
    else {
      const lm = tok.match(/^\[([^\]]*)\]\(([^)]*)\)$/)
      if (lm) out.push({ kind: 'link', text: lm[1] ?? '', href: normalizeHref(lm[2] ?? '') })
    }
    last = idx + tok.length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}

/** `./21-choices.md` or `choices.md` → the article slug `choices`. */
function normalizeHref(href: string): string {
  if (/^[a-z]+:\/\//.test(href)) return href
  return slugForPath(href.replace(/^\.\//, '').replace(/#.*$/, ''))
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export function parseHelpArticle(path: string, raw: string): HelpArticle {
  const { meta, body } = parseFrontmatter(raw)
  const blocks = parseBlocks(body)
  const plainParts: string[] = []
  for (const b of blocks) {
    if (b.kind === 'heading' || b.kind === 'para' || b.kind === 'quote') plainParts.push(plainText(b.text))
    else if (b.kind === 'list') plainParts.push(...b.items.map(plainText))
    else if (b.kind === 'table') {
      plainParts.push(...b.header.map(plainText))
      for (const r of b.rows) plainParts.push(...r.map(plainText))
    } else if (b.kind === 'code') plainParts.push(b.text)
  }
  const slug = slugForPath(path)
  return {
    slug,
    title: meta.title ?? slug,
    section: meta.section ?? 'General',
    order: Number(meta.order ?? 0),
    keywords: (meta.keywords ?? '')
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean),
    role: meta.role || undefined,
    blocks,
    plain: plainParts.join('\n').toLowerCase(),
  }
}

/**
 * Build the sectioned table of contents from a glob result
 * (`path → raw markdown`). Sections keep the order of their lowest-ordered
 * article; articles sort by `order` within a section.
 */
export function buildHelp(files: Record<string, string>): { articles: HelpArticle[]; sections: HelpSection[] } {
  const articles = Object.entries(files)
    .map(([path, raw]) => parseHelpArticle(path, raw))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
  const sections: HelpSection[] = []
  for (const a of articles) {
    let sec = sections.find((s) => s.title === a.section)
    if (!sec) {
      sec = { title: a.section, articles: [] }
      sections.push(sec)
    }
    sec.articles.push(a)
  }
  return { articles, sections }
}

// ── Search ───────────────────────────────────────────────────────────────────

function snippetAround(plain: string, idx: number, term: string): string {
  const start = Math.max(0, idx - 40)
  const end = Math.min(plain.length, idx + term.length + 80)
  const nlBefore = plain.lastIndexOf('\n', idx)
  const from = Math.max(start, nlBefore + 1)
  const nlAfter = plain.indexOf('\n', idx)
  const to = nlAfter >= 0 ? Math.min(end, nlAfter) : end
  let s = plain.slice(from, to).trim()
  if (from > 0 && from !== nlBefore + 1) s = '…' + s
  if (to < plain.length && to !== nlAfter) s = s + '…'
  return s
}

/**
 * Rank articles against a query. Every whitespace-separated term must appear
 * somewhere in the article (title, keywords, or body); scoring favours title
 * and keyword matches over body matches.
 */
export function searchHelp(articles: HelpArticle[], query: string): HelpHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const hits: HelpHit[] = []
  for (const article of articles) {
    const title = article.title.toLowerCase()
    let score = 0
    let snippet = ''
    let ok = true
    for (const term of terms) {
      let s = 0
      if (title === term) s += 100
      else if (title.includes(term)) s += 40
      if (article.keywords.some((k) => k === term)) s += 30
      else if (article.keywords.some((k) => k.includes(term))) s += 15
      const idx = article.plain.indexOf(term)
      if (idx >= 0) {
        // Count occurrences (capped) so denser articles rank higher.
        let n = 0
        for (let at = idx; at >= 0 && n < 5; at = article.plain.indexOf(term, at + 1)) n++
        s += 4 + n
        if (!snippet) snippet = snippetAround(article.plain, idx, term)
      }
      if (s === 0) {
        ok = false
        break
      }
      score += s
    }
    if (ok) hits.push({ article, score, snippet })
  }
  return hits.sort((a, b) => b.score - a.score)
}
