// Door inputs: asymmetric debounce + the reed / copper-tape combination.
// Pure C++ (tested in test/test_logic.cpp).
#pragma once
#include <stdint.h>

namespace door {

enum Mode { kBoth, kReed, kTape };

// Reports "open" once the raw input has read open for openMs, "closed" once
// it has read closed for closeMs. Wrap-safe on millis().
struct Debounce {
  uint32_t openMs, closeMs;
  bool stable = false, last = false;
  uint32_t since = 0;

  Debounce(uint32_t openMs_, uint32_t closeMs_) : openMs(openMs_), closeMs(closeMs_) {}
  void reset(bool open, uint32_t now) {
    stable = last = open;
    since = now;
  }
  // True when `stable` just changed.
  bool update(bool rawOpen, uint32_t now) {
    if (rawOpen != last) {
      last = rawOpen;
      since = now;
    }
    if (last == stable || (uint32_t)(now - since) < (last ? openMs : closeMs)) return false;
    stable = last;
    return true;
  }
};

// kBoth: open only when both inputs say open. An unplugged input reads open
// (pull-up), so it drops out and the other decides; a flaky tape that gaps
// open while the door is shut is outvoted by the reed.
inline bool combine(Mode m, bool reedOpen, bool tapeOpen) {
  switch (m) {
    case kReed: return reedOpen;
    case kTape: return tapeOpen;
    default: return reedOpen && tapeOpen;
  }
}

inline const char* modeName(Mode m) { return m == kReed ? "reed" : m == kTape ? "tape" : "both"; }

}  // namespace door
