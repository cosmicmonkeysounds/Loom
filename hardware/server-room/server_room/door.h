// Door inputs: per-input polarity, asymmetric debounce and the reed /
// contact combination. Pure C++ (tested in test/test_logic.cpp).
//
// Wave 20 (D16): retired. The server-room door is read by the Grand Central
// M4's LED + LDR (hardware/server-room-door/), bridged by the server-room
// terminal; stagehand no longer reads sensors/serverroom/door. This code
// still publishes it, unread, so the box's firmware needs no change.
//
// Wave 7: the door's main sensor is two loops of wire / copper tape that
// TOUCH WHEN THE DOOR OPENS (kClosedWhenOpen on the tape input). The real
// door has a standalone keypad lock that nothing here drives. The reed
// (MC-38, closed with the magnet present = kClosedWhenShut) is optional.
#pragma once
#include <stdint.h>
#include <stdio.h>

namespace door {

enum Mode { kBoth, kReed, kTape };

// What a closed contact (pin pulled LOW) means for one input.
//   kClosedWhenShut: a reed / MC-38 — closed while the door is shut, so an
//                    unplugged input floats HIGH and reads OPEN.
//   kClosedWhenOpen: the wire loops that touch when the door opens, so an
//                    unplugged or broken input reads SHUT forever and fails
//                    silently (the director's 🚪 fallback covers it).
enum Polarity { kClosedWhenShut, kClosedWhenOpen };

inline bool isOpen(Polarity p, bool pinLow) { return p == kClosedWhenOpen ? pinLow : !pinLow; }

inline const char* polarityName(Polarity p) {
  return p == kClosedWhenOpen ? "closed_when_open" : "closed_when_shut";
}

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

// kBoth: open only when both inputs say open. The drop-out rule (an
// unplugged input reads open through its pull-up, so the other decides) holds
// ONLY for a kClosedWhenShut input: an unplugged kClosedWhenOpen input reads
// shut and would veto every opening. So kBoth needs both inputs physically
// fitted, or the missing one closed-when-shut. The wave 7 default is kTape.
inline bool combine(Mode m, bool reedOpen, bool tapeOpen) {
  switch (m) {
    case kReed: return reedOpen;
    case kTape: return tapeOpen;
    default: return reedOpen && tapeOpen;
  }
}

inline const char* modeName(Mode m) { return m == kReed ? "reed" : m == kTape ? "tape" : "both"; }

// Whether the published payload reports an input: the reed only when the
// mode reads it, the tape likewise ("reed": true on a tape-only box would
// advertise a sensor that isn't there).
inline bool reportsReed(Mode m) { return m != kTape; }
inline bool reportsTape(Mode m) { return m != kReed; }

// The sensors/serverroom/door payload: {"open":bool[,"reed":bool][,"tape":bool],"mode":"…"}.
// stagehand's rule reads only "open". Returns snprintf's length.
inline int payloadJson(Mode m, bool open, bool reedOpen, bool tapeOpen, char* out, size_t cap) {
  const char* t = "true";
  const char* f = "false";
  char reed[16] = "", tape[16] = "";
  if (reportsReed(m)) snprintf(reed, sizeof reed, ",\"reed\":%s", reedOpen ? t : f);
  if (reportsTape(m)) snprintf(tape, sizeof tape, ",\"tape\":%s", tapeOpen ? t : f);
  return snprintf(out, cap, "{\"open\":%s%s%s,\"mode\":\"%s\"}", open ? t : f, reed, tape, modeName(m));
}

}  // namespace door
