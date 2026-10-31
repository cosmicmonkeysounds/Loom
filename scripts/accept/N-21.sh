#!/usr/bin/env bash
# N-21 bench check for the server-room patch bay (hardware/server-room-m4,
# wave 22), run on the laptop the Grand Central M4 is plugged into, with the
# panel wired to it (the live jacks: sources B8 B7 B4 B2, inputs A5 A7 A6 A4;
# the other eight are decoys) and one patch cable. ~5 minutes (~8 with the full
# walk). It talks to the board over USB serial only: no server, no stagehand,
# no terminal page. It prompts in the panel's names; the board says V1–V4 and
# D1–D4 (the table is in the firmware's config.h).
#
#   scripts/accept/N-21.sh [port]       # no port: the only usbmodem / ttyACM
#   scripts/accept/N-21.sh COM5         # Windows (Git Bash), needs pyserial
#
# It checks the empty bay reads under the floor, learns the four sources one
# cable at a time (`pb learn V<k>`), checks they climb in order and sit at least
# 2 × tol apart, walks a source through every input (or, with the full walk,
# every source through every input), prints the table of readings, checks
# each one lands within the tolerance of its source, and offers `pb save`.
# It never names a combination: which four cables matter is the story's.
#
# Close the Arduino IDE's serial monitor and the terminal page first: only
# one program can hold the port. Needs: python3 (+ pyserial on Windows:
# `py -m pip install pyserial`), c++ for the host tests.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HW="$ROOT/hardware/server-room-m4"
PASS=0; FAIL=0
ok()   { echo "  ✔ $*"; PASS=$((PASS+1)); }
bad()  { echo "  ✘ $*"; FAIL=$((FAIL+1)); }
step() { echo; echo "── $*"; }

step "0. preflight"
if command -v c++ >/dev/null; then
  "$HW/test/run.sh" >/dev/null 2>&1 && ok "host logic tests green" || bad "hardware/server-room-m4/test/run.sh failing"
else
  echo "  · no c++ here: skipping the host tests (run them on the Mac)"
fi
PY=python3
command -v "$PY" >/dev/null || PY=python
command -v "$PY" >/dev/null && ok "$PY" || { bad "python3 missing"; exit 1; }
PORT="${1:-}"
if [ -z "$PORT" ]; then
  # shellcheck disable=SC2012
  PORTS=$(ls /dev/cu.usbmodem* /dev/ttyACM* 2>/dev/null || true)
  [ "$(echo "$PORTS" | grep -c .)" = 1 ] && PORT="$PORTS"
fi
[ -n "$PORT" ] || { bad "no port: plug the board in, or pass it (macOS: ls /dev/cu.usbmodem*, Windows: Device Manager → Ports → COMx)"; exit 1; }
case "$PORT" in
  COM*|com*) ok "port $PORT" ;;
  *)
    [ -e "$PORT" ] && ok "port $PORT" || { bad "$PORT does not exist"; exit 1; }
    if command -v lsof >/dev/null && lsof "$PORT" >/dev/null 2>&1; then
      bad "$PORT is held by: $(lsof -Fc "$PORT" | sed -n 's/^c//p' | sort -u | tr '\n' ' ')— close the serial monitor / the terminal page"
      exit 1
    fi ;;
esac

# The rest is Python (pyserial when installed, else termios), read from a
# variable so that stdin stays the terminal for the prompts.
read -r -d '' SCRIPT <<'PY'
import json, os, sys, threading, time

port = sys.argv[1]
passed = failed = 0
def ok(m):
    global passed; passed += 1; print("  ✔ " + m)
def bad(m):
    global failed; failed += 1; print("  ✘ " + m)
def note(m): print("    · " + m)
def step(m): print("\n── " + m)
def ask(m): input("  → " + m + " [enter] ")
def yes(m): return input("  → " + m + " [y/n] ").strip().lower() == "y"
def done():
    print(f"\nN-21: {passed} passed, {failed} failed.")
    sys.exit(0 if failed == 0 else 1)

# ── the port ───────────────────────────────────────────────────────────────
try:
    import serial  # pyserial: Windows, or anywhere it is installed
    ser = serial.Serial(port, 115200, timeout=0.05)
    try: ser.dtr = True  # the board drops its output while no host holds DTR (pyserial's default anyway)
    except OSError: pass
    read_bytes = lambda: ser.read(4096)
    write_bytes = ser.write
