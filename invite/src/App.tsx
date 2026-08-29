import { useCallback, useEffect, useRef, useState } from "react";
import { IV_B64, SALT_B64, SEALED_B64 } from "./sealed.ts";

// ————————————————————————————————————————————————————————————————
// The homepage of a webmaster who set out to map the internet in
// 1997 and never found his way back out. Maximum-chaos GeoCities:
// water background, fire borders, a MIDI player that really plays,
// unrelated clip-art animations everywhere. Buried in the kitsch is
// a real puzzle:
//
//   1. The guestbook entry signed "B. de V. — 1586" is a Vigenère
//      cipher (Blaise de Vigenère, Traicté des chiffres, 1586).
//   2. The key, MODEM, is the acrostic of the "THINGS I ♥" list
//      ("first things first" — also nudged by the view-source
//      comment in index.html).
//   3. The plaintext names the passphrase; typing it into the
//      MEMBERS ONLY box AES-decrypts the real invitation, which
//      never ships in this bundle as plaintext.
//
// To change the party details or the passphrase, edit
// scripts/payload.json (and the constants at the top of
// scripts/seal.mjs) and re-run:  node scripts/seal.mjs DIALTONE
// scripts/payload.json  — it rewrites src/sealed.ts and prints the
// matching guestbook ciphertext for GUESTBOOK below.
// ————————————————————————————————————————————————————————————————

const CIPHER_GROUPS = "FVHQQ YPHVE PCRVA BSQWF AHKII AFGHU MZWSZ Q";

// NOTE: the bold names are load-bearing — their first letters spell the
// Vigenère key (MODEM). Grease the descriptions, never the names.
const HEARTS = [
  ["Modems", "that sweet handshake song 'fore the world hooks up. real gone."],
  ["Oregon Trail", "i cashed in from dysentery 61 times, daddy-o"],
  ["Doom II", "i know every secret wall in the joint"],
  ["Encarta 95", "every article. even the flags. read 'em all twice."],
  ["MIDI files", "crank your speakers, cat ☝"],
] as const;

// Real, still-breathing corners of the old internet — the map works.
const MAPPED_SITES = [
  { label: "the FIRST website ever made (this is where i parked first)", href: "http://info.cern.ch" },
  { label: "zombo com (you can do anything there. anything at all, cat.)", href: "https://zombo.com" },
  { label: "space jam (1996) (still up. nothin' ever dies in here.)", href: "https://www.spacejam.com/1996/" },
  { label: "arngren dot net (prettiest map these optics ever saw)", href: "https://www.arngren.net" },
  { label: "cameron's world (a map of the old country)", href: "https://www.cameronsworld.net" },
  { label: "wiby (a search engine for cool pages like mine, dig it)", href: "https://wiby.me" },
  { label: "the end of the internet", href: null },
  { label: "my cousin's page about lighthouses", href: null },
] as const;

const GUESTBOOK = [
  { who: "coolguy82", when: "04/12/1998", what: "AWESOME page!!! u should add frames. visit my page about trucks" },
  { who: "B. de V.", when: "1586", what: CIPHER_GROUPS },
  { who: "the webmaster", when: "yesterday", what: "i can't read the entry above. i also can't leave this joint. these two facts feel related, daddy-o." },
] as const;

interface Invite {
  name: string;
  lines: string[];
  url: string;
  note: string;
}

function b64bytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function unseal(guess: string): Promise<Invite | null> {
  if (!("subtle" in crypto)) return null;
  const norm = guess.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!norm) return null;
  try {
    const enc = new TextEncoder();
    const material = await crypto.subtle.importKey("raw", enc.encode(norm), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64bytes(SALT_B64), iterations: 250_000, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64bytes(IV_B64) }, key, b64bytes(SEALED_B64));
    return JSON.parse(new TextDecoder().decode(plain)) as Invite;
  } catch {
    return null;
  }
}

// ——— unrelated decorations (this is the point) ———

/** Für Elise's opening, as a 1997 sound card would remember it. */
const MELODY = [659, 622, 659, 622, 659, 494, 587, 523, 440, 0, 262, 330, 440, 494, 0, 330, 415, 494, 523, 0, 330];

