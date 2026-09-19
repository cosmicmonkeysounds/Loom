# loom-terminal — the wall terminal

A kiosk app for tablets mounted around a live Loom event: a **direct line
to an agent-voiced character** (Trabolta, in *Trapped in the Internet*).
A program holds their pass up to the camera, and for as long as they keep
typing the screen is theirs: the conversation on one side, the
character's **animated face** on the other, and every reply **spoken
aloud** in a synthesised voice. Thirty seconds without input and the line
drops.

It is the same chat architecture as the rest of Loom — no new server, no
new thread model:

- A terminal is a **trusted device**. It is set up once with the event's
  moderator passcode, which it trades for a moderator token
  (`/api/mod/login`). The passcode is never stored.
- Scanning a pass (the QR on the play app's *Your pass* sheet, which is
  the guest id) mints a **play-as session for that guest** through
  `/api/mod/impersonate` — the seam the editor's Run → Players page uses.
  It is exactly the guest's own session: their `GuestView`, their stream,
  no moderator powers, cut by the same restarts that cut their phone.
- The terminal opens that stream (the play app's own `useChatStream`) and
  narrows it to `dm:<Character>` — **the very thread on the guest's
  phone**. What is said at the wall is in their DM when they walk away,
  and the character's agent answers it exactly as it answers the phone.
- Every line typed at a terminal is journaled `by` the terminal's name
  (`label` on `/api/mod/impersonate`) — the mod feed shows it as
  `via: "Terminal · Kitchen"`.

## Running

```bash
pnpm --filter loom-terminal dev      # :5175, proxies /api + /e to the server on :7000
pnpm --filter loom-terminal build    # → dist/, served by the event server at /terminal/
pnpm --filter loom-terminal test     # the pure pieces (scan parsing, the leash, splitting, voice ranking, moods)
```

Open `http://<server>:7000/terminal/` on the tablet. Set it up on the
screen (moderator passcode, a name, the character, camera, voice), or
provision a whole fleet by opening one link on each:

```
http://<server>/terminal/?code=<mod passcode>&name=Kitchen&character=Trabolta
```

(`&camera=environment` for the back camera, `&engine=browser` to skip the
server voice.) The passcode is scrubbed from the address bar at once.

**The camera needs a secure context** — `https://` or `localhost`. On a
plain `http://192.168.x.x` address every browser refuses `getUserMedia`;
the terminal says so and offers the typed fallback (a program types the
name they registered with; a unique match pilots). For a LAN party put
the server behind the Docker `proxy` (Caddy does HTTPS), or on Android
kiosks flag the origin as secure in `chrome://flags`.

Add the page to the home screen / run the browser in kiosk mode. After a
reload the terminal shows **TOUCH TO WAKE** until someone taps it once —
that one gesture is what lets a browser play sound unattended afterwards.

## The voice

Two engines behind one queue (`src/speech/`):

| Engine | Where it runs | Quality |
|---|---|---|
| **server** (default) | The show laptop, behind the event server's `/api/mod/tts` proxy | Neural — the one to use. Run [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) (`docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu`, or the GPU image) and set `LOOM_TTS_URL=http://<laptop>:8880/v1` on the event server. Any OpenAI-compatible `/audio/speech` endpoint works, OpenAI's own included (`LOOM_TTS_URL=https://api.openai.com/v1 LOOM_TTS_API_KEY=… LOOM_TTS_MODEL=tts-1 LOOM_TTS_VOICE=onyx`). |
| **browser** (fallback) | The tablet's `speechSynthesis` | Varies: Edge's online *Natural* voices and an iPad's downloaded *Enhanced/Premium* voices are close to real; stock Android is not. The setup screen ranks the installed voices best-first with a TEST button. |

The server voice is cached per line across every terminal, so the hold
message costs the GPU once a night. If the laptop is down mid-sentence
the queue hands that chunk to the tablet voice rather than going mute
(`voice: tablet fallback` appears under the face). Replies are split into
sentences and synthesised one ahead, so speech starts on the first
sentence and the transcript reveals as it is said. Server env:

```
LOOM_TTS_URL       base of the speech API (unset = no server voice)
LOOM_TTS_API_KEY   bearer token, if the endpoint wants one
LOOM_TTS_MODEL     default "kokoro"
LOOM_TTS_VOICE     default "am_michael"  (Kokoro: am_adam, bm_george, af_bella+af_sky …)
LOOM_TTS_FORMAT    mp3 (default) | wav | opus
```

## The face

`src/face/` — an SVG head driven by a requestAnimationFrame loop: brows,
lidded eyes that look around and blink, a mouth that opens with the live
loudness of the voice (an `AnalyserNode` on the decoded audio; a
syllable-rate flutter on the browser engine, which exposes no waveform).
The mood is read off the situation (waiting / someone connected /
composing / speaking) and off each sentence as it is said (`mood.ts`:
shouting is anger, a question is curiosity, an ellipsis is slyness). A
dropped line glitches.

## Layout

```
src/app.tsx            the screens: setup → attract → connecting → piloting
src/config.ts          per-tablet config (localStorage) + URL provisioning
src/scanner.tsx        camera + QR (BarcodeDetector, else jsQR)
src/scan.ts            what a scanned code means; the typed-name fallback
src/pilot.ts           impersonate / end / say; the DM thread off the guest stream
src/idle.ts            the 30 s leash (paused while the character is answering)
src/chat.tsx           the thread + composer
src/speech/            engine.ts (server + browser + queue), split.ts, pick-voice.ts
src/face/              Face.tsx (SVG + animation), mood.ts
```

Server-side pieces live in `core/server`: `tts.ts` (the proxy + cache),
the `/api/mod/tts` route and the `label` on `/api/mod/impersonate` in
`event-runtime.ts`, and static serving of `dist/` at `/terminal/` in
`server.ts`.
