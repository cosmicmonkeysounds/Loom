// The pop-up and the teleprompter (wave 55): the lazy chunk behind `AloudSlot`.
// The pop-up has no way to close it, and sounds until it is opened. The reader's
// lines scroll past the reading line at a speed they set; the rail on the
// right is a map of the whole script: drag it to preview a line, let go to
// jump there. ≡ jumps by section, ↩ goes back after a jump. A finger on the
// text holds the scroll. It keeps the screen on, since nobody touches a phone
// they are reading from. Closing it without ✓ Done lands on the pop-up.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { playTone } from "../alerts.ts";
import type { SessionStorage } from "../host.ts";
import type { Aloud } from "./lazy.tsx";
import { unreadLines } from "./model.ts";
import { MARK_AT, SIZE_STEP, SPEED_MAX, SPEED_MIN, SPEED_STEP, clampSize, clampSpeed, clip, flatten, lineAt, pastLastLine, pxPerSecond, railLine, railStarts, readingLabel, sectionLine, startLine, type FlatLine } from "./prompter-model.ts";

const SPEED_KEY = "loom.aloud.speed";
const SIZE_KEY = "loom.aloud.size";
/** A finger off the text keeps holding the scroll this long, through its fling. */
const HOLD_AFTER_MS = 400;
const DONE_ARM_MS = 4_000;
const BACK_CHIP_MS = 8_000;
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

export function AloudSurface(p: PrompterProps) {
  return p.a.open ? <Prompter {...p} /> : <AloudAlert a={p.a} sound={p.sound} />;
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
    <p data-line={l.index} className={`aloud-line ${l.mine ? "mine" : "cue"}${now ? " now" : ""}${unread ? " unread" : ""}`}>
      {!l.mine && l.speaker !== "" && <span className="aloud-who">{l.speaker}: </span>}
      {l.manner !== null && <span className="aloud-manner">({l.manner}) </span>}
      {l.text}
    </p>
  );
}

export function Prompter({ a, storage, sound }: PrompterProps) {
  useKeepAwake();
  const lines = useMemo(() => flatten(a.script), [a.script]);
  const starts = useMemo(() => railStarts(lines), [lines]);
  const words = useMemo(() => lines.reduce((n, l) => n + l.words, 0), [lines]);
  const box = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const tops = useRef<number[]>([]);
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
    tops.current = [...el.querySelectorAll<HTMLElement>("[data-line]")].map((n) => n.offsetTop);
  };
  const place = (i: number) => {
    const el = box.current;
    if (el === null) return;
    pos.current = Math.max(0, (tops.current[i] ?? 0) - markY());
    el.scrollTop = pos.current;
    setAt(i);
  };
  const jump = (i: number) => {
    setBackTo(atRef.current);
    place(i);
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

  useEffect(() => {
    if (!playing) return;
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
  }, [playing, words]);

  const onScroll = () => {
    const el = box.current;
    if (el === null) return;
    setAt(lineAt(tops.current, el.scrollTop + markY() + 1));
    setEnded(el.scrollTop >= el.scrollHeight - el.clientHeight - 2);
    if (held.current) pos.current = el.scrollTop;
  };
  const hold = () => {
    window.clearTimeout(release.current);
    held.current = true;
  };
  const letGo = () => {
    window.clearTimeout(release.current);
    release.current = window.setTimeout(() => {
      held.current = false;
    }, HOLD_AFTER_MS);
  };
  useEffect(() => () => window.clearTimeout(release.current), []);

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
      else if (e.key === "ArrowDown") place(Math.min(lines.length - 1, atRef.current + 1));
      else if (e.key === "ArrowUp") place(Math.max(0, atRef.current - 1));
      else if (e.key === " " && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lines.length]);

  const line = lines[at];
  const section = line?.section ?? 0;
  const finished = ended || pastLastLine(lines, at);
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
            {a.script[section]?.title ?? ""} · line {at + 1} of {lines.length}
          </span>
        </div>
        <button type="button" className="aloud-x" aria-label="Close the teleprompter" onClick={() => a.setOpen(false)}>
          ✕
        </button>
      </header>
      <div className="aloud-stage">
        <div
          className="aloud-text"
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
          {a.script.map((s, i) => (
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
          {a.script.slice(1).map((s, i) => (
            <b key={s.lines[0]!.seq} className="aloud-rail-tick" style={{ top: `${(starts[sectionLine(lines, i + 1) ?? 0] ?? 0) * 100}%` }} />
          ))}
          <span className="aloud-rail-thumb" style={{ top: `${(starts[scrub ?? at] ?? 0) * 100}%` }} />
        </div>
        {preview !== undefined && (
          <div className="aloud-preview" style={{ top: `min(calc(100% - 132px), ${(starts[scrub!] ?? 0) * 100}%)` }}>
            <strong>{a.script[preview.section]?.title}</strong>
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
                place(backTo);
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
          <button type="button" aria-label="Previous section" disabled={section === 0} onClick={() => toSection(section - 1)}>
            ⏮
          </button>
          <button type="button" aria-label="Back a line" onClick={() => place(Math.max(0, at - 1))}>
            ↶
          </button>
          <button type="button" className="aloud-play" onClick={() => setPlaying((p) => !p)}>
            {playing ? "⏸ Pause" : "▶ Scroll"}
          </button>
          <button type="button" aria-label="Forward a line" onClick={() => place(Math.min(lines.length - 1, at + 1))}>
            ↷
          </button>
          <button type="button" aria-label="Next section" disabled={section >= a.script.length - 1} onClick={() => toSection(section + 1)}>
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
            {a.script.map((s, i) => {
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
