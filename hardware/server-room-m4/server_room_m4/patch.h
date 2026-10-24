// The patch bay's logic (wave 22): reading the seven inputs, naming the
// source on each, the settle that keeps a cable on its way in from counting,
// the canonical pairs, and `pb learn`. Pure C++ with no Arduino include: the
// ADC comes in through `Pins`, so test/test_logic.cpp drives all of it
// against a modelled bay.
//
// Every source V<k> sits at its own voltage (an independent divider off
// 3V3); a cable from V<k> into input D<i> puts that voltage on D<i>'s pin,
// and an empty input is pulled to GND. So each input reads one of nine
// things: empty, one of the eight sources, or something between levels (a
// half-seated plug, a dirty tip, a wrong resistor). A V–V or a D–D cable
// moves no input at all: the bay sees V–D cables only, and a patch with one
// of those among its four cables reads as fewer than four pairs (never as a
// wrong combination).
//
// The story judges the pairs (the terminal posts them as `patch_changed
// {combo}`): nothing here knows which combinations matter.
#pragma once
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "config.h"

namespace pb {

constexpr int kSources = PB_SOURCES;
constexpr int kInputs = PB_INPUTS;
// Arrays are sized for any build (a PB_INPUTS 0 build included).
constexpr int kMaxInputs = 16;
static_assert(kInputs >= 0 && kInputs <= kMaxInputs, "PB_INPUTS is 0–16");
static_assert(kSources >= 1 && kSources <= 9, "a source is V1–V9 (one digit on the wire)");
constexpr uint16_t kMax = 4095;  // analogReadResolution(12)
constexpr int kReads = 8;        // reads averaged per input per scan
constexpr int kPairs = 4;        // a complete patch is exactly four V–D cables

// One input's decode: 0 empty, 1..kSources that source, kBetween neither.
constexpr int8_t kEmpty = 0;
constexpr int8_t kBetween = -1;

// ── Settings ───────────────────────────────────────────────────────────────

struct Settings {
  uint16_t level[kSources];
  uint16_t floor = PB_FLOOR, tol = PB_TOL;

  Settings() {
    const uint16_t nominal[] = PB_NOMINAL;
    static_assert(sizeof nominal / sizeof nominal[0] == kSources, "PB_NOMINAL has one level per source");
    for (int k = 0; k < kSources; k++) level[k] = nominal[k];
  }
  bool operator==(const Settings& o) const {
    if (floor != o.floor || tol != o.tol) return false;
    for (int k = 0; k < kSources; k++)
      if (level[k] != o.level[k]) return false;
    return true;
  }
  bool operator!=(const Settings& o) const { return !(*this == o); }
};

inline bool validFloor(long v) { return v >= 20 && v <= 1000; }
inline bool validTol(long v) { return v >= 20 && v <= 1000; }
// Every level clear of the floor (else that source would read as empty).
inline bool valid(const Settings& s) {
  if (!validFloor(s.floor) || !validTol(s.tol)) return false;
  for (int k = 0; k < kSources; k++)
    if (s.level[k] > kMax || s.level[k] < s.floor + s.tol) return false;
  return true;
}

// ── Decoding ───────────────────────────────────────────────────────────────

// The source an input's reading names: empty under the floor, else the
// nearest learned level within `tol`, else kBetween.
inline int8_t classify(uint16_t raw, const Settings& s) {
  if (raw < s.floor) return kEmpty;
  int best = -1;
  long dist = 0;
  for (int k = 0; k < kSources; k++) {
    long d = labs((long)raw - (long)s.level[k]);
    if (best < 0 || d < dist) {
      best = k;
      dist = d;
    }
  }
  return dist <= s.tol ? (int8_t)(best + 1) : kBetween;
}

// The decode of every input (index 0 = D1).
struct Bay {
  int8_t src[kMaxInputs] = {};
  bool operator==(const Bay& o) const { return memcmp(src, o.src, sizeof src) == 0; }
  bool operator!=(const Bay& o) const { return !(*this == o); }
};

struct Summary {
  int count = 0;     // V–D pairs read
  int between = 0;   // inputs between levels
  bool dup = false;  // one source on two inputs: impossible with TS cables (a wiring fault or crosstalk)
  bool complete = false;
};

inline Summary summarise(const Bay& b, int n = kInputs) {
  Summary s;
  bool seen[kSources + 1] = {};
  for (int i = 0; i < n; i++) {
    int8_t k = b.src[i];
    if (k == kBetween) s.between++;
    else if (k > 0) {
      s.count++;
      if (seen[k]) s.dup = true;
      seen[k] = true;
    }
  }
  s.complete = s.count == kPairs && s.between == 0 && !s.dup;
  return s;
}

// The pairs as one string, the story's canonical form: `V<k>-D<i>` for each
// patched input, sorted by source then input, joined by `,`, no spaces
// (e.g. `V1-D3,V5-D2`; "" for none). The old ESP32 scanner wrote the same
// form, so the story's Kernel strings never changed shape.
inline int pairsText(const Bay& b, char* out, size_t cap, int n = kInputs) {
  size_t len = 0;
  int count = 0;
  out[0] = 0;
  for (int k = 1; k <= kSources; k++)
    for (int i = 0; i < n; i++) {
      if (b.src[i] != k) continue;
      int w = snprintf(out + len, len < cap ? cap - len : 0, "%sV%d-D%d", count ? "," : "", k, i + 1);
      if (w > 0) len += (size_t)w;
      if (len >= cap) len = cap - 1;
      count++;
    }
  return count;
}

// ── Reading the pins ───────────────────────────────────────────────────────

struct Pins {
  virtual uint16_t adc(int input) = 0;  // one 12-bit read of input `input` (0 = D1)
  virtual ~Pins() {}
};

// One input: a throwaway read once the ADC's mux has moved (the sample-and-
// hold still carries the last pin's charge), then the mean of kReads.
inline uint16_t readInput(Pins& p, int input) {
  (void)p.adc(input);
  uint32_t s = 0;
  for (int i = 0; i < kReads; i++) s += p.adc(input);
  return (uint16_t)((s + kReads / 2) / kReads);
}

// ── The scanner ───────────────────────────────────────────────────────────
// One scan of every input every PB_FRAME_MS, non-blocking. The live decode
// must hold unchanged for PB_SETTLE_MS before it is the *settled* bay, the
// only one the terminal posts: a plug brushing the sleeve on its way in, or
// a hand still moving cables, never settles.

class Scanner {
 public:
  void begin(uint32_t now) {
    last_ = now;
    scanned_ = hasCand_ = settled_ = changed_ = false;
    live_ = cand_ = stable_ = Bay();
    memset(raw_, 0, sizeof raw_);
  }

