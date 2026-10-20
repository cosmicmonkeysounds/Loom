//! Re-scoping the participant stylesheet for an embedded pane (`embed.tsx`).
//! The stylesheet stays written for a phone — the whole page is the app —
//! and this turns page-level selectors and viewport units into pane-level
//! ones, so several apps can sit side by side in one host page. Pure.

/** The pane frame: a size container (so `cqh` and container queries resolve
 *  against the pane) that also contains fixed-position sheets inside it. */
const FRAME_CSS = `
:host { display: block; }
.play-frame { position: relative; width: 100%; height: 100%; overflow: hidden; container: play / size; contain: strict; outline: none; }
.play-root { height: 100%; overflow: hidden; }
`;

/**
 * Page selectors become the pane root (`.play-root`), viewport units become
 * container units, and viewport `@media` size queries become container
 * queries against the pane. Preference queries (`prefers-reduced-motion`)
 * are left alone — they are about the person, not the page.
 *
 * Takes the stylesheet as written (spaced, quoted) and as `vite build`
 * minifies `styles.css?inline` (`html,body,#root{…}`,
 * `:root[data-theme=aol97] body{…}` — no spaces, no quotes). The dynamic
 * viewport units (`dvh`, `svh`, `lvh`, and their `vw`s) become container
 * units too, so a full-screen layer sizes to its pane, and a size query in
 * range syntax (`@media (height>=520px)`, as the editor's lightningcss build
 * writes it) becomes a container query like the `min-` / `max-` forms.
 */
export function scopeCss(css: string): string {
  return (
    css
      // The themed page body is the pane root itself.
      .replace(/:root\[data-theme=("?)([^"\]]+)\1\]\s*body\b/gu, '.play-root[data-theme="$2"]')
      .replace(/:root\b/gu, ".play-root")
      .replace(/(^|[}\n])\s*html,\s*body,\s*#root\s*\{/gu, "$1.play-root {")
      .replace(/(^|[}\n])\s*body\s*\{/gu, "$1.play-root {")
      .replace(/(\d*\.?\d+)[dsl]?vh\b/gu, "$1cqh")
      .replace(/(\d*\.?\d+)[dsl]?vw\b/gu, "$1cqw")
      .replace(/@media ?\((min|max)-(height|width):/gu, "@container play ($1-$2:")
      // Range syntax: the editor's build (lightningcss) writes `(height>=520px)`.
      .replace(/@media ?\(((?:width|height)\s*[<>]=?|[\d.]+[a-z]*\s*[<>]=?\s*(?:width|height))/gu, "@container play ($1") + FRAME_CSS
  );
}
