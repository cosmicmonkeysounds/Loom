#!/usr/bin/env bash
# N-20 bench check for the server-room door sensor
# (hardware/server-room-door, wave 20), run on the laptop the Grand Central
# M4 is plugged into, with the LED and the LDR (in its shroud) fitted across
# the real door, or a bench mock-up of it. ~10 minutes. It talks to the
# board over USB serial only: no server, no stagehand, no MQTT.
#
#   scripts/accept/N-20.sh [/dev/cu.usbmodemXXXX]   # no port: the only usbmodem
#
# It records lit / dark / level in `mod` and in `steady`, door shut and door
# open, room lights on and off; finds the settle a CdS cell needs in `mod`;
# proposes `mode`, `settle`, `close` and `open` from the worst case; offers to
# `set` + `save` them; then checks one real opening and closing.
#
# Close the Arduino IDE's serial monitor and the terminal page first: only
# one program can hold the port. Needs: python3 (macOS ships it), c++.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HW="$ROOT/hardware/server-room-door"
PASS=0; FAIL=0
ok()   { echo "  ✔ $*"; PASS=$((PASS+1)); }
bad()  { echo "  ✘ $*"; FAIL=$((FAIL+1)); }
step() { echo; echo "── $*"; }

step "0. preflight"
"$HW/test/run.sh" >/dev/null 2>&1 && ok "host logic tests green" || bad "hardware/server-room-door/test/run.sh failing"
command -v python3 >/dev/null && ok "python3" || { bad "python3 missing (xcode-select --install)"; exit 1; }
PORT="${1:-}"
if [ -z "$PORT" ]; then
  # shellcheck disable=SC2012
  PORTS=$(ls /dev/cu.usbmodem* 2>/dev/null || true)
  [ "$(echo "$PORTS" | grep -c .)" = 1 ] && PORT="$PORTS"
fi
[ -n "$PORT" ] && [ -e "$PORT" ] && ok "port $PORT" || { bad "no port: plug the board in, or pass it (ls /dev/cu.usbmodem*)"; exit 1; }
if lsof "$PORT" >/dev/null 2>&1; then
  bad "$PORT is held by: $(lsof -Fc "$PORT" | sed -n 's/^c//p' | sort -u | tr '\n' ' ')— close the serial monitor / the terminal page"
  exit 1
fi

# The rest is Python (termios, no pyserial), read from a variable so that
# stdin stays the terminal for the prompts.
read -r -d '' PY <<'PY'
import json, os, statistics, sys, termios, threading, time

port = sys.argv[1]
passed = failed = 0
def ok(m):
    global passed; passed += 1; print("  ✔ " + m)
def bad(m):
    global failed; failed += 1; print("  ✘ " + m)
def step(m): print("\n── " + m)
def ask(m): input("  → " + m + " [enter] ")
def yes(m): return input("  → " + m + " [y/n] ").strip().lower() == "y"

fd = os.open(port, os.O_RDWR | os.O_NOCTTY)
a = termios.tcgetattr(fd)
a[0] = 0; a[1] = 0
a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
a[3] = 0
a[4] = a[5] = termios.B115200
a[6][termios.VMIN] = 1
a[6][termios.VTIME] = 0
termios.tcsetattr(fd, termios.TCSANOW, a)
got = []  # (time, line) from a reader thread, so nothing is lost while a prompt waits
lock = threading.Lock()

def reader():
    buf = b""
    while True:
        try: chunk = os.read(fd, 4096)
        except OSError: return
        if not chunk:
            time.sleep(0.01); continue
        buf += chunk
        while b"\n" in buf:
            raw, buf = buf.split(b"\n", 1)
            try: obj = json.loads(raw.decode("ascii", "replace"))
            except ValueError: continue
            with lock: got.append((time.time(), obj))

threading.Thread(target=reader, daemon=True).start()

def since(t0):
    with lock: return [o for (t, o) in got if t >= t0]

def lines(seconds):
    """Every JSON line the board sends in the next `seconds`."""
    t0 = time.time()
    time.sleep(seconds)
    return since(t0)

