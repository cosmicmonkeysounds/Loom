# Deploying Loom to a VPS with Docker

A start-to-finish walkthrough for putting the Loom web stack on a fresh
Ubuntu VPS (written against OVHcloud, but any Ubuntu box works). No
prior server experience assumed — the only prerequisite is that you can
SSH into the machine.

What you end up with, all on one box (domain layout shown; before you
have a domain everything under the app address is reachable by plain
`http://YOUR_VPS_IP/…`):

| URL | What it serves |
|-----|----------------|
| `https://mapsandducks.com/` | The **invitation** — a cryptic static one-pager (`invite/`) |
| `https://app.mapsandducks.com/` | The **play** app — guests/performers join here |
| `https://app.mapsandducks.com/edit/` | The **editor** — sign up, write, run + deploy events |
| `https://app.mapsandducks.com/terminal/` | The **wall terminals** — the kiosk tablets around the house (`terminal/`) |
| `https://app.mapsandducks.com/reinstall/` | The **web reinstallation game** — the tent tablet's golden-duck hunt, and the King at the server-room door (`reinstall/web/`) |
| `https://app.mapsandducks.com/reinstall/map` | The **house map** viewer + editor for directors |
| `…/api/*`, `…/e/*` | The event server's API (used by both apps) |

Under the hood it's four containers, defined in the repo-root
[`docker-compose.yml`](../docker-compose.yml):

- **loom** — the `@loom/core` event server (built by the repo-root
  [`Dockerfile`](../Dockerfile), which also builds `play/dist`,
  `terminal/dist`, `reinstall/web/dist` and `editor/dist` inside the
  image build, so you never run `pnpm` on the VPS).
- **caddy** — the front door: serves the invitation site on the apex
  domain and the editor at `/edit/` on the app address, proxies
  everything else to the event server, and (once you have a domain)
  handles HTTPS certificates automatically.
- **db** — Postgres, for author accounts + server-stored projects.
- **kokoro** — **opt-in, not started by default** (the `tts` profile): a
  neural voice for the terminals; the devices speak with their own voices
  without it. See [§5¾ The voice](#the-voice).

Everything that must survive restarts (the Postgres data, the event
journals, the TLS certificates) lives in named Docker volumes — the
containers themselves are disposable.

---

## 0. The mental model (if you're new to this)

- Your **VPS** is just a Linux computer running somewhere else. SSH is
  how you type commands on it.
- **Docker** packages the app and everything it needs into an *image*;
  a running image is a *container*. You don't install Node, pnpm, or
  Postgres on the VPS — Docker builds/runs all of it.
- **docker compose** reads `docker-compose.yml` and starts the whole
  four-container stack with one command.
- "Deploying" is: copy the source code to the VPS → `docker compose up
  -d --build`. "Updating" is the same two steps again.

---

## 1. One-time VPS setup

SSH in (use the IP OVH gave you; the user may be `ubuntu`, `debian`,
or `root` depending on the image you picked):

```bash
ssh ubuntu@YOUR_VPS_IP
```

### Install Docker

Use Docker's official convenience script (installs the engine +
compose plugin):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER    # let your user run docker without sudo
exit                             # log out…
ssh ubuntu@YOUR_VPS_IP           # …and back in so the group applies
docker ps                        # should print an empty table, no error
```

### Open the firewall

Ubuntu's `ufw` is often inactive on fresh VPSes; set it up so only
SSH + web traffic are reachable:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

(OVHcloud VPSes usually have no extra cloud-side firewall by default;
if you configured one in the OVH panel, open 80/443 there too.)

---

## 2. Get the code onto the VPS

Two good options — pick one.

### Option A — `rsync` straight from your machine (no GitHub needed)

Run this **on your Mac**, from the directory *containing* the loom
folder. It copies the source but skips the heavy build junk:

```bash
rsync -avz --delete \
  --exclude .git --exclude node_modules --exclude dist \
  --exclude target --exclude .env --exclude core/server/.loom-state \
  --filter='P /.env*' --filter='P /show-map/' \
  --filter='P /docker-compose.override.yml' --filter='P /docker-compose.override.yaml' \
  --filter='P /loom-db-*' --filter='P /loom-state-*' --filter='P /*.sql*' --filter='P /*.tgz' \
  --filter='P /*.bak*' \
  ~/Documents/prism-root/packages/loom/ \
  ubuntu@YOUR_VPS_IP:~/loom/
```

Notes: the trailing slashes matter (`loom/` → contents into `~/loom/`);
`--delete` makes the VPS mirror your local tree on re-runs, so anything
else in `~/loom` that your tree lacks is **deleted** — the `P` (protect)
rules keep an operator's own files at the top of the checkout (a dated
`.env` backup, the `./show-map` mount, a compose override, hand-made
dumps). Better still, keep those outside the checkout (`~/loom-backups`).
Re-running this same command is how you'll ship updates later; for the
show, `scripts/ops/ship.sh` runs it for you with the same rules (§6).

### Option B — push to a git host, clone on the VPS

If the repo lives on GitHub/GitLab (private is fine):

```bash
# on the VPS
git clone git@github.com:you/loom.git ~/loom     # first time
cd ~/loom && git pull                             # updates
```

---

## 3. Configure secrets

On the VPS, in the repo:

```bash
cd ~/loom
cp .env.example .env
openssl rand -hex 24       # → paste as POSTGRES_PASSWORD
openssl rand -base64 32    # → paste as BETTER_AUTH_SECRET
nano .env                  # fill in all four values
```

The four values:

- `POSTGRES_PASSWORD` — anything long and random (only containers see it).
- `BETTER_AUTH_SECRET` — signs author login cookies. The server
  **refuses to start accounts** on the dev default, so this must be real.
- `LOOM_BASE_URL` — the address people type in a browser. Starting
  without a domain: `http://YOUR_VPS_IP`.
