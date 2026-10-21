//! The idle show (wave 17, D1): what every wall terminal, the TV's attract
//! and the Internet laptop show when nobody is talking to them — a seeded
//! line of screensavers, fake-1999 ads and popups that pile up (`schedule.ts`),
//! playing to the night (`pools.ts`), tappable everywhere (`gags.ts`).
//!
//! Awake (the face terminals, `app.tsx`): it covers the stage with the scan
//! box (`ScanBox.tsx`) above it in the corner — popups never land there
//! (`reserve`), and a held-up pass connects whatever is on screen. A pass
//! connecting, a line, or the room's voice speaking pushes it aside
//! (`active` false: hidden, every loop stopped, its place kept). Asleep
//! (`Attract.tsx`): full screen, minus anything naming the character.
//!
//! Sound: only the page's own accents through `sfx()` (D4) — quiet, rationed,
//! dropped while a voice speaks; the TV's are quieter still (the bus's TV
//! level), and its director mute cuts them.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from "react";
import { useReducedMotion } from "../cutscene/clock.ts";
import { useMomentUp } from "../cutscene/moment-bus.ts";
import type { ScreenState } from "../screen.ts";
import { sfx } from "../sound/bus.ts";
import type { SfxName } from "../sound/library.ts";
import { FACE_TIPS, SKIN_BAR, type IdleAd } from "./ads.ts";
import { IdleArt } from "./art.tsx";
import { MAX_POPUPS, ask, close, closeGag, dodge, emptyField, hydra, relayout, tick, type LivePopup, type PopupField, type Rect } from "./field.ts";
import { GAG_MS, THANKS, adGag, attentionOn, duckLane, gagSound, gagText, ringsAt, type AdGag } from "./gags.ts";
import { fillCopy, idleContextOf, type IdleContext } from "./pools.ts";
import { CONFIRM_TEXT, DODGED_TITLE, type PopupKind } from "./popups.ts";
import { hash32, mix, roll } from "./rng.ts";
import { SaverCanvas, StormTrail, type SaverHandle } from "./SaverCanvas.tsx";
import { adPool, advance, loadCursor, popupAt, popupPool, resumeCursor, saveCursor, segmentAt, type IdleCursor, type Segment } from "./schedule.ts";
import type { SaverEvent } from "./savers/index.ts";

/** The show's clock ticks this often while it runs (ms): segments, popups, TOUCH ME. */
export const IDLE_TICK_MS = 250;

export interface IdleShowProps {
  /** The terminal's name: the seed, and the cursor's key. */
  name: string;
  state: ScreenState | null;
  /** The character is hidden or asleep: nothing may name him. */
  asleep: boolean;
  character: string;
  target: "tv" | "wall";
  /** Off: hidden, every loop stopped (a pass connecting, a line open, the room speaking). */
  active: boolean;
  /** `pane`: beside the world view (the line pane only); `full`: the whole box. */
  region?: "full" | "pane";
  /** The scan box in the corner: no popup lands on it. */
  reserveRef?: RefObject<HTMLElement | null>;
  /** Hears each segment's layout (the wall's face sleeps unless it shows: `face`). */
  onLayout?: (layout: string) => void;
}

interface Gag {
  ad: string;
  gag: AdGag;
  until: number;
  seq: number;
}

/** The scan box's footprint as a share of the show's box (+ a margin), or null. */
function reserveOf(show: HTMLElement | null, box: HTMLElement | null | undefined): Rect | null {
  if (show === null || box === null || box === undefined) return null;
  const a = show.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  if (a.width <= 0 || a.height <= 0 || b.width <= 0) return null;
  const m = 0.02;
  return { x: (b.left - a.left) / a.width - m, y: (b.top - a.top) / a.height - m, w: b.width / a.width + 2 * m, h: b.height / a.height + 2 * m };
}

