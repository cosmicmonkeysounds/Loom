// The pop-up and the teleprompter (wave 55): the lazy chunk behind `AloudSlot`.
// The pop-up has no way to close it, and sounds until it is opened. The reader's
// lines scroll past the reading line at a speed they set; the rail on the
// right is a map of the whole script: drag it to preview a line, let go to
// jump there. ≡ jumps by section, ↩ goes back after a jump. A finger on the
// text holds the scroll. It keeps the screen on, since nobody touches a phone
// they are reading from. Closing it without ✓ Done lands on the pop-up.
// Wave 59: while a scene is on the server, all of that is one shared position,
// in words: this phone follows it, a finger on the text locks it to this phone
// and sends where it goes, and his lines lock it for everyone and scroll by
// themselves. `AloudCard` is what someone with one line gets instead.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { playTone } from "../alerts.ts";
import type { SessionStorage } from "../host.ts";
import type { Aloud } from "./lazy.tsx";
import { unreadLines } from "./model.ts";
import { MARK_AT, SIZE_STEP, SPEED_MAX, SPEED_MIN, SPEED_STEP, bitsKey, bitsOf, clampSize, clampSpeed, clip, flatten, lineAt, pastLastLine, posOfY, pxPerSecond, railLine, railStarts, readingLabel, sectionLine, startLine, wordOffsets, yOfPos, type FlatLine } from "./prompter-model.ts";

const SPEED_KEY = "loom.aloud.speed";
const SIZE_KEY = "loom.aloud.size";
/** A finger off the text keeps holding the scroll this long, through its fling. */
const HOLD_AFTER_MS = 400;
const noSubscribe = (): (() => void) => () => {};
const DONE_ARM_MS = 4_000;
const BACK_CHIP_MS = 8_000;
/** Wave 59: a finger on the text sends where it is this often… */
const MOVE_MS = 160;
/** …and, resting, says it is still there this often (the server's lock lapses). */
const STILL_HERE_MS = 1_500;
/** Wave 59: how much of the gap to the shared position a frame closes. */
const FOLLOW = 0.3;
/** While the pop-up waits, it sounds again this often. */
export const ALOUD_NUDGE_MS = 15_000;

export interface PrompterProps {
  a: Aloud;
  storage: SessionStorage;
  sound: boolean;
}

export function AloudAlert({ a, sound }: Pick<PrompterProps, "a" | "sound">) {
  useEffect(() => {
    playTone("alarm", sound);
    const t = window.setInterval(() => playTone("alarm", sound), ALOUD_NUDGE_MS);
    return () => window.clearInterval(t);
  }, [sound]);
  const lines = unreadLines(a.script, a.mark);
  const title = a.script.find((s) => s.lines.includes(lines[0]!))?.title ?? "";
  return (
    <button type="button" className="aloud-alert" role="alert" onClick={() => a.setOpen(true)}>
      {/* DRAFT w55 */}
      <span className="aloud-alert-head">📜 READ THIS OUT LOUD</span>
      <span className="aloud-alert-title">{title}</span>
      <span className="aloud-alert-sub">
        {lines.length} {lines.length === 1 ? "line" : "lines"} · {readingLabel(lines)}
      </span>
      <span className="aloud-alert-go">▶ Open the teleprompter</span>
    </button>
  );
}

/** Wave 59: someone else's script has a line of yours. Never the whole phone. */
export function AloudCard({ a, sound }: Pick<PrompterProps, "a" | "sound">) {
  useEffect(() => {
    playTone("info", sound);
  }, [sound]);
  const mine = (a.shared?.script ?? []).flatMap((s) => s.lines.filter((l) => l.mine));
  return (
    <div className="aloud-card" role="status" data-testid="aloud-card">
      {/* DRAFT w59 */}
      <b className="aloud-card-head">📜 You have a line</b>
      {mine.map((l) => (
        <p key={l.seq} className="aloud-card-line">
          {clip(l.text, 160)}
        </p>
      ))}
      <div className="aloud-card-row">
        <button type="button" className="w95-btn" onClick={a.dropCard}>
          ✓ I'll just say it
        </button>
        <button type="button" className="w95-btn" onClick={() => a.setOpen(true)}>
          📜 Join the teleprompter
        </button>
      </div>
    </div>
  );
}

