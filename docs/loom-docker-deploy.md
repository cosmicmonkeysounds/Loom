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
| `…/api/*`, `…/e/*` | The event server's API (used by both apps) |

Under the hood it's three containers, defined in the repo-root
[`docker-compose.yml`](../docker-compose.yml):

- **loom** — the `@loom/core` event server (built by the repo-root
  [`Dockerfile`](../Dockerfile), which also builds `play/dist` and
  `editor/dist` inside the image build, so you never run `pnpm` on the
  VPS).
- **caddy** — the front door: serves the invitation site on the apex
  domain and the editor at `/edit/` on the app address, proxies
  everything else to the event server, and (once you have a domain)
  handles HTTPS certificates automatically.
- **db** — Postgres, for author accounts + server-stored projects.

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
  three-container stack with one command.
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
  ~/Documents/prism-root/packages/loom/ \
  ubuntu@YOUR_VPS_IP:~/loom/
```

Notes: the trailing slashes matter (`loom/` → contents into `~/loom/`);
`--delete` makes the VPS mirror your local tree on re-runs. Re-running
this same command is how you'll ship updates later.

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

---

## 4. Launch

```bash
cd ~/loom
docker compose up -d --build
```

The first build takes a few minutes (it installs the JS workspace and
builds both web apps inside Docker). When it returns:

```bash
docker compose ps            # all three services "running", loom "healthy"
docker compose logs loom     # boot banner: passcodes + URLs
```

Then check in a browser:

- `http://YOUR_VPS_IP/` → the play app's join screen.
- `http://YOUR_VPS_IP/edit/` → the editor's sign-in gate. Create your
  author account, make a project, write, open Run (`⌘2`) to launch an
  event — guests join at the root URL with the event's code.

The default (code-less) event's three passcodes are printed in the
`loom` logs and saved in the state volume; events you launch from the
editor get their own codes on the Run page.

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
INVITE_ADDRESS=mapsandducks.com
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

## 6. Day-2 operations

**Ship an update** (after editing code locally):

```bash
# on your Mac: re-run the same rsync from step 2 (or git push + pull)
# on the VPS:
cd ~/loom && docker compose up -d --build
```

Restarts are safe mid-event: live state is an append-only journal that
replays on boot, so the room recovers where it was.

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
# author accounts + projects (Postgres):
docker compose exec db pg_dump -U loom loom > loom-db-$(date +%F).sql
# live event journals (the loom-state volume):
docker run --rm -v loom_loom-state:/data -v "$PWD":/backup alpine \
  tar czf /backup/loom-state-$(date +%F).tgz -C /data .
```

Copy those files off the VPS (`scp ubuntu@YOUR_VPS_IP:~/loom/loom-db-*.sql .`).

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
- **Site unreachable** — `docker compose ps` (is caddy up?), then
  `sudo ufw status` (80/443 open?), then the OVH panel firewall.
- **HTTPS won't issue** — the A record must already point at the VPS
  and port 80 must be reachable from the internet (Let's Encrypt
  validates over it).
- **Guests can't reach it from phones** — they must use the public URL
  (`LOOM_BASE_URL`), not a LAN address; QR codes on the Run page encode the
  public URL automatically.

For the underlying server's security model, env-var reference, and
non-Docker deployment paths, see
[`loom-deployment.md`](./loom-deployment.md).
