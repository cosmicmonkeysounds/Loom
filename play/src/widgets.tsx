//! Widgets — the cards a `show <kind> …` statement puts in a conversation:
//! a CAPTCHA to solve, a picture, a poll, a 📝 fact to file, a 💬 free-text answer. The story names a kind and some
//! text/params; this registry maps the kind to a React card. A widget that
//! wants an answer calls `onAnswer(result)` once, and the story hears it as
//! the named event `<kind> answered` with the result bound as arguments.
//!
//! Adding a widget = adding a `WidgetDef` to `WIDGETS`. Unknown kinds render
//! as plain text so an older client never hides a newer story's card.

import { useMemo, useRef, useState, type ReactNode } from "react";
import { PassQr } from "./pass-qr.tsx";
import type { ChatMessage, WidgetCard } from "./types.ts";

export type WidgetResult = Record<string, string | number | boolean>;

export interface WidgetProps {
  card: WidgetCard;
  /** Stable per-card seed (the message seq) so a grid is the same on reload. */
  seed: number;
  /** Who is looking (a guest's own id + name) — a card about *them* (their
   *  pass) needs it. Absent on a performer's read-only view. */
  viewer?: { id: string; name: string } | null;
  /** Absent when the card can't be answered (already answered, or read-only). */
  onAnswer?: (result: WidgetResult) => void;
  /** The answer already given, if any — the card shows its resolved state. */
  answered?: WidgetResult | null;
  /** A newer card of the same kind came after this one in the room (a
   *  re-dealt 📝 fact card): show it folded, not as a live form. */
  superseded?: boolean;
}

export interface WidgetDef {
  /** A short label for the sidebar preview / a performer's feed ("🧩 captcha"). */
  label: string;
  /** Does this kind ask the viewer for an answer? */
  answerable: boolean;
  /** The card is answered through a surface over the whole app (the
   *  guided tutorial), not inline — the in-thread card is only its receipt. */
  overlay?: boolean;
  /** The story re-deals this kind (a fresh 📝 card after every filing):
   *  only the newest in a room is live; earlier ones fold away. */
  supersedes?: boolean;
  /** This card asks nothing any more (a 📝 card dealt with no open
   *  questions — the round closed): it renders as a note, not a task. */
  closed?: (card: WidgetCard) => boolean;
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
          // Neutral on purpose: the story judges the answer (in *Trapped in
          // the Internet* a "verified" grid is the wrong one), so the card
          // never stamps its own verdict.
          <span className="widget-state">✔ Submitted</span>
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
      {done && <div className="widget-foot"><span className="widget-state">{answered["choice"] === undefined ? "answered" : `you answered “${String(answered["choice"])}”`}</span></div>}
    </div>
  );
}

// --- tutorial ---------------------------------------------------------------

/**
 * `show tutorial "Clippy's orientation" to program with guide: "Clippy"` —
 * the app's own guided tour of itself (`tutorial.tsx`), shown over the whole
 * app until it is finished or skipped. This card is the receipt in the
 * thread; the answer is `{completed}` or `{skipped, step}` plus `steps`, so
 * a story can react to a program that declined orientation.
 */
function TutorialCard({ card, answered, onAnswer }: WidgetProps) {
  const done = answered !== null && answered !== undefined;
  // After a reload the server only says the card *was* answered, not how.
  const state = !done ? null : answered["skipped"] === true ? "✖ skipped" : answered["completed"] === true ? "✔ completed" : "✔ answered";
  return (
    <div className={`widget tutorial ${done ? "done" : ""}`} role="group" aria-label={card.text || "Orientation"}>
      <div className="widget-head">
        <span className="widget-glyph" aria-hidden>
          📘
        </span>
        <div>
          <div className="widget-title">{card.text || "Orientation"}</div>
          <div className="widget-sub">{card.params["guide"] ? `A tour of the app, with ${card.params["guide"]}.` : "A tour of the app."}</div>
        </div>
      </div>
      <div className="widget-foot">
        <span className="widget-state">{state ?? (onAnswer ? "in progress…" : "shown to a guest")}</span>
      </div>
    </div>
  );
}

// --- pass -------------------------------------------------------------------

