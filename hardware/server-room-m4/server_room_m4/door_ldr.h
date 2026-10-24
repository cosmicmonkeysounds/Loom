// The door's logic: the LED + LDR sampler, the classifier (hysteresis +
// debounce), the faults and the warning, the boot probe that picks `mod` or
// `steady`, and the calibration maths. Pure C++ with no Arduino include:
// the pins come in through `Pins`, so test/test_logic.cpp drives all of it
// against a modelled CdS cell.
#pragma once
#include <stdint.h>
#include <string.h>

#include "config.h"

namespace dl {

constexpr uint16_t kMax = 4095;  // analogReadResolution(12)
constexpr int kReads = 8;        // reads averaged per phase

// ── Settings ───────────────────────────────────────────────────────────────

// `mod` is the pulsed wiring (config.h LED_PULSED); the wire keeps the name.
enum Mode : uint8_t { kAuto = 0, kMod = 1, kSteady = 2 };
static_assert(LED_AUTO == kAuto && LED_PULSED == kMod && LED_STEADY == kSteady, "config.h LED_MODE values are dl::Mode's");
static_assert(LED_MODE >= LED_AUTO && LED_MODE <= LED_STEADY, "LED_MODE is LED_STEADY, LED_PULSED or LED_AUTO");
constexpr Mode kBuildMode = (Mode)LED_MODE;  // what a blank board and `reset` run

inline const char* modeName(Mode m) { return m == kMod ? "mod" : m == kSteady ? "steady" : "auto"; }

inline bool parseMode(const char* s, Mode& out) {
  if (strcmp(s, "auto") == 0) out = kAuto;
  else if (strcmp(s, "mod") == 0 || strcmp(s, "pulsed") == 0) out = kMod;
  else if (strcmp(s, "steady") == 0) out = kSteady;
  else return false;
  return true;
}

struct Settings {
  uint16_t close = DEF_CLOSE, open = DEF_OPEN, settle = DEF_SETTLE;
  Mode mode = kBuildMode;  // what was asked for; Engine::mode() is what runs
  bool cal = false;   // the thresholds came from `cal closed` + `cal open`

  bool operator==(const Settings& o) const {
    return close == o.close && open == o.open && settle == o.settle && mode == o.mode && cal == o.cal;
  }
  bool operator!=(const Settings& o) const { return !(*this == o); }
};

inline bool validSettle(long v) { return v >= 20 && v <= 1000; }
inline bool validLevel(long v) { return v >= 0 && v <= kMax; }
inline bool valid(const Settings& s) {
  return validLevel(s.close) && validLevel(s.open) && s.open < s.close && validSettle(s.settle) && s.mode <= kSteady;
}

// ── Calibration ───────────────────────────────────────────────────────────
// After both references: open = o + 0.35·(c − o), close = o + 0.65·(c − o),
// refused when c − o < CAL_MIN_SPAN (an LDR that can't tell the two apart).

inline bool calThresholds(int o, int c, uint16_t& open, uint16_t& close) {
  if (c - o < CAL_MIN_SPAN) return false;
  open = (uint16_t)(o + (35 * (c - o) + 50) / 100);
  close = (uint16_t)(o + (65 * (c - o) + 50) / 100);
  return true;
}

// Averages `level` over CAL_MS of frames. Wrap-safe on millis().
struct Averager {
  bool running = false;
  uint32_t start = 0, sum = 0, n = 0;
  void begin(uint32_t now) {
    running = true;
    start = now;
    sum = n = 0;
  }
  // True once CAL_MS has passed: `mean` holds the average.
  bool feed(uint16_t level, uint32_t now, uint16_t& mean) {
    if (!running) return false;
    sum += level;
    n++;
    if ((uint32_t)(now - start) < CAL_MS) return false;
    running = false;
    mean = (uint16_t)((sum + n / 2) / n);
    return true;
  }
};

// ── The boot probe (mode auto) ────────────────────────────────────────────
// D2 low, settle, read; D2 high, settle, read; three times. A mean difference
// ≥ AUTO_MIN_DIFF means the LED hangs off D2 → `mod`, else it's on 3V3 (or
// missing) → `steady`.
struct Probe {
  long diff = 0;
  int n = 0;
  void add(uint16_t low, uint16_t high) {
    diff += (long)high - (long)low;
    n++;
  }
  Mode pick() const { return n > 0 && diff / n >= AUTO_MIN_DIFF ? kMod : kSteady; }
};

// ── Pins ───────────────────────────────────────────────────────────────────

struct Pins {
  virtual void led(bool on) = 0;
  virtual uint16_t ldr() = 0;    // one 12-bit read of A0
  virtual uint16_t sense() = 0;  // one 12-bit read of A1 (only with LED_SENSE)
  virtual void wait(uint32_t ms) = 0;  // blocking; only the boot probe uses it
  virtual ~Pins() {}
};

// One throwaway read first: since 1.2.0 the bay scans A2–A8 between the
// door's frames, and the first read after the ADC's mux moves carries the
// last pin's charge into A0's high-impedance divider (patch.h does the same).
inline uint16_t average(Pins& p, uint16_t (Pins::*read)()) {
  (void)(p.*read)();
  uint32_t s = 0;
  for (int i = 0; i < kReads; i++) s += (p.*read)();
  return (uint16_t)((s + kReads / 2) / kReads);
}

inline Mode probe(Pins& p, uint16_t settle) {
  Probe pr;
  for (int i = 0; i < 3; i++) {
    p.led(false);
    p.wait(settle);
    uint16_t low = average(p, &Pins::ldr);
    p.led(true);
    p.wait(settle);
    pr.add(low, average(p, &Pins::ldr));
  }
  p.led(true);
  return pr.pick();
}

// ── The sampler ───────────────────────────────────────────────────────────
// mod: LED on, settle, average 8 → lit; LED off, settle, average 8 → dark;
// level = max(0, lit − dark): one frame per ≈ 2 × settle. steady: the LED
// (or 3V3) always on, level = lit, dark = 0, one frame per STEADY_FRAME_MS.
// Non-blocking: tick() as often as loop() runs.

struct Frame {
  uint16_t lit = 0, dark = 0, level = 0;
  int sense = -1;  // A1 while the LED was driven; -1 = not read
};

struct Sampler {
  Mode mode = kSteady;
  uint16_t settle = DEF_SETTLE;
  bool sensing = false;
  bool started = false, litPhase = true;
  uint32_t at = 0;
  Frame cur;

