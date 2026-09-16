//! Widgets — the cards a `show <kind> …` statement puts in a conversation:
//! a CAPTCHA to solve, a picture, a poll. The story names a kind and some
//! text/params; this registry maps the kind to a React card. A widget that
//! wants an answer calls `onAnswer(result)` once, and the story hears it as
//! the named event `<kind> answered` with the result bound as arguments.
//!
//! Adding a widget = adding a `WidgetDef` to `WIDGETS`. Unknown kinds render
//! as plain text so an older client never hides a newer story's card.

import { useMemo, useState, type ReactNode } from "react";
import type { WidgetCard } from "./types.ts";

export type WidgetResult = Record<string, string | number | boolean>;

export interface WidgetProps {
  card: WidgetCard;
  /** Stable per-card seed (the message seq) so a grid is the same on reload. */
  seed: number;
  /** Absent when the card can't be answered (already answered, or read-only). */
  onAnswer?: (result: WidgetResult) => void;
  /** The answer already given, if any — the card shows its resolved state. */
  answered?: WidgetResult | null;
}

export interface WidgetDef {
  /** A short label for the sidebar preview / a performer's feed ("🧩 captcha"). */
  label: string;
  /** Does this kind ask the viewer for an answer? */
  answerable: boolean;
  render: (p: WidgetProps) => ReactNode;
}

// --- captcha ----------------------------------------------------------------

/** The picture bank a CAPTCHA draws from: each entry is one "kind of thing"
 *  a prompt can ask for (`with target: "traffic light"`) and how it shows. */
export const CAPTCHA_TILES: ReadonlyArray<{ key: string; glyph: string }> = [
  { key: "traffic light", glyph: "🚦" },
  { key: "crosswalk", glyph: "🚸" },
  { key: "bus", glyph: "🚌" },
  { key: "bicycle", glyph: "🚲" },
  { key: "fire hydrant", glyph: "🧯" },
  { key: "bridge", glyph: "🌉" },
  { key: "palm tree", glyph: "🌴" },
  { key: "boat", glyph: "⛵" },
  { key: "mountain", glyph: "🏔️" },
  { key: "storefront", glyph: "🏪" },
  { key: "taxi", glyph: "🚕" },
  { key: "motorcycle", glyph: "🏍️" },
];

