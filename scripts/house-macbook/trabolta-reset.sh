#!/usr/bin/env bash
# Put Trabolta's MacBook back in show shape: after a reboot, a `git pull`, a
# persona or mind edit, or whenever Run → Mind looks wrong. Safe to run again
# and again: each step only acts when something is off.
#
#   scripts/house-macbook/trabolta-reset.sh [--check] [--no-reset] [--no-restart]
#                                           [--persist] [--unpersist] [--config FILE]
#
#   1. Ollama's launchctl environment: OLLAMA_NUM_PARALLEL = the worker's
#      `concurrency` (wave 42) and OLLAMA_KEEP_ALIVE=-1. `launchctl setenv`
#      does not survive a reboot (2026-10-29: the MacBook rebooted mid-show-
#      prep), so a changed value quits and reopens the Ollama app.
#   2. The voice model is pulled, then loaded with the worker's own context
#      size (a load at another num_ctx would be reloaded on the first guest).
#   3. `stagehand check --only agents` must pass.
#   4. The `agents` launchd job is restarted (picks up new code, persona and
#      mind) and the script waits for the event server to see it online.
#   5. Run → Mind → Reset for Trabolta (POST /api/mod/agent/control, the
#      panel's own call), unless --no-reset.
#
#   --check      read-only: print what is off, change nothing (exit 1 if anything is)
#   --no-restart no Ollama quit/reopen and no agents restart (steps 1, 4 only report)
#   --no-reset   skip step 5 (keep the mind he has: e.g. mid-rehearsal)
#   --persist    also install a LaunchAgent that sets the two variables at login
#                and reopens Ollama, so a reboot needs no one at the keyboard
#   --unpersist  remove that LaunchAgent
#   --config     the agents YAML (default stagehand/laptop.yaml)
#
# Never mid-show without a reason: a Mind reset forgets every guest's file.
# Never prints the moderator code or the event id's secret parts.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="$ROOT/stagehand/laptop.yaml"
check=0 restart=1 reset=1 persist=0 unpersist=0
while [ $# -gt 0 ]; do
  case "$1" in
    --check) check=1 ;;
    --no-restart) restart=0 ;;
    --no-reset) reset=0 ;;
    --persist) persist=1 ;;
    --unpersist) unpersist=1 ;;
    --config) CONFIG="$2"; shift ;;
    -h|--help) sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag $1 (see --help)" >&2; exit 64 ;;
  esac
  shift
done

OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
PLIST="$HOME/Library/LaunchAgents/com.mapsandducks.ollama-env.plist"
LAUNCHCTL="${LAUNCHCTL:-launchctl}"
OPEN_APP="${OPEN_APP:-open -a Ollama}"
QUIT_APP="${QUIT_APP:-osascript -e 'quit app \"Ollama\"'}"
UV="${UV:-uv}"
off=0
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; off=1; }
die()  { printf '  ✘ %s\n' "$*" >&2; exit 1; }
step() { printf '\n── %s\n' "$*"; }

[ -f "$CONFIG" ] || die "no $CONFIG (copy stagehand/agents.example.yaml; see scripts/house-macbook/trabolta.md §3)"

# The YAML's values, read once (python ships with uv's environment).
read_cfg() {
  (cd "$ROOT/stagehand" && "$UV" run --quiet python - "$CONFIG" <<'PY'
import sys, yaml
c = yaml.safe_load(open(sys.argv[1])) or {}
s, a = c.get("server") or {}, c.get("agents") or {}
llm = a.get("llm") or {}
print(s.get("url") or "")
print(s.get("event") or "")
print(a.get("concurrency") or 1)
print(llm.get("model") or "gpt-oss:20b")
print(llm.get("num_ctx") or 32768)
print((a.get("characters") or [""])[0].split("/")[-1].split(".")[0].capitalize() or "Trabolta")
PY
  )
}
{ read -r SERVER_URL; read -r EVENT; read -r CONC; read -r MODEL; read -r NUM_CTX; read -r CHARACTER; } < <(read_cfg)
# The moderator code stays inside this process: never echoed, never on argv.
MOD_CODE="$(cd "$ROOT/stagehand" && "$UV" run --quiet python -c 'import sys,yaml;print((yaml.safe_load(open(sys.argv[1])).get("server") or {}).get("mod_passcode") or "")' "$CONFIG")"
printf 'Trabolta reset · %s · concurrency %s · model %s (ctx %s)%s\n' "${SERVER_URL:-?}" "$CONC" "$MODEL" "$NUM_CTX" "$([ $check = 1 ] && echo ' · CHECK ONLY')"

