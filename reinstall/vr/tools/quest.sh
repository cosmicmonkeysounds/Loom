#!/usr/bin/env bash
# The Quest 3 build of the reinstallation game (K-30): toolchain check, APK
# export, sideload, per-headset station config. Everything it writes lives in
# the git-ignored `build/` (plus, once and only when you say so, the Java path
# in Godot's editor settings and a release keystore under ~/.config/loom).
#
#   tools/quest.sh setup [--yes]          check + fix the toolchain, fetch the OpenXR vendors plugin
#   tools/quest.sh build [--debug] [--station vr-1] [--name "Headset 1"] [--code PASS] [--server URL]
#                                        export build/reinstall-vr[-<station>].apk (release by default)
#   tools/quest.sh install [APK]          adb install -r + launch (the newest APK when none given)
#   tools/quest.sh provision vr-1 --code PASS [--name …] [--server …]
#                                        push user://station.json to a DEBUG build over adb
#   tools/quest.sh station vr-1 --code PASS [--name …] [--server …]
#                                        print the station.json it would bake / push
#   tools/quest.sh logs                   adb logcat, the game's lines only
#
# Global flags: --dry-run (print the commands, change nothing), --godot PATH.
# Env: GODOT, JAVA_HOME, ANDROID_HOME, LOOM_MOD_CODE (the passcode when --code
# is omitted), VENDORS_VERSION (default below).
#
# Why a staging copy: the vendors plugin is a 48 MB binary GDExtension that
# must sit in the project at export time, and a baked station.json carries
# the mod passcode. Neither belongs in git, so `build` rsyncs the project into
# build/stage/, adds both there, and exports from that copy. The working
# project (and test/run.sh) never sees them.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project="$(dirname "$here")"
build="$project/build"
stage="$build/stage"
cache="$build/cache"

PACKAGE="com.mapsandducks.reinstall"
ACTIVITY="$PACKAGE/com.godot.game.GodotApp"
PRESET="Quest"
DEFAULT_SERVER="https://app.mapsandducks.com"
VENDORS_VERSION="${VENDORS_VERSION:-5.1.0-stable}"
# sha256 of godotopenxrvendorsaddon.zip for the pinned version (checked when known).
VENDORS_SHA_5_1_0="6a838dbdf4115549e4511ebee0da9a5dcc8f9f6258d4cc2f2ee57a907a3e2911"
KEY_DIR="${LOOM_KEY_DIR:-$HOME/.config/loom}"
RELEASE_KEYSTORE="$KEY_DIR/reinstall-release.keystore"
RELEASE_ENV="$KEY_DIR/reinstall-release.env"
GODOT_CONFIG="${GODOT_CONFIG:-$HOME/Library/Application Support/Godot}"

DRY=0
YES=0
GODOT="${GODOT:-}"

say()  { echo "$*"; }
ok()   { echo "  ✔ $*"; }
bad()  { echo "  ✘ $*"; FAILS=$((FAILS + 1)); }
die()  { echo "quest: $*" >&2; exit 1; }
run()  { if [[ $DRY == 1 ]]; then printf '  $'; printf ' %q' "$@"; echo; else "$@"; fi; }

# ── pure helpers (also exercised by test/quest_sh.sh) ─────────────────────

json_escape() { # a JSON string body: backslash, quote, control chars
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"; s="${s//$'\r'/\\r}"; s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

default_name() { # vr-1 → "Headset 1"; anything else → itself
  case "$1" in
    vr-[0-9]*) printf 'Headset %s' "${1#vr-}" ;;
    *) printf '%s' "$1" ;;
  esac
}

station_json() { # station_json <station> <name> <code> <server>
  printf '{\n  "server": "%s",\n  "code": "%s",\n  "station": "%s",\n  "name": "%s"\n}\n' \
    "$(json_escape "$4")" "$(json_escape "$3")" "$(json_escape "$1")" "$(json_escape "$2")"
}

build_json() { # build_json <short sha> <UTC time> — the lobby's build stamp (config/build.json)
  printf '{\n  "build": "%s",\n  "at": "%s"\n}\n' "$(json_escape "$1")" "$(json_escape "$2")"
}

