//! The Desk window (wave 25, docs/loom-house-desk.md §6.2): a host's face of
//! the house desk, a lazy chunk (`windows.tsx` loads it). It fires and
//! tests; it never edits a cue (that is the editor's Run → House).
//!
//! - The status chips (`deskStatus`) and ■ STOP ALL (every desk run and the
//!   house sounds).
//! - *How the Desk works* (wave 30), folded: five lines on what each part is for.
//! - Setup (wave 30, `deskSetup`): a card per system — the sound, the lights,
//!   each outside mind — tone-coloured, with what to do (open when it is
//!   down); one *All connected ✓* line when every one is fine.
//! - STANDBY: the cue GO fires, its steps and the story events it tells,
//!   and a big GO that sends the standby it showed (another console moved
//!   it: "Standby moved — press GO again").
//! - What is playing, with progress and ■ Stop each.
//! - The cue list by section: a tap stands a cue by.
//! - The checks, built for walking the house with a phone: one row at a
//!   time with a big Test (a colour per button for a bulb), ✓ Heard it /
//!   ✗ Nothing (a mark moves on to the next open row), *next*, and the
//!   whole list a tap away. Once the doors are open a test asks first.
//! - Try it (wave 30): tap a look or a story sound to play it, or say a line
//!   on the speakers. No marks; once the doors are open each one asks first.
//!
//! The view is a long poll (`GET /api/mod/desk?after=<rev>&wait=25`) with
//! the booth's token, parked while the page is hidden (`startPoll`).
//! Every write is on the host allowlist (`host/api.ts`).

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ApiError } from "../client.ts";
import { startPoll } from "../director.tsx";
import type { PrimeSession } from "../session/prime.ts";
import { hostCalls, type HostCalls } from "./api.ts";
import { browserPollDeps, eventBase, fetchHostPost, type HostAuth } from "./client.ts";
import { ActButton, ConfirmButton, HostEmpty, failText } from "./kit.tsx";
import {
  DESK_POLL_TIMEOUT_MS,
  DESK_REPOLL_MS,
  DESK_SAY_MAX,
  afterMark,
  chipClass,
  deskChecks,
  deskCueList,
  deskHow,
  deskPollOutcome,
  deskPollPath,
  deskStatus,
  eventsLine,
  goRefusal,
  liveAsk,
  markLine,
  markWords,
  progressLine,
  recentLines,
  runRows,
  sayCall,
  sayCount,
  serverNow,
  setupClass,
  setupMark,
  setupOpen,
  setupView,
  standbyCard,
  testNeedsConfirm,
  testWords,
  tryDone,
  tryGroups,
  walkAt,
  walkBack,
  walkNext,
  type DeskCheckRow,
  type DeskSetupRow,
  type DeskView,
  type TryRow,
} from "./desk-model.ts";

export interface DeskClient {
  view: DeskView | null;
  receivedAt: number;
  error: string | null;
  connected: boolean;
  refresh: () => void;
}

/** The desk's long poll: a plain read, then held reads past the `rev` it holds. */
export function useDeskView(auth: HostAuth | null): DeskClient {
  const [view, setView] = useState<DeskView | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const poll = useRef<{ stop(): void; now(): void } | null>(null);
  const token = auth?.token ?? null;
  const eventId = auth?.eventId ?? null;
  useEffect(() => {
    if (token === null || eventId === null) return;
    let stopped = false;
    let rev: number | null = null;
    const load = async () => {
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = setTimeout(() => ctl?.abort(), DESK_POLL_TIMEOUT_MS);
      try {
        let res: Response;
        try {
          res = await fetch(`${eventBase(eventId)}${deskPollPath(rev)}`, { headers: { "x-loom-token": token }, cache: "no-store", ...(ctl !== null ? { signal: ctl.signal } : {}) });
        } catch (e) {
          if (!stopped) {
            setConnected(false);
            setError("Can't reach the server");
          }
          throw e;
        }
        const out = deskPollOutcome(res.status, await res.json().catch(() => null));
        if (stopped) return;
        if (out.kind === "error") {
          setConnected(false);
          setError(out.message);
          throw new Error(out.message);
        }
        if (out.kind === "view") {
          rev = out.view.rev;
          setView(out.view);
        }
        setReceivedAt(Date.now());
        setConnected(true);
        setError(null);
      } finally {
        clearTimeout(timer);
      }
    };
    const p = startPoll(browserPollDeps(load), DESK_REPOLL_MS);
    poll.current = p;
    return () => {
      stopped = true;
      p.stop();
      poll.current = null;
    };
  }, [token, eventId]);
  const refresh = useCallback(() => poll.current?.now(), []);
  return { view, receivedAt, error, connected, refresh };
}