  // True when a scan ran this call.
  bool tick(Pins& p, const Settings& s, uint32_t now) {
    if (scanned_ && (uint32_t)(now - last_) < PB_FRAME_MS) return false;
    scanned_ = true;
    last_ = now;
    for (int i = 0; i < kInputs; i++) {
      raw_[i] = readInput(p, i);
      live_.src[i] = classify(raw_[i], s);
    }
    if (!hasCand_ || live_ != cand_) {
      cand_ = live_;
      since_ = now;
      hasCand_ = true;
    }
    if ((!settled_ || cand_ != stable_) && (uint32_t)(now - since_) >= PB_SETTLE_MS) {
      stable_ = cand_;
      settled_ = changed_ = true;
    }
    return true;
  }

  // The settled bay changed since the last call (once per change).
  bool takeChange() {
    bool c = changed_;
    changed_ = false;
    return c;
  }

  bool scanned() const { return scanned_; }
  bool settled() const { return settled_; }
  // The live decode is the settled one (false while a change settles).
  bool stable() const { return settled_ && live_ == stable_; }
  const Bay& live() const { return live_; }
  const Bay& bay() const { return stable_; }  // all empty until the first settle
  uint16_t raw(int i) const { return raw_[i]; }

 private:
  uint32_t last_ = 0, since_ = 0;
  bool scanned_ = false, hasCand_ = false, settled_ = false, changed_ = false;
  Bay live_, cand_, stable_;
  uint16_t raw_[kMaxInputs] = {};
};

// ── Learning a source's level ─────────────────────────────────────────────
// `pb learn V<k>` with exactly one cable in, from V<k> into any input:
// averages that input over PB_LEARN_MS. Refused when no input or more than
// one reads above the floor (at any scan), when the cable moves to another
// input, and when the mean lands within 2·tol of another source's level
// (the two could no longer be told apart).

struct Learner {
  enum Result { kRunning, kDone, kFailed };
  bool running = false;
  int source = 0;  // 1..kSources
  int input = -1;  // the input the cable is in (0 = D1)
  uint32_t start = 0, sum = 0, n = 0;
  uint16_t mean = 0;
  char error[32] = "";

  void begin(int k, uint32_t now) {
    running = true;
    source = k;
    input = -1;
    start = now;
    sum = n = 0;
    error[0] = 0;
  }

  Result fail(const char* e) {
    running = false;
    snprintf(error, sizeof error, "%s", e);
    return kFailed;
  }

  // After each scan.
  Result feed(const Scanner& sc, const Settings& s, uint32_t now) {
    if (!running) return kRunning;
    int in = -1, above = 0;
    for (int i = 0; i < kInputs; i++)
      if (sc.raw(i) >= s.floor) {
        above++;
        in = i;
      }
    if (above != 1 || (input >= 0 && in != input)) return fail("pb: need exactly one cable");
    input = in;
    sum += sc.raw(in);
    n++;
    if ((uint32_t)(now - start) < PB_LEARN_MS) return kRunning;
    running = false;
    mean = (uint16_t)((sum + n / 2) / n);
    if (mean < s.floor + s.tol) return fail("pb: too faint");
    for (int k = 0; k < kSources; k++) {
      if (k == source - 1) continue;
      if (labs((long)mean - (long)s.level[k]) < 2L * s.tol) {
        char e[32];
        snprintf(e, sizeof e, "pb: too close to V%d", k + 1);
        return fail(e);
      }
    }
    return kDone;
  }
};

}  // namespace pb