except ImportError:
    if os.name == "nt":
        print("  ✘ pyserial missing: py -m pip install pyserial"); sys.exit(1)
    import termios
    fd = os.open(port, os.O_RDWR | os.O_NOCTTY)
    a = termios.tcgetattr(fd)
    a[0] = 0; a[1] = 0
    a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
    a[3] = 0
    a[4] = a[5] = termios.B115200
    a[6][termios.VMIN] = 1
    a[6][termios.VTIME] = 0
    termios.tcsetattr(fd, termios.TCSANOW, a)
    read_bytes = lambda: os.read(fd, 4096)
    write_bytes = lambda b: os.write(fd, b)

got = []  # (time, line) from a reader thread, so nothing is lost while a prompt waits
lock = threading.Lock()

def reader():
    buf = b""
    while True:
        try: chunk = read_bytes()
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
    t0 = time.time()
    time.sleep(seconds)
    return since(t0)

def send(cmd):
    write_bytes((cmd + "\n").encode())

def reply(cmd, kinds, wait=1.0):
    """The first line of a kind in `kinds` within `wait` s of sending `cmd`."""
    t0 = time.time()
    send(cmd)
    while time.time() - t0 < wait:
        for l in since(t0):
            if l.get("t") in kinds and (l.get("t") != "err" or l.get("cmd", "").startswith(cmd.split()[0])): return l
        time.sleep(0.05)
    return None

def settled(want, timeout=6.0):
    """The first settled, stable `patch` line whose pairs are `want` (None: timed out)."""
    t0 = time.time()
    while time.time() - t0 < timeout:
        for l in since(t0):
            if l.get("t") == "patch" and l.get("stable") and l.get("pairs") == want: return l
        time.sleep(0.1)
    return None

def volts(raw): return f"{raw * 3.3 / 4095:.2f} V"

# The panel's own names, V1 first and D1 first (the firmware's config.h).
SOURCES = ["B8", "B7", "B4", "B2"]
INPUTS = ["A5", "A7", "A6", "A4"]
def src(k): return SOURCES[k - 1] if k <= len(SOURCES) else f"V{k}"
def inp(i): return INPUTS[i - 1] if i <= len(INPUTS) else f"D{i}"

step("1. the board answers, with a bay")
lines(1.0)
h = reply("version", ("hello",), 1.5)
if h is None:
    bad("no hello in 1.5 s (wrong port? not flashed? another program on it?)"); sys.exit(1)
ok(f"{h['fw']} · door mode {h['mode']}")
pbv, pbd = h.get("pbv", 0), h.get("pbd", 0)
if not pbd:
    bad("this firmware reads no patch bay (pbd 0 or missing): flash hardware/server-room-m4 1.3.0 or later"); done()
if (pbv, pbd) != (len(SOURCES), len(INPUTS)):
    bad(f"a bay of {pbv} sources × {pbd} inputs is not this panel: flash hardware/server-room-m4 1.3.0 or later"); done()
ok(f"a bay of {pbv} sources × {pbd} inputs")
cal = reply("pb get", ("pbcal",))
if cal is None:
    bad("no answer to `pb get`"); done()
floor, tol, nominal = cal["floor"], cal["tol"], list(cal["levels"])
ok(f"floor {floor} · tol {tol} · levels {nominal}{' (saved)' if cal['saved'] else ' (not saved: the nominal table or unsaved changes)'}")

step("2. the empty bay")
ask("pull EVERY cable out of the bay")
p = settled("", 4.0)
if p is None:
    bad("the bay never settled empty: an input still reads a source (a cable left in, or a source shorted onto an input)")
else:
    hi = max(p["raw"])
    ok(f"empty: every input under the floor (highest {hi} of {floor})") if all(k == 0 for k in p["src"]) else bad(f"an input reads between levels with no cable: {p['raw']}")
    if hi > floor // 2: note(f"an empty input reads {hi}, more than half the floor: check the pull-down on it")

step(f"3. learn every source (one cable, into {inp(1)})")
levels = list(nominal)
for k in range(1, pbv + 1):
    ask(f"ONE cable: from {src(k)} into {inp(1)}, nothing else in")
    r = reply(f"pb learn V{k}", ("pbcal", "err"), 3.0)
    if r is None:
        bad(f"{src(k)}: no answer to pb learn"); continue
    if r["t"] == "err":
        bad(f"{src(k)}: the board refused it ({r['error']})"); continue
    levels[k - 1] = r["raw"]
    off = r["raw"] - nominal[k - 1]
    ok(f"{src(k)}: {r['raw']} ({volts(r['raw'])}; nominal {nominal[k - 1]}, {off:+d})")
    if abs(off) > tol: note(f"{src(k)} is {off:+d} counts from its nominal level: is its voltage what config.h says?")