export interface DeskWindowProps {
  session: PrimeSession;
}

export function DeskWindow({ session }: DeskWindowProps) {
  const auth = session.auth;
  const token = auth?.token ?? null;
  const eventId = auth?.eventId ?? null;
  const d = useDeskView(token !== null && eventId !== null ? { token, eventId } : null);
  const calls = useMemo(() => (token !== null && eventId !== null ? hostCalls(fetchHostPost({ token, eventId }), () => "") : null), [token, eventId]);
  if (d.view === null || calls === null) {
    return (
      <div className="screen side host-desk" data-testid="host-desk">
        <p className="host-empty">{d.error ?? "Loading the house desk…"}</p>
      </div>
    );
  }
  return <DeskBody view={d.view} calls={calls} client={d} me={auth?.character ?? "you"} />;
}

/** The window over one view (the tests render it with a fixture). */
export function DeskBody({ view, calls, client, me }: { view: DeskView; calls: HostCalls; client: Pick<DeskClient, "receivedAt" | "connected" | "error" | "refresh">; me: string }) {
  const [note, setNote] = useState<string | null>(null);
  const [wall, setWall] = useState(() => Date.now());
  const running = view.runs.some((r) => r.state === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setWall(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => {
    if (note === null) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);
  const now = serverNow(view, client.receivedAt, Math.max(wall, client.receivedAt));
  // One write: a line on success (or made from the answer) or the server's
  // refusal, then a fresh read.
  const act: Act = async (done, call, refusal) => {
    try {
      const answer = await call();
      const line = typeof done === "function" ? done(answer) : done;
      if (line !== "") setNote(line);
      return true;
    } catch (e) {
      setNote(e instanceof ApiError && refusal !== undefined ? refusal(e) : failText(e));
      return false;
    } finally {
      client.refresh();
    }
  };
  const card = standbyCard(view);
  const events = eventsLine(card.events);
  const runs = runRows(view, now);
  const list = deskCueList(view);
  const recent = recentLines(view.recent);
  return (
    <div className="screen side host-desk" data-testid="host-desk">
      <div className="host-desk-scroll">
        <div className="host-desk-status" role="group" aria-label="The house">
          {deskStatus(view).map((c, k) => (
            <span key={k} className={chipClass(c)}>
              {c.text}
            </span>
          ))}
          {!client.connected && <span className="host-desk-chip bad">⚠ {client.error ?? "Reconnecting…"}</span>}
        </div>
        <ActButton className="host-desk-stopall" label="■ STOP ALL" title="Stop every desk cue and the house sounds" onClick={() => act("■ Stopped every desk cue and the house sounds", () => calls.deskStopAll())} />
        <p className="host-desk-note" role="status" aria-live="polite" data-testid="host-desk-note">
          {note ?? ""}
        </p>
        <How view={view} />
        <Setup view={view} />

        <fieldset className={`host-box host-desk-standby${card.running ? " running" : ""}`} data-testid="host-desk-standby">
          <legend>STANDBY</legend>
          <div className="host-desk-standby-row">
            <span className="host-desk-standby-name">{card.label}</span>
            <ActButton
              className="host-desk-go"
              label="GO"
              disabled={card.cue === null}
              title={card.cue !== null ? `GO ${card.label}` : undefined}
              onClick={() => act(card.cue !== null ? `▶ GO ${card.label}` : "", () => calls.deskGo(view.standby), (e) => goRefusal(e.status, e.message))}
            />
          </div>
          {events !== null && <p className="host-desk-events">{events}</p>}
          {card.notes !== null && <p className="host-desk-notes">📝 {card.notes}</p>}
          {card.running && <p className="host-note">Still playing — GO starts it again from the top.</p>}
          {card.steps.length > 0 && (
            <ol className="host-desk-steps">
              {card.steps.map((t, k) => (
                <li key={k}>{t}</li>
              ))}
            </ol>
          )}
          {card.length !== null && <p className="host-note">About {card.length}.</p>}
        </fieldset>

        {runs.length > 0 && (
          <section className="host-desk-part" aria-label="Playing">
            <h3 className="host-section-head">Playing</h3>
            <ul className="host-desk-runs">
              {runs.map((r) => (
                <li key={r.run} className={`host-desk-run${r.running ? " running" : ""}`}>
                  <div className="host-desk-run-head">
                    <span className="host-desk-run-name">{r.name}</span>
                    <span className="host-desk-run-by">{r.by}</span>
                    {r.running && <ActButton className="host-desk-run-stop" label="■ Stop" onClick={() => act(`■ Stopped ${r.name}`, () => calls.deskStop(r.run))} />}
                  </div>
                  <div className="host-desk-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.progress * 100)} aria-label={`${r.name}: ${Math.round(r.progress * 100)}%`}>
                    <span className="host-desk-progress-fill" style={{ width: `${Math.round(r.progress * 100)}%` }} />
                  </div>
                  <p className="host-desk-run-line">{r.line}</p>
                  {r.trouble.map((t, k) => (
                    <p key={k} className="host-note alarm">
                      ⚠ {t}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="host-desk-part" aria-label="Cues">
          <h3 className="host-section-head">
            <span>Cues</span>
            <span className="host-section-aside">tap to stand by</span>
          </h3>
          {list.length === 0 ? (
            <HostEmpty>The desk has no cues yet. They are built in the editor's Run → House.</HostEmpty>
          ) : (
            list.map((sec, k) => (
              <div key={k} className="host-desk-cues">
                {sec.title !== null && <h4 className="host-desk-sec">{sec.title}</h4>}
                <ul className="host-desk-list">
                  {sec.rows.map((r) => (
                    <li key={r.id}>
                      <button type="button" className={`host-desk-row${r.standby ? " standby" : ""}${r.running ? " running" : ""}`} aria-pressed={r.standby} onClick={() => (r.standby ? undefined : void act(`Standing by: ${r.label}`, () => calls.deskStandby(r.id)))}>
                        <span className="host-desk-row-mark" aria-hidden="true">
                          {r.standby ? "▶" : r.running ? "♪" : ""}
                        </span>
                        <span className="host-desk-row-body">
                          <span className="host-desk-row-name">{r.label}</span>
                          <span className="host-desk-row-sum">
                            {r.summary}
                            {r.length !== null ? ` · ${r.length}` : ""}
                          </span>
                          {r.events.length > 0 && <span className="host-desk-row-ev">⚡ {r.events.join(", ")}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>

        <TryIt view={view} calls={calls} act={act} note={note} />

        <Checks view={view} calls={calls} act={act} me={me} now={now} />

        {recent.length > 0 && (
          <section className="host-desk-part" aria-label="Lately">
            <h3 className="host-section-head">Lately</h3>
            <ul className="host-desk-recent">
              {recent.map((t, k) => (
                <li key={k}>{t}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

/** One write (`DeskBody`'s `act`): `done` is the line on success, or makes it from the answer. */
type Act = (done: string | ((answer: unknown) => string), call: () => Promise<unknown>, refusal?: (e: ApiError) => string) => Promise<boolean>;

/** *How the Desk works*, folded under one button. */
function How({ view }: { view: DeskView }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="host-desk-how">
      <button type="button" className="w95-btn host-desk-fold" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} How the Desk works
      </button>
      {open && (
        <ul className="host-desk-how-list">
          {deskHow(view).map((t, k) => (
            <li key={k}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Setup: a card per system with what to do, or one line when all is well. */
function Setup({ view }: { view: DeskView }) {
  const s = setupView(view);
  const [shown, setShown] = useState(false);
  if (s.rows.length === 0) return null;
  return (
    <section className="host-desk-part host-desk-setup" aria-label="Setup" data-testid="host-desk-setup">
      {s.allOk ? (
        <button type="button" className="w95-btn host-desk-fold host-desk-setup-ok" aria-expanded={shown} onClick={() => setShown((o) => !o)}>
          {shown ? "▾" : "▸"} {s.line}
        </button>
      ) : (
        <h3 className="host-section-head">
          <span>Setup</span>
          <span className="host-section-aside">{s.line}</span>
        </h3>
      )}
      {(!s.allOk || shown) &&
        s.rows.map((r) => (
          // Keyed by tone too: a system that goes down opens its steps again.
          <SetupCard key={`${r.id}:${r.tone}`} row={r} />
        ))}
    </section>
  );
}

function SetupCard({ row }: { row: DeskSetupRow }) {
  const [open, setOpen] = useState(() => setupOpen(row));
  return (
    <div className={setupClass(row)} data-testid={`host-desk-setup-${row.id}`}>
      <p className="host-desk-setup-head">
        <span className="host-desk-setup-title">{row.title}</span>
        <span className="host-desk-setup-mark" aria-hidden="true">
          {setupMark(row.tone)}
        </span>
      </p>
      <p className="host-desk-setup-status">{row.status}</p>
      {row.fix.length > 0 && (
        <>
          <button type="button" className="w95-btn host-desk-fold" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "▾" : "▸"} What to do ({row.fix.length})
          </button>
          {open && (
            <ol className="host-desk-setup-fix">
              {row.fix.map((t, k) => (
                <li key={k}>{t}</li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

/** Try it: a look, a story sound or a line on the speakers, now. No marks. */
function TryIt({ view, calls, act, note }: { view: DeskView; calls: HostCalls; act: Act; note: string | null }) {
  const groups = tryGroups(view);
  const live = testNeedsConfirm(view);
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({});
  const [say, setSay] = useState("");
  const sayId = useId();
  const said = sayCall(say);
  const play = (r: TryRow) => act((a) => tryDone(r.kind, r.name, a), () => calls.deskTest(r.test));
  const button = (r: TryRow) => {
    const label = (
      <span className="host-desk-row-body">
        <span className="host-desk-row-name">{r.name}</span>
        <span className="host-desk-row-sum">{r.detail}</span>
        {r.hints.map((h, k) => (
          <span key={k} className="host-desk-try-hint">
            ⚠ {h}
          </span>
        ))}
      </span>
    );
    return live ? <ConfirmButton label={label} ask={liveAsk(r.kind)} yes="Play anyway" className="host-desk-try" onConfirm={() => play(r)} /> : <ActButton label={label} className="host-desk-try" onClick={() => play(r)} />;
  };
  const sayIt = async () => {
    if (said === null) return;
    if (await act(() => tryDone("say", "", null), () => calls.deskTest(said))) setSay("");
  };
  return (
    <section className="host-desk-part host-desk-tryit" aria-label="Try it" data-testid="host-desk-tryit">
      <h3 className="host-section-head">
        <span>Try it</span>
        <span className="host-section-aside">tap to play · no marks</span>
      </h3>
      <div className="host-desk-say">
        <label className="host-desk-say-label" htmlFor={sayId}>
          📢 Say on the speakers
        </label>
        <input id={sayId} className="host-desk-say-box" type="text" maxLength={DESK_SAY_MAX} enterKeyHint="send" placeholder="What the house says" value={say} onChange={(e) => setSay(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !live && void sayIt()} />
        <div className="host-desk-say-row">
          <span className="host-desk-say-count">{sayCount(say)}</span>
          {live ? <ConfirmButton label="📢 Say it" ask={liveAsk("sound")} yes="Say it anyway" disabled={said === null} className="host-desk-say-go" onConfirm={sayIt} /> : <ActButton label="📢 Say it" disabled={said === null} className="host-desk-say-go" onClick={sayIt} />}
        </div>
      </div>
      {note !== null && <p className="host-desk-try-note">{note}</p>}
      {groups.map((g) => {
        const open = unfolded[g.id] ?? g.open;
        return (
          <div key={g.id} className="host-desk-cues">
            <button type="button" className="w95-btn host-desk-fold" aria-expanded={open} onClick={() => setUnfolded((u) => ({ ...u, [g.id]: !open }))}>
              {open ? "▾" : "▸"} {g.title} ({g.rows.length})
            </button>
            {open && g.away !== null && <p className="host-note alarm">⚠ {g.away}</p>}
            {open && (
              <ul className="host-desk-list">
                {g.rows.map((r) => (
                  <li key={r.key}>{button(r)}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** The checks, walked one row at a time (and the whole list a tap away). */
function Checks({ view, calls, act, me, now }: { view: DeskView; calls: HostCalls; act: Act; me: string; now: number }) {
  const sections = deskChecks(view);
  const [key, setKey] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const walk = walkAt(sections, key);
  const row = walk.row;
  const live = testNeedsConfirm(view);
  const mark = async (r: DeskCheckRow, m: "ok" | "bad") => {
    const ok = await act(`${m === "ok" ? "✓" : "✗"} ${r.label}`, () => calls.deskMark(r.key, m));
    if (ok) setKey(afterMark(sections, r.key, m, me, Date.now()));
  };
  const test = (label: string, call: () => Promise<unknown>, r: DeskCheckRow) =>
    live ? (
      <ConfirmButton key={label} label={label} ask={liveAsk(r.kind)} yes="Test anyway" className="host-desk-test" onConfirm={() => act("", call)} />
    ) : (
      <ActButton key={label} label={label} className="host-desk-test" onClick={() => act("", call)} />
    );
  return (
    <section className="host-desk-part host-desk-checks" aria-label="Checks">
      <h3 className="host-section-head">
        <span>Checks</span>
        <span className="host-section-aside" data-testid="host-desk-progress">
          {progressLine(walk.progress)}
        </span>
      </h3>
      {row === null ? (
        <HostEmpty>Speakers, outputs, story sounds, lights and looks appear here once the house map and the router know them.</HostEmpty>
      ) : (
        <div className="host-desk-walk" data-testid="host-desk-walk">
          <p className="host-desk-walk-where">
            {walk.section} · {walk.at} of {walk.total}
            {walk.done ? " · all checked" : ""}
          </p>
          <p className="host-desk-walk-label">{row.label}</p>
          <p className="host-desk-walk-detail">{row.detail}</p>
          {row.hints.map((h, k) => (
            <p key={k} className="host-note alarm">
              ⚠ {h}
            </p>
          ))}
          {row.mark !== null && <p className={`host-desk-walk-mark ${row.mark.mark}`}>{markLine(row.mark, now)}</p>}
          <div className="host-desk-tests">
            {test(testWords(row.kind), () => calls.deskTest(row.test), row)}
            {row.extra.map((x) => test(x.label, () => calls.deskTest(x.test), row))}
          </div>
          <div className="host-desk-marks">
            <ActButton className="host-desk-ok" label={markWords(row.kind).ok} pressed={row.mark?.mark === "ok"} onClick={() => mark(row, "ok")} />
            <ActButton className="host-desk-bad" label={markWords(row.kind).bad} pressed={row.mark?.mark === "bad"} onClick={() => mark(row, "bad")} />
          </div>
          <div className="host-desk-steer">
            <button type="button" className="w95-btn host-desk-back" onClick={() => setKey(walkBack(sections, row.key))}>
              ‹ back
            </button>
            {row.mark !== null && <ActButton className="host-desk-clear" label="Clear mark" onClick={() => act(`Cleared ${row.label}`, () => calls.deskMark(row.key, null))} />}
            <button type="button" className="w95-btn host-desk-next" onClick={() => setKey(walkNext(sections, row.key))}>
              next ›
            </button>
          </div>
        </div>
      )}
      {sections.length > 0 && (
        <>
          <button type="button" className="w95-btn host-desk-all" aria-expanded={all} onClick={() => setAll((a) => !a)}>
            {all ? "▾" : "▸"} Every check ({walk.total})
          </button>
          {all &&
            sections.map((s) => (
              <div key={s.id} className="host-desk-cues">
                <h4 className="host-desk-sec">{s.title}</h4>
                <ul className="host-desk-list">
                  {s.rows.map((r) => (
                    <li key={r.key}>
                      <button
                        type="button"
                        className={`host-desk-row${r.key === row?.key ? " standby" : ""}`}
                        aria-current={r.key === row?.key || undefined}
                        onClick={() => {
                          setKey(r.key);
                          setAll(false);
                        }}
                      >
                        <span className={`host-desk-row-mark ${r.mark?.mark ?? "open"}`} aria-hidden="true">
                          {r.mark === null ? "○" : r.mark.mark === "ok" ? "✓" : "✗"}
                        </span>
                        <span className="host-desk-row-body">
                          <span className="host-desk-row-name">{r.label}</span>
                          <span className="host-desk-row-sum">{r.detail}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </>
      )}
    </section>
  );
}
