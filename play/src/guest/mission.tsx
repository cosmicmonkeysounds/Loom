//! The Mission window (wave 18, GUEST-SPEC §2): the guest's home. A quest
//! card for the NOW objective (where, how long, what's left, the big
//! buttons), Your move, the desktop's three tiles, and Also now. The model
//! is `mission-model.ts`'s; this file only draws it.

import { Fragment, useState, type ReactElement } from "react";
import { Icon } from "../chrome/icons.tsx";
import { countdownItems, useStoryNow } from "../countdown.tsx";
import { ObjectiveCard } from "../ui/objective.tsx";
import { BlockBar } from "../ui/progress.tsx";
import type { CountdownSummary } from "../types.ts";
import type { Nav } from "../moments/exits.ts";
import { countdownText, missionOf, type MissionInput, type MissionModel, type MissionTile, type WhereRow } from "./mission-model.ts";
import type { InviteView } from "./wire.ts";

/** A to-do short enough to sit three to a row. */
export const SHORT_TODO = 14;

function Countdown({ countdowns, clock, paused, stamp }: { countdowns: readonly CountdownSummary[]; clock?: number; paused: boolean; stamp?: unknown }) {
  const now = useStoryNow(clock, paused, true, stamp);
  const first = countdownItems(countdowns, now)[0];
  if (first === undefined) return null;
  return <div className={`mission-countdown${!paused && first.left < 60 ? " urgent" : ""}`}>{countdownText(first.left, paused)}</div>;
}

function Where({ where, onGo }: { where: WhereRow; onGo: (n: Nav) => void }) {
  if (where.kind === "here") {
    return (
      <div className="mission-where here">
        <span className="mission-where-name">📍 {where.name}</span>
        <span className="mission-here">✓ YOU'RE HERE</span>
      </div>
    );
  }
  const label = where.kind === "go" ? `📍 Go to ${where.name}` : where.label;
  return (
    <button type="button" className="mission-where go" onClick={() => onGo(where.nav)}>
      <span className="mission-where-name">{label}</span>
      <span aria-hidden>›</span>
    </button>
  );
}

const TILE_ICON: Record<MissionTile["id"], "coin" | "quest" | "codex"> = { wallet: "coin", quests: "quest", codex: "codex" };

function Tiles({ tiles, onGo }: { tiles: readonly MissionTile[]; onGo: (n: Nav) => void }) {
  if (tiles.length === 0) return null;
  return (
    <div className="desk-tiles">
      {tiles.map((t) => (
        <button key={t.id} type="button" className="desk-tile" data-tour={t.id} onClick={() => onGo(t.nav)} aria-label={`${t.label}: ${t.status}${t.dot ? ", something new" : ""}`}>
          <span className="desk-tile-icon">
            <Icon name={t.frozen === true ? "frozen" : TILE_ICON[t.id]} size={32} />
            {t.dot && <span className="guest-dot" aria-hidden />}
          </span>
          <span className="desk-tile-label">{t.label}</span>
          <span className="desk-tile-status">{t.status}</span>
        </button>
      ))}
    </div>
  );
}