/**
 * `show pass "Hold it up for the Antivirus." to program` — the guest's own
 * pass, right in the conversation: the QR a performer scans (their id),
 * big enough to hold up. The story deals it at the moment it asks for it,
 * so a guest on rails never has to find ⊞ Start or the 🎟 Pass button. Never answers.
 */
export function PassCard({ card, viewer }: WidgetProps) {
  return (
    <div className="widget pass-card" role="group" aria-label="Your pass">
      <div className="widget-head">
        <span className="widget-glyph" aria-hidden>
          🎟️
        </span>
        <div>
          <div className="widget-title">Your pass</div>
          {card.text && <div className="widget-sub">{card.text}</div>}
        </div>
      </div>
      {viewer ? (
        <div className="pass-body">
          <PassQr alt="Your QR pass" text={viewer.id} />
          <div className="pass-id">{viewer.id}</div>
          <div className="pass-who">{viewer.name} · show this to a performer to be scanned</div>
        </div>
      ) : (
        <div className="widget-foot">
          <span className="widget-state">the guest's own pass</span>
        </div>
      )}
    </div>
  );
}

// --- fact -------------------------------------------------------------------

/** A 📝 card with no open questions (the round closed). */
export const FACT_CLOSED_NOTE = "The filing is closed — no open questions.";

/** Longest answer a 📝 fact card files (the server refuses longer). */
export const FACT_MAX = 200;

/** `questions: "H1: Round 1 Q1. … | H2: …"` → `[{id, label}]` (id before the
 *  first colon; an entry with no colon is its own id and label). */
export function factQuestions(param: string | undefined): Array<{ id: string; label: string }> {
  return (param ?? "")
    .split("|")
    .map((q) => q.trim())
    .filter(Boolean)
    .map((q) => {
      const i = q.indexOf(":");
      return i > 0 ? { id: q.slice(0, i).trim(), label: q.slice(i + 1).trim() } : { id: q, label: q };
    });
}

/** The confidence slider's range: 1–100, whole numbers. */
export const CONFIDENCE_MIN = 1;
export const CONFIDENCE_MAX = 100;
/** The slider's label, verbatim (the show's wording). */
export const CONFIDENCE_LABEL = "Please select your confidence level in this response";
/** Where an unset slider's thumb rests (greyed, reading "not set"): the
 *  middle, so neither end is the default. Untouched, it files nothing. */
export const CONFIDENCE_REST = 50;
/** What the slider's readout says until the guest sets it. */
export const CONFIDENCE_UNSET = "not set";

/** The answer a fact card files, or null while it isn't fileable: a question
 *  picked, a non-empty answer within `FACT_MAX`, and a whole-number
 *  confidence between `CONFIDENCE_MIN` and `CONFIDENCE_MAX` that the guest
 *  set (null = the slider is untouched: "confident" is a choice, never the
 *  default a tipsy guest files without looking). */
export function factResult(question: string, answer: string, confidence: number | null): WidgetResult | null {
  const a = answer.trim();
  if (question === "" || a === "" || a.length > FACT_MAX) return null;
  if (confidence === null || !Number.isInteger(confidence) || confidence < CONFIDENCE_MIN || confidence > CONFIDENCE_MAX) return null;
  return { question, answer: a, confidence };
}

/** The question a fact card starts on: the lone open one (nothing to pick),
 *  else none — the guest picks. */
export function defaultFactQuestion(questions: ReadonlyArray<{ id: string }>): string {
  return questions.length === 1 ? questions[0]!.id : "";
}

/** The picked question while it is still open, else the default — so a
 *  list that shrinks to one (a filing elsewhere) lands on the lone one. */
export function factQuestionOf(picked: string, questions: ReadonlyArray<{ id: string }>): string {
  return questions.some((q) => q.id === picked) ? picked : defaultFactQuestion(questions);
}

/** The question buttons a fact card shows: all of them while choosing (or
 *  with none picked), else only the picked one (its tap reopens the list). */
export function factQuestionsShown<Q extends { id: string }>(questions: readonly Q[], picked: string, choosing: boolean): Q[] {
  if (choosing || picked === "") return [...questions];
  const one = questions.filter((q) => q.id === picked);
  return one.length > 0 ? one : [...questions];
}

