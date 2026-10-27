#!/usr/bin/env bash
# Checks for tools/quest.sh (K-30) that need no Android toolchain: the pure
# helpers (station JSON, names, APK names, Java version parsing) and a
# --dry-run of `build` / `station`, plus the Quest preset's must-haves.
#
#   ./test/quest_sh.sh
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project="$(dirname "$here")"
q="$project/tools/quest.sh"
fails=0
checks=0
check() { # check <description> <command…>
  checks=$((checks + 1))
  if "${@:2}"; then :; else fails=$((fails + 1)); echo "  FAIL  $1" >&2; fi
}
eq() { [[ "$1" == "$2" ]] || { echo "    got:  $1" >&2; echo "    want: $2" >&2; return 1; }; }

# shellcheck disable=SC1090
QUEST_SH_SOURCE_ONLY=1 . "$q"
set +e

check "default_name vr-1" eq "$(default_name vr-1)" "Headset 1"
check "default_name vr-12" eq "$(default_name vr-12)" "Headset 12"
check "default_name other" eq "$(default_name tent)" "tent"
check "apk_name plain" eq "$(apk_name "" 0)" "reinstall-vr.apk"
check "apk_name station" eq "$(apk_name vr-2 0)" "reinstall-vr-vr-2.apk"
check "apk_name debug" eq "$(apk_name vr-2 1)" "reinstall-vr-vr-2-debug.apk"
check "valid_station vr-1" valid_station vr-1
check "valid_station refuses a slash" bash -c "! (QUEST_SH_SOURCE_ONLY=1 . '$q'; valid_station 'a/b')"
check "valid_station refuses empty" bash -c "! (QUEST_SH_SOURCE_ONLY=1 . '$q'; valid_station '')"
check "json_escape" eq "$(json_escape 'a"b\c')" 'a\"b\\c'

json="$(station_json vr-2 'Headset "2"' 'p4ss' https://app.mapsandducks.com)"
parsed="$(printf '%s' "$json" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["server"], d["code"], d["station"], d["name"], d["smooth_turn"])' 2>&1)"
check "station_json is valid JSON with every key" eq "$parsed" 'https://app.mapsandducks.com p4ss vr-2 Headset "2" False'

# The build stamp (wave 26, R8): valid JSON, the short sha, staged only.
stamp="$(build_json abc1234 2026-10-26T12:00Z | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["build"], d["at"])' 2>&1)"
check "build_json is valid JSON with the sha and time" eq "$stamp" "abc1234 2026-10-26T12:00Z"
check "build_sha names a commit" bash -c "[[ -n \"\$(QUEST_SH_SOURCE_ONLY=1 . '$q'; build_sha)\" ]]"
check "the project carries no build stamp (quest.sh writes it to the stage only)" test ! -e "$project/config/build.json"

# A fake JDK answering `java -version` like Temurin 17 and like Java 8.
fake="$(mktemp -d)"
mkdir -p "$fake/j17/bin" "$fake/j8/bin"
printf '#!/bin/sh\necho %s >&2\n' "'openjdk version \"17.0.12\" 2024-07-16'" > "$fake/j17/bin/java"
printf '#!/bin/sh\necho %s >&2\n' "'java version \"1.8.0_401\"'" > "$fake/j8/bin/java"
chmod +x "$fake/j17/bin/java" "$fake/j8/bin/java"
check "java_major 17" eq "$(java_major "$fake/j17")" "17"
check "java_major 1.8 → 8" eq "$(java_major "$fake/j8")" "8"

# Dry runs print the plan and change nothing.
out="$("$q" --dry-run station vr-1 --code 1234 2>&1)"
check "station prints the HTTPS VPS by default" bash -c "printf '%s' '$out' | grep -q '\"server\": \"https://app.mapsandducks.com\"'"
check "station needs a passcode" bash -c "! LOOM_MOD_CODE= '$q' station vr-1 >/dev/null 2>&1"
check "build --station needs a passcode" bash -c "! LOOM_MOD_CODE= '$q' --dry-run build --station vr-1 >/dev/null 2>&1"
plan="$(LOOM_MOD_CODE=1234 GODOT=/bin/echo "$q" --dry-run build --debug --station vr-1 2>&1)"
check "dry-run build exports the Quest preset in debug" bash -c "printf '%s' \"\$1\" | grep -q -- '--export-debug Quest .*reinstall-vr-vr-1-debug.apk'" _ "$plan"
check "dry-run build stages, never touching the project" bash -c "printf '%s' \"\$1\" | grep -q 'rsync -a --delete'" _ "$plan"
check "dry-run build stamps the staged copy, not the project" bash -c "printf '%s' \"\$1\" | grep -q 'stamp build .* into .*/build/stage/config/build.json'" _ "$plan"
check "dry-run build never prints the passcode" bash -c "! printf '%s' \"\$1\" | grep -q 1234" _ "$plan"
check "a non-HTTPS server warns" bash -c "LOOM_MOD_CODE=1 GODOT=/bin/echo '$q' --dry-run build --debug --station vr-1 --server http://10.0.0.2:7000 2>&1 | grep -q 'not HTTPS'"

# The preset: Meta vendor plugin on, Quest 3, arm64 only, no cleartext opt-in.
preset="$project/export_presets.cfg"
check "preset enables the Meta vendor plugin" grep -q '^xr_features/enable_meta_plugin=true' "$preset"
check "preset targets Quest 3" grep -q '^meta_xr_features/quest_3_support=true' "$preset"
check "preset is OpenXR" grep -q '^xr_features/xr_mode=1' "$preset"
check "preset is arm64-v8a only" bash -c "grep -q '^architectures/arm64-v8a=true' '$preset' && grep -q '^architectures/armeabi-v7a=false' '$preset'"
check "preset uses the Gradle build" grep -q '^gradle_build/use_gradle_build=true' "$preset"
check "preset asks for the microphone (the voice link)" grep -q '^permissions/record_audio=true' "$preset"
check "preset ships config/*.json" grep -q 'include_filter=.*config/\*.json' "$preset"
# Wave 33: the intro's video ships inside the APK (never streamed from the web).
check "preset ships media/*.ogv (the intro video)" grep -q 'include_filter=.*media/\*.ogv' "$preset"
check "media/reinstallation.ogv is there (Ogg)" bash -c "head -c 4 '$project/media/reinstallation.ogv' | grep -q OggS"
check "quest.sh's stage keeps media/" bash -c "! grep -q 'exclude /media' '$q'"
# Wave 26 (C10, C6): the pronunciation table ships with the APK (config/,
# never game/), and the device voice is on.
check "config/pronounce.json is there, under the shipped filter" test -f "$project/config/pronounce.json"
check "config/pronounce.json is valid JSON with words" bash -c "python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d[\"version\"] == 1 and d[\"words\"]' '$project/config/pronounce.json'"
check "project.godot turns the device voice on (text_to_speech)" bash -c "awk '/^\\[audio\\]/{a=1;next} /^\\[/{a=0} a && /^general\\/text_to_speech=true/{f=1} END{exit !f}' '$project/project.godot'"

rm -rf "$fake"
echo "quest.sh: $checks checks, $fails failures"
[[ $fails == 0 ]]
