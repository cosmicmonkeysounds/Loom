# Deploying Loom to a VPS with Docker

A start-to-finish walkthrough for putting the Loom web stack on a fresh
Ubuntu VPS (written against OVHcloud, but any Ubuntu box works). No
prior server experience assumed — the only prerequisite is that you can
SSH into the machine.

What you end up with, all on one box behind one address:

| URL | What it serves |
|-----|----------------|
| `http://your-server/` | The **play** app — guests/performers join here |
| `http://your-server/edit/` | The **editor** — sign up, write, run + deploy events |
| `/api/*`, `/e/*` | The event server's API (used by both apps) |

Under the hood it's three containers, defined in the repo-root
[`docker-compose.yml`](../docker-compose.yml):

- **loom** — the `@loom/core` event server (built by the repo-root
  [`Dockerfile`](../Dockerfile), which also builds `play/dist` and
  `editor/dist` inside the image build, so you never run `pnpm` on the
  VPS).
- **caddy** — the front door: serves the editor at `/edit/`, proxies
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
  author account, make a project, write, hit Deploy (`⌘4`) to launch an
  event — guests join at the root URL with the event's code.

The default (code-less) event's three passcodes are printed in the
`loom` logs and saved in the state volume; events you launch from the
editor get their own codes in the Deploy panel.

---

## 5. Add a domain + HTTPS (recommended before a real event)

Author logins and event traffic should really be encrypted. You need a
domain (a cheap one is fine — you can buy it at OVH too):

1. In your DNS provider, add an **A record**: `loom.example.com` →
   `YOUR_VPS_IP`. Wait until `ping loom.example.com` resolves.
2. On the VPS, edit `.env`:
   ```
   LOOM_BASE_URL=https://loom.example.com
   SITE_ADDRESS=loom.example.com
   ```
3. Apply:
   ```bash
   docker compose up -d
   ```

Caddy fetches and renews the Let's Encrypt certificate automatically
(that's why port 443 is open). `https://loom.example.com/` now serves
the play app; `/edit/` the editor. HTTP redirects to HTTPS.

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
  (`LOOM_BASE_URL`), not a LAN address; QR codes in Deploy encode the
  public URL automatically.

For the underlying server's security model, env-var reference, and
non-Docker deployment paths, see
[`loom-deployment.md`](./loom-deployment.md).
