//! More: the rest of a host's night, one section each, shown only when the
//! event has it — Announce (+ 🔔), the alert-level dial (D2), wallet holds,
//! the King, terminals + the TV voice, codes + invitations (🔓 2 min),
//! performer parts (⏏ Release), and Trabolta: his worker, his queue, and
//! the guests waiting on him, answered as him in their own thread.

import { useEffect, useRef, useState } from "react";
import { queueBadge } from "../../../core/src/host-board.ts";
import type { AlertLevel } from "../../../core/src/delivery.ts";
import { ARM_LINE, useArmButtons } from "../arm.ts";
import { PassQr } from "../pass-qr.tsx";
import { Sheet } from "../ui/primitives.tsx";
import type { HostView } from "../types.ts";
import { joinLink, type HostCodes } from "./api.ts";
import { ALERT_LADDER, optimisticValue, tvVoiceLabel, type Optimistic, agentQueue, agentSection, agentThread, agoText, kingHpInput, levelLabel, moreSections, presenceText, releasable, showControl, stimulusInput, threadLine, waitingFor, type MoreFocus } from "./model.ts";
import { ActButton, ConfirmButton, HostEmpty, HostSection, failText, useHost, useRevealed } from "./kit.tsx";
import { clockText, setToFields, setToTime, showClockOf, useShowClock } from "../show-clock.ts";