export function IdleShow({ name, state, asleep, character, target, active, region = "full", reserveRef, onLayout }: IdleShowProps) {
  const seed = useMemo(() => hash32(name.trim().toLowerCase() || "terminal"), [name]);
  const reduced = useReducedMotion();
  // A moment's scene over the show pauses it where it stands (still drawn —
  // a popup moment shows what is under it — but nothing moves or rings).
  const moment = useMomentUp();
  const running = active && !moment;
  const ctx: IdleContext = idleContextOf({ state, asleep, character, target, scan: reserveRef !== undefined, region, now: Date.now() });
  const ctxKey = `${ctx.pool}|${ctx.phase}|${ctx.names}|${ctx.target}|${ctx.scan}|${ctx.face}|${ctx.character}`;
  // The pools only change with the context (not with every poll).
  const pools = useMemo(() => ({ ads: adPool(ctx), popups: popupPool(ctx) }), [ctxKey]);
  const segOf = useCallback((i: number): Segment => segmentAt(seed, i, ctx, pools.ads), [seed, ctxKey, pools]);
  const lengthOf = useCallback((i: number) => segOf(i).ms, [segOf]);

  // --- the clock, the cursor, the popups ---
  const root = useRef<HTMLDivElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const cursor = useRef<IdleCursor | null>(null);
  if (cursor.current === null) cursor.current = resumeCursor(loadCursor(name), name, Date.now(), lengthOf);
  const field = useRef<PopupField>(emptyField(cursor.current.index * 5));
  const kinds = useRef(new Map<number, PopupKind>());
  const lastRing = useRef<number | null>(null);
  /** Windows drawn before this segment (the storm counts its own errors). */
  const stormBase = useRef(field.current.drawn);
  const lastTouch = useRef(Date.now());
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const play = useCallback(
    (name: SfxName, gain = 1, pitch?: number) => {
      if (!running) return;
      sfx(name, { gain: target === "tv" ? Math.min(gain, 0.7) : gain, pitch });
    },
    [running, target],
  );

  const kindOf = (p: LivePopup): PopupKind | null => {
    let k = kinds.current.get(p.id);
    if (k === undefined) {
      const picked = popupAt(seed, p.n, pools.popups, ctxRef.current.pool);
      if (picked === null) return null;
      k = picked;
      kinds.current.set(p.id, k);
    }
    return k;
  };

  const seg = segOf(cursor.current.index);

  // One tick: the line moves on, a window may arrive, a stale one goes.
  const step = useCallback(() => {
    const t = Date.now();
    const c = cursor.current!;
    const next = advance(c, t, lengthOf);
    if (next.index !== c.index) {
      cursor.current = next;
      saveCursor(name, next);
      const s = segOf(next.index);
      field.current = relayout(field.current, s.layout);
      stormBase.current = field.current.drawn;
      if (s.layout === "storm") {
        play("critical", 0.6);
        play("glitch", 0.5);
      } else if (s.layout === "ad" || s.layout === "side") play("whoosh", 0.35);
    }
    const s = segOf(cursor.current!.index);
    const reserve = reserveOf(root.current, reserveRef?.current);
    const r = tick(field.current, t, { seed, layout: s.layout, pool: ctxRef.current.pool, target, reserve, y2kLeft: ctxRef.current.y2kLeft });
    field.current = r.field;
    if (r.arrived !== null) {
      const k = kindOf(r.arrived);
      if (k !== null && !r.arrived.storm && ringsAt(lastRing.current, t, target)) {
        lastRing.current = t;
        play(k.sound, 0.45);
      }
    }
    for (const id of kinds.current.keys()) if (!field.current.live.some((p) => p.id === id)) kinds.current.delete(id);
    setNow(t);
  }, [lengthOf, name, segOf, seed, target, play, reserveRef]);

  useEffect(() => {
    if (!running) return;
    let id = 0;
    const start = () => {
      window.clearInterval(id);
      if (document.hidden) return;
      step();
      id = window.setInterval(step, IDLE_TICK_MS);
    };
    const onVis = () => (document.hidden ? window.clearInterval(id) : start());
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [running, step]);
  // Keep the place across a remount (the character waking, a line ending).
  useEffect(() => () => void (cursor.current !== null && saveCursor(name, cursor.current)), [name]);

  // --- taps ---
  const saver = useRef<SaverHandle | null>(null);
  const [ripple, setRipple] = useState<{ x: number; y: number; k: number } | null>(null);
  const [thanks, setThanks] = useState<{ text: string; until: number } | null>(null);
  const thanked = useRef(0);
  const clicks = useRef(new Map<string, number>());
  const [gag, setGag] = useState<Gag | null>(null);
  const gagSeq = useRef(0);

  const touched = () => {
    lastTouch.current = Date.now();
  };
  // Any tap on the terminal is a touch — the face showing through, the
  // scan box, the bar — so TOUCH ME never asks someone who is poking it.
  useEffect(() => {
    if (!active) return;
    const on = () => void (lastTouch.current = Date.now());
    window.addEventListener("pointerdown", on, true);
    return () => window.removeEventListener("pointerdown", on, true);
  }, [active]);
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    touched();
    // The background pokes the saver (the dimmed backdrop under an ad too);
    // a window, an ad or a button does its own thing.
    const el = e.target as HTMLElement;
    if (typeof el.closest === "function" && el.closest("button, .idle-ad, .idle-pop, .idle-banner-ad, .idle-face-tip") !== null) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    saver.current?.poke(x, y);
    setRipple({ x, y, k: Date.now() });
    play("blip", 0.5, 0.8 + roll(seed, Date.now()) * 0.6);
  };
  const onSaverEvent = useCallback(
    (e: SaverEvent) => {
      if (e === "corner") play("lose", 0.35); // a near miss: so close
      else if (e === "quack") play("blip", 0.6, 1.8);
      else if (e === "solved") play("sparkle", 0.35);
    },
    [play],
  );

  const reserveNow = () => reserveOf(root.current, reserveRef?.current);
  const onPopupButton = (p: LivePopup, which: "x" | number, e: MouseEvent) => {
    e.stopPropagation();
    touched();
    const k = kindOf(p);
    const t = Date.now();
    const b = typeof which === "number" ? k?.buttons[which] : undefined;
    const gagKind = p.asking ? "close" : which === "x" ? closeGag(roll(seed, p.id, t), p, field.current.live.length) : (b?.gag ?? "close");
    if (gagKind === "confirm") {
      field.current = ask(field.current, p.id, t);
      play("exclamation", 0.5);
    } else if (gagKind === "dodge" && !p.dodged) {
      field.current = dodge(field.current, p.id, t, { seed, reserve: reserveNow() });
      play("blip", 0.6, 1.4);
    } else if (gagKind === "hydra" || gagKind === "more") {
      field.current = hydra(field.current, p.id, t, { seed, reserve: reserveNow() }).field;
      play("error", 0.5);
    } else {
      field.current = close(field.current, p.id);
      play(which === "x" ? "close" : "click", 0.6);
    }
    setNow(t);
  };

  const onAdButton = (ad: IdleAd, e: MouseEvent) => {
    e.stopPropagation();
    touched();
    const n = clicks.current.get(ad.id) ?? 0;
    clicks.current.set(ad.id, n + 1);
    const g = adGag(ad.id, n);
    const t = Date.now();
    setGag({ ad: ad.id, gag: g, until: t + GAG_MS[g], seq: ++gagSeq.current });
    play(gagSound(g), 0.6);
    if (g === "popup") {
      field.current = hydra({ ...field.current, live: [...field.current.live] }, -1, t, { seed, reserve: reserveNow() }).field;
      setNow(t);
    }
  };
  const onAdClose = (e: MouseEvent) => {
    e.stopPropagation();
    touched();
    // The × skips the ad: the next segment, now.
    const c = cursor.current!;
    cursor.current = { index: c.index + 1, start: Date.now() };
    saveCursor(name, cursor.current);
    field.current = relayout(field.current, segOf(cursor.current.index).layout);
    play("close", 0.6);
    setNow(Date.now());
  };
  const onTouchMe = (e: MouseEvent) => {
    e.stopPropagation();
    touched();
    const text = THANKS[thanked.current++ % THANKS.length]!;
    setThanks({ text, until: Date.now() + 2_200 });
    play("sparkle", 0.6);
  };

  // --- the picture ---
  const live = field.current.live;
  const attention = running && attentionOn(lastTouch.current, now, target);
  const gagFor = (ad: IdleAd) => (gag !== null && gag.ad === ad.id && now < gag.until ? gag : null);
  const adNode = (ad: IdleAd, size: "big" | "half") => <AdView key={ad.id} ad={ad} ctx={ctx} size={size} gag={gagFor(ad)} now={now} reduced={reduced} onButton={(e) => onAdButton(ad, e)} onClose={onAdClose} />;
  const layout = seg.layout;
  useEffect(() => onLayout?.(layout), [layout, onLayout]);
  const tip = seg.layout === "face" ? fillCopy(FACE_TIPS[mix(seed, seg.index) % FACE_TIPS.length]!, ctx) : null;
  const storming = seg.layout === "storm";
  return (
    <div
      ref={root}
      className={`idle-show${reduced ? " reduced" : ""}`}
      data-layout={seg.layout}
      data-pool={ctx.pool}
      data-region={region}
      data-target={target}
      data-active={String(active)}
      data-paused={running ? undefined : ""}
      data-segment={seg.index}
      onPointerDown={onDown}
    >
      <div className="idle-saver-wrap" key={`${seg.saver}.${seg.index}`}>
        <SaverCanvas saver={seg.saver} seed={mix(seed, seg.index)} active={running && seg.layout !== "face"} reduced={reduced} handle={saver} onEvent={onSaverEvent} />
      </div>
      {storming && <StormTrail key={seg.index} seed={mix(seed, seg.index)} active={running} reduced={reduced} />}
      {storming && (
        <div className="idle-storm-banner" key={`b${seg.index}`}>
          <IdleArt kind="error" size="1.4em" /> SYSTEM OVERLOAD — {String(Math.max(0, field.current.drawn - stormBase.current) * 7 + 13).padStart(3, "0")} ERRORS
        </div>
      )}
      {seg.layout === "ad" && seg.ads[0] !== undefined && (
        <div className="idle-ad-full" key={`a${seg.index}`}>
          {adNode(seg.ads[0], "big")}
        </div>
      )}
      {seg.layout === "banner" && seg.ads[0] !== undefined && (
        <div className="idle-banner" key={`n${seg.index}`}>
          <AdBanner ad={seg.ads[0]} ctx={ctx} gag={gagFor(seg.ads[0])} onButton={(e) => onAdButton(seg.ads[0]!, e)} />
        </div>
      )}
      {seg.layout === "side" && (
        <div className="idle-side" key={`s${seg.index}`}>
          {seg.ads.map((a) => adNode(a, "half"))}
        </div>
      )}
      {seg.layout === "face" && (
        <div className="idle-face" key={`f${seg.index}`}>
          <div className="idle-face-tip">
            <span className="idle-face-tip-who">{ctx.character.toUpperCase()}</span>
            {tip}
          </div>
          {seg.ads[0] !== undefined && <div className="idle-face-ad">{adNode(seg.ads[0], "half")}</div>}
        </div>
      )}
      <div className="idle-popups">
        {Array.from({ length: MAX_POPUPS }, (_, slot) => {
          const p = live.find((x) => x.slot === slot) ?? null;
          return <PopupSlot key={slot} popup={p} kind={p === null ? null : kindOf(p)} ctx={ctx} reduced={reduced} onButton={onPopupButton} />;
        })}
      </div>
      {attention && (
        <button type="button" className="idle-touch-me" onClick={onTouchMe} style={{ left: `${12 + (mix(seed, Math.floor(now / 30_000)) % 60)}%` }}>
          👆 TOUCH ME
        </button>
      )}
      {thanks !== null && now < thanks.until && <div className="idle-thanks">{thanks.text}</div>}
      {ripple !== null && <span className="idle-ripple" key={ripple.k} style={{ left: ripple.x, top: ripple.y }} />}
    </div>
  );
}