/** Typing in a card's box: keep its submit row in view in the tray's scroll
 *  (the box, the slider above it, then File it / Say it — never hidden
 *  under the fold while the keyboard is up). */
export function keepFootInView(field: Element): void {
  field.closest(".widget")?.querySelector(".widget-foot")?.scrollIntoView?.({ block: "nearest" });
}

/** …and once the keyboard has come up (the tray has just shrunk). */
function footInViewSoon(field: Element): void {
  window.setTimeout(() => keepFootInView(field), 350);
}

/** Why "File it" is off, under the button (`null` when it's on). */
export function factFileHint(question: string, answer: string, confidence: number | null): string | null {
  if (question === "") return "Pick a question above";
  const a = answer.trim();
  if (a === "") return "Type your answer";
  if (a.length > FACT_MAX) return `Keep it under ${FACT_MAX} characters`;
  if (confidence === null) return "Set how sure you are";
  return null;
}

/** The slider's value from an input event (a whole number in range), or
 *  null for anything else. Any touch, drag, click or key on the slider
 *  sets it — even a tap that lands on the resting middle. */
export function confidenceFrom(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= CONFIDENCE_MIN && n <= CONFIDENCE_MAX ? n : null;
}

/** The keys that move a range input. Only these set the slider from the
 *  keyboard: the Tab that moves focus onto it releases on the slider too,
 *  and must not file a resting 50 nobody chose. */
const SLIDER_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

/** Whether a key released on the slider is the guest setting it. */
export function setsConfidence(key: string): boolean {
  return SLIDER_KEYS.has(key);
}

/**
 * `show fact "📝 File a fact" to program with thread: Trabolta, questions:
 * "H1: … | H2: …"` — file an answer to one of tonight's questions with a
 * character, and say how sure you are (a 1–100 slider). The server judges
 * it (when the project has a `facts.json`) and the story decides what the
 * verdict does; the character's reply is the same whether the answer was
 * right, a confident lie or a guess. The answer is
 * `{question, answer, confidence}` → `fact answered`.
 */
