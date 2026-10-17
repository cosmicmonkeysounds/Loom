// The lock-indicator ring over the server-room door. Pure C++: the sketch
// asks pixel(i) every frame and pushes it to the NeoPixels. The ring only
// SHOWS a state: the real door has a standalone keypad lock that nothing
// here drives.
//
// Priority: alarm (red strobe, 2.5 Hz — under the 3 Hz photosensitivity
// limit) > a timed override from show/serverroom/ring (a bench / director
// look, e.g. white for 30 s) > the lock state (red breathing = locked, green
// = unlocked, dim amber breathing = no lock message yet). While the broker is
// unreachable one blue pixel circles on top, so the crew can see it. The
// alarm runs on its own timer, so it keeps strobing if the Wi-Fi drops.
#pragma once
#include <stdint.h>
#include <string.h>

namespace ring {

struct Rgb {
  uint8_t r, g, b;
};
inline bool operator==(Rgb a, Rgb b) { return a.r == b.r && a.g == b.g && a.b == b.b; }

enum Lock { kUnknown, kLocked, kUnlocked };
enum Look { kOff, kRed, kGreen, kAmber, kWhite, kBlue };

constexpr uint32_t kMaxSeconds = 600;
constexpr uint32_t kStrobeHalfMs = 200;  // 200 on / 200 off = 2.5 Hz
constexpr uint32_t kBreathMs = 3000;

inline Rgb color(Look l, uint8_t level = 255) {
  auto s = [level](uint8_t v) { return (uint8_t)((v * level) / 255); };
  switch (l) {
    case kRed: return {s(255), 0, 0};
    case kGreen: return {0, s(255), 0};
    case kAmber: return {s(255), s(110), 0};
    case kWhite: return {s(255), s(255), s(255)};
    case kBlue: return {0, 0, s(255)};
    default: return {0, 0, 0};
  }
}

// Parses a ring look name; false for anything else ("clear" is handled by
// the caller).
inline bool parseLook(const char* s, Look& out) {
  static const struct {
    const char* name;
    Look look;
  } kNames[] = {{"off", kOff}, {"red", kRed}, {"green", kGreen}, {"amber", kAmber}, {"white", kWhite}, {"blue", kBlue}};
  for (const auto& n : kNames)
    if (strcmp(s, n.name) == 0) {
      out = n.look;
      return true;
    }
  return false;
}

struct State {
  Lock lock = kUnknown;
  bool alarm = false;
  uint32_t alarmUntil = 0;
  bool override_ = false;
  Look overrideLook = kOff;
  uint32_t overrideUntil = 0;
  bool online = false;

  static uint32_t clampMs(uint32_t seconds) { return (seconds > kMaxSeconds ? kMaxSeconds : seconds) * 1000u; }
  void startAlarm(uint32_t seconds, uint32_t now) {
    alarm = true;
    alarmUntil = now + clampMs(seconds);
  }
  void stopAlarm() { alarm = false; }
  void setOverride(Look l, uint32_t seconds, uint32_t now) {
    override_ = true;
    overrideLook = l;
    overrideUntil = now + clampMs(seconds);
  }
  void clearOverride() { override_ = false; }
  // Expire the timers (call once per frame).
  void tick(uint32_t now) {
    if (alarm && (int32_t)(alarmUntil - now) <= 0) alarm = false;
    if (override_ && (int32_t)(overrideUntil - now) <= 0) override_ = false;
  }
  bool alarming() const { return alarm; }
};

// Triangle breath between ~8% and 100%.
inline uint8_t breath(uint32_t now) {
  uint32_t t = now % kBreathMs, half = kBreathMs / 2;
  uint32_t up = t < half ? t : kBreathMs - t;  // 0..half
  return (uint8_t)(20 + (235u * up) / half);
}

inline Rgb pixel(const State& s, int i, int n, uint32_t now) {
  Rgb c;
  if (s.alarm)
    c = (now / kStrobeHalfMs) % 2 == 0 ? color(kRed) : color(kOff);
  else if (s.override_)
    c = color(s.overrideLook);
  else if (s.lock == kLocked)
    c = color(kRed, breath(now));
  else if (s.lock == kUnlocked)
    c = color(kGreen);
  else
    c = color(kAmber, breath(now) / 4);
  if (!s.online && n > 0 && i == (int)((now / 120) % (uint32_t)n)) c = color(kBlue);
  return c;
}

}  // namespace ring
