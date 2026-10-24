# loom-invite

The party-invitation one-pager: a 1997-style homepage of a webmaster lost
in the internet, served at the apex domain (`INVITE_ADDRESS`, e.g.
`mapsandducks.com`) while the app lives on a subdomain (`SITE_ADDRESS`).
A small Vite + React 18 SPA with no server calls.

## The puzzle

The page hides a two-part puzzle. A guestbook entry is a Vigenère
cipher whose key is spelled by a list on the page; its plaintext names a
passphrase. Typing the passphrase into the MEMBERS ONLY box decrypts the
real invitation in the browser (AES-GCM, key derived from what was
typed). The plaintext invitation never ships in the bundle.

Do not write the passphrase, the key or the invitation text into docs.

## Changing the invitation

1. Edit `scripts/payload.json` (the party details), and the Vigenère
   constants at the top of `scripts/seal.mjs` if the passphrase changes.
2. Run `node scripts/seal.mjs <PASSPHRASE> scripts/payload.json`. It
   rewrites `src/sealed.ts` (salt, IV, sealed blob; do not edit by hand)
   and prints the guestbook ciphertext.
3. If the printed groups changed, paste them into `CIPHER_GROUPS` in
   `src/App.tsx`.

## Commands

```bash
pnpm --filter loom-invite dev        # Vite dev server
pnpm --filter loom-invite build      # → invite/dist
pnpm --filter loom-invite typecheck  # tsc --noEmit
```

## Deployment

The Docker `proxy` image builds it (`Dockerfile`, `pnpm --filter
loom-invite build`) and copies `invite/dist` to `/srv/invite`; Caddy
serves it on the `INVITE_ADDRESS` site (`deploy/Caddyfile`). See
[`docs/loom-docker-deploy.md`](../docs/loom-docker-deploy.md).
