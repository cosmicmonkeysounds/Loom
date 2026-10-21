//! The reinstall app's stylesheet, re-scoped for the tent laptop's pane
//! (wave 18b) — pure. The pane is a shadow root (`pane.tsx`), so the two
//! apps' class names (`.terminal`, `.flash`, `.scanner`, `.big`, …) never
//! meet; only the page-level rules need moving: `:root` (the variables)
//! becomes the shadow host, and `html, body, #root` / `body` become the
//! pane's own root, `.ri-root`. The pane covers the whole window, so
//! viewport units, `@media` and `position: fixed` stay as written (unlike
//! the play app's side-by-side panes, `play/src/embed-css.ts`).
//!
//! Takes the stylesheet as written (spaced) and as `vite build` minifies a
//! `?inline` import (`html,body,#root{…}body{…}`). VT323's `@font-face` is
//! declared by the terminal's page and reaches the shadow tree from there.

/** The pane's frame: the host fills the window, under the screen layer. */
export const PANE_CSS = `
:host { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 15; display: block; }
.ri-root { position: relative; width: 100%; height: 100%; overflow: hidden; }
`;

export function scopeReinstallCss(css: string): string {
  return (
    css
      .replace(/:root\b/gu, ":host")
      .replace(/(^|[}\n])\s*html\s*,\s*body\s*,\s*#root\s*\{/gu, "$1.ri-root {")
      .replace(/(^|[}\n])\s*body\s*\{/gu, "$1.ri-root {") + PANE_CSS
  );
}
