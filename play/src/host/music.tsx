//! The Desk window's 🎵 Music (wave 58, docs/loom-w58-music-contract.md): the night's
//! music in one place, for a phone. Part of the Desk's lazy chunk, so a guest
//! never downloads it.
//!
//! - The Desk's 🎵 Music tab (wave 59), Task Manager's first. On screen it polls the
//!   mixer's GET every second while the page is visible; on any other tab, nothing.
//! - Where the music comes from, and the scene (picking one holds it by hand).
//! - ⏮ ⏸ ⏭ while a bed is on the TIDAL app, each bed with its own ⏭, Skip all,
//!   Stop music (asks once).
//! - The show's playlists, every playlist in the app's sidebar (folded), and a
//!   pasted link. A pick plays where the scene's music plays, by hand.
//! - The music's level, the 🎚 Mixer's own `src:music`.
//! - 🤖 Trabolta: who he'd do it for, what he did last, and the lock (the
//!   story's cues, so the director phone has them too).

import { useState } from "react";
import { DJ_LOCK_CUE, DJ_UNLOCK_CUE, djLines, handPlaylists, musicSceneName, musicSource, scopeStrips, tidalPlaylistId, type MixChange, type MixLevel, type MixerView, type MusicCommand, type MusicDj } from "../../../core/src/house-mixer.ts";
import type { HostCalls } from "./api.ts";
import type { HostAuth } from "./client.ts";
import { ActButton, ConfirmButton, HostEmpty, failText } from "./kit.tsx";
import { StripLine, useMixPosts, useMixerView } from "./mixer.tsx";
import { BAD_LINK, HAND_NOTE, LOAN_NOTE, NO_SOUNDTRACK, musicCalls, nowPlaying, routerBanner, stripRow } from "./mixer-model.ts";

/** The section in the Desk window. */
export function MusicSection({ auth, calls }: { auth: HostAuth; calls: HostCalls }) {
  return (
    <section className="host-mix" aria-label="Music" data-testid="host-music">
      <MusicPanel auth={auth} calls={calls} />
    </section>
  );
}

function MusicPanel({ auth, calls }: { auth: HostAuth; calls: HostCalls }) {
  const client = useMixerView(auth);
  const posts = useMixPosts(client, calls);
  const view = client.view;
  if (view === null) return <p className="host-empty">{client.error ?? "Loading the music…"}</p>;
  const lock = async (locked: boolean) => {
    try {
      await calls.cue(locked ? DJ_LOCK_CUE : DJ_UNLOCK_CUE, null, null);
      posts.setNote(locked ? "🔒 Trabolta is off the music" : "🔓 Trabolta can reach the music");
    } catch (e) {
      posts.setNote(failText(e));
    } finally {
      client.refresh();
    }
  };
  return <MusicBody view={view} levels={posts.levels} onChange={posts.change} onMusic={posts.music} onLock={lock} onNote={posts.setNote} note={posts.note} error={client.connected ? null : client.error} />;
}

export interface MusicBodyProps {
  view: MixerView;
  levels: Readonly<Record<string, MixLevel>>;
  onChange: (c: MixChange) => void;
  onMusic: (cmd: MusicCommand) => Promise<void> | void;
  onLock: (locked: boolean) => Promise<void> | void;
  onNote: (note: string) => void;
  note: string | null;
  error: string | null;
}

/** The panel over one view (the tests render it with a fixture). */
export function MusicBody({ view, levels, onChange, onMusic, onLock, onNote, note, error }: MusicBodyProps) {
  const banner = routerBanner(view);
  const source = musicSource(view.music);
  const level = scopeStrips(view, { kind: "all" }, levels).find((s) => s.source === "music");
  return (
    <div className="host-mix-body" data-testid="host-music-body">
      {error !== null && <p className="host-note alarm">⚠ {error}</p>}
      {banner !== null && (
        <p className="host-mix-banner" role="status">
          ⚠ {banner}
        </p>
      )}
      <p className="host-desk-note" role="status" aria-live="polite">
        {note ?? ""}
      </p>
      <p className={`host-music-source ${source.tone}`} data-testid="host-music-source">
        {source.text}
      </p>
      <NowPlayingBox view={view} onMusic={onMusic} />
      <Playlists view={view} onMusic={onMusic} onNote={onNote} />
      {level !== undefined && (
        <ul className="host-mix-strips" data-testid="host-music-level">
          <StripLine row={stripRow(level)} onChange={onChange} />
        </ul>
      )}
      {view.dj !== undefined && view.dj !== null && <TraboltaBox dj={view.dj} onLock={onLock} />}
    </div>
  );
}