if levels[3] and abs(levels[3] - 3646) > 150:
    note(f"{src(4)} reads {levels[3]}, not ≈ 3646: is the ADC reading against 3.3 V? (README: verify the reference)")
order = all(levels[i] < levels[i + 1] for i in range(len(levels) - 1))
ok("the levels climb " + " → ".join(SOURCES)) if order else bad(f"the levels are out of order: {levels} (two sources swapped?)")
gaps = [levels[i + 1] - levels[i] for i in range(len(levels) - 1)]
tight = [f"{src(i + 1)}–{src(i + 2)} {g}" for i, g in enumerate(gaps) if g < 2 * tol]
ok(f"every neighbour at least 2 × tol ({2 * tol}) apart (closest {min(gaps)})") if not tight else bad("too close to tell apart: " + ", ".join(tight))

step("4. the walk")
full = yes(f"walk EVERY source through every input ({pbv * pbd} plugs, ~4 min)? (n = {src(1)} through every input, then every source in {inp(pbd)})")
plan = [(k, i) for k in range(1, pbv + 1) for i in range(1, pbd + 1)] if full else \
       [(1, i) for i in range(1, pbd + 1)] + [(k, pbd) for k in range(2, pbv + 1)]
table = {}  # (k, i) → raw
for (k, i) in plan:
    ask(f"ONE cable: {src(k)} → {inp(i)}")
    p = settled(f"V{k}-D{i}")
    if p is None:
        last = next((l for l in reversed(since(time.time() - 2)) if l.get("t") == "patch"), None)
        bad(f"{src(k)} → {inp(i)}: never settled as V{k}-D{i} (reads {last['src'] if last else '?'}, raw {last['raw'] if last else '?'})")
        continue
    raw = p["raw"][i - 1]
    table[(k, i)] = raw
    dev = raw - levels[k - 1]
    if abs(dev) <= tol // 2: ok(f"{src(k)} → {inp(i)}: {raw} ({dev:+d})")
    elif abs(dev) <= tol: note(f"{src(k)} → {inp(i)}: {raw} ({dev:+d}): inside the tolerance, but past half of it")
    else: bad(f"{src(k)} → {inp(i)}: {raw} ({dev:+d}) is outside ±{tol}")
    others = [x for j, x in enumerate(p["raw"]) if j != i - 1]
    if others and max(others) >= floor: bad(f"{src(k)} → {inp(i)}: another input rose with it ({p['raw']}): crosstalk or a short between jacks")

step("5. the table (12-bit counts; — not plugged in the walk)")
print("    " + "  " + "".join(f"{inp(i):>7}" for i in range(1, pbd + 1)) + f"{'learnt':>9}")
for k in range(1, pbv + 1):
    print(f"    {src(k)}" + "".join(f"{table[(k, i)] if (k, i) in table else '—':>7}" for i in range(1, pbd + 1)) + f"{levels[k - 1]:>9}")
if table:
    worst = max(abs(raw - levels[k - 1]) for (k, _i), raw in table.items())
    ok(f"the widest spread from a learnt level is {worst} (tol {tol})") if worst <= tol else bad(f"a reading lands {worst} from its level, past tol {tol}")
    if worst > tol // 2: note(f"worth `pb tol {min(2 * worst, min(gaps) // 2 if gaps else tol)}` (half the closest gap at most), then run this again")

step("6. keep them")
if yes("save the learnt levels on the board (pb save)?"):
    s = reply("pb save", ("pbcal", "err"), 2.0)
    ok("saved in flash (the door's calibration untouched)") if s and s["t"] == "pbcal" and s["saved"] else bad(f"pb save: {s}")
else:
    note("not saved: a reboot goes back to the levels in flash")
ask("pull the cable out")
done()
PY

"$PY" -c "$SCRIPT" "$PORT"
RC=$?
echo "(preflight: $PASS passed, $FAIL failed)"
echo "Next: the terminal page (⚙ → patch bay shows the same table), then Run → Terminals shows 🔌 n."
[ "$RC" = 0 ] && [ "$FAIL" = 0 ]