# -- 1. Ollama's environment ------------------------------------------------------------
step "1. Ollama's environment (launchctl)"
want_parallel="$CONC"
cur_parallel="$($LAUNCHCTL getenv OLLAMA_NUM_PARALLEL || true)"
cur_keep="$($LAUNCHCTL getenv OLLAMA_KEEP_ALIVE || true)"
changed=0
if [ "$cur_parallel" = "$want_parallel" ]; then ok "OLLAMA_NUM_PARALLEL=$cur_parallel"
elif [ $check = 1 ]; then warn "OLLAMA_NUM_PARALLEL is '${cur_parallel:-unset}', the worker wants $want_parallel"
else $LAUNCHCTL setenv OLLAMA_NUM_PARALLEL "$want_parallel"; changed=1; ok "OLLAMA_NUM_PARALLEL set to $want_parallel (was '${cur_parallel:-unset}')"; fi
if [ "$cur_keep" = "-1" ]; then ok "OLLAMA_KEEP_ALIVE=-1"
elif [ $check = 1 ]; then warn "OLLAMA_KEEP_ALIVE is '${cur_keep:-unset}', want -1 (the model never unloads)"
else $LAUNCHCTL setenv OLLAMA_KEEP_ALIVE -1; changed=1; ok "OLLAMA_KEEP_ALIVE set to -1 (was '${cur_keep:-unset}')"; fi

if [ $persist = 1 ] && [ $check = 0 ]; then
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<PLISTXML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.mapsandducks.ollama-env</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string><string>-c</string>
    <string>launchctl setenv OLLAMA_NUM_PARALLEL $want_parallel; launchctl setenv OLLAMA_KEEP_ALIVE -1; osascript -e 'quit app "Ollama"'; sleep 3; open -a Ollama</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLISTXML
  $LAUNCHCTL unload "$PLIST" 2>/dev/null || true
  ok "installed $PLIST (sets both at login, then reopens Ollama)"
elif [ $unpersist = 1 ] && [ $check = 0 ]; then
  $LAUNCHCTL unload "$PLIST" 2>/dev/null || true; rm -f "$PLIST"; ok "removed the login LaunchAgent"
elif [ -f "$PLIST" ]; then
  grep -q "OLLAMA_NUM_PARALLEL $want_parallel;" "$PLIST" && ok "login LaunchAgent present" || warn "the login LaunchAgent sets another OLLAMA_NUM_PARALLEL: run with --persist again"
else
  printf '  · no login LaunchAgent (after a reboot, run this script; --persist installs one)\n'
fi

ollama_up() { curl -sf -m 3 "$OLLAMA_URL/api/version" >/dev/null; }
if [ $changed = 1 ] && [ $restart = 1 ]; then
  printf '  … reopening Ollama so it reads them\n'
  eval "$QUIT_APP" >/dev/null 2>&1 || true
  sleep 3
  $OPEN_APP
  for _ in $(seq 1 60); do ollama_up && break; sleep 1; done
fi
if ollama_up; then ok "Ollama answers at $OLLAMA_URL"
else [ $check = 1 ] && warn "Ollama is not answering at $OLLAMA_URL" || die "Ollama is not answering at $OLLAMA_URL (open the app)"; fi
[ $changed = 1 ] && [ $restart = 0 ] && warn "the new values take effect only after Ollama is quit and reopened"

# -- 2. The model ----------------------------------------------------------------------
step "2. The voice model"
if curl -sf -m 5 "$OLLAMA_URL/api/tags" | grep -q "\"name\":\"$MODEL\""; then ok "$MODEL is pulled"
else [ $check = 1 ] && warn "$MODEL is not pulled (ollama pull $MODEL)" || { printf '  … pulling %s (≈13 GB, once)\n' "$MODEL"; ollama pull "$MODEL"; }; fi
loaded="$(curl -sf -m 5 "$OLLAMA_URL/api/ps" || true)"
if printf '%s' "$loaded" | grep -q "\"name\":\"$MODEL\".*\"context_length\":$NUM_CTX"; then ok "$MODEL is loaded at ctx $NUM_CTX"
elif [ $check = 1 ]; then warn "$MODEL is not loaded at ctx $NUM_CTX (the first guest would wait ~25 s)"
else
  printf '  … loading %s at ctx %s\n' "$MODEL" "$NUM_CTX"
  curl -sf -m 180 "$OLLAMA_URL/api/chat" -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":false,\"keep_alive\":-1,\"options\":{\"num_ctx\":$NUM_CTX,\"num_predict\":1}}" >/dev/null \
    && ok "$MODEL loaded" || warn "could not load $MODEL"
fi

# -- 3. The worker's own check -----------------------------------------------------------
step "3. stagehand check --only agents"
if (cd "$ROOT/stagehand" && env -u LOOM_SERVER_URL -u LOOM_EVENT_ID -u LOOM_MOD_PASSCODE -u LOOM_MOD_TOKEN "$UV" run --quiet stagehand check --config "$CONFIG" --only agents) | sed 's/^/  │ /'; then ok "config OK"
else die "stagehand check failed: fix $CONFIG before restarting the worker"; fi