function FactCard({ card, onAnswer, answered, superseded }: WidgetProps) {
  const questions = factQuestions(card.params["questions"]);
  const [picked, setQuestion] = useState("");
  const question = factQuestionOf(picked, questions);
  const [answer, setAnswer] = useState("");
  // Unset until the guest touches the slider: File it stays off.
  const [confidence, setConfidence] = useState<number | null>(null);
  // Once a question is picked the others fold away (the card fits the tray:
  // the answer box and the slider stay on screen); its button reopens them.
  const [choosing, setChoosing] = useState(false);
  const answerBox = useRef<HTMLTextAreaElement>(null);
  const sureBox = useRef<HTMLLabelElement>(null);
  const done = answered !== null && answered !== undefined;
  const result = factResult(question, answer, confidence);
  const filedFor = done && typeof answered["question"] === "string" ? questions.find((q) => q.id === answered["question"])?.label ?? String(answered["question"]) : null;
  // "Sent", not "filed": the story still has to accept it (a question from
  // a round that hasn't opened, a second filing… is refused in its reply).
  const sentSure = done && typeof answered["confidence"] === "number" ? ` · ${answered["confidence"]}%` : "";
  const sent = filedFor ? `✔ sent: ${filedFor}${sentSure}` : `✔ sent${sentSure}`;
  if (!done && questions.length === 0) {
    // Dealt after a round closed with nothing left to file (B14): a note.
    return (
      <div className="widget fact done folded closed" role="note">
        <span className="widget-glyph" aria-hidden>
          📝
        </span>{" "}
        <span className="widget-state">{FACT_CLOSED_NOTE}</span>
      </div>
    );
  }
  if (superseded) {
    return (
      <div className="widget fact done folded" role="note">
        <span className="widget-glyph" aria-hidden>
          📝
        </span>{" "}
        <span className="widget-state">{done ? sent : "An earlier card — use the newest one below."}</span>
      </div>
    );
  }
  return (
    <div className={`widget fact ${done ? "done" : ""}${question !== "" && !choosing ? " picked" : ""}`} role="group" aria-label={card.text || "File a fact"}>
      <div className="widget-head">
        <span className="widget-glyph" aria-hidden>
          📝
        </span>
        <div>
          <div className="widget-title">{card.text || "File a fact"}</div>
          <div className="widget-sub">Pick a question, type the answer, say how sure you are. One filing per question.</div>
        </div>
      </div>
      {!done && onAnswer && (
        <>
          <div className="poll-options fact-questions">
            {factQuestionsShown(questions, question, choosing).map((q) => (
              <button
                key={q.id}
                type="button"
                className={`choice ${question === q.id ? "primary" : "ghost"}`}
                aria-pressed={question === q.id}
                aria-expanded={questions.length > 1 && question === q.id ? choosing : undefined}
                onClick={() => {
                  // The picked one, tapped again, opens the list to change it.
                  if (question === q.id && !choosing && questions.length > 1) {
                    setChoosing(true);
                    return;
                  }
                  setQuestion(q.id);
                  setChoosing(false);
                  // The answer box next, in view (the tray scrolls).
                  window.setTimeout(() => answerBox.current?.scrollIntoView?.({ block: "nearest" }), 0);
                }}
              >
                {question === q.id && (
                  <span className="fact-picked" aria-hidden>
                    ✔{" "}
                  </span>
                )}
                {q.label}
                {question === q.id && !choosing && questions.length > 1 && <span className="fact-change">change</span>}
              </button>
            ))}
          </div>
          <textarea
            ref={answerBox}
            className="fact-answer"
            rows={2}
            maxLength={FACT_MAX}
            placeholder="Your answer"
            value={answer}
            onChange={(e) => {
              setAnswer(e.target.value);
              keepFootInView(e.currentTarget);
            }}
            onFocus={(e) => footInViewSoon(e.currentTarget)}
            // Done typing (the keyboard goes down): the slider next, in view.
            onBlur={() => sureBox.current?.scrollIntoView?.({ block: "nearest" })}
          />
          <label ref={sureBox} className={`fact-confidence ${confidence === null ? "unset" : ""}`}>
            <span>{CONFIDENCE_LABEL}</span>
            {/* A range always has a value, so an unset one rests greyed in
                the middle. A tap on the thumb itself changes nothing, so
                pointer-up and the value keys set it too (never Tab). */}
            <input
              type="range"
              min={CONFIDENCE_MIN}
              max={CONFIDENCE_MAX}
              step={1}
              value={confidence ?? CONFIDENCE_REST}
              onChange={(e) => setConfidence(confidenceFrom(e.target.value))}
              onPointerUp={(e) => setConfidence(confidenceFrom(e.currentTarget.value))}
              onKeyUp={(e) => {
                if (setsConfidence(e.key)) setConfidence(confidenceFrom(e.currentTarget.value));
              }}
              aria-valuetext={confidence === null ? CONFIDENCE_UNSET : `${confidence}%`}
            />
            <output>{confidence === null ? CONFIDENCE_UNSET : `${confidence}%`}</output>
          </label>
        </>
      )}
      <div className="widget-foot">
        {done ? (
          <span className="widget-state">{sent} — the reply says whether it's accepted</span>
        ) : onAnswer ? (
          <>
            {result === null && factFileHint(question, answer, confidence) !== null && <span className="widget-state fact-hint">{factFileHint(question, answer, confidence)}</span>}
            <button type="button" className="choice primary widget-go" disabled={result === null} onClick={() => result && onAnswer(result)}>
              File it
            </button>
          </>
        ) : (
          <span className="widget-state">shown to a guest</span>
        )}
      </div>
    </div>
  );
}

// --- answer -----------------------------------------------------------------

/** Longest free-text answer when the card sets no `max`. */
export const ANSWER_MAX_DEFAULT = 200;

/** The card's own text limit: `with max: 120`, else `ANSWER_MAX_DEFAULT`. */
export function answerMax(params: Record<string, string>): number {
  const n = Number(params["max"]);
  return Number.isInteger(n) && n > 0 ? n : ANSWER_MAX_DEFAULT;
}

/** The text an answer card sends, or null while it is empty / too long. */
export function answerResult(text: string, max: number): WidgetResult | null {
  const t = text.trim();
  if (t === "" || t.length > max) return null;
  return { text: t };
}

