//! The focused element, shadow-root aware. Run → Players mounts the play app
//! in shadow roots, where `document.activeElement` is the pane's host
//! element, never the field or button inside it: a focus trap that compares
//! against it never finds its place, and a "don't steal focus from a text
//! field" check never sees the field. Pure DOM, no React.

/** The element focused in `node`'s tree (its shadow root's, else the
 *  document's, descending through open shadow roots). */
export function focusedIn(node?: Node | null): Element | null {
  if (typeof document === "undefined") return null;
  const root = node?.getRootNode?.();
  if (root !== undefined && root !== document && "activeElement" in root) return (root as ShadowRoot).activeElement ?? null;
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement != null) el = el.shadowRoot.activeElement;
  return el;
}

/** Is focus in a text field (never steal it: the iOS keyboard would drop)? */
export function typingIn(node?: Node | null): boolean {
  const el = focusedIn(node) as HTMLElement | null;
  return el !== null && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable === true);
}
