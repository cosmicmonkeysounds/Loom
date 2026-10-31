//! The Desk's 📷 Terminal photos (wave 59p, `docs/loom-w59-photos-contract.md`): the
//! arm, big and obvious (red when armed), the count, and each terminal's last shot,
//! thumbnail and why it isn't shooting. Self-contained: mount `PhotosSection` with
//! the booth's auth and calls. It polls only while mounted and the page is visible
//! (`startPoll`). Part of the Desk's lazy chunk, so a guest never downloads it.
//!
//! These are pictures of people. The thumbnails are fetched with the booth's
//! token, held as blob URLs, and revoked as soon as they're replaced. The download
//! and Delete all are Run's alone.

import "./photos.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { photoAgo, photosState, photosStopLine, photosSummary, photosViewOf, type PhotoTerminal, type PhotosView } from "../../../core/src/photos.ts";
import { startPoll } from "../director.tsx";
import type { HostCalls } from "./api.ts";
import { browserPollDeps, eventBase, type HostAuth } from "./client.ts";
import { ActButton, failText } from "./kit.tsx";
import { PHOTOS_PATH, PHOTOS_POLL_MS, PHOTOS_TIMEOUT_MS, PHOTOS_UNREACHED, PHOTO_THUMB_PATH, armHint, photosPollOutcome, thumbDue } from "./photos-model.ts";

function usePhotosView(auth: HostAuth): { view: PhotosView | null; error: string | null; setView: (v: PhotosView) => void; refresh: () => void } {
  const [view, setView] = useState<PhotosView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<{ stop(): void; now(): void } | null>(null);
  const { token, eventId } = auth;
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), PHOTOS_TIMEOUT_MS);
      try {
        const res = await fetch(`${eventBase(eventId)}${PHOTOS_PATH}`, { headers: { "x-loom-token": token }, cache: "no-store", signal: ctl.signal }).catch((e: unknown) => {
          if (!stopped) setError(PHOTOS_UNREACHED);
          throw e;
        });
        const out = photosPollOutcome(res.status, await res.json().catch(() => null));
        if (stopped) return;
        if (out.kind === "error") {
          setError(out.message);
          throw new Error(out.message);
        }
        setView(out.view);
        setError(null);
      } finally {
        clearTimeout(timer);
      }
    };
    const p = startPoll(browserPollDeps(load), PHOTOS_POLL_MS);
    poll.current = p;
    return () => {
      stopped = true;
      p.stop();
      poll.current = null;
    };
  }, [token, eventId]);
  const refresh = useCallback(() => poll.current?.now(), []);
  return { view, error, setView, refresh };
}

/** One spot's latest still, as a blob URL revoked when it's replaced. */
function useThumb(auth: HostAuth, spot: string, lastAt: number | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const shown = useRef<{ lastAt: number; fetchedAt: number } | null>(null);
  const held = useRef<string | null>(null);
  const { token, eventId } = auth;
  useEffect(() => {
    const now = Date.now();
    if (!thumbDue(shown.current, lastAt, now)) return;
    shown.current = { lastAt: lastAt!, fetchedAt: now };
    let stale = false;
    void fetch(`${eventBase(eventId)}${PHOTO_THUMB_PATH}?spot=${encodeURIComponent(spot)}`, { headers: { "x-loom-token": token }, cache: "no-store" })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (stale || blob === null) return;
        if (held.current !== null) URL.revokeObjectURL(held.current);
        held.current = URL.createObjectURL(blob);
        setUrl(held.current);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [token, eventId, spot, lastAt]);
  useEffect(
    () => () => {
      if (held.current !== null) URL.revokeObjectURL(held.current);
      held.current = null;
    },
    [],
  );
  return url;
}

/** One terminal's row. */
export function PhotoRow({ t, now, thumb }: { t: PhotoTerminal; now: number; thumb: string | null }) {
  return (
    <li className="host-photos-row" data-testid={`host-photos-row-${t.spot}`}>
      {thumb !== null ? <img className="host-photos-thumb" src={thumb} alt={`The last photo from ${t.name}`} /> : <span className="host-photos-thumb" aria-hidden="true" />}
      <span className="host-photos-body">
        <span className="host-photos-name">{t.name}</span>
        {t.count} · last {photoAgo(now, t.lastAt)}
        {t.note !== null && <span className="host-note alarm"> ⚠ {t.note}</span>}
      </span>
    </li>
  );
}

function LiveRow({ auth, t, now }: { auth: HostAuth; t: PhotoTerminal; now: number }) {
  return <PhotoRow t={t} now={now} thumb={useThumb(auth, t.spot, t.lastAt)} />;
}

/** The arm and the count, off a view. */
export function PhotosHead({ view, note, onArm }: { view: PhotosView; note: string | null; onArm: (armed: boolean) => Promise<unknown> | void }) {
  const stop = photosStopLine(view);
  return (
    <>
      <ActButton
        className={`host-photos-state ${view.armed ? "armed" : "safe"}`}
        pressed={view.armed}
        label={
          <>
            {photosState(view)}
            <span className="host-photos-hint">{armHint(view.armed)}</span>
          </>
        }
        title={view.armed ? "Each terminal with a working camera takes one photo every 15 s" : "No terminal is taking photos"}
        onClick={() => onArm(!view.armed)}
      />
      <p className="host-note" data-testid="host-photos-summary">
        {photosSummary(view)}
      </p>
      {stop !== null && <p className="host-note alarm">🛑 {stop}</p>}
      {note !== null && <p className="host-note alarm">⚠ {note}</p>}
    </>
  );
}

/** 📷 Terminal photos: for a Desk tab, or anywhere else a booth's auth reaches. */
export function PhotosSection({ auth, calls }: { auth: HostAuth; calls: HostCalls }) {
  const { view, error, setView, refresh } = usePhotosView(auth);
  const [note, setNote] = useState<string | null>(null);
  const arm = async (armed: boolean) => {
    try {
      const next = photosViewOf(await calls.photosArm(armed));
      if (next !== null) setView(next);
      setNote(null);
    } catch (e) {
      setNote(failText(e));
    } finally {
      refresh();
    }
  };
  return (
    <section className="host-desk-part host-photos" aria-label="Terminal photos" data-testid="host-photos">
      <h3 className="host-section-head">
        <span>📷 Terminal photos</span>
      </h3>
      {view === null ? (
        <p className="host-note">{error ?? "Reading…"}</p>
      ) : (
        <>
          <PhotosHead view={view} note={note ?? error} onArm={arm} />
          <ul className="host-photos-list">
            {view.terminals.map((t) => (
              <LiveRow key={t.spot} auth={auth} t={t} now={view.now} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
