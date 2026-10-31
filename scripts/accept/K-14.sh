#!/usr/bin/env bash
# K-14 — terminal + reinstall build compatibility (OCT31.md §5).
#
#   scripts/accept/K-14.sh            build both apps, scan the bundles, print the device check
#   scripts/accept/K-14.sh --no-build scan the existing dist/ only
#
# Desk part (automatic): both apps build with the pinned chrome87/safari14
# target and their bundles call no runtime API newer than Chrome 87 without
# a guard. Device part (≤ 10 min, printed at the end): the oldest tablet.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [[ "${1:-}" != "--no-build" ]]; then
  pnpm --filter loom-terminal build >/dev/null
  pnpm --filter loom-reinstall build >/dev/null
  pnpm --filter loom-play build >/dev/null
fi

fail=0
# Runtime APIs newer than Chrome 87 that a build target cannot transpile
# (incl. `crypto.randomUUID`, Chrome 92; `.at()` is checked just below).
# `structuredClone` is allowed only as `globalThis.structuredClone` (the
# guarded `cloneData` in @loom/house).
banned='randomUUID|Object\.hasOwn\(|\.findLast(Index)?\(|\.toSorted\(|\.toReversed\(|\.toSpliced\(|AbortSignal\.timeout|Promise\.withResolvers|Object\.groupBy|Array\.fromAsync|[^.a-zA-Z]structuredClone\('
for f in terminal/dist/assets/*.js reinstall/web/dist/assets/*.js; do
  hits=$(grep -oE "$banned" "$f" | sort | uniq -c || true)
  # Array/String `.at()` (Chrome 92). three.js's own `Ray.at(t, target)` is
  # always called as `this.at(` in its bundle, so that one is allowed.
  at=$(grep -oE '[A-Za-z_$][A-Za-z0-9_$]*\.at\(-?[0-9A-Za-z_$]' "$f" | grep -v '^this\.at(' | sort | uniq -c || true)
  hits="$hits${hits:+${at:+$'\n'}}$at"
  if [[ -n "$hits" ]]; then
    echo "FAIL $f"; echo "$hits"; fail=1
  fi
done
# Regex lookbehind (Safari 16.4): esbuild can't lower it, so it ships as a
# literal or as `new RegExp("(?<=…")`, and throws on Safari 14 / 15 when run.
for f in terminal/dist/assets/*.js reinstall/web/dist/assets/*.js play/dist/assets/*.js; do
  [[ -f "$f" ]] || continue
  if grep -qE '\(\?<[=!]' "$f"; then
    echo "FAIL $f: a regex lookbehind (Safari 16.4+)"; grep -oE '.{20}\(\?<[=!].{20}' "$f" | head -3; fail=1
  fi
done
# The wall tablets run Chrome 95 (wave 59): what a build target can't lower and
# a terminal page would die on or draw nothing with. The canvas calls first.
for f in terminal/dist/assets/*.js; do
  hits=$(grep -oE '\.roundRect\(|\.letterSpacing|\.fontKerning|createConicGradient\(' "$f" | sort | uniq -c || true)
  if [[ -n "$hits" ]]; then
    echo "FAIL $f: a canvas call newer than Chrome 95"; echo "$hits"; fail=1
  fi
done
# (The CRT's rules are left out: it runs a current Chrome on Steph's laptop.)
for f in terminal/dist/assets/*.css; do
  hits=$(sed -E 's/\.crt-stage[^{}]*\{[^}]*\}//g' "$f" | grep -oE '[0-9](dvh|svh|lvh|dvw|svw|lvw)\b|:has\(|color-mix\(|@container|@layer' | sort | uniq -c || true)
  if [[ -n "$hits" ]]; then
    echo "FAIL $f: CSS newer than Chrome 95"; echo "$hits"; fail=1
  fi
done
grep -q 'typeof globalThis.structuredClone' terminal/dist/assets/index-*.js || { echo "FAIL terminal bundle lacks the structuredClone guard"; fail=1; }
[[ $fail -eq 0 ]] && echo "OK  bundles: no unguarded post-Chrome-87 API (terminal + reinstall), no regex lookbehind (+ play)"

cat <<'STEPS'

Device check (≤ 10 min) — the oldest tablet from the K-02 tags:
  1. On the tablet: Settings → Developer options → USB debugging on; plug into a laptop;
     laptop Chrome → chrome://inspect → the tablet's page → Console.
  2. Open https://app.mapsandducks.com/terminal/ (provision with the mod code if asked).
     PASS: the idle show (screensavers, ads, popups; after the introduction the corner scan
     box with the live camera) and an empty Console (no red errors).
  3. Open https://app.mapsandducks.com/reinstall/  → the wizard loads, Console empty.
  4. On that tablet, in the Console:  !!document.createElement('canvas').getContext('webgl2')
     - true  → set a placed terminal (one with a spot) to view=world and walk a player into its
               room in the game: the simulation draws in the face pane (only while someone is there).
     - false → any view shows the face (never "SIMULATION UNAVAILABLE — RETRYING…");
               setup shows "this tablet has no WebGL2"; a mirror shows a still notice.
  Desk rehearsal of the no-WebGL2 path (no tablet needed):
     open -na "Google Chrome" --args --user-data-dir=/tmp/k14 --disable-es3-apis \
       "https://app.mapsandducks.com/terminal/"   → expect the face, view=world or not.
STEPS
exit $fail