def send(cmd, wait=0.6):
    t0 = time.time()
    os.write(fd, (cmd + "\n").encode())
    time.sleep(wait)
    return since(t0)

def reply(cmd, kinds, wait=0.6):
    for l in send(cmd, wait):
        if l.get("t") in kinds: return l
    return None

def doors(seconds):
    return [l for l in lines(seconds) if l.get("t") == "door"]

def sample(seconds=3.0):
    """Median lit / dark / level over `seconds` of door lines (≥ 1 frame)."""
    d = doors(seconds)
    if not d: return None
    med = lambda k: int(statistics.median(x[k] for x in d))
    return {"lit": med("lit"), "dark": med("dark"), "level": med("level"),
            "fault": next((x["fault"] for x in d if x["fault"]), None),
            "warn": next((x["warn"] for x in d if x["warn"]), None), "n": len(d)}

def fmt(s): return "—" if s is None else f"lit {s['lit']:4} dark {s['dark']:4} level {s['level']:4}"

step("1. the board answers")
lines(1.0)
h = reply("version", ("hello",), 1.5)
if h is None:
    bad("no hello in 1.5 s (wrong port? not flashed? another program on it?)"); sys.exit(1)
ok(f"{h['fw']} · mode {h['mode']} (auto {h['auto']}) · close {h['close']} open {h['open']} settle {h['settle']} · cal {h['cal']} · sense {h['sense']}")
start = reply("get", ("cfg",))
before = {k: start[k] for k in ("close", "open", "settle")} if start else None
d = doors(1.6)
ok(f"door lines every second ({len(d)} in 1.6 s)") if len(d) >= 1 else bad("no door lines")

step("2. readings: each mode × lights × door")
reply("set settle 300", ("ok", "err"))  # generous while measuring
results = {}
for mode in ("mod", "steady"):
    r = reply(f"set mode {mode}", ("ok", "err"))
    if not r or r["t"] != "ok": bad(f"set mode {mode}: {r}"); continue
    lines(1.5)
    for lights in ("on", "off"):
        ask(f"[{mode}] turn the room / hall lights {lights.upper()} (as on the night: on = the brightest it will be)")
        for door in ("shut", "open"):
            ask(f"[{mode}, lights {lights}] door {door.upper()}, hands clear of the beam")
            lines(1.5)
            s = sample(3.0)
            results[(mode, lights, door)] = s
            print(f"    {mode:6} lights {lights:3} door {door:5}: {fmt(s)}" + (f"  fault {s['fault']}" if s and s["fault"] else "") + (f"  warn {s['warn']}" if s and s["warn"] else ""))

def span(mode):
    sh = [results.get((mode, l, "shut")) for l in ("on", "off")]
    op = [results.get((mode, l, "open")) for l in ("on", "off")]
    if None in sh or None in op: return None
    return min(s["level"] for s in sh), max(s["level"] for s in op)

mod_span, steady_span = span("mod"), span("steady")
for name, sp in (("mod", mod_span), ("steady", steady_span)):
    if sp: print(f"    {name:6}: worst shut {sp[0]} · worst open {sp[1]} · margin {sp[0] - sp[1]}")
if mod_span and mod_span[0] - mod_span[1] >= 200:
    ok("mod tells shut from open in every light (the LED is on D2)")
elif mod_span:
    print("    · mod can't tell them apart: the LED isn't on D2 (or the aim / shroud is off)")
if steady_span and steady_span[0] - steady_span[1] < 200:
    print("    · steady can't tell them apart in every light: room light reaches the LDR (fit the shroud)")
if results.get(("mod", "on", "shut")) and results[("mod", "on", "shut")]["dark"] > 4000:
    bad("dark > 4000 in mod with the lights on: the cell is saturated (the fault ldr_saturated) — shroud it, or a bigger pull-down")

step("3. the settle a CdS cell needs (mod, door shut, lights on)")
settle_need = None
if mod_span and mod_span[0] - mod_span[1] >= 200:
    reply("set mode mod", ("ok",))
    ask("door SHUT, room lights ON")
    by = {}
    for st in (40, 80, 150, 300, 600):
        reply(f"set settle {st}", ("ok",))
        lines(max(1.0, 3 * st / 1000))
        s = sample(max(2.0, 6 * st / 1000))
        by[st] = s["level"] if s else 0
        print(f"    settle {st:4} ms: level {by[st]}")
    full = by[600] or 1
    settle_need = next((st for st in (40, 80, 150, 300, 600) if by[st] >= 0.9 * full), 600)
    ok(f"the cell reaches 90 % of its swing by settle {settle_need} ms")