- `SITE_ADDRESS` — what Caddy listens as. Without a domain: `:80`.

Keep `.env` on the VPS only — it's in `.gitignore`/`.dockerignore` and
excluded from the rsync above.

### Email for share invites

When you **Share** a project with a co-writer, the server emails them a
join link. That needs a mail provider; the three `LOOM_*MAIL*` lines in
`.env` set it up. Pick one:

- **Resend** (easiest): sign up at resend.com, add + verify your domain
  (two DNS records), create an API key → `LOOM_RESEND_API_KEY=re_…` and
  `LOOM_MAIL_FROM=Loom <no-reply@YOUR_DOMAIN>`.
- **Any SMTP mailbox** (Fastmail, a Gmail app password, Mailgun,
  Postmark, …): `LOOM_SMTP_URL=smtps://USER:PASSWORD@smtp.host:465`
  (URL-encode special characters in the password) and `LOOM_MAIL_FROM`
  set to that mailbox.

Leave both blank and sharing still works — the Share dialog shows the
owner the invite link to send by hand, and the server logs the email
it would have sent (`docker compose logs loom`). After changing `.env`,
`docker compose up -d` restarts the server with the new values; the
boot log prints `✉️  mail via smtp` / `resend` when a transport is on.

### The webmaster outbox (`/webmaster/`)

A one-password page on the app domain
(`https://app.mapsandducks.com/webmaster/`) for sending mail as
`webmaster@…` through Resend: To (paste a list; each person gets their
own copy, so nobody sees the guest list), Reply-to, Subject, a
plain-text message (links become clickable), and a log of what was
sent. Set in `.env`, then `docker compose up -d`:

```
LOOM_RESEND_API_KEY=re_…            # the domain must be verified in Resend
LOOM_WEBMASTER_PASSWORD=<long random string>
LOOM_WEBMASTER_FROM=Webmaster <webmaster@mapsandducks.com>
LOOM_WEBMASTER_REPLY_TO=            # blank = replies go to the From address
```

The boot log prints `📮 webmaster outbox at /webmaster/`. Wrong
passwords are throttled (10 per 15 min per IP); a sign-in lasts 12 h;
changing the password signs everyone out. The sent log lives in the
state volume (`webmaster-sent.json`). Replies land wherever the
domain's MX points (e.g. ImprovMX → your Gmail) — Resend only sends.

### Show settings: join links, push, door-rush throttles

- **`LOOM_BASE_URL` is also the join origin.** Every join link the server
  hands out — the Run page's codes + QR (`/api/mod/codes`, the event's
  `joinUrl`), the printable codex `?code=&unlock=` links and the Print
  page — uses it; with it blank the server falls back to its first LAN IP
  (fine on a LAN box, useless from cellular). It is also the Web Push
  contact when `LOOM_VAPID_SUBJECT` is blank (an `https://` origin; else
  the server logs a warning).
- **Push notifications** (alerts, a character's DMs and the booths' door
  alarm on a locked Android phone or performer booth): generate a pair
  **once** with `npx web-push generate-vapid-keys` →
  `LOOM_VAPID_PUBLIC_KEY` / `LOOM_VAPID_PRIVATE_KEY` (+ optional
  `LOOM_VAPID_SUBJECT`, `mailto:` or `https:`). Never rotate them before
  the show — every phone's subscription is bound to the public key.
  Blank = push off (no 🔔 card; in-app alerts still work). Subscriptions
  live in the event's state dir, so backups carry them.
- **iPhone Home Screen push** (`LOOM_HOMESCREEN`, blank = off; `on` /
  `1` / `true` / `yes` = on; K-31b). Off, an iPhone's 🔔 card says to keep
  the app open with the screen on. On (and with the VAPID keys set), an
  iPhone on iOS 16.4+ is told to tap Share → Add to Home Screen; the icon
  opens signed in as the same guest through a single-use nonce in the
  manifest's `start_url` (12 h, the newest 3 per guest, cleared by every
  restart). Booths only get the steps (sign out in Safari, sign in from
  the icon). Turn it on only if the Android push check (K-31a) passed;
  the device check is `scripts/accept/k31b.sh`.
- **Door-rush throttles** (`LOOM_RL_*`, each `<max>` or `<max>/<seconds>`,
  blank = default, a malformed value is logged and ignored):
  `LOOM_RL_RESOLVE` (`/api/resolve-code` per IP, 30/60),
  `LOOM_RL_REGISTER` (guest registrations per IP, 20/60),
  `LOOM_RL_LOGIN_FAILURES` (wrong passcodes per IP before the lockout,
  10/300), `LOOM_RL_REDEEM_MISSES` (wrong codex codes per guest, then 429
  and nothing journaled, 8/60), `LOOM_RL_WIDGETS` (widget answers per
  guest, 20/60), `LOOM_RL_WALLET` (wallet calls per guest — sends,
  requests, offers, the stimulus — 30/60, the only brake on a phone
  flooding the approver's queue), `LOOM_RL_QR` (`/api/qr` per IP, 60/60:
  since wave 9 only the editor's Run join QR uses it — guest passes are
  drawn on the phone). At the party every phone on the house Wi-Fi reaches the
  VPS from **one** public IP, so the night's `.env` raises the per-IP ones:
  `LOOM_RL_RESOLVE=600`, `LOOM_RL_REGISTER=400`,
  `LOOM_RL_LOGIN_FAILURES=100/300`. A locked-out IP still lets the right
  **guest** event code through (a house full of phones shares the IP);
  wrong codes and the performer and mod codes stay locked out.
- **Check them**: `deploy/release.sh --check-env` (on the VPS, in the
  checkout) warns about any of those three below the night's value, a
  blank VAPID key and a `LOOM_BASE_URL` that isn't `https://`, and ends
  `env: the night's knobs are set ✔` (exit 0) when all are fine. Every
  `deploy/release.sh <tag>` prints the same warnings first (and goes on).
