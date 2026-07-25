// Loads the authoring help collection from `docs/help/` — the
// single source of truth shared with the play app — and exposes the parsed
// articles + search. The markdown is bundled at build time via
// `import.meta.glob`, so the overlay works offline and in the static build.

import {
  buildHelp,
  searchHelp,
  type HelpArticle,
  type HelpHit,
  type HelpSection,
} from '../../../docs/help/helpdoc'

const files = import.meta.glob('../../../docs/help/authoring/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const built = buildHelp(files)

export const helpArticles: HelpArticle[] = built.articles
export const helpSections: HelpSection[] = built.sections

export function helpArticle(slug: string | null): HelpArticle | undefined {
  if (slug === null) return helpArticles[0]
  return helpArticles.find((a) => a.slug === slug)
}

export function helpSearch(query: string): HelpHit[] {
  return searchHelp(helpArticles, query)
}

export type { HelpArticle, HelpHit, HelpSection }
export { inlineTokens, type HelpBlock, type InlineToken } from '../../../docs/help/helpdoc'