// --- one ad ---------------------------------------------------------------------------------

/** Ads whose `public/ads/<id>.png` failed to load: never fetched again this page. */
const missingArt = new Set<string>();

/** An ad's picture: its PNG when it has one (`png: true`), else (or once that fails) its SVG art. */
export function AdArtView({ ad, className }: { ad: IdleAd; className: string }) {
  const [failed, setFailed] = useState(() => missingArt.has(ad.id));
  useEffect(() => setFailed(missingArt.has(ad.id)), [ad.id]);
  if (ad.png === true && !failed) {
    return (
      <img
        className={`${className} idle-ad-png`}
        src={`${import.meta.env.BASE_URL}ads/${ad.id}.png`}
        alt=""
        draggable={false}
        onError={() => {
          missingArt.add(ad.id);
          setFailed(true);
        }}
      />
    );
  }
  return ad.art === undefined ? null : <IdleArt kind={ad.art} size="1em" className={className} />;
}

function AdView({ ad, ctx, size, gag, now, reduced, onButton, onClose }: { ad: IdleAd; ctx: IdleContext; size: "big" | "half"; gag: Gag | null; now: number; reduced: boolean; onButton: (e: MouseEvent) => void; onClose: (e: MouseEvent) => void }) {
  const text = gag === null ? null : gag.gag === "loading" && now < gag.until - 1_200 ? null : gagText(gag.gag);
  return (
    <div className={`idle-ad skin-${ad.skin} size-${size}`} data-gag={gag?.gag ?? undefined} key={gag?.seq ?? 0}>
      <div className="idle-ad-bar">
        <span className="idle-ad-bar-title">{SKIN_BAR[ad.skin]}</span>
        <button type="button" className="idle-ad-x" aria-label="Close the ad" onClick={onClose} onPointerDown={(e) => e.stopPropagation()}>
          ×
        </button>
      </div>
      <div className="idle-ad-body">
        <AdArtView ad={ad} className="idle-ad-art" />
        <div className="idle-ad-words">
          {ad.kicker !== undefined && <div className="idle-ad-kicker">{fillCopy(ad.kicker, ctx)}</div>}
          <div className="idle-ad-title">{fillCopy(ad.title, ctx)}</div>
          <p className="idle-ad-text">{fillCopy(ad.body, ctx)}</p>
          {ad.id === "ad-punch-the-duck" && <DuckTarget now={now} reduced={reduced} />}
          <button type="button" className="idle-ad-button" onClick={onButton} onPointerDown={(e) => e.stopPropagation()}>
            {fillCopy(ad.button, ctx)}
          </button>
          {gag?.gag === "loading" && (
            <div className="idle-ad-loading" aria-hidden="true">
              <span />
            </div>
          )}
          {text !== null && <div className="idle-ad-gag">{text}</div>}
        </div>
      </div>
    </div>
  );
}