else:
    print("    · skipped: mod isn't usable here")

step("4. proposal")
use = "mod" if (mod_span and mod_span[0] - mod_span[1] >= 200) else "steady"
sp = mod_span if use == "mod" else steady_span
if not sp or sp[0] - sp[1] < 200:
    bad(f"no mode separates shut from open by 200 in every light ({sp}) — re-aim the LED, fit the shroud, check the wiring")
    print(f"\nN-20: {passed} passed, {failed} failed."); sys.exit(1)
o, c = sp[1], sp[0]
p_open = o + round(0.35 * (c - o))
p_close = o + round(0.65 * (c - o))
p_settle = 150 if use == "steady" else min(1000, max(20, int(round((settle_need or 150) * 1.5 / 10) * 10)))
print(f"    mode {use} · settle {p_settle} · close {p_close} · open {p_open}  (shut ≥ {c}, open ≤ {o}, worst case)")
ok("a proposal with at least 200 between shut and open")

if yes("apply and save it on the board?"):
    reply(f"set mode {use}", ("ok",))
    reply(f"set settle {p_settle}", ("ok",))
    cur = reply("get", ("cfg",))
    # The order that never trips `open < close`: open first when it fits under the current close.
    pair = [f"set open {p_open}", f"set close {p_close}"] if p_open < cur["close"] else [f"set close {p_close}", f"set open {p_open}"]
    for cmd in pair:
        r = reply(cmd, ("ok", "err"))
        ok(cmd) if r and r["t"] == "ok" else bad(f"{cmd}: {r}")
    s = reply("save", ("cfg", "err"))
    if s and s["t"] == "cfg" and s["saved"]:
        ok(f"saved: mode {s['mode']} close {s['close']} open {s['open']} settle {s['settle']}")
    else:
        bad(f"save: {s}")
    print("    · the terminal re-sends its own stored thresholds on connect: enter the same values in its ⚙ (or run Calibrate there)")
else:
    print("    · not applied; put the board back as it was")
    reply("set mode auto", ("ok",))
    if before:
        cur = reply("get", ("cfg",))
        pair = [f"set open {before['open']}", f"set close {before['close']}"] if before["open"] < cur["close"] else [f"set close {before['close']}", f"set open {before['open']}"]
        for cmd in pair + [f"set settle {before['settle']}"]: reply(cmd, ("ok", "err"))

step("5. one real opening and closing")
ask("door SHUT, room lights at show level")
lines(2.0)
t0 = time.time()
ask("OPEN the door, count to three, SHUT it, then press enter")
time.sleep(3.0)  # the close lands ≈ 1 s after the door shuts
d = [l for l in since(t0) if l.get("t") == "door"]
seen = [x["open"] for x in d]
edges = [seen[i] for i in range(len(seen)) if i == 0 or seen[i] != seen[i - 1]]
if True in edges: ok("open: the board reported the opening")
else: bad(f"no open:true while the door was open ({len(d)} lines) — thresholds too low?")
if edges and edges[-1] is False: ok("shut: back to open:false (≈ 1 s after the door closed)")
else: bad("still open:true 3 s after enter — thresholds too high, or the beam misses the LDR when shut")
if any(x["fault"] for x in d): bad(f"a fault while testing: {[x['fault'] for x in d if x['fault']][0]}")

print(f"\nN-20: {passed} passed, {failed} failed.")
print("Next: the terminal page (⚙ → Connect door sensor), then Run → Terminals shows 🚪 open / shut (contract §5.3 step 7).")
sys.exit(0 if failed == 0 else 1)
PY

python3 -c "$PY" "$PORT"
RC=$?
echo "(preflight: $PASS passed, $FAIL failed)"
[ "$RC" = 0 ] && [ "$FAIL" = 0 ]