build_sha() { # the project's short commit, "+" when the tree has changes, else "unknown"
  local sha
  sha="$(git -C "$project" rev-parse --short HEAD 2>/dev/null)" || { printf 'unknown'; return 0; }
  if [[ -n "$(git -C "$project" status --porcelain -- . 2>/dev/null)" ]]; then sha="$sha+"; fi
  printf '%s' "$sha"
}

valid_station() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$ ]]; }

apk_name() { # apk_name <station|""> <debug 0|1>
  local n="reinstall-vr"
  [[ -n "$1" ]] && n="$n-$1"
  [[ "$2" == 1 ]] && n="$n-debug"
  printf '%s.apk' "$n"
}

java_major() { # java_major <java-home> → 17, 21, … (empty when not a JDK)
  local v
  v="$("$1/bin/java" -version 2>&1 | awk -F'"' '/version/ {print $2; exit}')" || return 0
  [[ -z "$v" ]] && return 0
  v="${v#1.}"
  printf '%s' "${v%%[.+-]*}"
}

# ── toolchain discovery ───────────────────────────────────────────────────

find_godot() {
  if [[ -n "$GODOT" ]]; then return; fi
  if command -v godot >/dev/null 2>&1; then GODOT="$(command -v godot)"
  elif [[ -x /Applications/Godot.app/Contents/MacOS/Godot ]]; then GODOT=/Applications/Godot.app/Contents/MacOS/Godot
  else die "no Godot found — install Godot 4.7 into /Applications or pass --godot PATH"; fi
}

godot_version() { "$GODOT" --version 2>/dev/null | head -1; }   # 4.7.1.stable.official.<hash>

find_jdk() { # prints a JDK home whose major is 17..21 (Godot 4.7's Gradle 8.11 + AGP 8.6), else nothing
  local c m
  for c in "${JAVA_HOME:-}" \
           "$(/usr/libexec/java_home -v 17 2>/dev/null || true)" \
           /Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home \
           /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
           "/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
           "$(/usr/libexec/java_home -v 21 2>/dev/null || true)"; do
    [[ -n "$c" && -x "$c/bin/java" ]] || continue
    m="$(java_major "$c")"
    if [[ -n "$m" && "$m" -ge 17 && "$m" -le 21 ]]; then printf '%s' "$c"; return 0; fi
  done
  return 0
}

find_sdk() {
  local c
  for c in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Library/Android/sdk"; do
    [[ -n "$c" && -d "$c/platform-tools" ]] && { printf '%s' "$c"; return 0; }
  done
  return 0
}

adb_bin() {
  local sdk; sdk="$(find_sdk)"
  if [[ -n "$sdk" && -x "$sdk/platform-tools/adb" ]]; then printf '%s' "$sdk/platform-tools/adb"
  elif command -v adb >/dev/null 2>&1; then command -v adb
  else die "no adb — install the Android SDK platform-tools (see the README's Quest build)"; fi
}

editor_settings() { # the editor settings file for this Godot's major.minor
  local v; v="$(godot_version)"; v="${v%%.stable*}"; v="$(printf '%s' "$v" | cut -d. -f1-2)"
  printf '%s' "$GODOT_CONFIG/editor_settings-$v.tres"
}

setting() { # setting <file> <key> → its string value
  awk -v k="$2" -F' = ' '$1 == k { v = $2; gsub(/^"|"$/, "", v); print v; exit }' "$1" 2>/dev/null
}

set_setting() { # set_setting <file> <key> <value>: replace the line, or append to [resource]
  local file="$1" key="$2" val="$3" tmp
  tmp="$(mktemp)"
  if grep -q "^$key = " "$file"; then
    awk -v k="$key" -v v="$val" -F' = ' '$1 == k { print k " = \"" v "\""; next } { print }' "$file" > "$tmp"
  else
    cat "$file" > "$tmp"; printf '%s = "%s"\n' "$key" "$val" >> "$tmp"
  fi
  run cp "$file" "$file.bak-quest"
  if [[ $DRY == 1 ]]; then echo "  (would set $key = \"$val\" in $file)"; rm -f "$tmp"; else mv "$tmp" "$file"; fi
}