/** The "punch the duck" target, ping-ponging along its lane (`duckLane`) —
 *  a transform on a lane-wide runner, never layout; held mid-lane under
 *  reduced motion. */
export function DuckTarget({ now, reduced }: { now: number; reduced: boolean }) {
  const at = reduced ? 0.5 : duckLane(now);
  return (
    <div className="idle-duck-lane" aria-hidden="true">
      <span className="idle-duck-runner" style={{ transform: `translateX(${(at * 100).toFixed(1)}%)` }}>
        <span className="idle-duck-target">
          <IdleArt kind="duck" size="1em" />
        </span>
      </span>
    </div>
  );
}

/** A banner across the screen: the art, the title, the body as a marquee, the button. */
function AdBanner({ ad, ctx, gag, onButton }: { ad: IdleAd; ctx: IdleContext; gag: Gag | null; onButton: (e: MouseEvent) => void }) {
  const text = gag === null ? null : gagText(gag.gag);
  return (
    <div className={`idle-banner-ad skin-${ad.skin}`} data-gag={gag?.gag ?? undefined} key={gag?.seq ?? 0}>
      <AdArtView ad={ad} className="idle-banner-art" />
      <div className="idle-banner-words">
        <div className="idle-banner-title">
          {ad.kicker !== undefined && <span className="idle-banner-kicker">{fillCopy(ad.kicker, ctx)}</span>}
          {fillCopy(ad.title, ctx)}
        </div>
        <div className="idle-marquee">
          <span>{text ?? fillCopy(ad.body, ctx)}</span>
        </div>
      </div>
      <button type="button" className="idle-ad-button" onClick={onButton} onPointerDown={(e) => e.stopPropagation()}>
        {fillCopy(ad.button, ctx)}
      </button>
    </div>
  );
}

