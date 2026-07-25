#!/usr/bin/env bash
# Godot conformance: replay every scenario through the GDScript runtime and
# diff against the golden trace produced by the TypeScript reference
# interpreter. A divergence here means this runtime is wrong — the
# reference defines the semantics.
#
#   ./test/conformance.sh [path-to-godot]
#
# Godot must have imported the project once so `class_name` globals are
# registered; this script does that itself if `.godot/` is missing.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project="$(dirname "$here")"
loom="$(cd "$project/../.." && pwd)"
bank="$loom/bank"

godot="${1:-}"
if [[ -z "$godot" ]]; then
  if command -v godot >/dev/null 2>&1; then
    godot="godot"
  elif [[ -x "/Applications/Godot.app/Contents/MacOS/Godot" ]]; then
    godot="/Applications/Godot.app/Contents/MacOS/Godot"
  else
    echo "conformance: no godot binary found; pass one as \$1" >&2
    exit 2
  fi
fi

scenarios=(lighthouse arith shuffle locale)
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

# Compile each fixture fresh, so a compiler change is caught here too
# rather than only in the TypeScript suite. A `<name>.<tag>.json` next to
# a fixture is a translation file: the build also emits its locale bank,
# which the scenario loads with `loadbank`.
for name in "${scenarios[@]}"; do
  locale_flags=()
  for translations in "$bank/test/fixtures/$name".*.json; do
    [[ -f "$translations" ]] || continue
    tag="$(basename "$translations" .json)"
    tag="${tag#"$name".}"
    locale_flags+=(--locale "$tag=$translations")
  done
  (cd "$bank" && npx tsx bin/loom-bank.ts build \
    "test/fixtures/$name.loom" -o "$out" --name "$name" \
    ${locale_flags[@]+"${locale_flags[@]}"} >/dev/null)
  cp "$out/$name.loombank" "$project/test/$name.loombank"
  for extra in "$out/$name".*.loombank; do
    [[ -f "$extra" ]] && cp "$extra" "$project/test/$(basename "$extra")"
  done
  cp "$bank/test/scenarios/$name.script" "$project/test/$name.script"
done

if [[ ! -d "$project/.godot" ]]; then
  echo "conformance: importing project (first run)…"
  "$godot" --headless --path "$project" --import >/dev/null 2>&1 || true
fi

status=0
for name in "${scenarios[@]}"; do
  (cd "$bank" && npx tsx bin/loom-bank.ts trace \
    "$project/test/$name.loombank" "$project/test/$name.script" \
    -o "$out/$name.golden.jsonl")

  "$godot" --headless --path "$project" --script res://test/run.gd -- \
    --bank "test/$name.loombank" \
    --scenario "test/$name.script" \
    --out "$out/$name.godot.jsonl" >/dev/null 2>&1

  if (cd "$bank" && npx tsx bin/loom-bank.ts diff \
      "$out/$name.golden.jsonl" "$out/$name.godot.jsonl" >/dev/null); then
    lines="$(wc -l <"$out/$name.godot.jsonl" | tr -d ' ')"
    echo "  ok    $name ($lines trace lines)"
  else
    echo "  FAIL  $name"
    (cd "$bank" && npx tsx bin/loom-bank.ts diff \
      "$out/$name.golden.jsonl" "$out/$name.godot.jsonl") || true
    status=1
  fi
done

if [[ $status -eq 0 ]]; then
  echo "conformance: GDScript runtime matches the reference interpreter"
fi
exit $status