- **Snapshot coalescing** (`LOOM_SNAPSHOT_MS`, blank / 0 = off): at most
  one guest / booth view frame per that many ms (a burst of story steps →
  one leading + one trailing frame; restarts never trail). The mod
  consoles are always coalesced to 500 ms. The K-32 contingency: set
  `500` only if the load test fails (p95 > 1 s or CPU > 70 %).

After changing any of these, `docker compose up -d loom` (or the next
`deploy/release.sh`).

---

## 4. Launch

```bash
cd ~/loom
docker compose up -d --build
```

The first build takes a few minutes (it installs the JS workspace and
builds both web apps inside Docker). When it returns:

```bash
docker compose ps            # all four services "running", loom "healthy"
docker compose logs loom     # boot banner: passcodes + URLs
```

Then check in a browser:

- `http://YOUR_VPS_IP/` → the play app's join screen.
- `http://YOUR_VPS_IP/edit/` → the editor's sign-in gate. Create your
  author account, make a project, write, open Run (`⌘2`) to launch an
  event — guests join at the root URL with the event's code.

The default (code-less) event's three passcodes are printed in the
`loom` logs and saved in the state volume; events you launch from the
editor get their own codes on the Run page. Codes are **pinned per
project**: End → relaunch reuses the last event's codes, so printed QRs
keep working. Run's empty state offers **New performer + moderator codes**
(the guest code is kept) for when a staff code leaked at rehearsal —
re-provision the terminals and the tent tablet with the new mod code.

---

## 5. The domain: transfer, DNS, HTTPS

### 5a. Transferring a domain you were given (the EPP code)

If someone handed you a domain, "transferring" it means moving it into
a registrar account **you** control. Since the VPS is at OVHcloud, the
simplest home for it is your OVH account:

1. The **losing side** must have the domain *unlocked* (transfer lock
   off) and give you the **EPP / authorization code** — you have this.
2. In the OVH control panel: **Web Cloud → Domain names → Transfer a
   domain** (or ovh.com → Domains → Transfer). Enter the domain, pay
   the transfer fee (it normally includes a 1-year renewal), and paste
   the EPP code when asked.
3. Approve the confirmation email(s). The transfer then sits with the
   losing registrar for **up to 5 days** (many release it sooner if the
   previous owner clicks "approve transfer" on their side).
4. Things that block transfers, if it gets stuck: the domain was
   registered or changed owners **less than 60 days ago** (ICANN lock —
   you just have to wait), the transfer lock is still on, or the EPP
   code is stale (have the previous owner regenerate it).

**Don't want to wait?** You don't strictly need the transfer to finish
before going live: whoever currently controls the domain's DNS can add
the A records below and everything works today; the transfer just
moves ownership to you and can complete in the background.

### 5b. DNS records

In the domain's DNS zone (OVH panel → the domain → **DNS zone** once
the transfer lands), add two **A records** pointing at the VPS:

| Type | Name (host) | Target |
|------|------------|--------|
| A | `@` (the apex, `mapsandducks.com`) | `YOUR_VPS_IP` |
| A | `app` (→ `app.mapsandducks.com`) | `YOUR_VPS_IP` |

(`app` is just a suggestion — any subdomain works; use the same name in
`.env` below. Optionally add `www` → `YOUR_VPS_IP` too and a Caddy
redirect, see 5d.)

Wait until both resolve from your machine:
`ping mapsandducks.com`, `ping app.mapsandducks.com`.

### 5c. Point the stack at the domain

On the VPS, edit `.env`:

```
LOOM_BASE_URL=https://app.mapsandducks.com
SITE_ADDRESS=app.mapsandducks.com
INVITE_ADDRESS="mapsandducks.com, www.mapsandducks.com"
```

Apply:

```bash
docker compose up -d --build
```