function MidiPlayer(): JSX.Element {
  const [playing, setPlaying] = useState(false);
  const [secs, setSecs] = useState(147);
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noteRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (noteRef.current) clearInterval(noteRef.current);
    timerRef.current = null;
    noteRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    if (ctxRef.current) return;
    const Ctx = window.AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    ctxRef.current = ctx;
    let i = 0;
    const step = () => {
      const freq = MELODY[i % MELODY.length] ?? 0;
      i++;
      if (freq === 0) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.24);
    };
    step();
    noteRef.current = setInterval(step, 240);
    timerRef.current = setInterval(() => setSecs((s) => s + 1), 1000);
    setPlaying(true);
  }, []);

  useEffect(() => stop, [stop]);

  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");

  return (
    <div className="midi" role="group" aria-label="midi player">
      <div className="midi-title">
        <span>midifiles.midi</span>
        <span className="midi-buttons">
          <i>_</i>
          <i>□</i>
          <i>×</i>
        </span>
      </div>
      <div className="midi-menu">File&nbsp;&nbsp;Seek&nbsp;&nbsp;Options&nbsp;&nbsp;Help</div>
      <div className="midi-body">
        <span className="midi-live blink">LIVE</span>
        <span className="midi-song">Crescendo</span>
        <span className="midi-clock">
          0{mm}:{ss}
        </span>
      </div>
      <div className="midi-controls">
        <button type="button" onClick={playing ? stop : play}>
          {playing ? "■" : "►"}
        </button>
        <span className="midi-note">{playing ? "♫ ♪ ♫ now we're cookin'" : "sound's OFF, cat. he told ya to crank it."}</span>
      </div>
    </div>
  );
}

function Globe(): JSX.Element {
  const frames = ["🌍", "🌎", "🌏"] as const;
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % frames.length), 350);
    return () => clearInterval(t);
  }, [frames.length]);
  return <span className="globe">{frames[i]}</span>;
}

function Decor(): JSX.Element {
  return (
    <div className="decor" aria-hidden="true">
      <div className="skullbox">
        <span className="skull s1">💀</span>
        <span className="skull s2">💀</span>
        <div className="skull-caption">Skulls everywhere, daddy-o</div>
      </div>
      <div className="dancer">🕺</div>
      <div className="globebox">
        <Globe />
        <div className="globe-caption">the internet</div>
      </div>
      <span className="toast t1">🍞</span>
      <span className="toast t2">🍞</span>
      <span className="ufo">🛸</span>
      <span className="invader inv-l">👾</span>
      <span className="invader inv-r">👾</span>
      <span className="flame-dot fd1">🔥</span>
      <span className="flame-dot fd2">🔥</span>
    </div>
  );
}