confirm() { [[ $YES == 1 ]] && return 0; local a; read -r -p "  → $* [y/N] " a; [[ "$a" == y || "$a" == Y ]]; }

vendors_zip() { printf '%s' "$cache/godotopenxrvendorsaddon-$VENDORS_VERSION.zip"; }

fetch_vendors() {
  local zip; zip="$(vendors_zip)"
  [[ -f "$zip" ]] && return 0
  run mkdir -p "$cache"
  run curl -fSL --retry 3 -o "$zip.part" \
    "https://github.com/GodotVR/godot_openxr_vendors/releases/download/$VENDORS_VERSION/godotopenxrvendorsaddon.zip"
  if [[ $DRY == 0 && "$VENDORS_VERSION" == "5.1.0-stable" ]]; then
    local got; got="$(shasum -a 256 "$zip.part" | awk '{print $1}')"
    [[ "$got" == "$VENDORS_SHA_5_1_0" ]] || { rm -f "$zip.part"; die "vendors zip checksum mismatch ($got)"; }
  fi
  run mv "$zip.part" "$zip"
}

# ── setup ─────────────────────────────────────────────────────────────────

cmd_setup() {
  FAILS=0
  say "── Godot"
  find_godot
  local ver tdir es jdk sdk cur
  ver="$(godot_version)"
  case "$ver" in 4.7.*) ok "Godot $ver ($GODOT)" ;; *) bad "Godot $ver — the project is 4.7 (OpenXR vendors $VENDORS_VERSION needs ≥ 4.6)" ;; esac
  tdir="$GODOT_CONFIG/export_templates/${ver%.official*}"
  if [[ -f "$tdir/android_source.zip" && -f "$tdir/android_release.apk" ]]; then ok "export templates ($tdir)"
  else bad "export templates for ${ver%.official*} missing — editor: Editor → Manage Export Templates → Download and Install"; fi

  say "── Java (JDK 17–21)"
  jdk="$(find_jdk)"
  if [[ -n "$jdk" ]]; then ok "JDK $(java_major "$jdk") at $jdk"
  else bad "no JDK 17–21 — brew install --cask temurin@17 (or install Android Studio, whose bundled JBR works)"; fi

  say "── Android SDK"
  sdk="$(find_sdk)"
  if [[ -n "$sdk" ]]; then
    ok "SDK at $sdk"
    [[ -x "$sdk/platform-tools/adb" ]] && ok "platform-tools (adb)" || bad "platform-tools missing — sdkmanager 'platform-tools'"
    ls "$sdk/build-tools" 2>/dev/null | grep -q . && ok "build-tools $(ls "$sdk/build-tools" | tr '\n' ' ')" || bad "build-tools missing — sdkmanager 'build-tools;35.0.0'"
    ls -d "$sdk"/platforms/android-3[5-9]* >/dev/null 2>&1 && ok "platforms $(ls "$sdk/platforms" | tr '\n' ' ')" || bad "no android-35+ platform — sdkmanager 'platforms;android-36'"
    [[ -d "$sdk/cmdline-tools/latest" ]] && ok "cmdline-tools" || bad "cmdline-tools missing — Android Studio → SDK Manager → SDK Tools → Command-line Tools"
    [[ -d "$sdk/licenses" ]] && ok "SDK licences accepted" || bad "accept the licences: $sdk/cmdline-tools/latest/bin/sdkmanager --licenses"
  else
    bad "no Android SDK — install Android Studio (SDK Manager) or the command-line tools into ~/Library/Android/sdk"
  fi

  say "── Godot editor settings"
  es="$(editor_settings)"
  if [[ ! -f "$es" ]]; then
    bad "$es missing — open the Godot editor once, then re-run setup"
  else
    cur="$(setting "$es" export/android/java_sdk_path)"
    if [[ -n "$cur" && -x "$cur/bin/java" ]]; then ok "java_sdk_path = $cur"
    elif [[ -n "$jdk" ]] && confirm "set Godot's Java SDK path to $jdk?"; then set_setting "$es" export/android/java_sdk_path "$jdk"; ok "java_sdk_path = $jdk"
    else bad "java_sdk_path unset — Editor → Editor Settings → Export → Android → Java SDK Path"; fi
    cur="$(setting "$es" export/android/android_sdk_path)"
    if [[ -n "$cur" && -d "$cur/platform-tools" ]]; then ok "android_sdk_path = $cur"
    elif [[ -n "$sdk" ]] && confirm "set Godot's Android SDK path to $sdk?"; then set_setting "$es" export/android/android_sdk_path "$sdk"; ok "android_sdk_path = $sdk"
    else bad "android_sdk_path unset — Editor Settings → Export → Android → Android SDK Path"; fi
  fi

  say "── OpenXR vendors plugin ($VENDORS_VERSION)"
  fetch_vendors && ok "$(vendors_zip)"

  say "── Keystores"
  if [[ -f "$HOME/.android/debug.keystore" ]]; then ok "debug: ~/.android/debug.keystore"
  elif [[ -n "$jdk" ]]; then
    run mkdir -p "$HOME/.android"
    run "$jdk/bin/keytool" -genkeypair -keystore "$HOME/.android/debug.keystore" -storepass android -keypass android \
      -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
    ok "debug: created ~/.android/debug.keystore"
  fi
  if [[ -f "$RELEASE_KEYSTORE" && -f "$RELEASE_ENV" ]]; then ok "release: $RELEASE_KEYSTORE"
  elif [[ -n "$jdk" ]] && confirm "create a release keystore at $RELEASE_KEYSTORE (password kept in $RELEASE_ENV, mode 600)?"; then
    local pass; pass="$(head -c 512 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c1-24)"
    run mkdir -p "$KEY_DIR"; run chmod 700 "$KEY_DIR"
    run "$jdk/bin/keytool" -genkeypair -keystore "$RELEASE_KEYSTORE" -storepass "$pass" -keypass "$pass" \
      -alias reinstall -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Reinstallation,O=Maps and Ducks,C=US"
    if [[ $DRY == 0 ]]; then
      umask 077
      printf 'GODOT_ANDROID_KEYSTORE_RELEASE_PATH=%q\nGODOT_ANDROID_KEYSTORE_RELEASE_USER=reinstall\nGODOT_ANDROID_KEYSTORE_RELEASE_PASSWORD=%q\n' \
        "$RELEASE_KEYSTORE" "$pass" > "$RELEASE_ENV"
    fi
    ok "release: created $RELEASE_KEYSTORE — back it up; an update must be signed with the same key"
  else
    bad "no release keystore (only needed for release builds; --debug builds use the debug key)"
  fi

  echo
  if [[ $FAILS == 0 ]]; then say "setup: all green — next: tools/quest.sh build --station vr-1"
  else say "setup: $FAILS to fix (above)"; return 1; fi
}

