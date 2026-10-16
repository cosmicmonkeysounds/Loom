#!/usr/bin/env bash
# Pre-deploy gate, run on your Mac in the repo before every VPS deploy.
#
#   scripts/ops/predeploy.sh [--allow-dirty] [--skip-tests] [--vr]
#
# Checks: a clean tree, the story (`loomcheck --smoke` on Trapped in the
# Internet, and `titi:facts --check` — the files generated from the show's
# facts.json are up to date), every TS package's typecheck + tests
# (`pnpm -r`), stagehand's pytest, the ops-script tests, and that
# docker-compose.yml still parses.
# `--vr` adds the Godot suite (needs godot on PATH). On success it stamps
# the commit, and scripts/ops/ship.sh refuses to ship any other commit.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
STAMP="${LOOM_PREDEPLOY_STAMP:-$(git rev-parse --git-dir)/loom-predeploy-ok}"
allow_dirty=0 skip_tests=0 vr=0
for a in "$@"; do
  case "$a" in
    --allow-dirty) allow_dirty=1 ;;
    --skip-tests) skip_tests=1 ;;
    --vr) vr=1 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument $a" >&2; exit 64 ;;
  esac
done

FAILED=()
run() { # run <name> <cmd…>
  local name="$1"; shift
  printf '── %s … ' "$name"
  local log; log="$(mktemp)"
  local t0=$SECONDS
  if "$@" >"$log" 2>&1; then
    echo "ok ($((SECONDS - t0)) s)"
  else
    echo "FAILED"; tail -n 30 "$log" | sed 's/^/   │ /'; FAILED+=("$name")
  fi
  rm -f "$log"
}

rm -f "$STAMP"
HEAD="$(git rev-parse HEAD)"
dirty="$(git status --porcelain)"
if [ -n "$dirty" ]; then
  if [ "$allow_dirty" = 1 ]; then echo "── tree is dirty (allowed — no stamp will be written)"
  else echo "── tree is dirty — commit first (or --allow-dirty):"; echo "$dirty" | head -n 20; exit 1; fi
fi

run "story: loomcheck --smoke" pnpm --filter @loom/core loomcheck examples/trapped-in-the-internet --smoke
run "story: facts.json → generated files" pnpm --filter @loom/core titi:facts --check
run "ops scripts" bash scripts/ops/test/run.sh
run "accept-script helpers" node --no-warnings --test scripts/accept/live-guard.test.ts scripts/accept/burst.test.ts
run "compose file parses" env POSTGRES_PASSWORD=x BETTER_AUTH_SECRET=x LOOM_BASE_URL=http://x \
  docker compose -f docker-compose.yml config -q
if [ "$skip_tests" = 0 ]; then
  run "typecheck (pnpm -r)" pnpm -r typecheck
  run "tests (pnpm -r)" pnpm -r test
  run "stagehand pytest" bash -c 'cd stagehand && uv run pytest -q'
  [ "$vr" = 1 ] && run "Godot VR suite" pnpm test:vr
fi

echo
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "✘ pre-deploy FAILED: ${FAILED[*]}"; exit 1
fi
if [ -z "$dirty" ] && [ "$skip_tests" = 0 ]; then
  echo "$HEAD" > "$STAMP"
  echo "✔ pre-deploy passed for $(git rev-parse --short HEAD) — ship it: scripts/ops/ship.sh <tag>"
else
  echo "✔ checks passed (not stamped: dirty tree or --skip-tests)"
fi
