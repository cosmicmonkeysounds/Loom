//! Re-scoping the reinstall stylesheet for the embedded map (`embed.tsx`).
//! `styles.css` is written for a page the app fills; in a shadow root that
//! page is `.map-frame`: `:root`'s tokens go on `:host`, `body`'s type and
//! colours on the frame, viewport units and size queries on the frame's own
//! size, so the map lays out for its pane and not the window. Pure.

/** The pane: a size container that also holds anything position: fixed. */
const FRAME_CSS = `
:host { display: block; }
.map-frame { position: relative; width: 100%; height: 100%; overflow: hidden; container: map / size; contain: strict; outline: none; }
`;

/**
 * Takes the stylesheet as written and as `vite build` minifies `?inline` CSS
 * (`:root{…}html,body,#root{…}body{…}`, and a range query, `(width<=860px)`,
 * from the editor's lightningcss). Preference queries stay: they are about
 * the person, not the page.
 */
export function mapPaneCss(css: string): string {
  return (
    css
      .replace(/:root\b/gu, ":host")
      .replace(/(^|[}\n])\s*html,\s*body,\s*#root\s*\{[^}]*\}/gu, "$1")
      .replace(/(^|[}\n])\s*body\s*\{/gu, "$1.map-frame {")
      .replace(/(\d*\.?\d+)[dsl]?vh\b/gu, "$1cqh")
      .replace(/(\d*\.?\d+)[dsl]?vw\b/gu, "$1cqw")
      .replace(/@media ?\((min|max)-(height|width):/gu, "@container map ($1-$2:")
      .replace(/@media ?\(((?:width|height)\s*[<>]=?|[\d.]+[a-z]*\s*[<>]=?\s*(?:width|height))/gu, "@container map ($1") + FRAME_CSS
  );
}