export function MoreTab({ focus }: { focus: MoreFocus | null }) {
  const { view } = useHost();
  const sections = moreSections(view);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus === null) return;
    // Matched by attribute value, not a selector string: a character's name
    // never needs escaping.
    const hit = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-section]") ?? []).find((el) => el.dataset["section"] === focus);
    const first = focus.startsWith("agents") ? root.current?.querySelector<HTMLElement>('[data-section^="agents"]') : null;
    (hit ?? first)?.scrollIntoView({ block: "start" });
  }, [focus]);
  return (
    <div className="host-more" ref={root}>
      {sections.map((s) => {
        switch (s) {
          case "show":
            return <Show key={s} />;
          case "clock":
            return <ShowClockSection key={s} />;
          case "announce":
            return <Announce key={s} />;
          case "alerts":
            return <AlertDial key={s} />;
          case "wallet":
            return <Wallet key={s} wallet={view.wallet!} />;
          case "king":
            return <King key={s} king={view.king!} />;
          case "terminals":
            return <Terminals key={s} terminals={view.terminals!} />;
          case "codes":
            return <Codes key={s} />;
          case "parts":
            return <Parts key={s} />;
          case "agents":
            return <Agents key={s} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

/** The doors and a pause (C2): one control for where the night stands, tap
 *  to arm, tap again within 4 s to fire (core's arm model) — a pocket tap
 *  never pauses the show. */
function Show() {
  const { view, calls, run } = useHost();
  const c = showControl(view);
  const arm = useArmButtons();
  const [busy, setBusy] = useState(false);
  const armed = arm.armed === c.id;
  const call = () => (c.id === "pause" ? calls.pause() : c.id === "doors" ? calls.openDoors() : calls.resume());
  return (
    <HostSection id="show" title="⏯ The show" aside={c.state}>
      <button
        type="button"
        className={`w95-btn host-arm ${armed ? "armed" : ""}`}
        data-testid="host-show"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() =>
          arm.tap(c.id, true, () => {
            setBusy(true);
            void run(c.done, call).finally(() => setBusy(false));
          })
        }
      >
        <span className="host-arm-label">{busy ? "Sending…" : c.label}</span>
        {armed && !busy && <span className="host-arm-line">{ARM_LINE} — within 4 s</span>}
      </button>
      <p className="host-note">{c.note}</p>
    </HostSection>
  );
}

/** The nudges a host has (minutes). */
export const CLOCK_NUDGES = [-5, -1, 1, 5] as const;

/** 🕐 The show clock (wave 13 K5): the party's time large, −5 · −1 · +1 · +5
 *  at once, and Set to… armed then fired (a pocket tap never jumps the
 *  night's clock). Every phone follows on its next snapshot. */
function ShowClockSection() {
  const { view, calls, run } = useHost();
  const now = useShowClock(showClockOf(view));
  const arm = useArmButtons();
  const [hm, setHm] = useState("");
  const [half, setHalf] = useState<"AM" | "PM">("PM");
  const [err, setErr] = useState<string | null>(null);
  const time = setToTime(hm, half);
  const armed = arm.armed === "clock-set";
  const send = (done: string, call: () => Promise<unknown>) =>
    run(done, () =>
      call().then(
        (r) => {
          setErr(null);
          return r;
        },
        (e: unknown) => {
          setErr(failText(e));
          throw e;
        },
      ),
    );
  return (
    <HostSection id="clock" title="🕐 Show clock" aside={now === null ? "not set" : now.running ? "▶ running" : "⏸ paused"}>
      <div className={`host-clock-now${now === null ? " none" : !now.running ? " paused" : ""}`} data-testid="host-clock-now" aria-live="polite">
        {now === null ? "No clock yet — Set to… starts one." : `${now.running ? "" : "⏸ "}${clockText(now.minutes)}`}
      </div>
      <div className="host-clock-nudges" role="group" aria-label="Move the show clock">
        {CLOCK_NUDGES.map((n) => (
          <ActButton
            key={n}
            className="host-clock-nudge"
            label={`${n > 0 ? "+" : "−"}${Math.abs(n)}`}
            title={`${n > 0 ? "Forward" : "Back"} ${Math.abs(n)} min`}
            disabled={now === null}
            onClick={() => send(`🕐 Clock ${n > 0 ? "+" : "−"}${Math.abs(n)} min`, () => calls.clockNudge(n))}
          />
        ))}
      </div>
      <div className="host-row-actions host-clock-set">
        <label className="host-inline">
          <span>Set to</span>
          <input
            className="host-num host-clock-hm"
            inputMode="numeric"
            aria-label="Show time, hours and minutes"
            placeholder={now !== null ? setToFields(now.minutes).hm : "7:00"}
            value={hm}
            onChange={(e) => setHm(e.target.value)}
          />
        </label>
        <div className="host-clock-half" role="radiogroup" aria-label="AM or PM">
          {(["AM", "PM"] as const).map((h) => (
            <button key={h} type="button" role="radio" aria-checked={half === h} className="w95-btn host-toggle" aria-pressed={half === h} onClick={() => setHalf(h)}>
              {h}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`w95-btn host-arm host-clock-go ${armed ? "armed" : ""}`}
          data-testid="host-clock-set"
          disabled={time === null}
          onClick={() =>
            arm.tap("clock-set", true, () => {
              if (time === null) return;
              void send(`🕐 Clock set to ${time}`, () => calls.clockSet(time)).then((ok) => {
                if (ok) setHm("");
              });
            })
          }
        >
          <span className="host-arm-label">{time === null ? "Set" : `Set ${time}`}</span>
          {armed && <span className="host-arm-line">{ARM_LINE}</span>}
        </button>
      </div>
      {err !== null && (
        <p className="host-note alarm" role="alert">
          {err}
        </p>
      )}
      <p className="host-note">Every phone, booth and screen shows this time. It stops while the show is paused.</p>
    </HostSection>
  );
}

function Announce() {
  const { calls, run } = useHost();
  const [text, setText] = useState("");
  const [alert, setAlert] = useState(false);
  const t = text.trim();
  return (
    <HostSection id="announce" title="📣 Announce">
      <textarea className="host-text" rows={2} maxLength={300} aria-label="Announcement" placeholder="To every phone (the lobby)…" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="host-row-actions">
        <button type="button" className="w95-btn host-toggle" aria-pressed={alert} onClick={() => setAlert((a) => !a)}>
          🔔 Alert {alert ? "on" : "off"}
        </button>
        <ConfirmButton
          label="Send"
          ask={alert ? "Banner every phone?" : "Post to everyone?"}
          yes="Send"
          disabled={t === ""}
          testId="host-announce"
          onConfirm={async () => {
            if (await run(alert ? "🔔 Alert sent" : "📣 Announced", () => calls.announce(t, alert))) setText("");
          }}
        />
      </div>
      <p className="host-note">🔔 makes every phone chime, buzz and banner it.</p>
    </HostSection>
  );
}

function AlertDial() {
  const { view, calls, run } = useHost();
  const [want, setWant] = useState<AlertLevel | null>(null);
  const ask = useRef<HTMLDivElement>(null);
  useRevealed(ask, want !== null);
  const level = view.alerts.level;
  return (
    <HostSection id="alerts" title="🚨 Alert level" aside={levelLabel(level)}>
      <div className="host-dial" role="radiogroup" aria-label="Alert level for every phone">
        {ALERT_LADDER.map((l) => (
          <button
            key={l.level}
            type="button"
            role="radio"
            aria-checked={l.level === level}
            className={`w95-btn host-dial-step ${l.level === level ? "current" : ""} ${l.level === want ? "want" : ""}`}
            onClick={() => setWant(l.level === level ? null : l.level)}
          >
            <span className="host-radio" aria-hidden="true" />
            <span className="host-dial-words">
              <span className="host-dial-label">{l.label}</span>
              <span className="host-dial-hint">{l.hint}</span>
            </span>
          </button>
        ))}
      </div>
      {want !== null && (
        <div className="host-confirm" role="group" ref={ask}>
          <span className="host-confirm-ask">Switch every phone to {levelLabel(want)}? Every screen glitches once.</span>
          <ActButton
            className="host-confirm-yes"
            label="Switch"
            onClick={async () => {
              await run(`🚨 Alert level: ${levelLabel(want)}`, () => calls.setAlertLevel(want));
              setWant(null);
            }}
          />
          <button type="button" className="w95-btn" onClick={() => setWant(null)}>
            No
          </button>
        </div>
      )}
    </HostSection>
  );
}

function Wallet({ wallet }: { wallet: NonNullable<HostView["wallet"]> }) {
  const { calls, run } = useHost();
  const [amount, setAmount] = useState("");
  const n = stimulusInput(amount);
  const left = Math.max(0, wallet.stimulus.limit - wallet.stimulus.uses);
  return (
    <HostSection id="wallet" title={`💰 ${wallet.name}`} aside={`${wallet.held.length} held`}>
      {wallet.held.length === 0 ? (
        <HostEmpty>No transfer is held.</HostEmpty>
      ) : (
        <ul className="host-rows">
          {wallet.held.map((t) => (
            <li key={t.id} className="host-subrow">
              <span className="host-subrow-name">
                {t.fromName} → {t.toName} · {t.amount}
              </span>
              <ActButton label="✓ Approve" onClick={() => run(`✓ ${t.fromName} → ${t.toName} approved`, () => calls.walletApprove(t.id))} />
              <ConfirmButton label="✕ Deny" ask="Deny it?" danger onConfirm={() => run(`✕ ${t.fromName} → ${t.toName} denied`, () => calls.walletDeny(t.id))} />
            </li>
          ))}
        </ul>
      )}
      {wallet.held.length > 1 && <ConfirmButton label={`✓ Approve all held (${wallet.held.length})`} ask={`Approve all ${wallet.held.length}?`} onConfirm={() => run("✓ All held approved", () => calls.walletApproveHeld())} />}
      {wallet.frozen.length > 0 && (
        <ul className="host-rows">
          {wallet.frozen.map((f) => (
            <li key={f.who} className="host-subrow">
              <span className="host-subrow-name">🧊 {f.name}</span>
              <ActButton label="☀ Lift" onClick={() => run(`☀ ${f.name} thawed`, () => calls.walletUnfreeze(f.who))} />
            </li>
          ))}
        </ul>
      )}
      <div className="host-row-actions">
        <label className="host-inline">
          <span>Stimulus {wallet.stimulus.uses}/{wallet.stimulus.limit}</span>
          <input className="host-num" inputMode="numeric" aria-label="Stimulus amount" placeholder="amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <ConfirmButton label="💰 Pay" ask={n !== null ? `Pay every program ${n}?` : "Pay?"} disabled={n === null || left === 0} onConfirm={() => run(`💰 Stimulus of ${n} paid`, () => calls.walletStimulus(n!))} />
      </div>
    </HostSection>
  );
}

function King({ king }: { king: NonNullable<HostView["king"]> }) {
  const { calls, run } = useHost();
  const [hp, setHp] = useState("");
  const n = kingHpInput(hp, king.max);
  const pct = king.max > 0 ? Math.round((king.hp / king.max) * 100) : 0;
  return (
    <HostSection id="king" title="♚ The King" aside={king.fallen ? "kneels" : `${king.hp} / ${king.max}`}>
      <div className="host-meter" role="meter" aria-valuemin={0} aria-valuemax={king.max} aria-valuenow={king.hp} aria-label="The King's health">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="host-row-actions">
        <label className="host-inline">
          <span>Set</span>
          <input className="host-num" inputMode="numeric" aria-label={`King hp, 0 to ${king.max}`} placeholder={`0–${king.max}`} value={hp} onChange={(e) => setHp(e.target.value)} />
        </label>
        <ConfirmButton label="Set" ask={n !== null ? `Set the King to ${n}?` : "Set?"} disabled={n === null} onConfirm={async () => {
          if (await run(`♚ The King is at ${n}`, () => calls.kingHp(n!))) setHp("");
        }} />
        {king.hp < king.max && <ConfirmButton label="👑 Restore" ask={`Back to ${king.max}?`} onConfirm={() => run("👑 The King is restored", () => calls.kingHp(king.max))} />}
      </div>
    </HostSection>
  );
}

function Terminals({ terminals }: { terminals: NonNullable<HostView["terminals"]> }) {
  const { calls, run, now } = useHost();
  const silent = terminals.rows.filter((r) => r.agoMs > terminals.silentMs).length;
  // The TV voice turns with the toast: the flip stands until a poll agrees.
  const [flipped, setFlipped] = useState<Optimistic<boolean> | null>(null);
  useEffect(() => {
    if (flipped !== null && terminals.voiceMuted === flipped.value) setFlipped(null);
  }, [terminals.voiceMuted, flipped]);
  const muted = optimisticValue(terminals.voiceMuted, flipped, Math.max(now, Date.now()));
  return (
    <HostSection id="terminals" title="📟 Terminals" aside={`${terminals.rows.length - silent}/${terminals.rows.length} live`}>
      {terminals.rows.length === 0 ? (
        <HostEmpty>No terminal has polled yet.</HostEmpty>
      ) : (
        <ul className="host-rows">
          {terminals.rows.map((r) => {
            const quiet = r.agoMs > terminals.silentMs;
            return (
              <li key={r.name} className={`host-subrow ${quiet ? "alarm" : ""}`}>
                <span className="host-subrow-name">
                  {quiet ? "🔴" : "🟢"} {r.name}
                  <span className="host-subrow-sub">
                    {r.view}
                    {r.room !== undefined ? ` · ${r.room}` : ""} · {agoText(r.agoMs)}
                  </span>
                </span>
                <ActButton label="Identify" onClick={() => run(`📟 ${r.name} shows its name`, () => calls.identify(r.name))} />
              </li>
            );
          })}
        </ul>
      )}
      <ActButton
        className="host-toggle"
        pressed={muted}
        label={tvVoiceLabel(muted)}
        onClick={async () => {
          const want = !muted;
          if (await run(want ? "🔇 TV voice muted" : "🔊 TV voice on", () => calls.tvMute(want))) setFlipped({ value: want, at: Date.now() });
        }}
      />
    </HostSection>
  );
}

function Codes() {
  const { calls, run } = useHost();
  const [codes, setCodes] = useState<HostCodes | null>(null);
  const [qr, setQr] = useState<{ title: string; url: string; alt: string; note: string } | null>(null);
  return (
    <HostSection id="codes" title="🎟 Codes and invitations">
      {codes === null ? (
        <ActButton
          label="Show the codes"
          onClick={async () => {
            await run("", async () => setCodes(await calls.codes()));
          }}
        />
      ) : (
        <>
          <dl className="host-codes">
            <dt>Guests</dt>
            <dd>{codes.eventPass}</dd>
            <dt>Performers</dt>
            <dd>{codes.primePass}</dd>
          </dl>
          <div className="host-row-actions">
            <button type="button" className="w95-btn host-primary" data-testid="host-join-qr" onClick={() => setQr({ title: "🎟 Join the party", url: joinLink(codes), alt: "Join QR for guests", note: `Guests scan this to join, or type ${codes.eventPass}.` })}>
              ▦ Show the join QR
            </button>
          </div>
          {codes.claims.length > 0 && (
            <ul className="host-rows">
              {codes.claims.map((c) => (
                <li key={c.character} className="host-subrow">
                  <span className="host-subrow-name">🔒 {c.character}</span>
                  {c.url !== "" && (
                    <button type="button" className="w95-btn" aria-label={`Show ${c.character}'s invitation QR`} onClick={() => setQr({ title: `🔒 ${c.character}'s invitation`, url: c.url, alt: `Invitation QR for ${c.character}`, note: `The invited guest scans this to join as ${c.character}. It works all night.` })}>
                      ▦ QR
                    </button>
                  )}
                  <ConfirmButton label="🔓 Open 2 min" ask={`Let anyone take ${c.character} for 2 min?`} onConfirm={() => run(`🔓 ${c.character} open for 2 min`, () => calls.unlockClaim(c.character, 2))} />
                </li>
              ))}
            </ul>
          )}
          {qr !== null && <QrSheet {...qr} onClose={() => setQr(null)} />}
          <button type="button" className="w95-btn" onClick={() => setCodes(null)}>
            Hide the codes
          </button>
        </>
      )}
    </HostSection>
  );
}

/** A QR shown big, drawn in the browser (no server QR call), to be scanned
 *  off this phone: the guest join link, or one invitation's claim link. */
function QrSheet({ title, url, alt, note, onClose }: { title: string; url: string; alt: string; note: string; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="host-pair host-qr">
        <PassQr text={url} alt={alt} />
        <p>{note}</p>
      </div>
    </Sheet>
  );
}

function Parts() {
  const { view, calls, run, session } = useHost();
  const held = view.parts.filter((p) => releasable(p.presence));
  const free = view.parts.filter((p) => !releasable(p.presence));
  return (
    <HostSection id="parts" title="🎭 Performer parts" aside={`${held.length}/${view.parts.length} signed in`}>
      {held.length > 0 && (
        <ul className="host-rows">
          {held.map((p) => (
            <li key={p.id} className="host-subrow">
              <span className="host-subrow-name">
                {p.id}
                {p.id === session.auth?.character ? " (you)" : ""}
                <span className="host-subrow-sub">{presenceText(p.presence)}</span>
              </span>
              {p.id !== session.auth?.character && <ConfirmButton label="⏏ Release" ask={`Sign ${p.id}'s phone out?`} danger onConfirm={() => run(`⏏ ${p.id} released`, () => calls.release(p.id))} />}
            </li>
          ))}
        </ul>
      )}
      {free.length > 0 && <p className="host-note">{presenceText(free[0]!.presence)}: {free.map((p) => p.id).join(", ")}</p>}
    </HostSection>
  );
}

function Agents() {
  const { view, now } = useHost();
  const [answering, setAnswering] = useState<{ agent: string; guest: string; name: string } | null>(null);
  return (
    <>
      {view.agents.map((a) => (
        <HostSection key={a.id} id={agentSection(a.id)} title={`🤖 ${a.id}`} aside={a.online ? "● worker on" : "○ no worker"}>
          {(() => {
            const q = agentQueue(a, now);
            return q !== null && <p className={`host-note ${q.stalled ? "alarm" : ""}`}>{queueBadge(q).text}</p>;
          })()}
          {a.waiting.length === 0 ? (
            <HostEmpty>Nobody is waiting on {a.id}.</HostEmpty>
          ) : (
            <ul className="host-rows">
              {a.waiting.map((w) => (
                <li key={w.guest}>
                  <button type="button" className="host-row-btn" onClick={() => setAnswering({ agent: a.id, guest: w.guest, name: w.name })}>
                    <span className="host-person-body">
                      <span className="host-person-name">
                        {w.name} <span className="host-subrow-sub">{waitingFor(w.since, now)}</span>
                      </span>
                      <span className="host-person-line">“{w.text}”</span>
                    </span>
                    <span className="host-need-go">Answer ›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </HostSection>
      ))}
      {answering !== null && <AnswerSheet {...answering} onClose={() => setAnswering(null)} />}
    </>
  );
}

/** Answer one guest as the agent: their thread (from the host stream) and a
 *  reply box that posts into it as him. */
function AnswerSheet({ agent, guest, name, onClose }: { agent: string; guest: string; name: string; onClose: () => void }) {
  const { session, calls, run } = useHost();
  const [text, setText] = useState("");
  const thread = agentThread(session.messages, agent, guest).slice(-12);
  const t = text.trim();
  return (
    <Sheet title={`🤖 ${name} ↔ ${agent}`} onClose={onClose} tall>
      <ol className="host-thread" aria-label={`${name}'s conversation with ${agent}`}>
        {thread.length === 0 && <li className="host-empty">The thread hasn't reached this booth yet.</li>}
        {thread.map((m) => {
          const l = threadLine(m, agent, name);
          return (
            <li key={m.seq} className={`host-thread-line ${l.tone}`}>
              <strong>{l.who}</strong> {l.text}
            </li>
          );
        })}
      </ol>
      <textarea className="host-text in-sheet" rows={3} maxLength={2000} aria-label={`Reply as ${agent}`} placeholder={`Reply to ${name} as ${agent}…`} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="host-row-actions">
        <ActButton
          className="host-primary"
          label={`Send as ${agent}`}
          disabled={t === ""}
          onClick={async () => {
            if (await run(`🤖 Sent to ${name} as ${agent}`, () => calls.answerAs(agent, guest, t))) setText("");
          }}
        />
      </div>
      <p className="host-note">{name} sees it from {agent}, in their own thread. It closes their waiting request.</p>
    </Sheet>
  );
}
