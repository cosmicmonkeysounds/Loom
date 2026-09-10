// The help system: the shared markdown engine (docs/help/helpdoc.ts) and the
// bundled authoring collection's integrity — every article well-formed, every
// cross-link resolving, search finding the obvious entry points.

import { describe, expect, it } from 'vitest'
import { inlineTokens, parseBlocks, parseHelpArticle, searchHelp } from '../../../docs/help/helpdoc'
import { helpArticle, helpArticles, helpSearch, helpSections } from './help-content'

describe('helpdoc markdown engine', () => {
  it('parses frontmatter, headings, paragraphs, and code fences', () => {
    const a = parseHelpArticle('x/10-sample.md', [
      '---',
      'title: Sample',
      'section: Test',
      'order: 3',
      'keywords: alpha, beta',
      '---',
      '',
      '# Heading',
      '',
      'A paragraph with `code`.',
      '',
      '```loom',
      '== beat',
      '```',
    ].join('\n'))
    expect(a.slug).toBe('sample')
    expect(a.title).toBe('Sample')
    expect(a.section).toBe('Test')
    expect(a.order).toBe(3)
    expect(a.keywords).toEqual(['alpha', 'beta'])
    expect(a.blocks.map((b) => b.kind)).toEqual(['heading', 'para', 'code'])
    const code = a.blocks[2]
    expect(code.kind === 'code' && code.text).toBe('== beat')
  })

  it('parses tables and unescapes pipes in cells', () => {
    const blocks = parseBlocks(['| A | B |', '|---|---|', '| `x \\| y` | z |'].join('\n'))
    expect(blocks).toHaveLength(1)
    const t = blocks[0]
    if (t.kind !== 'table') throw new Error('expected table')
    expect(t.header).toEqual(['A', 'B'])
    expect(t.rows).toEqual([['`x | y`', 'z']])
  })

  it('keeps literal ``` lines inside a ````-fenced block', () => {
    const blocks = parseBlocks(['````loom', 'text', '```note', 'inner', '```', '````'].join('\n'))
    expect(blocks).toHaveLength(1)
    const code = blocks[0]
    if (code.kind !== 'code') throw new Error('expected code')
    expect(code.text).toContain('```note')
    expect(code.text).toContain('inner')
  })

  it('parses lists, quotes, and rules', () => {
    const blocks = parseBlocks(['- one', '- two', '', '> quoted', '', '---'].join('\n'))
    expect(blocks.map((b) => b.kind)).toEqual(['list', 'quote', 'rule'])
    const list = blocks[0]
    expect(list.kind === 'list' && list.items).toEqual(['one', 'two'])
  })

  it('tokenizes inline markdown', () => {
    const toks = inlineTokens('go **bold** and `code` then [there](./11-choices.md)')
    expect(toks.map((t) => t.kind)).toEqual(['text', 'bold', 'text', 'code', 'text', 'link'])
    const link = toks[5]
    expect(link.kind === 'link' && link.href).toBe('choices')
  })

  it('search requires every term and ranks title matches first', () => {
    const a = parseHelpArticle('a.md', '---\ntitle: Choices\nkeywords: sticky\n---\nA sticky choice stays.')
    const b = parseHelpArticle('b.md', '---\ntitle: Other\n---\nNothing here about that topic.')
    const hits = searchHelp([b, a], 'sticky choice')
    expect(hits.map((h) => h.article.slug)).toEqual(['a'])
    expect(hits[0].snippet).toContain('sticky')
    expect(searchHelp([a, b], 'sticky zebra')).toHaveLength(0)
  })
})

describe('the bundled authoring collection', () => {
  it('loads a substantial, well-formed manual', () => {
    expect(helpArticles.length).toBeGreaterThanOrEqual(20)
    for (const a of helpArticles) {
      expect(a.title, a.slug).toBeTruthy()
      expect(a.section, a.slug).toBeTruthy()
      expect(a.blocks.length, a.slug).toBeGreaterThan(0)
      expect(a.keywords.length, a.slug).toBeGreaterThan(0)
    }
    const slugs = helpArticles.map((a) => a.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('orders sections for learning: Start Here first, Reference last', () => {
    const titles = helpSections.map((s) => s.title)
    expect(titles[0]).toBe('Start Here')
    expect(titles[titles.length - 1]).toBe('Reference')
    expect(titles).toContain('Language')
    expect(titles).toContain('Live Shows')
    expect(titles).toContain('The Editor')
  })

  it('resolves every internal cross-link to a real article', () => {
    const slugs = new Set(helpArticles.map((a) => a.slug))
    for (const a of helpArticles) {
      for (const block of a.blocks) {
        const texts =
          block.kind === 'para' || block.kind === 'quote' || block.kind === 'heading'
            ? [block.text]
            : block.kind === 'list'
              ? block.items
              : block.kind === 'table'
                ? [...block.header, ...block.rows.flat()]
                : []
        for (const text of texts) {
          for (const tok of inlineTokens(text)) {
            if (tok.kind === 'link' && !/^[a-z]+:\/\//.test(tok.href)) {
              expect(slugs.has(tok.href), `${a.slug} links to missing article "${tok.href}"`).toBe(true)
            }
          }
        }
      }
    }
  })

  it('finds the obvious things writers search for', () => {
    expect(helpSearch('sticky choice')[0]?.article.slug).toBe('choices')
    expect(helpSearch('divert').map((h) => h.article.slug)).toContain('choices')
    expect(helpSearch('broadcast')[0]?.article.section).toBe('Live Shows')
    expect(helpSearch('trait')[0]?.article.slug).toBe('traits')
    expect(helpSearch('shortcut')[0]?.article.slug).toBe('shortcuts')
    expect(helpSearch('capture').map((h) => h.article.slug)).toContain('live-verbs')
    expect(helpSearch('slot fill').map((h) => h.article.slug)).toContain('owned-beats')
    // Front of house merged into Run mode (the Deploy article is gone).
    expect(helpSearch('join code')[0]?.article.slug).toBe('run-mode')
    expect(helpSearch('QR')[0]?.article.slug).toBe('run-mode')
    expect(helpSearch('go live')[0]?.article.slug).toBe('run-mode')
    expect(helpArticle('deploy-mode')).toBeUndefined()
  })

  it('helpArticle(null) is the welcome page; unknown slugs are undefined', () => {
    expect(helpArticle(null)?.slug).toBe('welcome')
    expect(helpArticle('does-not-exist')).toBeUndefined()
  })
})
