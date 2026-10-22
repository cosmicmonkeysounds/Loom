// Wave 18b: the story's `badge:` lines on the cockpit's people lists — a
// glyph per badge with its label as the tooltip, nothing when none, and the
// plain-text form a select's option takes.

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NameBadges } from './ui'
import { badgeText } from './format'

const BATH = { glyph: '🚻', label: 'Bathroom Mode' }

describe('name badges', () => {
  it('renders each glyph with its label, and nothing when there are none', () => {
    const html = renderToStaticMarkup(createElement(NameBadges, { badges: [BATH] }))
    expect(html).toContain('title="Bathroom Mode"')
    expect(html).toContain('aria-label="Bathroom Mode"')
    expect(html).toContain('🚻')
    expect(renderToStaticMarkup(createElement(NameBadges, { badges: [] }))).toBe('')
    expect(renderToStaticMarkup(createElement(NameBadges, { badges: undefined }))).toBe('')
  })

  it('has a plain-text form for a select option', () => {
    expect(badgeText([BATH, { glyph: '⭐', label: 'Star' }])).toBe(' 🚻⭐')
    expect(badgeText(undefined)).toBe('')
  })
})