function Counter(): JSX.Element {
  const [n, setN] = useState(13);
  useEffect(() => {
    const t = setInterval(() => setN((v) => v - 1), 6000);
    return () => clearInterval(t);
  }, []);
  const digits = n > 0 ? String(n).padStart(6, "0") : "YOU???";
  return (
    <p className="counter">
      u are the{" "}
      <span className="odometer">
        {digits.split("").map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </span>{" "}
      visiter to cruise thru here!!! <small>(countin' down. don't sweat it, cat.)</small>
    </p>
  );
}

function Home({ onUnlock }: { onUnlock: (invite: Invite) => void }): JSX.Element {
  const [guess, setGuess] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "denied">("idle");

  const submit = useCallback(async () => {
    if (status === "checking") return;
    setStatus("checking");
    const invite = await unseal(guess);
    if (invite) onUnlock(invite);
    else setStatus("denied");
  }, [guess, status, onUnlock]);

  return (
    <div className="page">
      <div className="fire fire-top" aria-hidden="true" />
      <div className="fire fire-bottom" aria-hidden="true" />
      <Decor />
      <MidiPlayer />

      <table className="frame">
        <tbody>
          <tr>
            <td>
              <h1 className="cooltitle">
                The Webmaster's
                <br />
                <span className="cooltitle-2">Home Page</span>
              </h1>
              <p className="subtitle">
                ☆ i'm drawin' a map of the whole internet ☆ <span className="newburst">NEW!</span>
              </p>

              <div className="marquee">
                <span>
                  WELCOME, DADDY-O ··· i been cruisin' this information superhighway since 1997 ···
                  today is day 10,592 ··· the modem never hangs up ··· don't trust the counter, it's a
                  square ··· nothin' on this page is decoration ···&nbsp;
                </span>
              </div>

              <div className="construction">
                <span className="stripe" />
                <span className="construction-label">THIS MAP IS UNDER CONSTRUCTION — 41% COMPLETE</span>
                <span className="stripe" />
              </div>

              <div className="rainbow-bar" aria-hidden="true" />

              <h2>ABOUT ME</h2>
              <p>
                hey there, cat. i'm the webmaster. back in '97 i set out to draw a complete map of the
                internet — every page, every link, every last backstreet. i'm still drawin'. i ain't
                found the edge. i ain't found the exit. <span className="blink">i'm cool. real cool.</span>
              </p>

              <h2>
                THINGS I ♥ <small>(first things first)</small>
              </h2>
              <ul>
                {HEARTS.map(([thing, why]) => (
                  <li key={thing}>
                    <b>{thing}</b> — {why}
                  </li>
                ))}
              </ul>

              <h2>SITES I HAVE MAPPED SO FAR</h2>
              <ul>
                {MAPPED_SITES.map((site) => (
                  <li key={site.label}>
                    {site.href ? (
                      <a href={site.href} target="_blank" rel="noopener noreferrer">
                        {site.label}
                      </a>
                    ) : (
                      <a href="#" onClick={(e) => e.preventDefault()}>
                        {site.label} <small>(link broken)</small>
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              <p>
                <span className="spin">✉️</span>{" "}
                <a href="mailto:webmaster@mapsandducks.com?subject=RE:%20the%20map">
                  drop the webmaster a line
                </a>{" "}
                <small>(i write back within 3-5 business years)</small>
              </p>

              <div className="rainbow-bar" aria-hidden="true" />

              <h2 id="guestbook">
                ~ GUESTBOOK ~ <span className="newburst">HOT!</span>
              </h2>
              <table className="guestbook">
                <tbody>
                  {GUESTBOOK.map((entry) => (
                    <tr key={entry.who}>
                      <td className="gb-who">
                        <b>{entry.who}</b>
                        <br />
                        <small>{entry.when}</small>
                      </td>
                      <td className="gb-what">{entry.what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="gb-links">
                <a href="mailto:webmaster@mapsandducks.com?subject=SIGN%20MY%20GUESTBOOK">
                  Sign my Guestbook!
                </a>{" "}
                🌈{" "}
                <a href="#guestbook">View Guestbook</a>{" "}
                <small>(the pen quit on me back in '99)</small>
              </p>

              <div className="rainbow-bar" aria-hidden="true" />

              <div className="members">
                <h2>*** MEMBERS ONLY ***</h2>
                <p>you got the word, cat? then the map'll show ya the way off of it.</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  <input
                    type="password"
                    value={guess}
                    onChange={(e) => {
                      setGuess(e.target.value);
                      setStatus("idle");
                    }}
                    placeholder="the word"
                    aria-label="members password"
                  />{" "}
                  <button type="submit">[ ENTER ]</button>
                </form>
                {status === "denied" && <p className="denied blink">NO DICE, DADDY-O.</p>}
                {status === "checking" && <p className="checking">checkin' the map…</p>}
                {!("subtle" in crypto) && <p className="denied">this door only swings open over https, cat.</p>}
              </div>

              <div className="rainbow-bar" aria-hidden="true" />

              <div className="badges">
                <span className="badge b-net">NETSCAPE NOW!</span>
                <span className="badge b-pad">MADE WITH NOTEPAD</span>
                <span className="badge b-y2k">Y2K READY</span>
                <span className="badge b-res">800 × 600</span>
              </div>

              <Counter />

              <p className="fineprint">
                hand-made in notepad, cat. view source and weep.
                <br />
                best viewed in Netscape Navigator 4.0 · © 1997 · last updated: tomorrow
              </p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Revealed({ invite }: { invite: Invite }): JSX.Element {
  return (
    <div className="terminal">
      <p className="term-dim">CARRIER DETECTED · 56000 bps · WELCOME, DADDY-O</p>
      <p className="term-line">well ain't you a cool cat. the map ends right here.</p>
      <h1 className="term-title">{invite.name}</h1>
      {invite.lines.map((line) => (
        <p key={line} className="term-line">
          {line}
        </p>
      ))}
      <p className="term-link">
        <a href={invite.url}>{invite.url.replace(/^https?:\/\//, "")}</a>
      </p>
      <p className="term-dim">{invite.note}</p>
      <p className="term-cursor">▮</p>
    </div>
  );
}

export function App(): JSX.Element {
  // Deliberately nothing is persisted: the door opens for this look
  // only, and the next visit starts back at the webmaster's page.
  const [invite, setInvite] = useState<Invite | null>(null);
  return invite ? <Revealed invite={invite} /> : <Home onUnlock={setInvite} />;
}
