//! The **show clock** (wave 13, K1–K3): the party's wall time — "7:43 PM" —
//! that every phone, booth and host shows, set by the story and nudged by
//! the hosts in real time.
//!
//! Two world values, journaled like any story var (so replay and a restart
//! give the same clock): `Clock.set_to` (show-time minutes after midnight at
//! the moment of setting: 1140 = 7:00 PM, 1380 = 11:00 PM, past 1440 = after
//! midnight) and `Clock.set_at` (the story's `Time.elapsed` seconds at that
//! moment). Absent → no clock anywhere. The clock reads story time, so it
//! stops while the show is paused exactly as the story clock does:
//!
//!     minutes = set_to + (elapsed_s − set_at) / 60
//!
//! Pure (no I/O): the runtime decides `running` (doors open), this file does
//! the arithmetic and parses what a host types.

/** The world path of the show minutes at the moment of setting. */
export const CLOCK_SET_TO = "Clock.set_to";
/** The world path of the story's `Time.elapsed` (seconds) at that moment. */
export const CLOCK_SET_AT = "Clock.set_at";
/** The largest nudge a host may send, in minutes either way. */
export const MAX_NUDGE = 240;

/** What a view carries: the show minutes when the view was built (a float)
 *  and whether the clock runs (false while paused, before the doors, ended).
 *  A client re-bases on every snapshot and, while running, ticks on from its
 *  own receive time (`minutes + elapsedWallMs / 60000`). */
export interface ShowClock {
  minutes: number;
  running: boolean;
}

/** What the clock reads off a sim (structural, so a local sim works too). */
export interface ClockSource {
  world: { get(path: string): unknown };
  /** Story-clock elapsed, ms. */
  elapsed(): number;
}

/** A world value as a finite number, or null (a `Value` or a bare number). */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v !== null && typeof v === "object" && "value" in v) {
    const inner = (v as { value: unknown }).value;
    if (typeof inner === "number" && Number.isFinite(inner)) return inner;
    if (typeof inner === "string" && inner.trim() !== "" && Number.isFinite(Number(inner))) return Number(inner);
  }
  return null;
}

/** The current show minutes, or null when the story has set no clock. */
export function showMinutes(sim: ClockSource): number | null {
  const setTo = num(sim.world.get(CLOCK_SET_TO));
  if (setTo === null) return null;
  // A null `set_at` is 0: `Time.elapsed` is unset until the first tick, and
  // only a tick moves the story clock, so a beat that plays before it (the
  // `start:` beat at the doors) writes `Clock.set_at = Time.elapsed` as null
  // at exactly elapsed 0.
  const setAt = num(sim.world.get(CLOCK_SET_AT)) ?? 0;
  return setTo + (sim.elapsed() / 1000 - setAt) / 60;
}

/** A view's `showClock`, or undefined when there is no clock. */
export function showClock(sim: ClockSource | null, running: boolean): ShowClock | undefined {
  if (sim === null) return undefined;
  const minutes = showMinutes(sim);
  if (minutes === null) return undefined;
  return { minutes: Math.round(minutes * 1000) / 1000, running };
}

/** Before this hour a typed time is read as after midnight (the party runs
 *  from the evening into the small hours): "12:05 AM" → 1445, not 5. */
const AFTER_MIDNIGHT_BEFORE = 6 * 60;

/**
 * Parse a typed show time — `"7:00 PM"`, `"11:55pm"`, `"7 pm"`, `"23:00"`,
 * `"0:05"` — into show minutes. A time before 6:00 AM is the night's small
 * hours (+ 1440), so the clock keeps counting up past midnight. Null when
 * it is not a time.
 */
export function parseShowTime(text: string): number | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?\s*$/iu.exec(text) ?? null;
  let minutes: number;
  if (m !== null) {
    const h = Number(m[1]);
    const min = m[2] !== undefined ? Number(m[2]) : 0;
    if (h < 1 || h > 12 || min > 59) return null;
    const pm = m[3]!.toLowerCase() === "p";
    minutes = ((h % 12) + (pm ? 12 : 0)) * 60 + min;
  } else {
    const t = /^\s*(\d{1,2}):(\d{2})\s*$/u.exec(text);
    if (t === null) return null;
    const h = Number(t[1]);
    const min = Number(t[2]);
    if (h > 23 || min > 59) return null;
    minutes = h * 60 + min;
  }
  return minutes < AFTER_MIDNIGHT_BEFORE ? minutes + 1440 : minutes;
}

/** "7:43 PM" for show minutes (past 1440 → "12:05 AM"); floors to the minute. */
export function formatShowTime(minutes: number): string {
  const total = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const min = total % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** The two writes a clock change journals. */
export interface ClockWrite {
  setTo: number;
  setAt: number;
}

/**
 * A host's `POST /api/mod/clock` body → the writes, or an error with its
 * status: `{time}` (a typed time) or `{nudge}` (± minutes, |n| ≤ 240),
 * exactly one; a nudge with no clock yet is 409.
 */
export function clockChange(sim: ClockSource, body: Readonly<Record<string, unknown>>): ClockWrite | { status: 400 | 409; error: string } {
  const hasTime = body["time"] !== undefined && body["time"] !== null && body["time"] !== "";
  const hasNudge = body["nudge"] !== undefined && body["nudge"] !== null && body["nudge"] !== "";
  if (hasTime === hasNudge) return { status: 400, error: "send a time or a nudge" };
  const setAt = Math.floor(sim.elapsed() / 1000);
  if (hasTime) {
    const raw = body["time"];
    const minutes = typeof raw === "string" ? parseShowTime(raw) : null;
    if (minutes === null) return { status: 400, error: "that is not a time (try 7:00 PM or 23:00)" };
    return { setTo: minutes, setAt };
  }
  const raw = body["nudge"];
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) > MAX_NUDGE) return { status: 400, error: `a nudge is a number of minutes, at most ${MAX_NUDGE} either way` };
  const now = showMinutes(sim);
  if (now === null) return { status: 409, error: "no clock yet" };
  // Re-based on the whole second the write is stamped with, so the nudge
  // moves the clock by exactly n minutes.
  const atStamp = now - (sim.elapsed() / 1000 - setAt) / 60;
  return { setTo: Math.round((atStamp + n) * 1000) / 1000, setAt };
}