/** Now playing: the scene, the beds and the transport. */
function NowPlayingBox({ view, onMusic }: { view: MixerView; onMusic: (cmd: MusicCommand) => Promise<void> | void }) {
  const np = nowPlaying(view.music);
  return (
    <fieldset className="host-box host-mix-now" data-testid="host-mix-now">
      <legend>NOW PLAYING</legend>
      {np === null ? (
        <HostEmpty>{NO_SOUNDTRACK}</HostEmpty>
      ) : (
        <>
          <label className="host-mix-scene">
            <span className="host-mix-scene-label">Scene</span>
            {np.scenes.length > 0 ? (
              <select className="host-mix-scene-pick" value={np.scene ?? ""} onChange={(e) => e.target.value !== "" && void onMusic(musicCalls.scene(e.target.value))}>
                {np.scene === null && <option value="">—</option>}
                {np.scenes.map((s) => (
                  <option key={s} value={s}>
                    {musicSceneName(s)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="host-mix-scene-name">{np.scene !== null ? musicSceneName(np.scene) : "—"}</span>
            )}
          </label>
          {np.hand && (
            <div className="host-mix-hand" data-testid="host-mix-hand">
              <p className="host-mix-hand-note">{np.loan ? `🤖 ${LOAN_NOTE}` : `✋ ${HAND_NOTE}`}</p>
              <ActButton className="host-mix-story" label={np.loan ? "↺ Take it back" : "↺ Follow the story"} onClick={() => onMusic(musicCalls.story())} />
            </div>
          )}
          {np.onApp && (
            <div className="host-music-deck" role="group" aria-label="TIDAL">
              <ActButton className="host-music-key" label="⏮" title="Back a track" onClick={() => onMusic(musicCalls.previous())} />
              <ActButton className="host-music-key" label={np.paused ? "▶" : "⏸"} title={np.paused ? "Play" : "Pause"} onClick={() => onMusic(np.paused ? musicCalls.resume() : musicCalls.pause())} />
              <ActButton className="host-music-key" label="⏭" title="Next track" onClick={() => onMusic(musicCalls.next())} />
            </div>
          )}
          {np.beds.length > 0 && (
            <ul className="host-mix-beds">
              {np.beds.map((b) => (
                <li key={b.playlist} className="host-mix-bed">
                  <div className="host-mix-bed-head">
                    <span className="host-mix-bed-name">
                      <span className="host-mix-bed-list">{b.name}</span>
                      <span className="host-mix-bed-track">{b.track}</span>
                    </span>
                    <ActButton className="host-mix-skip" label="⏭" title={`Skip ${b.name}`} onClick={() => onMusic(musicCalls.next(b.playlist))} />
                  </div>
                  <div className="host-mix-progress" aria-hidden="true">
                    <span className="host-mix-progress-fill" style={{ width: `${Math.round((b.progress ?? 0) * 100)}%` }} />
                  </div>
                  <p className="host-mix-time">{b.time}</p>
                </li>
              ))}
            </ul>
          )}
          {np.warnings.map((w, k) => (
            <p key={k} className="host-note alarm">
              ⚠ {w}
            </p>
          ))}
          <div className="host-mix-transport">
            {np.beds.length > 0 && !np.onApp && <ActButton className="host-mix-skipall" label="⏭ Skip all" onClick={() => onMusic(musicCalls.next())} />}
            <ConfirmButton className="host-mix-stop" label="■ Stop music" ask="Stop the music?" yes="■ Stop" danger onConfirm={() => onMusic(musicCalls.stop())} />
          </div>
        </>
      )}
    </fieldset>
  );
}

/** What to play: the show's playlists, the app's library, a pasted link. */
function Playlists({ view, onMusic, onNote }: { view: MixerView; onMusic: (cmd: MusicCommand) => Promise<void> | void; onNote: (note: string) => void }) {
  const [more, setMore] = useState(false);
  const [link, setLink] = useState("");
  const show = handPlaylists(view.music);
  const app = view.music?.tidal;
  const library = app?.library ?? [];
  if (show.length === 0 && app === undefined) return null;
  const paste = async () => {
    const id = tidalPlaylistId(link);
    if (id === null) {
      onNote(BAD_LINK);
      return;
    }
    await onMusic(musicCalls.tidal(id));
    setLink("");
  };
  return (
    <fieldset className="host-box" data-testid="host-music-lists">
      <legend>PLAY NOW</legend>
      {show.length > 0 && (
        <ul className="host-music-picks">
          {show.map((p) => (
            <li key={p.name}>
              <ActButton className="host-music-pick" label={`▶ ${p.name}`} onClick={() => onMusic(musicCalls.playlist(p.name))} />
            </li>
          ))}
        </ul>
      )}
      {library.length > 0 && (
        <button type="button" className="w95-btn host-music-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          {more ? "▾" : "▸"} Your TIDAL playlists ({library.length})
        </button>
      )}
      {more && (
        <ul className="host-music-picks" data-testid="host-music-library">
          {library.map((p) => (
            <li key={p.id}>
              <ActButton className="host-music-pick" label={`▶ ${p.title}${p.items !== undefined ? ` (${p.items})` : ""}`} onClick={() => onMusic(musicCalls.tidal(p.id, p.title))} />
            </li>
          ))}
        </ul>
      )}
      {app !== undefined && (
        <form
          className="host-music-link"
          onSubmit={(e) => {
            e.preventDefault();
            void paste();
          }}
        >
          <input className="host-music-input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a TIDAL playlist link" aria-label="TIDAL playlist link" autoComplete="off" />
          <button type="submit" className="w95-btn host-music-play">
            ▶ Play
          </button>
        </form>
      )}
    </fieldset>
  );
}

/** Trabolta at the stereo. */
function TraboltaBox({ dj, onLock }: { dj: MusicDj; onLock: (locked: boolean) => Promise<void> | void }) {
  const lines = djLines(dj);
  return (
    <fieldset className="host-box" data-testid="host-music-dj">
      <legend>🤖 TRABOLTA</legend>
      <p className="host-music-line host-music-status">{lines.status}</p>
      {lines.pals !== null && <p className="host-music-line">{lines.pals}</p>}
      {lines.last !== null && <p className="host-music-line">{lines.last}</p>}
      <ActButton className="host-music-lock" label={dj.locked ? "🔓 Let him reach the music" : "🔒 Keep him off the music"} onClick={() => onLock(!dj.locked)} />
    </fieldset>
  );
}