export function AloudSurface(p: PrompterProps) {
  if (!p.a.covering) return <AloudCard a={p.a} sound={p.sound} />;
  return p.a.open ? <Prompter key={p.a.shared?.id ?? 0} {...p} /> : <AloudAlert a={p.a} sound={p.sound} />;
}

function useKeepAwake(): void {
  useEffect(() => {
    const api = (navigator as unknown as { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (api === undefined) return;
    let alive = true;
    let held: { release(): Promise<void> } | null = null;
    const take = () => {
      if (document.visibilityState !== "visible") return;
      api.request("screen").then(
        (lock) => {
          if (alive) held = lock;
          else void lock.release().catch(() => {});
        },
        () => {},
      );
    };
    take();
    document.addEventListener("visibilitychange", take);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", take);
      void held?.release().catch(() => {});
    };
  }, []);
}

function LineRow({ l, now, unread }: { l: FlatLine; now: boolean; unread: boolean }) {
  return (
    <p data-line={l.index} className={`aloud-line ${l.mine ? "mine" : "cue"}${l.his === true ? " his" : ""}${now ? " now" : ""}${unread ? " unread" : ""}`}>
      {!l.mine && l.speaker !== "" && <span className="aloud-who">{l.speaker}: </span>}
      {l.manner !== null && <span className="aloud-manner">({l.manner}) </span>}
      {l.text}
    </p>
  );
}

export function Prompter({ a, storage, sound }: PrompterProps) {
  useKeepAwake();
  const sh = a.shared;
  const shRef = useRef(sh);
  shRef.current = sh;
  const script = sh?.script ?? a.script;
  const lines = useMemo(() => flatten(script), [script]);
  const offs = useMemo(() => wordOffsets(lines), [lines]);
  const key = useSyncExternalStore(sh?.store.subscribe ?? noSubscribe, () => bitsKey(sh?.store.frame ?? null, sh?.me ?? ""));
  const bits = useMemo(() => bitsOf(key), [key]);
  const bitsRef = useRef(bits);
  bitsRef.current = bits;
  const starts = useMemo(() => railStarts(lines), [lines]);
  const words = useMemo(() => lines.reduce((n, l) => n + l.words, 0), [lines]);
  const box = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const tops = useRef<number[]>([]);
  const bottom = useRef(0);
  const shown = useRef(0);
  const sentAt = useRef(0);
  const pos = useRef(0);
  const held = useRef(false);
  const release = useRef<number | undefined>(undefined);
  const [at, setAt] = useState(() => startLine(lines, a.mark));
  const atRef = useRef(at);
  atRef.current = at;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedNow] = useState(() => clampSpeed(storage.load<number>(SPEED_KEY) ?? 1));
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const [size, setSizeNow] = useState(() => clampSize(storage.load<number>(SIZE_KEY) ?? 34));
  const [ended, setEnded] = useState(false);
  const [jumps, setJumps] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [backTo, setBackTo] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const seen = useRef(lines.length);

  const setSpeed = (n: number) => {
    const next = clampSpeed(n);
    setSpeedNow(next);
    storage.save(SPEED_KEY, next);
    if (sh !== null && bits.playing) void sh.post({ scene: sh.id, op: "play", on: true, speed: next }).catch(() => {});
  };
  const togglePlay = () => {
    const s = shRef.current;
    if (s === null) setPlaying((p) => !p);
    else if (!bitsRef.current.locked) void s.post({ scene: s.id, op: "play", on: !bitsRef.current.playing, speed: speedRef.current }).catch(() => {});
  };
  const setSize = (n: number) => {
    const next = clampSize(n);
    setSizeNow(next);
    storage.save(SIZE_KEY, next);
  };
  const markY = () => Math.round((box.current?.clientHeight ?? 0) * MARK_AT);
  const measure = () => {
    const el = box.current;
    if (el === null) return;
    el.style.setProperty("--aloud-mark", `${markY()}px`);
    el.style.setProperty("--aloud-tail", `${el.clientHeight - markY()}px`);
    const rows = [...el.querySelectorAll<HTMLElement>("[data-line]")];
    tops.current = rows.map((n) => n.offsetTop);
    const end = rows[rows.length - 1];
    bottom.current = end !== undefined ? end.offsetTop + end.offsetHeight : 0;
  };
  const sharedPos = () => posOfY((box.current?.scrollTop ?? 0) + markY(), offs, tops.current, bottom.current);
  const place = (i: number) => {
    const el = box.current;
    if (el === null) return;
    pos.current = Math.max(0, (tops.current[i] ?? 0) - markY());
    el.scrollTop = pos.current;
    setAt(i);
  };
  /** A move someone asked for, as opposed to a repaint: everyone goes there. */
  const moveTo = (i: number) => {
    place(i);
    const s = shRef.current;
    if (s === null || bitsRef.current.locked) return;
    const p = offs[i] ?? 0;
    s.store.nudge(p);
    void s.post({ scene: s.id, op: "jump", pos: p }).catch(() => s.store.revert());
  };
  const jump = (i: number) => {
    if (bitsRef.current.locked) return;
    setBackTo(atRef.current);
    moveTo(i);
    setEnded(false);
  };

  // First paint at the first new line; a new size or a turned phone keeps the line.
  useLayoutEffect(() => {
    measure();
    place(atRef.current);
  }, [size]);
  useLayoutEffect(() => {
    measure();
  }, [lines.length]);
  useEffect(() => {
    const el = box.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const r = new ResizeObserver(() => {
      measure();
      place(atRef.current);
    });
    r.observe(el);
    return () => r.disconnect();
  }, []);

  // New lines while reading: they join the end, with one tone and a chip.
  const fresh = lines.length - seen.current;
  useEffect(() => {
    if (fresh > 0) playTone("info", sound);
  }, [lines.length]);
  useEffect(() => {
    if (at >= seen.current) seen.current = lines.length;
  }, [at, lines.length]);

  // Wave 59: the shared position, on this phone's text. A finger on the text
  // drives it instead, and says so, even when it rests.
  useEffect(() => {
    if (sh === null) return;
    let frame = 0;
    const step = () => {
      const el = box.current;
      const f = sh.store.frame;
      if (el !== null && f !== null) {
        if (f.speaking !== null || (f.holder !== null && f.holder.who !== sh.me)) held.current = false;
        const now = performance.now();
        if (held.current) {
          const moved = Math.abs(el.scrollTop - shown.current) >= 1;
          if (now - sentAt.current >= (moved ? MOVE_MS : STILL_HERE_MS)) {
            sentAt.current = now;
            shown.current = el.scrollTop;
            void sh.post({ scene: sh.id, op: "move", pos: sharedPos() }).catch(() => {});
          }
        } else {
          const want = Math.max(0, yOfPos(sh.store.pos(now), offs, tops.current, bottom.current) - markY());
          const gap = want - shown.current;
          shown.current = Math.abs(gap) < 0.5 || Math.abs(gap) > el.clientHeight ? want : shown.current + gap * FOLLOW;
          el.scrollTop = shown.current;
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [sh, offs]);

  useEffect(() => {
    if (!playing || sh !== null) return;
    let frame = 0;
    let last = performance.now();
    const step = (t: number) => {
      const el = box.current;
      if (el === null) return;
      const dt = Math.min(t - last, 100);
      last = t;
      if (held.current) {
        pos.current = el.scrollTop;
      } else {
        const px = (tops.current[tops.current.length - 1] ?? 0) - (tops.current[0] ?? 0);
        pos.current += (pxPerSecond(speedRef.current, px, words) * dt) / 1000;
        el.scrollTop = pos.current;
        if (pos.current >= el.scrollHeight - el.clientHeight - 1) {
          setPlaying(false);
          return;
        }
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, words, sh]);

  const onScroll = () => {
    const el = box.current;
    if (el === null) return;
    setAt(lineAt(tops.current, el.scrollTop + markY() + 1));
    setEnded(el.scrollTop >= el.scrollHeight - el.clientHeight - 2);
    if (held.current) pos.current = el.scrollTop;
  };
  const hold = () => {
    window.clearTimeout(release.current);
    const s = shRef.current;
    if (s !== null) {
      if (bitsRef.current.locked) return;
      if (!held.current) {
        sentAt.current = performance.now();
        shown.current = box.current?.scrollTop ?? 0;
        void s.post({ scene: s.id, op: "press", pos: sharedPos() }).catch(() => {
          held.current = false;
        });
      }
    }
    held.current = true;
  };
  const leave = () => {
    const s = shRef.current;
    if (s === null || !held.current) return;
    const p = sharedPos();
    s.store.nudge(p);
    void s.post({ scene: s.id, op: "letgo", pos: p }).catch(() => {});
  };
  const letGo = () => {
    window.clearTimeout(release.current);
    if (!held.current) return;
    release.current = window.setTimeout(() => {
      leave();
      held.current = false;
    }, HOLD_AFTER_MS);
  };
  useEffect(
    () => () => {
      window.clearTimeout(release.current);
      leave();
    },
    [],
  );

  const railPick = (e: ReactPointerEvent) => {
    const r = rail.current?.getBoundingClientRect();
    if (r === undefined || r.height === 0) return;
    setScrub(railLine(starts, (e.clientY - r.top) / r.height));
  };

  useEffect(() => {
    if (backTo === null) return;
    const t = window.setTimeout(() => setBackTo(null), BACK_CHIP_MS);
    return () => window.clearTimeout(t);
  }, [backTo]);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), DONE_ARM_MS);
    return () => window.clearTimeout(t);
  }, [armed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") a.setOpen(false);
      else if (bitsRef.current.locked) return;
      else if (e.key === "ArrowDown") moveTo(Math.min(lines.length - 1, atRef.current + 1));
      else if (e.key === "ArrowUp") moveTo(Math.max(0, atRef.current - 1));
      else if (e.key === " " && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lines.length]);

  const line = lines[at];
  const section = line?.section ?? 0;
  // Nothing of a host's to get to the end of: their ✓ Done always asks.
  const finished = ended || (sh?.role !== "host" && pastLastLine(lines, at));
  const toSection = (n: number) => {
    const i = sectionLine(lines, n);
    if (i !== null) jump(i);
  };
  const doneTap = () => {
    if (finished || armed) a.done();
    else setArmed(true);
  };
  const preview = scrub !== null ? lines[scrub] : undefined;

  return (
    <div className="aloud-prompter" role="dialog" aria-label="Teleprompter">
      <header className="aloud-bar">
        <div className="aloud-bar-words">
          {/* DRAFT w55 */}
          <span className="aloud-bar-head">📜 READ OUT LOUD</span>
          <span className="aloud-bar-title">
            {script[section]?.title ?? ""} · line {at + 1} of {lines.length}
          </span>
        </div>
        <button type="button" className="aloud-x" aria-label="Close the teleprompter" onClick={() => a.setOpen(false)}>
          ✕
        </button>
      </header>
      <div className="aloud-stage">
        <div
          className={`aloud-text${bits.locked ? " locked" : ""}`}
          ref={box}
          style={{ fontSize: `${size}px` }}
          onScroll={onScroll}
          onTouchStart={hold}
          onTouchEnd={letGo}
          onTouchCancel={letGo}
          onPointerDown={hold}
          onPointerUp={letGo}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") letGo();
          }}
          onWheel={() => {
            hold();
            letGo();
          }}
        >
          {script.map((s, i) => (
            <section key={s.lines[0]!.seq}>
              <h2 className="aloud-section">{s.title}</h2>
              {lines
                .filter((l) => l.section === i)
                .map((l) => (
                  <LineRow key={l.seq} l={l} now={l.index === at} unread={l.seq > a.mark} />
                ))}
            </section>
          ))}
          <div className="aloud-end">
            <p>End of script</p>
            <button type="button" className="aloud-done big" onClick={a.done}>
              ✓ Done reading
            </button>
          </div>
        </div>
        <div className="aloud-mark" aria-hidden="true">
          ▶
        </div>
        {bits.locked && (
          <div className="aloud-lock" role="status" data-testid="aloud-lock">
            {/* DRAFT w59 */}
            {bits.speaking ? `🔊 ${bits.name} is speaking` : `🔒 ${bits.name} has it`}
          </div>
        )}
        <div
          className="aloud-rail"
          ref={rail}
          role="slider"
          tabIndex={0}
          aria-label="Scroll preview: drag to see a line, let go to jump there"
          aria-valuemin={1}
          aria-valuemax={lines.length}
          aria-valuenow={at + 1}
          onPointerDown={(e) => {
            if (bits.locked) return;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            railPick(e);
          }}
          onPointerMove={(e) => {
            if (scrub !== null) railPick(e);
          }}
          onPointerUp={() => {
            if (scrub !== null) jump(scrub);
            setScrub(null);
          }}
          onPointerCancel={() => setScrub(null)}
        >
          {lines.map((l) => (
            <i key={l.seq} className={l.mine ? "mine" : "cue"} style={{ flexGrow: l.words }} />
          ))}
          {script.slice(1).map((s, i) => (
            <b key={s.lines[0]!.seq} className="aloud-rail-tick" style={{ top: `${(starts[sectionLine(lines, i + 1) ?? 0] ?? 0) * 100}%` }} />
          ))}
          <span className="aloud-rail-thumb" style={{ top: `${(starts[scrub ?? at] ?? 0) * 100}%` }} />
        </div>
        {preview !== undefined && (
          <div className="aloud-preview" style={{ top: `min(calc(100% - 132px), ${(starts[scrub!] ?? 0) * 100}%)` }}>
            <strong>{script[preview.section]?.title}</strong>
            <span>
              Line {preview.index + 1}: {clip(preview.text)}
            </span>
            {lines[preview.index + 1] !== undefined && <span className="aloud-preview-next">{clip(lines[preview.index + 1]!.text, 60)}</span>}
          </div>
        )}
        <div className="aloud-chips">
          {backTo !== null && (
            <button
              type="button"
              className="aloud-chip"
              onClick={() => {
                moveTo(backTo);
                setBackTo(null);
              }}
            >
              ↩ Back to line {backTo + 1}
            </button>
          )}
          {fresh > 0 && (
            <button type="button" className="aloud-chip fresh" onClick={() => jump(seen.current)}>
              ＋ {fresh} new {fresh === 1 ? "line" : "lines"} ▾
            </button>
          )}
        </div>
      </div>
      <footer className="aloud-controls">
        <div className="aloud-row">
          <button type="button" aria-label="Previous section" disabled={section === 0 || bits.locked} onClick={() => toSection(section - 1)}>
            ⏮
          </button>
          <button type="button" aria-label="Back a line" disabled={bits.locked} onClick={() => moveTo(Math.max(0, at - 1))}>
            ↶
          </button>
          <button type="button" className="aloud-play" disabled={bits.locked} onClick={togglePlay}>
            {(sh !== null ? bits.playing : playing) ? "⏸ Pause" : "▶ Scroll"}
          </button>
          <button type="button" aria-label="Forward a line" disabled={bits.locked} onClick={() => moveTo(Math.min(lines.length - 1, at + 1))}>
            ↷
          </button>
          <button type="button" aria-label="Next section" disabled={section >= script.length - 1 || bits.locked} onClick={() => toSection(section + 1)}>
            ⏭
          </button>
        </div>
        <div className="aloud-row aloud-speed">
          <button type="button" aria-label="Slower" onClick={() => setSpeed(speed - SPEED_STEP)}>
            −
          </button>
          <label>
            <span>Speed {speed.toFixed(1)}×</span>
            <input type="range" aria-label="Speed" min={SPEED_MIN} max={SPEED_MAX} step={SPEED_STEP} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
          </label>
          <button type="button" aria-label="Faster" onClick={() => setSpeed(speed + SPEED_STEP)}>
            +
          </button>
        </div>
        <div className="aloud-row">
          <button type="button" aria-label="Smaller text" onClick={() => setSize(size - SIZE_STEP)}>
            A−
          </button>
          <button type="button" aria-label="Bigger text" onClick={() => setSize(size + SIZE_STEP)}>
            A+
          </button>
          <button type="button" className="aloud-jump" onClick={() => setJumps(true)}>
            ≡ Jump
          </button>
          <button type="button" className={`aloud-done${armed ? " armed" : ""}`} onClick={doneTap}>
            {armed ? "Skip the rest? Tap again" : "✓ Done"}
          </button>
        </div>
      </footer>
      {jumps && (
        <div className="aloud-sheet" role="dialog" aria-label="Jump to a section">
          <header className="aloud-sheet-bar">
            <span>Jump to</span>
            <button type="button" className="aloud-x" aria-label="Close the list" onClick={() => setJumps(false)}>
              ✕
            </button>
          </header>
          <div className="aloud-sheet-list">
            {script.map((s, i) => {
              const news = s.lines.some((l) => l.mine && l.seq > a.mark);
              return (
                <button
                  key={s.lines[0]!.seq}
                  type="button"
                  className={i === section ? "now" : ""}
                  onClick={() => {
                    toSection(i);
                    setJumps(false);
                  }}
                >
                  <strong>
                    {s.title}
                    {news && <em> NEW</em>}
                  </strong>
                  <span>{clip(s.lines.find((l) => l.mine)?.text ?? "", 70)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