/**
 * `show answer "Give me a pickup line." to program with thread: Trabolta,
 * question: P1, max: 120, button: "Say it", placeholder: "…"` — one free-text
 * line. The result is `{text}` → `answer answered`; when the card carries a
 * `question` key and the project has a `facts.json`, the server attaches
 * `{question, verdict}` on the way (the phone never sees the verdict). Not
 * re-dealt: every answer card stays live until answered.
 */
function AnswerCard({ card, onAnswer, answered }: WidgetProps) {
  const [text, setText] = useState("");
  const max = answerMax(card.params);
  const done = answered !== null && answered !== undefined;
  const result = answerResult(text, max);
  const button = card.params["button"] ?? "Send";
  return (
    <div className={`widget answer ${done ? "done" : ""}`} role="group" aria-label={card.text || "Your answer"}>
      <div className="widget-head">
        <span className="widget-glyph" aria-hidden>
          💬
        </span>
        <div>
          <div className="widget-title">{card.text || "Your answer"}</div>
        </div>
      </div>
      {!done && onAnswer && (
        <textarea className="answer-text" rows={2} maxLength={max} placeholder={card.params["placeholder"] ?? "Type it here"} value={text} onChange={(e) => (setText(e.target.value), keepFootInView(e.currentTarget))} onFocus={(e) => footInViewSoon(e.currentTarget)} />
      )}
      <div className="widget-foot">
        {done ? (
          <span className="widget-state">✔ sent</span>
        ) : onAnswer ? (
          <button type="button" className="choice primary widget-go" disabled={result === null} onClick={() => result && onAnswer(result)}>
            {button}
          </button>
        ) : (
          <span className="widget-state">shown to a guest</span>
        )}
      </div>
    </div>
  );
}

// --- registry ---------------------------------------------------------------

export const WIDGETS: Record<string, WidgetDef> = {
  captcha: { label: "🛡️ security check", answerable: true, render: (p) => <Captcha {...p} /> },
  image: { label: "🖼️ picture", answerable: false, render: (p) => <Image {...p} /> },
  poll: { label: "📊 poll", answerable: true, render: (p) => <Poll {...p} /> },
  tutorial: { label: "📘 orientation", answerable: true, overlay: true, render: (p) => <TutorialCard {...p} /> },
  pass: { label: "🎟️ your pass", answerable: false, render: (p) => <PassCard {...p} /> },
  fact: { label: "📝 file a fact", answerable: true, supersedes: true, closed: (c) => factQuestions(c.params["questions"]).length === 0, render: (p) => <FactCard {...p} /> },
  answer: { label: "💬 your answer", answerable: true, render: (p) => <AnswerCard {...p} /> },
};

/** Does this card still ask the viewer for an answer (an answerable kind
 *  that isn't closed)? */
export function cardAsks(card: WidgetCard): boolean {
  const def = WIDGETS[card.kind];
  return (def?.answerable ?? false) && !(def?.closed?.(card) ?? false);
}

/** The cards a newer card of the same (re-dealt) kind has replaced, per
 *  room: every one but the newest of each `supersedes` kind. */
export function supersededCards(messages: Iterable<ChatMessage>): Set<number> {
  const newest = new Map<string, number>();
  const all: Array<{ key: string; seq: number }> = [];
  for (const m of messages) {
    if (m.kind !== "widget" || m.widget === undefined || WIDGETS[m.widget.kind]?.supersedes !== true) continue;
    const key = `${m.channel}\u0000${m.widget.kind}`;
    all.push({ key, seq: m.seq });
    if ((newest.get(key) ?? -Infinity) < m.seq) newest.set(key, m.seq);
  }
  return new Set(all.filter((c) => newest.get(c.key) !== c.seq).map((c) => c.seq));
}

/** A one-line description of a card, for previews and performer feeds. */
export function widgetLabel(card: WidgetCard): string {
  const def = WIDGETS[card.kind];
  if (def === undefined) return `🧩 ${card.kind}${card.text ? ` — ${card.text}` : ""}`;
  // A card whose text already leads with the kind's glyph ("📝 File a
  // fact") says it once, not "📝 file a fact — 📝 File a fact".
  const glyph = def.label.split(" ")[0]!;
  if (card.text && card.text.startsWith(glyph)) return card.text;
  return `${def.label}${card.text ? ` — ${card.text}` : ""}`;
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