export function MissionWindow({
  model,
  countdowns,
  clock,
  stamp,
  captured,
  onGo,
  renderButton,
  onInvite,
  peopleHere,
  onPeople,
}: {
  model: MissionModel;
  countdowns?: readonly CountdownSummary[];
  clock?: number;
  stamp?: unknown;
  captured: boolean;
  onGo: (nav: Nav) => void;
  /** One of the objective's `buttons:` ids as a big button (`frame.tsx` objectiveButton). */
  renderButton: (id: string) => ReactElement | null;
  onInvite: (inv: InviteView) => void;
  /** Other people where you stand (free roam's WHO'S HERE). */
  peopleHere: number;
  onPeople: () => void;
}) {
  const [more, setMore] = useState(false);
  const [alsoOpen, setAlsoOpen] = useState(false);
  const o = model.objective;
  const todos = o?.checklist ?? [];
  const done = todos.filter((c) => c.done === true).length;
  const short = todos.length > 0 && todos.every((c) => c.label.length <= SHORT_TODO);
  const buttons = model.buttons.map((id) => ({ id, el: renderButton(id) })).filter((b) => b.el !== null);
  return (
    <div className={`screen mission${captured ? " captured" : ""}`} data-tour="mission">
      <div className="mission-scroll">
        <section className={`w95-window mission-card${model.paused ? " paused" : ""}`} aria-label="Mission">
          <div className="w95-titlebar mission-caption">
            <span className="w95-title ico-title">
              <Icon name="mission" />
              <span>Mission{model.paused ? " (Paused)" : ""}</span>
            </span>
          </div>
          <div className="mission-body">
            {o === null ? (
              <p className="mission-none">Nothing to do just yet. The house will call you.</p>
            ) : (
              <>
                <h2 className="mission-title">
                  <span className="mission-glyph" aria-hidden>
                    {model.glyph}
                  </span>
                  <span className="mission-words">{model.title}</span>
                </h2>
                {model.freeRoam && <div className="mission-kicker">FREE ROAM · The house will call you.</div>}
                {model.where !== null && <Where where={model.where} onGo={onGo} />}
                {countdowns !== undefined && countdowns.length > 0 && <Countdown countdowns={countdowns} clock={clock} paused={model.paused} stamp={stamp} />}
                {o.brief.trim() !== "" && (
                  <div className="mission-brief-wrap">
                    <p className={`mission-brief${more ? " open" : ""}`}>{o.brief}</p>
                    {o.brief.length > 160 && (
                      <button type="button" className="link mission-more" onClick={() => setMore((v) => !v)}>
                        {more ? "less ▴" : "more ▾"}
                      </button>
                    )}
                  </div>
                )}
                {todos.length > 0 && (
                  <ul className={`mission-todos${short ? " short" : ""}`}>
                    {todos.map((c, i) => (
                      <li key={i} className={c.done === true ? "done" : ""}>
                        <span className="w95-check" aria-hidden>
                          {c.done === true ? "☑" : "☐"}
                        </span>{" "}
                        {c.label}
                      </li>
                    ))}
                  </ul>
                )}
                {todos.length >= 2 && <BlockBar done={done} total={todos.length} label={`${done} / ${todos.length}`} />}
                {model.freeRoam ? (
                  <div className="mission-pair">
                    {buttons.slice(0, 1).map((b) => (
                      <Fragment key={b.id}>{b.el}</Fragment>
                    ))}
                    <button type="button" className="choice objective-go mission-big" onClick={onPeople}>
                      <Icon name="people" size={20} /> WHO'S HERE ({peopleHere})
                    </button>
                  </div>
                ) : (
                  <div className="mission-buttons">
                    {model.cardButton !== null && (
                      <button type="button" className="choice primary mission-big" onClick={() => onGo(model.cardButton!.nav)}>
                        {model.cardButton.label}
                        <span aria-hidden> ›</span>
                      </button>
                    )}
                    {buttons.map((b) => (
                      <Fragment key={b.id}>{b.el}</Fragment>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {(model.moves.length > 0 || model.decision !== null) && (
          <section className="mission-moves" aria-label="Your move">
            <div className="mission-h">YOUR MOVE</div>
            {model.decision !== null && (
              <div className="mission-decision" role="group" aria-label={model.decision.title}>
                <div className="mission-decision-title">{model.decision.title}</div>
                {model.decision.options.map((opt, i) => (
                  <button key={i} type="button" className={`choice mission-option${opt.tone === "danger" ? " danger" : ""}`} onClick={opt.onClick} disabled={opt.disabled}>
                    {model.decision!.options.length > 1 && <span className="mission-option-n">▶ {i + 1}</span>} {opt.label}
                  </button>
                ))}
              </div>
            )}
            {model.moves.map((m) => (
              <button key={m.key} type="button" className="mission-move" onClick={() => (m.action.kind === "nav" ? onGo(m.action.nav) : onInvite(m.action.invite))}>
                <span className="mission-move-text">{m.text}</span>
                <span aria-hidden>›</span>
              </button>
            ))}
            {model.moreMoves > 0 && (
              <button type="button" className="link mission-more-moves" onClick={() => onGo({ to: "chats" })}>
                + {model.moreMoves} more in Chats ›
              </button>
            )}
          </section>
        )}

        <Tiles tiles={model.tiles} onGo={onGo} />

        {model.also.length > 0 && (
          <section className="mission-also">
            <button type="button" className="rooms-fold-btn" aria-expanded={alsoOpen} onClick={() => setAlsoOpen((v) => !v)}>
              <span aria-hidden>{alsoOpen ? "▾" : "▸"}</span> Also now ({model.also.length})
            </button>
            {alsoOpen && (
              <div className="objective-stack">
                {model.also.map((x) => (
                  <ObjectiveCard key={x.id} objective={x} compact renderButton={renderButton} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/** Mission from its inputs (the lazy part's one export: the model is built here, in the chunk). */
export function MissionHome({ input, ...rest }: { input: MissionInput } & Omit<Parameters<typeof MissionWindow>[0], "model">) {
  return <MissionWindow model={missionOf(input)} {...rest} />;
}

export default MissionHome;