# -- server helpers (python: the code and the token never reach argv or the log) ----------
# One moderator login for the whole run (the house shares one public IP and the
# login is rate-limited); the session token lives only in this process.
# stagehand's own python: it has certifi (macOS's python.org build ships no CA
# bundle, so a bare urllib fails on the VPS's certificate).
PY="$ROOT/stagehand/.venv/bin/python"
[ -x "$PY" ] || (cd "$ROOT/stagehand" && "$UV" sync --quiet)
TOKEN=""
login_once() { # in this shell, never in $( ): a subshell's token would be lost
  [ -n "$TOKEN" ] && return 0
  TOKEN="$(MOD_CODE="$MOD_CODE" SERVER_URL="$SERVER_URL" EVENT="$EVENT" "$PY" - <<'PY'
import certifi, json, os, ssl, urllib.request
TLS = ssl.create_default_context(cafile=certifi.where())
base, event = os.environ["SERVER_URL"].rstrip("/"), os.environ["EVENT"]
req = urllib.request.Request(f"{base}/e/{event}/api/mod/login", method="POST",
                             data=json.dumps({"passcode": os.environ["MOD_CODE"]}).encode(),
                             headers={"content-type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=15, context=TLS) as r:
        print(json.loads(r.read()).get("token") or "")
except Exception as e:
    import sys; print(f"login: {type(e).__name__}: {getattr(e, 'code', '') or getattr(e, 'reason', '')}", file=sys.stderr)
PY
    )" || TOKEN=""
  [ -n "$TOKEN" ]
}
api() { # api METHOD PATH [JSON] → prints the response body (after login_once)
  [ -n "$TOKEN" ] || { echo "no moderator session" >&2; return 1; }
  TOKEN="$TOKEN" SERVER_URL="$SERVER_URL" EVENT="$EVENT" "$PY" - "$1" "$2" "${3:-}" <<'PY'
import certifi, json, os, ssl, sys, urllib.error, urllib.request
TLS = ssl.create_default_context(cafile=certifi.where())
method, path, body = sys.argv[1], sys.argv[2], sys.argv[3]
base, event = os.environ["SERVER_URL"].rstrip("/"), os.environ["EVENT"]
req = urllib.request.Request(f"{base}/e/{event}{path}", method=method, data=body.encode() if body else None,
                             headers={"content-type": "application/json", "x-loom-token": os.environ["TOKEN"]})
try:
    with urllib.request.urlopen(req, timeout=15, context=TLS) as r:
        print(r.read().decode() or "{}")
except urllib.error.HTTPError as e:
    print(f"HTTP {e.code}: {e.read().decode()[:200]}", file=sys.stderr); sys.exit(1)
PY
}
worker_state() { # → "online <capacity> <depth>" or "offline"
  api GET "/api/state?role=mod" | "$PY" -c '
import json, sys
v = json.load(sys.stdin); who = sys.argv[1]
c = next((c for c in v.get("cast") or [] if c.get("id") == who), None)
q = (c or {}).get("agentQueue") or {}
print(("online" if c and c.get("online") else "offline"), q.get("capacity", "legacy"), q.get("depth", 0))' "$CHARACTER"
}

# -- 4. The agents job -------------------------------------------------------------------
step "4. The agents worker"
if [ -z "$SERVER_URL" ] || [ -z "$EVENT" ] || [ -z "$MOD_CODE" ]; then die "$CONFIG needs server.url, server.event and server.mod_passcode"; fi
login_once || die "the moderator login failed (the code in $CONFIG, or the server is down)"
if [ $check = 0 ] && [ $restart = 1 ]; then
  (cd "$ROOT/stagehand" && "$UV" run --quiet stagehand launchd restart --job agents) | sed 's/^/  │ /'
  printf '  … waiting for the event server to see him\n'
  sleep 5
fi
state="offline"
for _ in $(seq 1 24); do
  state="$(worker_state 2>/dev/null || echo offline)"
  case "$state" in online*) break ;; esac
  [ $check = 1 ] && break
  sleep 5
done
case "$state" in
  online*) set -- $state; ok "$CHARACTER's worker is online · capacity $2 · queue $3"
           [ "$2" = "$CONC" ] || warn "the server holds capacity '$2', the YAML says $CONC (an older worker, or the server is older than wave 42)" ;;
  *) [ $check = 1 ] && warn "$CHARACTER's worker is not online" || die "$CHARACTER's worker did not come online in 2 min (stagehand launchd status --job agents; ~/Library/Logs/stagehand/)" ;;
esac

# -- 5. Run → Mind → Reset -----------------------------------------------------------------
step "5. Run → Mind → Reset"
if [ $check = 1 ] || [ $reset = 0 ]; then printf '  · skipped%s\n' "$([ $reset = 0 ] && echo ' (--no-reset)')"
else
  out="$(api POST /api/mod/agent/control "{\"action\":\"reset\",\"character\":\"$CHARACTER\",\"reason\":\"trabolta-reset.sh\"}" 2>&1)" \
    && ok "reset sent ($(printf '%s' "$out" | tr -d '\n' | cut -c1-60))" \
    || warn "the reset was not delivered: $(printf '%s' "$out" | tail -1 | cut -c1-120)"
fi

printf '\n%s\n' "$([ $off = 0 ] && echo '✓ Trabolta is in show shape.' || echo '! Something above is off.')"
exit $off
