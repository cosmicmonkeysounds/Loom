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
import { ALERT_LADDER, agentQueue, agentSection, agentThread, agoText, kingHpInput, levelLabel, moreSections, presenceText, releasable, showControl, stimulusInput, threadLine, waitingFor, type MoreFocus } from "./model.ts";
import { ActButton, ConfirmButton, HostEmpty, HostSection, useHost } from "./kit.tsx";

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
            <span className="host-dial-label">{l.label}</span>
            <span className="host-dial-hint">{l.hint}</span>
          </button>
        ))}
      </div>
      {want !== null && (
        <div className="host-confirm" role="group">
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
  const { calls, run } = useHost();
  const silent = terminals.rows.filter((r) => r.agoMs > terminals.silentMs).length;
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
      <ActButton className="host-toggle" pressed={terminals.voiceMuted} label={terminals.voiceMuted ? "🔇 TV voice muted: unmute" : "🔊 Mute the TV voice"} onClick={() => run(terminals.voiceMuted ? "🔊 TV voice on" : "🔇 TV voice muted", () => calls.tvMute(!terminals.voiceMuted))} />
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