  void begin(Mode m, uint16_t settleMs, bool sense, Pins& p, uint32_t now) {
    mode = m;
    settle = settleMs;
    sensing = sense;
    started = true;
    litPhase = true;
    at = now;
    cur = Frame();
    p.led(true);
  }

  // True when a frame completed (into `out`).
  bool tick(Pins& p, uint32_t now, Frame& out) {
    if (!started) return false;
    if (mode == kSteady) {
      if ((uint32_t)(now - at) < STEADY_FRAME_MS) return false;
      at = now;
      out = Frame();
      out.lit = out.level = average(p, &Pins::ldr);
      if (sensing) out.sense = average(p, &Pins::sense);
      return true;
    }
    if ((uint32_t)(now - at) < settle) return false;
    at = now;
    if (litPhase) {
      cur.lit = average(p, &Pins::ldr);
      cur.sense = sensing ? (int)average(p, &Pins::sense) : -1;
      p.led(false);
      litPhase = false;
      return false;
    }
    cur.dark = average(p, &Pins::ldr);
    cur.level = cur.lit > cur.dark ? (uint16_t)(cur.lit - cur.dark) : 0;
    out = cur;
    p.led(true);
    litPhase = true;
    return true;
  }
};

// ── The classifier ─────────────────────────────────────────────────────────
// Closed once level ≥ close for CLOSE_MS of frames, open once level ≤ open
// for OPEN_MS; between the two the last state holds. A run counts from the
// start of its first frame (`span` = how long a frame takes), so in `mod`
// at the default settle (300 ms frames) one whole open frame is enough: an
// opening reads when the first frame lit after the break ends, 150–450 ms
// after the beam breaks (plus the cell's own lag; N-20 measures it). A frame
// in the band breaks a run, so a flicker on an open door never reads closed.

struct Classifier {
  bool known = false, open = true;
  int run = 0;  // +1 a closed run, -1 an open run, 0 none
  uint32_t since = 0;

  void reset() {
    known = false;
    open = true;
    run = 0;
  }

  // True when `open` changed (the first frame sets it and counts as a change).
  bool update(uint16_t level, const Settings& s, uint32_t now, uint32_t span = 0) {
    if (!known) {
      known = true;
      open = level < (uint16_t)((s.open + s.close) / 2);
      run = 0;
      return true;
    }
    int want = level >= s.close ? 1 : level <= s.open ? -1 : 0;
    if (want == 0 || (want == 1) == !open) {
      // In the band, or already in that state: no run.
      run = 0;
      return false;
    }
    if (run != want) {
      run = want;
      since = now - span;
    }
    if ((uint32_t)(now - since) < (want == 1 ? (uint32_t)CLOSE_MS : (uint32_t)OPEN_MS)) return false;
    open = want == -1;
    run = 0;
    return true;
  }
};

// ── Faults and the warning ────────────────────────────────────────────────
// Each needs FAULT_MS of frames and clears after FAULT_MS clean.

struct Latch {
  bool on = false, pending = false;
  uint32_t since = 0;
  void reset() { on = pending = false; }
  // True when `on` changed.
  bool update(bool cond, uint32_t now) {
    if (cond == on) {
      pending = false;
      return false;
    }
    if (!pending) {
      pending = true;
      since = now;
      return false;
    }
    if ((uint32_t)(now - since) < FAULT_MS) return false;
    on = cond;
    pending = false;
    return true;
  }
  // Coming on, not yet latched.
  bool rising() const { return pending && !on; }
};

constexpr const char* kLdrSaturated = "ldr_saturated";
constexpr const char* kLedDead = "led_dead";
constexpr const char* kLdrOpen = "ldr_open";

struct Health {
  Latch saturated, ledDead, ldrOpen;

  void reset() {
    saturated.reset();
    ledDead.reset();
    ldrOpen.reset();
  }
  // True when the fault or the warning changed.
  bool update(const Frame& f, Mode m, uint32_t now) {
    bool changed = saturated.update(m == kMod && f.dark > 4000, now);
    if (f.sense >= 0) changed |= ledDead.update(f.sense < 20, now);
    changed |= ldrOpen.update(f.lit < 8 && f.dark < 8, now);
    return changed;
  }
  // A blocking fault is building: its frames say nothing true about the
  // door (a flood of light reads level ≈ 0, an open door), so the engine
  // holds the last state until it latches or clears.
  bool rising() const { return saturated.rising() || ledDead.rising(); }
  // Blocking: forces open, and the terminal posts nothing while it holds.
  const char* fault() const { return saturated.on ? kLdrSaturated : ledDead.on ? kLedDead : nullptr; }
  // Reported only: a cut LDR wire reads the same as an open door in a dark
  // hall, so it never blocks and never changes `open`.
  const char* warn() const { return ldrOpen.on ? kLdrOpen : nullptr; }
};

}  // namespace dl