// --- one window (a pooled slot) ---------------------------------------------------------------

function PopupSlot({ popup, kind, ctx, reduced, onButton }: { popup: LivePopup | null; kind: PopupKind | null; ctx: IdleContext; reduced: boolean; onButton: (p: LivePopup, which: "x" | number, e: MouseEvent) => void }) {
  const el = useRef<HTMLDivElement | null>(null);
  const id = popup?.id ?? 0;
  const dodged = popup?.dodged ?? false;
  // The slot's element is reused: a new window (or a dodge) replays the open animation on it.
  useLayoutEffect(() => {
    const node = el.current as (HTMLDivElement & { animate?: HTMLElement["animate"] }) | null;
    if (node === null || id === 0 || typeof node.animate !== "function") return;
    try {
      node.animate(
        reduced
          ? // Reduced motion: it fades in where it lands; a dodge just blinks.
            [{ opacity: dodged ? 0.4 : 0 }, { opacity: 1 }]
          : dodged
          ? [{ transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-3px)" }, { transform: "none" }]
          : [
              { transform: "scale(0.3)", opacity: 0 },
              { transform: "scale(1)", opacity: 1 },
            ],
        reduced ? { duration: 200, easing: "ease-out" } : { duration: dodged ? 240 : 170, easing: dodged ? "linear" : "steps(4, end)" },
      );
    } catch {
      /* no animation: it just appears */
    }
  }, [id, dodged, reduced]);
  const on = popup !== null && kind !== null;
  const stop = (e: PointerEvent) => e.stopPropagation();
  return (
    <div
      ref={el}
      className={`idle-pop style-${kind?.style ?? "dialog"}${popup?.storm === true ? " storm" : ""}`}
      data-on={String(on)}
      style={on ? { left: `${(popup.x * 100).toFixed(2)}%`, top: `${(popup.y * 100).toFixed(2)}%` } : undefined}
      onPointerDown={stop}
    >
      {on && (
        <>
          <div className="idle-pop-bar">
            <span className="idle-pop-title">{popup.dodged ? DODGED_TITLE : fillCopy(kind.title, ctx)}</span>
            <button type="button" className="idle-pop-x" aria-label="Close" onClick={(e) => onButton(popup, "x", e)}>
              ×
            </button>
          </div>
          <div className="idle-pop-body">
            <IdleArt kind={kind.icon} size="2em" className="idle-pop-icon" />
            <p className="idle-pop-text">{popup.asking ? CONFIRM_TEXT : fillCopy(kind.text, ctx)}</p>
          </div>
          {kind.style === "progress" && (
            <div className="idle-pop-progress" aria-hidden="true">
              <span />
            </div>
          )}
          <div className="idle-pop-buttons">
            {(popup.asking ? [{ label: "Yes" }, { label: "No" }] : kind.buttons).map((b, i) => (
              <button type="button" key={i} className="idle-pop-button" onClick={(e) => onButton(popup, i, e)}>
                {fillCopy(b.label, ctx)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
