#!/usr/bin/env python3
"""Measure the door LDR at each pulse settle, over USB serial.

    py hardware/server-room-m4/test/ldr_sweep.py COM4 "door shut"

Runs on any OS (pyserial), unlike scripts/accept/N-20.sh, which needs termios.
Prints lit / dark / level per settle and the LDR's resistance from the 10 kΩ
divider. Close the serial monitor and the terminal page first: only one
program can hold the port. `set settle` is not saved; the board's own settle
goes back when the sweep ends.
"""
import json
import statistics
import sys
import time

import serial

SETTLES = (40, 80, 150, 300, 600, 1000)
PULL_DOWN = 10_000  # the divider's bottom half, ohms
FULL_SCALE = 4095


def ohms(counts):
    return PULL_DOWN * (FULL_SCALE / counts - 1) if counts > 0 else float("inf")


def kilo(value):
    return "open" if value == float("inf") else f"{value / 1000:7.1f}k"


class Board:
    def __init__(self, port):
        self.port = serial.Serial(port, 115200, timeout=0.1, dsrdtr=False)
        self.port.dtr = True  # the firmware drops its output without DTR
        self.buf = b""
        time.sleep(0.5)

    def read(self, seconds):
        """Every JSON line the board sends in the next `seconds`."""
        out, end = [], time.time() + seconds
        while time.time() < end:
            self.buf += self.port.read(4096)
            while b"\n" in self.buf:
                raw, self.buf = self.buf.split(b"\n", 1)
                try:
                    out.append(json.loads(raw.decode("ascii", "replace")))
                except ValueError:
                    pass
        return out

    def ask(self, command, kind, seconds=1.5):
        self.port.write((command + "\n").encode())
        return next((l for l in self.read(seconds) if l.get("t") == kind), None)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    board = Board(sys.argv[1])
    label = sys.argv[2] if len(sys.argv) > 2 else ""
    hello = board.ask("version", "hello")
    if hello is None:
        sys.exit("no hello: wrong port, or another program holds it")
    print(f"{hello['fw']} · mode {hello['mode']} · close {hello['close']} open {hello['open']} "
          f"settle {hello['settle']} · cal {hello['cal']}" + (f" · {label}" if label else ""))
    if hello["mode"] != "mod":
        print("  ! not pulsed: dark is always 0 here")
    print(f"{'settle':>7} {'lit':>5} {'dark':>5} {'level':>5} {'±lvl':>5} {'R lit':>9} {'R dark':>9}  frames")
    for settle in SETTLES:
        board.ask(f"set settle {settle}", "ok")
        board.read(max(1.0, 4 * settle / 1000))  # the cell and the classifier catch up
        door = [l for l in board.read(max(5.0, 12 * settle / 1000)) if l.get("t") == "door"]
        if not door:
            print(f"{settle:>7} no door lines")
            continue
        lit = int(statistics.median(l["lit"] for l in door))
        dark = int(statistics.median(l["dark"] for l in door))
        levels = [l["level"] for l in door]
        spread = statistics.pstdev(levels)
        print(f"{settle:>7} {lit:>5} {dark:>5} {int(statistics.median(levels)):>5} {spread:>5.0f} "
              f"{kilo(ohms(lit)):>9} {kilo(ohms(dark)):>9}  {len(door)}")
    board.ask(f"set settle {hello['settle']}", "ok")


if __name__ == "__main__":
    main()