# ── build ─────────────────────────────────────────────────────────────────

stage_project() { # stage_project <station> <name> <code> <server>
  run mkdir -p "$stage"
  [[ $DRY == 1 ]] || touch "$build/.gdignore"   # the outer project never imports build/
  run rsync -a --delete \
    --exclude /build/ --exclude /android/ --exclude /.godot/ --exclude /addons/ --exclude '*.import' \
    "$project/" "$stage/"
  run mkdir -p "$stage/addons"
  if [[ ! -d "$stage/addons/godotopenxrvendors" || ! -f "$stage/addons/.vendors-$VENDORS_VERSION" ]]; then
    fetch_vendors
    run rm -rf "$stage/addons/godotopenxrvendors" "$build/vendors-unzip"
    run mkdir -p "$build/vendors-unzip"
    run unzip -q -o "$(vendors_zip)" -d "$build/vendors-unzip"
    run mv "$build/vendors-unzip/asset/addons/godotopenxrvendors" "$stage/addons/godotopenxrvendors"
    run rm -rf "$build/vendors-unzip"
    [[ $DRY == 1 ]] || touch "$stage/addons/.vendors-$VENDORS_VERSION"
  fi
  if [[ -n "$1" ]]; then
    if [[ $DRY == 1 ]]; then echo "  (would bake $1 / $2 / $4 into $stage/config/station.json)"
    else station_json "$1" "$2" "$3" "$4" > "$stage/config/station.json"; fi
  fi
  # The lobby's build stamp (wave 26): the staged copy only, never the project.
  local sha when; sha="$(build_sha)"; when="$(date -u +%Y-%m-%dT%H:%MZ)"
  if [[ $DRY == 1 ]]; then echo "  (would stamp build $sha into $stage/config/build.json)"
  else build_json "$sha" "$when" > "$stage/config/build.json"; fi
}