/** A tiny deterministic PRNG (mulberry32) — the same seed lays the same grid. */
function rng(seed: number): () => number {
  let a = (seed >>> 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CaptchaGrid {
  target: string;
  glyph: string;
  /** 3×3 tile keys, row-major. */
  tiles: string[];
  /** Indexes of the tiles that match the target — the "right" answer. */
  answer: number[];
}

/**
 * Lay a 3×3 grid for `target` (a `CAPTCHA_TILES` key, matched loosely; an
 * unknown target still works — it just has no matching squares, which is a
 * legitimate CAPTCHA too). Between two and four squares contain the target.
 */
export function captchaGrid(target: string, seed: number): CaptchaGrid {
  const want = target.trim().toLowerCase();
  const hit = CAPTCHA_TILES.find((t) => t.key === want) ?? CAPTCHA_TILES.find((t) => want.includes(t.key) || t.key.includes(want));
  const others = CAPTCHA_TILES.filter((t) => t !== hit);
  const r = rng(seed);
  const n = hit ? 2 + Math.floor(r() * 3) : 0;
  const slots = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [slots[i], slots[j]] = [slots[j]!, slots[i]!];
  }
  const answer = slots.slice(0, n).sort((a, b) => a - b);
  const tiles: string[] = [];
  for (let i = 0; i < 9; i++) {
    if (answer.includes(i)) tiles.push(hit!.key);
    else tiles.push(others[Math.floor(r() * others.length)]!.key);
  }
  return { target: hit?.key ?? want, glyph: hit?.glyph ?? "❔", tiles, answer };
}

/** Did the picked squares exactly match the answer? */
export function captchaPassed(grid: CaptchaGrid, picked: readonly number[]): boolean {
  const a = [...new Set(picked)].sort((x, y) => x - y);
  return a.length === grid.answer.length && a.every((v, i) => v === grid.answer[i]);
}

function glyphFor(key: string): string {
  return CAPTCHA_TILES.find((t) => t.key === key)?.glyph ?? "▪️";
}

function Captcha({ card, seed, onAnswer, answered }: WidgetProps) {
  const grid = useMemo(() => captchaGrid(card.params["target"] ?? card.text, seed), [card, seed]);
  const [picked, setPicked] = useState<number[]>([]);
  const done = answered !== null && answered !== undefined;
  const toggle = (i: number) => {
    if (done || !onAnswer) return;
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  };
  const verify = () => {
    if (done || !onAnswer) return;
    onAnswer({ passed: captchaPassed(grid, picked), picked: picked.length, target: grid.target });
  };
  return (
    <div className={`widget captcha ${done ? "done" : ""}`} role="group" aria-label="Security check">
      <div className="widget-head">
        <span className="widget-glyph" aria-hidden>
          🛡️
        </span>
        <div>
          <div className="widget-title">Security check</div>
          <div className="widget-sub">{card.text || `Select every square that contains a ${grid.target}.`}</div>
        </div>
      </div>
      <div className="captcha-grid">
        {grid.tiles.map((key, i) => (
          <button
            key={i}
            type="button"
            className={`captcha-tile ${picked.includes(i) ? "on" : ""}`}
            aria-pressed={picked.includes(i)}
            aria-label={key}
            disabled={done || !onAnswer}
            onClick={() => toggle(i)}
          >
            <span aria-hidden>{glyphFor(key)}</span>
          </button>
        ))}
      </div>
      <div className="widget-foot">
        {done ? (
          <span className="widget-state">{answered["passed"] === true ? "✔ Verified" : "✖ Failed"} · submitted</span>
        ) : onAnswer ? (
          <button type="button" className="choice primary widget-go" onClick={verify}>
            VERIFY
          </button>
        ) : (
          <span className="widget-state">shown to a guest</span>
        )}
      </div>
    </div>
  );
}

// --- image ------------------------------------------------------------------

function Image({ card }: WidgetProps) {
  const src = card.params["src"] ?? card.text;
  const caption = card.params["caption"] ?? (card.params["src"] ? card.text : "");
  return (
    <figure className="widget image">
      <img src={src} alt={card.params["alt"] ?? caption ?? ""} loading="lazy" />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

// --- poll -------------------------------------------------------------------

/** `show poll "Question?" to everyone with options: "Yes | No | Maybe"` */
function Poll({ card, onAnswer, answered }: WidgetProps) {
  const options = (card.params["options"] ?? "Yes | No").split("|").map((o) => o.trim()).filter(Boolean);
  const done = answered !== null && answered !== undefined;
  return (
    <div className={`widget poll ${done ? "done" : ""}`} role="group" aria-label={card.text}>
      <div className="widget-head">
        <span className="widget-glyph" aria-hidden>
          📊
        </span>
        <div>
          <div className="widget-title">{card.text || "Poll"}</div>
        </div>
      </div>
      <div className="poll-options">
        {options.map((o, i) => (
          <button
            key={i}
            type="button"
            className={`choice ${done && answered["choice"] === o ? "primary" : "ghost"}`}
            disabled={done || !onAnswer}
            onClick={() => onAnswer?.({ choice: o, index: i })}
          >
            {o}
          </button>
        ))}
      </div>
      {done && <div className="widget-foot"><span className="widget-state">you answered “{String(answered["choice"])}”</span></div>}
    </div>
  );
}

// --- registry ---------------------------------------------------------------

export const WIDGETS: Record<string, WidgetDef> = {
  captcha: { label: "🛡️ security check", answerable: true, render: (p) => <Captcha {...p} /> },
  image: { label: "🖼️ picture", answerable: false, render: (p) => <Image {...p} /> },
  poll: { label: "📊 poll", answerable: true, render: (p) => <Poll {...p} /> },
};

/** A one-line description of a card, for previews and performer feeds. */
export function widgetLabel(card: WidgetCard): string {
  const def = WIDGETS[card.kind];
  return def ? `${def.label}${card.text ? ` — ${card.text}` : ""}` : `🧩 ${card.kind}${card.text ? ` — ${card.text}` : ""}`;
}

/** Render a card by kind; an unknown kind falls back to its label + text. */
export function WidgetHost(p: WidgetProps) {
  const def = WIDGETS[p.card.kind];
  if (def === undefined) {
    return (
      <div className="widget unknown">
        <div className="widget-title">🧩 {p.card.kind}</div>
        {p.card.text && <div className="widget-sub">{p.card.text}</div>}
      </div>
    );
  }
  return <>{def.render(p)}</>;
}