Caddy fetches and renews both Let's Encrypt certificates automatically
(that's why port 443 is open; HTTP redirects to HTTPS). Now:

- `https://mapsandducks.com/` → the cryptic invitation.
- `https://app.mapsandducks.com/` → the play app (QR codes and join
  links on the Run page use this origin, via `LOOM_BASE_URL`).
- `https://app.mapsandducks.com/edit/` → the editor.

### 5d. Optional: `www.`

If you want `www.mapsandducks.com` to work too, add an A record for
`www` and this block at the bottom of `deploy/Caddyfile`, then
`docker compose up -d --build`:

```
www.mapsandducks.com {
	redir https://mapsandducks.com{uri} permanent
}
```

## 5½. The invitation page (the puzzle)

The apex-domain site lives in [`invite/`](../invite): a fake
GeoCities-era homepage ("THE WEBMASTER'S HOME PAGE" — a man who has
been mapping the internet since 1997 and can't log off) in full
clip-art chaos — animated water background, fire borders, a Win95-style
MIDI player that genuinely plays (WebAudio, on click), spinning skulls,
flying toast, and a "SITES I HAVE MAPPED" list of **real, working
links** to surviving web-1.0 sites (info.cern.ch, zombo.com, the 1996
Space Jam page, arngren.net, cameronsworld.net, wiby.me) acting as
decoys. Under the noise hides a real cipher puzzle. Solving it is
deliberately **not persisted** — the reveal shows once, and the next
page load starts back at the homepage. **Spoilers, for the host
only:**

1. The guestbook entry signed **"B. de V. — 1586"** is a Vigenère
   cipher (Blaise de Vigenère published it in 1586 — that's the
   googleable hook).
2. The key is the acrostic of the **THINGS I ♥** list ("first things
   first"): **M**odems, **O**regon Trail, **D**oom II, **E**ncarta 95,
   **M**IDI files → `MODEM`. A classic view-source HTML comment nudges
   both steps.
3. Decrypting yields *"THE MEMBERS DOOR OPENS TO THE WORD DIALTONE"* —
   typing `DIALTONE` (any casing/spacing) into the MEMBERS ONLY box
   reveals the actual invite: the party name, and the link to
   `app.mapsandducks.com`.

The invite content is **AES-encrypted inside the bundle** (the typed
word is the decryption key), so reading the page's JavaScript doesn't
skip the puzzle — the party name and app URL literally are not in the
shipped files. To change the party details, the passphrase, or the
cipher text, edit `invite/scripts/payload.json` (and the constants at
the top of `invite/scripts/seal.mjs`), then:

```bash
node invite/scripts/seal.mjs DIALTONE invite/scripts/payload.json
```

It rewrites `invite/src/sealed.ts`, prints the matching guestbook
ciphertext (paste into `App.tsx` if you changed the plaintext/key),
and warns if the two halves of the puzzle ever drift apart.

Preview locally with `pnpm --filter loom-invite dev`, then ship like
any other update (rsync + `docker compose up -d --build`). One
constraint: the decrypt uses the browser's Web Crypto API, which only
exists on **https or localhost** — another reason the domain + TLS
setup above matters.

---

## 5¾. Show hardware: terminals + the reinstallation games

Nothing to configure — the `loom` image already serves the wall
terminals at `/terminal/` and the web reinstallation game at
`/reinstall/` (the house map editor at `/reinstall/map`); the design
contract is [`loom-reinstall.md`](./loom-reinstall.md). Every device is
provisioned with the event's **moderator passcode** by a link, e.g.

```
https://app.mapsandducks.com/reinstall/?code=<mod passcode>&name=Tent tablet
https://app.mapsandducks.com/terminal/?code=<mod passcode>&name=Kitchen&character=Trabolta&spot=start-bar&view=auto
```

(the map page offers each terminal's link from its row). The house map
the games and terminals share **belongs to the project**: its
`house.json` (and any `house.<variant>.json`, e.g. the rain plan's
`house.shed.json`) are project files, pushed by `scripts/sync-show.sh`
with the story and snapshotted when the event launches; a reload (Push
draft) refreshes them, End → relaunch plays the project's current map.
The map page's variant buttons switch the live map (mid-show too), **Save
to project** writes the event's map back into the project, **Download
JSON** gives you the file to commit. Order: a director's save from
`/reinstall/map` (stored per event in the `loom-state` volume — the
default event, the one the env passcodes open, at
`/data/spatial-house.json`, every other event at
`/data/<eventId>/spatial-house.json`) > the project's active variant >
the show file. **`LOOM_HOUSE` is now only the fallback** — for the LAN
default event and old events with no map snapshot — and defaults to the
`core/examples/trapped-in-the-internet/house.json` baked into the image.
To pin a different fallback, mount it read-only **outside the state
volume** and set `LOOM_HOUSE` on the `loom` service (`docker-compose.yml`
has both lines commented); mount the **directory**, so its
`house.<variant>.json` siblings become that event's variants, e.g.

```yaml
    volumes:
      - ./show-map:/config:ro       # house.json + house.shed.json (ship.sh never deletes it)
    environment:
      LOOM_HOUSE: /config/house.json
```

The server re-reads that file whenever it changes (its mtime): an event
still running on the show map picks up the edit and the games and
terminals refetch it; a half-written or invalid file is logged and the
last good map keeps serving. An event a director has saved a map for
keeps its own save, and an event on a project snapshot never follows the
file. Never point `LOOM_HOUSE` at a `spatial-house.json`
inside `/data` — that is an event's own save file, and the show map and
that save would become one file.

**The facts judge's key** rides the same way. The show's `facts.json` (the
hunt questions and answers, the scannable facts, the truth-or-dare
questions — the one file the team edits; `pnpm --filter @loom/core
titi:facts` writes `generated/questions.loom`, `codex/9-facts.loom` and
the print stacks from it, and `titi:facts --check` is a predeploy gate) is
a **project file** beside `house.json`: `scripts/sync-show.sh` pushes it,
a launch snapshots it (on the event row and in the state volume as
`project-facts.json`), a reload refreshes it, and that copy is the key the
server judges every 📝 filing against (`Night.judge_mode` `auto` /
`review`). `LOOM_FACTS` is only the fallback for an event with no project
copy (the LAN default event): default `facts.json` beside the house map
(`LOOM_HOUSE`'s directory, else the show's in the image); point it at a
mounted file the same way as `LOOM_HOUSE` if you ever need to.

**Deploy order (Wave 4).** Ship the server **before** the first
`sync-show` that carries `facts.json` or the maps with the King: an older
server has no judge (every filing lands in `# hosts` as "could not be
judged") and its `validateHouse` refuses a map with a `kind: "king"` prop
or a `guard` door, so the sync would stop before writing. Then remove any
stale kokoro container (*The voice* below) and any `spatial-house.json`
left from a pre-Wave-2 save.

**Deploy order (Wave 8).** A Wave 8 server closes a paid, denied or
cancelled request in **both** parties' threads, so a journal an older
server wrote that holds one replays one extra wallet card. Restart every
non-ended event (Run → ↺ *Restart this draft*, or a `sync-show` reload)
before a guest uses it. **Rolling back** a Wave 8 server (`rollback.sh`)
on a journal it wrote is not clean either: an older server doesn't know
the journaled director broadcast, so those alerts vanish and every later
message shifts its seq (a hidden message comes back, answered cards are
asked again). Restart the story before guests, after a rollback too.

**Deploy order (Wave 9).** Ship the server first (`w9-1018`; the
rollback is `w8-1018`), then `sync-show` and **let it reload**: wave 9's
story refuses presses wave 8 accepted (📺 after one 📋, 🕚 as a
shortcut, 📓 / ⏳ / 🏓 / 🤖 out of turn), so a wave 8 journal replayed
against the wave 9 text diverges. The reload restarts the show's event
fresh on the new text; never sync this one with `--no-reload`, and
restart any other non-ended event before a guest uses it if it gets the
new text. The server alone changes no journal: it writes the same ops,
and an old journal replays the same story with only the wallet cards
reworded (same cards, same seqs). Rolling back to `w8-1018` is clean
for the same reason (the wallet cards go back to the old wording, and
G11's first press ticks again). Then restart the house Mac's stagehand
`show` job (`uv run stagehand launchd restart --job show`: new catch-up rules
in `trapped.house.yaml`), sideload the new Quest APK only after the
server is up (it reads the found reply's `captured`), and reload every
terminal and the tent tablet. The maps are unchanged: no
`--replace-maps`.

The **VR game** (`reinstall/vr/`, Godot, Quest 3) is not in any image:
export it to the headsets from a laptop (`reinstall/vr/README.md`) and
point each headset's `station.json` at the public URL + the moderator
passcode. Poses stream at 10 Hz per player, so a headset on a weak
venue uplink is the first thing to check if ghosts stutter on the
terminals.

The pass scanners (terminal + tent tablet) need the camera, which
browsers only grant on **https or localhost** — on a plain-HTTP IP
address they fall back to typing the guest's name.

### The voice

**The terminals and the TV speak with the devices' own voices** (decision
2026-10-15): each tablet's `speechSynthesis`, Fully Kiosk's text-to-speech
on the old Android tablets, the macOS voices on the house Mac's Chrome
(`terminal/README.md` → *The voice*, `docs/trapped/kiosk.md`). The house
speakers' announcements use the Mac's `say` (`scripts/house-macbook/audio.md`).
**Nothing to deploy, and nothing on the night depends on the VPS for a
voice.** A plain `docker compose up -d` does not start Kokoro, and
`LOOM_TTS_URL` defaults to `off` — `/api/mod/tts` answers 503 and any
terminal still set to the server voice latches to its own at once.

**One-time cleanup — a VPS that already runs Kokoro** (deployed before
2026-10-15, when it was bundled and on by default). After pulling this
change, Kokoro's container keeps running (and holding ~2 GB of RAM) until
you remove it. On the VPS, in the checkout:

```bash
grep -n '^LOOM_TTS_URL\|^COMPOSE_PROFILES' .env   # blank / off = no server voice (good)
docker compose rm -sf kokoro                       # stop + remove the container
#   (equivalently: docker compose stop kokoro && docker compose rm -f kokoro)
docker compose up -d --remove-orphans              # the stack without it
docker compose ps                                  # db, loom, caddy — no kokoro
docker image rm ghcr.io/remsky/kokoro-fastapi-cpu:v0.9.0   # optional: the ~2 GB image
```

If `.env` says `LOOM_TTS_URL=http://kokoro:8880/v1`, set it to `off` (or
delete the line) first, then `docker compose up -d loom`.

**Opting in** (one consistent neural voice on every terminal — optional):

1. In `.env`: `COMPOSE_PROFILES=tts` (so `docker compose up`, and
   `deploy/release.sh` / `rollback.sh`, include the `kokoro` service) and
   `LOOM_TTS_URL=http://kokoro:8880/v1` (on the compose network — no port
   is published, so only the server can reach it). Or point
   `LOOM_TTS_URL` at a Kokoro on a laptop, or at OpenAI.
2. `docker compose up -d` (or `docker compose --profile tts up -d kokoro loom`).
3. On each terminal: ⚙ → voice → *the server's voice*, or provision with
   `&engine=server`.

The rest of this section only applies to the opt-in.

**The CPU cap.** Kokoro serves one synthesis at a time and will take
every core it can see. `cpus: ${KOKORO_CPUS}` caps it so a burst of
lines can never starve the event server, Postgres or Caddy: set
`KOKORO_CPUS` in `.env` to **the VPS's cores minus one** (`nproc` on the
VPS tells you; the default is `1`, safe on any 2-core box; Docker
refuses a value above the core count).

- **RAM headroom.** Kokoro CPU holds ~1.5–2 GB resident. Run `free -h` on
  the VPS: with Postgres, the event server and Caddy up, `available` should
  stay above ~2.5 GB, or don't opt in.
- **The image** (checked 2026-10-15, without pulling): the pinned
  `ghcr.io/remsky/kokoro-fastapi-cpu:v0.9.0` exists for linux/amd64 and
  arm64, and its `PATH` has `/app/.venv/bin` + `/usr/local/bin` (a Python
  3.12 base), so the healthcheck's `python` resolves. Re-check after bumping
  `KOKORO_IMAGE`: `docker buildx imagetools inspect <image>`.

The first start pulls a ~2 GB image and warms the model (a minute);
`docker compose ps` shows it `healthy` when ready. The server never
waits for it — while it is down `/api/mod/tts` answers 502 and the
terminals latch to their own voices.

**Acceptance (OCT31 K-19, opt-in only).** With the stack up, run from your Mac:

```bash
MOD_CODE=<mod passcode> scripts/accept/K-19.sh
```

With the server voice off (the default) it prints `SKIP` and exits 0.
Opted in, it opens 50 SSE streams on the event, then synthesises 3 fresh
sentences at once (twice), and passes if **every sentence lands in < 2 s**.
On a miss, raise `KOKORO_CPUS` if the VPS has the cores; otherwise drop
the opt-in.

---

## 6. Day-2 operations

**Ship an update** (after editing code locally):

```bash
# on your Mac: re-run the same rsync from step 2 (or git push + pull)
# on the VPS:
cd ~/loom && docker compose up -d --build
```

For the show, ship pinned releases instead (`scripts/ops/ship.sh`, see
*Pinned releases, rollback, backups* below).

Restarts are safe mid-event: live state is an append-only journal that
replays on boot, so the room recovers where it was (the TV-voice mute
too). While loom is down Caddy holds each request and re-dials every
250 ms for up to 60 s (`lb_try_duration` in `deploy/Caddyfile`; a
late-night replay of a full show journal takes about 31 s) instead of
answering 502, which would close an open phone's stream for good. Allow about a second per 1,500 journal lines (a 4,000-line night
≈ 4–7 s, 13,000 lines ≈ 9–12 s) before phones reconnect. Two things
don't carry over: a program mid-walk in the reinstallation game is
scanned again at the tent (found ducks stay found), and a DM to an
agent-voiced character older than ten story-minutes isn't asked again.

**Push the show's story to the preview** (from your Mac, after a merge):

```bash
LOOM_SSH=ubuntu@app.mapsandducks.com scripts/sync-show.sh
# options (env): LOOM_PROJECT="Untitled Project"  LOOM_VPS_DIR=loom
#   LOOM_SERVER=https://app.mapsandducks.com  LOOM_EXAMPLE=trapped-in-the-internet
# --no-reload saves the files + snapshot without restarting the event
#   (and folds them into any open editor tabs, POST /e/:id/api/mod/resync);
# --dry-run prints the plan; --i-know-this-is-live (or
#   LOOM_I_KNOW_THIS_IS_LIVE=1) reloads a live show anyway.
```

It tunnels to the VPS's Postgres container over SSH (the db publishes no
port; the password is read from the VPS's `.env`), runs
`core/scripts/sync-example.ts` through the tunnel, and reloads the running
event over `https://app…` — a real cut, every guest re-joins, so **never
after doors**. It guards that itself: on a **live** event with a real
guest on its roster (anyone but a director's persona), or a live event
whose roster it can't read, it writes the
project's files, leaves the event alone (snapshot untouched, no reload,
with or without `--no-reload`) and exits **3** — *sync-show: the event
is LIVE with real guests (or its roster can't be read) — files written,
event snapshot untouched, NOT reloaded (exit 3)*. Use Run's *Push draft*
(typed confirm) instead, or re-run with `--i-know-this-is-live`
(`LOOM_I_KNOW_THIS_IS_LIVE=1` where a flag can't reach: `pnpm dev
--sync`, `pnpm sync-example`). `pnpm sync-example` keeps exit 3; `pnpm
dev --sync` prints a yellow *[sync] the event is LIVE …* line and keeps
the dev stack running. A preview is never guarded. Open editor tabs
follow a sync that reloads the event or runs with `--no-reload`: a file
it rewrote replaces the open copy for every co-writer, even one with
unsaved edits in it (those are dropped, with a log line); the other
files keep theirs. A sync the guard stopped (exit 3) calls neither, so
open tabs keep the pre-sync text until someone types there: that edit
is dropped (logged) and the synced text folds in. That is the show-night
case, so close and reopen the synced files before typing. It carries `facts.json` and the house maps with the
story, so a server that predates them must be shipped **first** (§5¾
*Deploy order*). `scripts/accept/k01.sh` (needs `LOOM_MOD_CODE`) checks the
three front doors, that `/api/mod/codes` hands out the `LOOM_BASE_URL`
origin, and that the SSE feed's 25 s pings arrive on time and uncompressed
(the Caddyfile compresses everything *except* `*/events` and `*/stream`).

**Load test** (OCT31 K-32, on a **rehearsal** event — it adds 45 bot
personas and refuses an event with real guests):

```bash
node --no-warnings scripts/accept/k32-load.ts --code <rehearsal MOD code> --out k32.json --reset-after
```

It drives 45 guest streams, 9 booths, 6 terminals and 2 director consoles
and passes on participant step-latency p95 < 1 s and mean server CPU
< 70 % of one core (read from `GET /api/mod/metrics`).

**Look at logs:**

```bash
docker compose logs -f loom      # the event server (Ctrl+C to stop following)
docker compose logs -f caddy     # web/TLS front door
```

**Stop / start everything:**

```bash
docker compose down              # stop (volumes/data are kept)
docker compose up -d             # start again
```

**Back up** the two things that matter:

```bash
mkdir -p ~/loom-backups
# author accounts + projects (Postgres):
docker compose exec db pg_dump -U loom loom > ~/loom-backups/loom-db-$(date +%F).sql
# live event journals (the loom-state volume):
docker run --rm -v loom_loom-state:/data -v ~/loom-backups:/backup alpine \
  tar czf /backup/loom-state-$(date +%F).tgz -C /data .
```

They go to `~/loom-backups`, outside the checkout, where no rsync can
touch them. Copy them off the VPS (`scp ubuntu@YOUR_VPS_IP:~/loom-backups/loom-db-*.sql .`). For the show, use `deploy/backup.sh` instead (below): it stamps, checksums and prunes, into the same directory.

### Pinned releases, rollback, backups (the show scripts)

For the show, deploys go through scripts instead of a bare
`docker compose up -d --build`, so every deploy is a **pinned tag** with
the previous one kept for a one-command rollback. Two places run them:
your Mac (`scripts/ops/`) and the VPS checkout (`deploy/`). `ssh` from the
Mac to the VPS must work without a prompt; set `LOOM_VPS`
(default `ubuntu@app.mapsandducks.com`) and `LOOM_VPS_DIR` (default
`loom`) in `~/.config/loom/ops.env` if yours differ.

| Where | Command | What it does |
|---|---|---|
| Mac | `scripts/ops/predeploy.sh` | Clean tree, `loomcheck --smoke` on the show, `titi:facts --check` (the generated hunt files match `facts.json`), `pnpm -r typecheck` + `test`, stagehand `pytest`, the ops-script tests, compose parses → stamps the commit |
| Mac | `scripts/ops/ship.sh show-1031` | Refuses an unstamped commit, rsyncs (never anything git-ignored: `secrets.h`, `reinstall/vr/build/`, `*.local.yaml`, `.env`; and its `--delete` never removes an operator's `.env*`, `show-map/`, `docker-compose.override.y*ml`, `loom-db-*` / `loom-state-*` / `*.sql*` / `*.tgz` / `*.bak*` at the checkout's top), then runs `deploy/release.sh show-1031 --commit <sha>` on the VPS. `--sync-only` stops after the rsync |
| VPS | `deploy/release.sh <tag>` | Pre-release backup → build `loom-server:<tag>` + `loom-proxy:<tag>` → `LOOM_TAG=<tag>` in `.env` → `up -d` → waits for the healthcheck + the public `/api/health` (200 = up, and with a database the control plane + every live event are back) → `~/loom-ops/releases.log`. Never rebuilds an existing tag. The **first** release on a box (empty log) first adopts what runs now as `pre-<tag>`, so the very first scripted release already has a rollback target (`--no-adopt` skips it) |
| VPS | `deploy/release.sh --adopt <tag>` | Tags what runs **now** by hand, no rebuild (the first release does this for you) |
| VPS | `deploy/release.sh --list` | Running tag, the release log, the kept images |
| VPS | `deploy/release.sh --check-env` | The night's `.env` knobs (`LOOM_RL_*` throttles, the VAPID pair, an `https://` `LOOM_BASE_URL`): warnings, or `env: the night's knobs are set ✔` |
| VPS | `deploy/rollback.sh [tag]` | Back to the previous tag (or a named one), no build: a container restart. Twice in a row toggles back. A release that failed its health check is never picked |
| VPS | `deploy/backup.sh --label nightly` | `pg_dump` + a tar of the state volume + a `.sha256`, UTC-stamped, in `~/loom-backups` (14 days kept) |
| VPS | `deploy/restore.sh …` | Restores a pair into a compose project (below) |
| House Mac | `scripts/ops/showbackup.sh install` | Show night: every 10 min from 19:00 to 03:00, a fresh `--label show` backup copied to `~/LoomBackups` and verified; `status` shows the newest copy's age (⚠ STALE after 15 min — check it each act); `uninstall` after the show. The house Mac is the TV computer, so a failure is only logged: no banner unless `LOOM_NOTIFY=1`, no sound unless `LOOM_NOTIFY_SOUND=<name>` (set them before `install`). ssh keepalives end a copy whose connection died within ~60 s |
| Any | `scripts/ops/checklist.sh [--probe]` | Prints the OCT31 §11 pre-show checklist as tick boxes; `--probe` heads it with what the public `/api/health` answers right now |

Once you use `release.sh`, don't run `docker compose up -d --build` by
hand: it would rebuild the pinned tag in place and wipe the rollback
target. A plain `docker compose up -d` (or a reboot) is fine; it stays on
`.env`'s `LOOM_TAG`.

**Nightly backup cron** (on the VPS, `crontab -e`). Ubuntu's cron ignores
`CRON_TZ` and runs on the system clock, so check the VPS is on UTC
(`timedatectl` → `Time zone: Etc/UTC`, or `sudo timedatectl set-timezone
UTC`) and the 02:00 DST change on Nov 1 can't move it. Backups are written
owner-only (`umask 077`): they hold guest tokens and the DB dump.

```
17 9 * * * cd ~/loom && deploy/backup.sh --label nightly >> ~/loom-backups/backup.log 2>&1
```

**Show-night copies.** Last night's backup predates every registration of
the night, so on the night the copy that matters is the newest 10-min one
on the house Mac. `--label show` leaves out `pictures/` (a re-fetchable
image cache) to keep 48 copies a night light.

**Restore drill** (rehearse once before the show). On the VPS, a scratch
project gets its own volumes and starts only `db` + `loom`, with no Caddy
and no port clash, on the image the live stack runs, and with **Web Push
off** (the VAPID keys blanked for the drill: the restored `push.json`
holds the real phones' subscriptions, and the drill's own timers would
otherwise notify them; `--live` keeps push):

```bash
deploy/restore.sh --latest nightly --project loom-drill --check --yes
docker compose -p loom-drill down -v          # tear the drill down
```

`--check` proves the restore: for each event whose state has guest
tokens, the first token still reads that guest's own view. From the house
Mac, `scripts/accept/K-08.sh` runs the whole acceptance: a show copy, the
drill, the rollback timing (it asks first) and the 10-min job's count.

**The host is dead** (show night). Start the warm standby (built 10-30
from a provider snapshot, images pulled, `.env` + Caddy volume in place,
left stopped). Copy the newest pair from `~/LoomBackups` on the house Mac
to `~/loom-backups/` on the standby, then run:

```bash
cd ~/loom && deploy/restore.sh --project loom --live \
  --db ~/loom-backups/loom-db-show-<stamp>.sql.gz \
  --state ~/loom-backups/loom-state-show-<stamp>.tgz --yes
docker compose up -d                          # brings Caddy back too
```

Then point the A records (`app.` + the apex) at the standby. Keep the TTL
at 300 s in the week before the show. The restore keeps guest tokens and
journals, so phones reconnect on their own.

**Uptime alerts** are not scripted. Point an external checker (e.g.
UptimeRobot, free tier) at `https://app.mapsandducks.com/api/health` every
minute (alert on anything but 200 — not on `/`, which a loom with its
control plane off still serves), and send its alerts to the tech op and
the second director, not only John.

**`/api/health`** (no auth, never throttled) answers
`200 {"ok":true,"controlPlane":true,"events":N}` once the server is up and,
with a database, its control plane is on and the boot rehydrate of every
live event has finished; until then `503 {"ok":false,"reason":"database"}`
(still retrying Postgres) or `{"reason":"starting"}`. Two more reasons
stay 503 until someone acts: `config` (the server refused the dev
`BETTER_AUTH_SECRET` on a deployment) and `events` with `failed: [ids]`
(a live event whose state would not load; that event answers `503
{"error":"event failed to load"}` with `retry-after: 5`, and the log
says `⚠️ could not rehydrate event <id>`). Alert on any 503; don't match
on the reason. On a LAN box with no database it stays 200 and lists
`failed` in the body. The compose
healthcheck, `release.sh`, `rollback.sh` and `checklist.sh --probe` all
read it. While it says `starting`, phones asking for an event that is not
back yet get `503 {"error":"starting"}` with `retry-after: 1`, not
"unknown event". An image older than the route (a rollback target)
answers 404 there; the healthcheck and `rollback.sh` then accept its play
shell at `/`.

**Reset the database** (nuclear — deletes all accounts/projects):
`docker compose down`, `docker volume rm loom_pgdata`, `docker compose up -d`.

---

## 7. Troubleshooting

- **Share invites aren't arriving** — check `docker compose logs loom`
  for `mail: failed to send`; the boot line `✉️  no mail transport` means
  neither `LOOM_SMTP_URL` nor `LOOM_RESEND_API_KEY` is set. Until it is,
  the Share dialog shows the link to send yourself.
- **`docker compose` says a variable is required** — `.env` is missing
  or has an empty value; every line in `.env.example` must be filled.
- **Editor loads but signing up fails** — check
  `docker compose logs loom` for a migration/DB error, and that
  `LOOM_BASE_URL` exactly matches what's in the address bar (scheme
  included). A mismatch breaks the auth cookie.
- **`loom` stays `unhealthy` / `/api/health` answers 503 `database`, the
  log says `control plane disabled — database unreachable` or `waiting for
  the database`** — Postgres isn't answering: `docker compose ps db`,
  `docker compose logs db`. The entrypoint waits 60 s for it
  (`LOOM_DB_WAIT`, whole seconds), then exits so the restart policy
  tries again; the server keeps retrying too (1 s doubling to 15 s,
  `⏳ database not ready — retrying in N s …`) and brings every live
  event back once the database answers (`✅ database reachable after N
  retries — control plane up`) — no second restart needed.
  `LOOM_DB_WAIT=off` (or `0`) means one probe and no wait: the
  entrypoint still exits while the database is down, and a server
  started without the entrypoint keeps its control plane off. A scratch server pointed at a dead `DATABASE_URL` needs
  `LOOM_DB_WAIT=off`, or it retries forever: `/api/health` answers 503
  `database`, and an unknown `/e/<id>` or a code `resolve-code` doesn't
  know answers 503 `starting`. The LAN default event still plays.
- **The log says `the database refused the credentials — check
  POSTGRES_PASSWORD in .env (28P01 …)` or `no such database (3D000 …)`**
  — Postgres answers but won't let loom in, which no restart fixes, so the
  entrypoint doesn't wait: it starts loom with the control plane off
  (`/api/health` answers 503 `database`). Usually `POSTGRES_PASSWORD` was
  edited in `.env` after the `pgdata` volume was created — Postgres keeps
  the password it was first booted with. Put the old value back (or
  `ALTER USER loom PASSWORD '…'` inside `docker compose exec db psql -U
  loom`), then `docker compose up -d loom`.
- **Site unreachable** — `docker compose ps` (is caddy up?), then
  `sudo ufw status` (80/443 open?), then the OVH panel firewall.
- **HTTPS won't issue** — the A record must already point at the VPS
  and port 80 must be reachable from the internet (Let's Encrypt
  validates over it).
- **A terminal says nothing / shows "no voice on this device — text only"**
  — that tablet has no usable voice: in Fully Kiosk enable *JavaScript
  Interface* and install Android's TTS voice data (`docs/trapped/kiosk.md`);
  ⚙ → TEST VOICE names what speaks. Not a server problem: the voices are
  the devices' own.
- **`/api/mod/tts` answers 503** — expected: the server voice is off by
  default. Only with the opt-in (§5¾): 502 = Kokoro is down —
  `docker compose ps kokoro` (still starting? `unhealthy`?),
  `docker compose logs kokoro`; the terminals have already latched to
  their own voices.
- **`/reinstall/` or `/terminal/` answers 404** — the image predates
  them; rebuild (`docker compose up -d --build`). The image serves them
  from `LOOM_TERMINAL_DIST` / `LOOM_REINSTALL_DIST` (set in the
  `Dockerfile`).
- **A saved house map was refused** — the map editor shows the
  validator's problems. `docker compose logs loom` shows `⚠️ … house
  map …` lines for an invalid saved map (the show's map is used instead)
  and for a room whose `location` names no `LOCATION` in the story. A
  map refused for its `kind: "king"` prop or a door's `guard` means the
  running server predates Wave 4 — ship it first (§5¾ *Deploy order*).
- **📝 filings all land in `# hosts` as "could not be judged"** — the event
  has no facts key: the project's `facts.json` was never synced (run
  `scripts/sync-show.sh`, then Push draft), or the server predates the
  judge. `docker compose logs loom` shows `⚠️ … facts …` for an invalid
  key.
- **Phones at the door get "too many requests" (429)** — the per-IP
  throttles: the whole house Wi-Fi is one IP. Raise `LOOM_RL_RESOLVE` /
  `LOOM_RL_REGISTER` / `LOOM_RL_LOGIN_FAILURES` (see §3 *Show settings*)
  and `docker compose up -d loom`.
- **No push notifications / no 🔔 card** — `LOOM_VAPID_*` blank or invalid
  (the boot log says `push disabled`). Push reaches Android and booths;
  iPhones get it only from a Home Screen install.
- **Guests can't reach it from phones** — they must use the public URL
  (`LOOM_BASE_URL`), not a LAN address; QR codes on the Run page encode the
  public URL automatically.

For the underlying server's security model, env-var reference, and
non-Docker deployment paths, see
[`loom-deployment.md`](./loom-deployment.md).