cmd_build() {
  local debug=0 station="" name="" code="${LOOM_MOD_CODE:-}" server="$DEFAULT_SERVER"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --debug) debug=1 ;;
      --station) station="$2"; shift ;;
      --name) name="$2"; shift ;;
      --code) code="$2"; shift ;;
      --server) server="$2"; shift ;;
      *) die "build: unknown flag $1" ;;
    esac
    shift
  done
  if [[ -n "$station" ]]; then
    valid_station "$station" || die "bad station id '$station' (e.g. vr-1)"
    [[ -n "$code" ]] || die "build --station needs --code (or LOOM_MOD_CODE): the mod passcode baked in"
    [[ -n "$name" ]] || name="$(default_name "$station")"
    case "$server" in https://*) ;; *) echo "quest: warning — $server is not HTTPS; Android refuses cleartext http, so this APK will not reach it" >&2 ;; esac
  fi
  find_godot
  local jdk sdk; jdk="$(find_jdk)"; sdk="$(find_sdk)"
  [[ -n "$jdk" || $DRY == 1 ]] || die "no JDK 17–21 — run tools/quest.sh setup"
  [[ -n "$sdk" || $DRY == 1 ]] || die "no Android SDK — run tools/quest.sh setup"

  stage_project "$station" "$name" "$code" "$server"

  local out; out="$build/$(apk_name "$station" "$debug")"
  local mode="--export-release"; [[ $debug == 1 ]] && mode="--export-debug"
  local envs=(JAVA_HOME="$jdk" ANDROID_HOME="$sdk")
  if [[ $debug == 1 ]]; then
    envs+=(GODOT_ANDROID_KEYSTORE_DEBUG_PATH="${GODOT_ANDROID_KEYSTORE_DEBUG_PATH:-$HOME/.android/debug.keystore}"
           GODOT_ANDROID_KEYSTORE_DEBUG_USER="${GODOT_ANDROID_KEYSTORE_DEBUG_USER:-androiddebugkey}"
           GODOT_ANDROID_KEYSTORE_DEBUG_PASSWORD="${GODOT_ANDROID_KEYSTORE_DEBUG_PASSWORD:-android}")
  else
    if [[ -z "${GODOT_ANDROID_KEYSTORE_RELEASE_PATH:-}" ]]; then
      [[ -f "$RELEASE_ENV" || $DRY == 1 ]] || die "no release keystore — run tools/quest.sh setup, or build with --debug"
      # shellcheck disable=SC1090
      [[ -f "$RELEASE_ENV" ]] && . "$RELEASE_ENV"
    fi
    envs+=(GODOT_ANDROID_KEYSTORE_RELEASE_PATH="${GODOT_ANDROID_KEYSTORE_RELEASE_PATH:-}"
           GODOT_ANDROID_KEYSTORE_RELEASE_USER="${GODOT_ANDROID_KEYSTORE_RELEASE_USER:-}"
           GODOT_ANDROID_KEYSTORE_RELEASE_PASSWORD="${GODOT_ANDROID_KEYSTORE_RELEASE_PASSWORD:-}")
  fi
  local tpl=(); [[ -d "$stage/android/build" ]] || tpl=(--install-android-build-template)

  say "── import (registers the vendors GDExtension)"
  run env "${envs[@]}" "$GODOT" --headless --path "$stage" --import || true
  say "── export $PRESET → $out"
  run rm -f "$out"
  run env "${envs[@]}" "$GODOT" --headless --path "$stage" ${tpl[@]+"${tpl[@]}"} "$mode" "$PRESET" "$out"
  if [[ $DRY == 0 ]]; then
    [[ -f "$out" ]] || die "export produced no APK — scroll up for Godot's error (tools/quest.sh setup checks the usual suspects)"
    say "built $out ($(du -h "$out" | awk '{print $1}'))"
    [[ -n "$station" ]] && say "baked: $station · $name · $server"
  fi
  say "next: tools/quest.sh install $out"
}

