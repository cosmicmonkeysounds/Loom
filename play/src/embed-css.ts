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
 */
export function scopeCss(css: string): string {
  return (
    css
      // The themed page body is the pane root itself.
      .replace(/:root\[data-theme="([^"]+)"\] body\b/gu, '.play-root[data-theme="$1"]')
      .replace(/:root\b/gu, ".play-root")
      .replace(/(^|\n)html, body, #root \{/gu, "$1.play-root {")
      .replace(/(^|\n)body \{/gu, "$1.play-root {")
      .replace(/(\d+(?:\.\d+)?)vh\b/gu, "$1cqh")
      .replace(/(\d+(?:\.\d+)?)vw\b/gu, "$1cqw")
      .replace(/@media \((min|max)-(height|width):/gu, "@container play ($1-$2:") + FRAME_CSS
  );
}