newest_apk() { ls -t "$build"/reinstall-vr*.apk 2>/dev/null | head -1; }

cmd_install() {
  local apk="${1:-$(newest_apk)}" adb
  [[ -n "$apk" && ( -f "$apk" || $DRY == 1 ) ]] || die "no APK — run tools/quest.sh build first"
  adb="$(adb_bin)"
  if [[ $DRY == 0 ]]; then
    "$adb" get-state >/dev/null 2>&1 || die "no headset on adb — USB-C cable, then 'Allow USB debugging' inside the headset ($adb devices)"
  fi
  run "$adb" install -r "$apk" || {
    echo "quest: install failed; a signature mismatch (debug ↔ release) needs: $adb uninstall $PACKAGE" >&2; exit 1; }
  run "$adb" shell am start -n "$ACTIVITY"
  say "installed + launched; put the headset on: the lobby shows the station name and 'Connected to …'"
}

cmd_station() {
  local station="${1:-}"; shift || true
  local name="" code="${LOOM_MOD_CODE:-}" server="$DEFAULT_SERVER"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name) name="$2"; shift ;; --code) code="$2"; shift ;; --server) server="$2"; shift ;;
      *) die "unknown flag $1" ;;
    esac
    shift
  done
  valid_station "$station" || die "usage: tools/quest.sh $CMD vr-1 --code PASS [--name …] [--server …]"
  [[ -n "$code" ]] || die "--code (or LOOM_MOD_CODE) is required: the event's mod passcode"
  [[ -n "$name" ]] || name="$(default_name "$station")"
  STATION_OUT="$(station_json "$station" "$name" "$code" "$server")"
}

cmd_provision() {
  cmd_station "$@"
  local adb tmp; adb="$(adb_bin)"
  tmp="$build/station-push.json"
  run mkdir -p "$build"
  [[ $DRY == 1 ]] || printf '%s\n' "$STATION_OUT" > "$tmp"
  run "$adb" push "$tmp" /data/local/tmp/station.json
  run "$adb" shell run-as "$PACKAGE" sh -c "'mkdir -p files && cp /data/local/tmp/station.json files/station.json'" || {
    echo "quest: run-as failed — provision works on a --debug build only; bake a release build instead: tools/quest.sh build --station …" >&2; exit 1; }
  run "$adb" shell rm /data/local/tmp/station.json
  [[ $DRY == 1 ]] || rm -f "$tmp"
  run "$adb" shell am force-stop "$PACKAGE"
  run "$adb" shell am start -n "$ACTIVITY"
  say "provisioned $1 and restarted the game"
}

cmd_logs() { local adb; adb="$(adb_bin)"; run "$adb" logcat -s godot:V GodotOpenXR:V; }

# ── dispatch ──────────────────────────────────────────────────────────────

[[ "${QUEST_SH_SOURCE_ONLY:-}" == 1 ]] && return 0 2>/dev/null

ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --yes|-y) YES=1 ;;
    --godot) GODOT="$2"; shift ;;
    *) ARGS+=("$1") ;;
  esac
  shift
done
[[ ${#ARGS[@]} -gt 0 ]] || { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
CMD="${ARGS[0]}"
REST=("${ARGS[@]:1}")
case "$CMD" in
  setup)     cmd_setup ;;
  build)     cmd_build ${REST[@]+"${REST[@]}"} ;;
  install)   cmd_install ${REST[@]+"${REST[@]}"} ;;
  station)   cmd_station ${REST[@]+"${REST[@]}"}; printf '%s\n' "$STATION_OUT" ;;
  provision) cmd_provision ${REST[@]+"${REST[@]}"} ;;
  logs)      cmd_logs ;;
  *) die "unknown command '$CMD' (setup | build | install | provision | station | logs)" ;;
esac
