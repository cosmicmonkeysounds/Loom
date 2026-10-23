// The whole sensor behind three calls: begin(), tick() as often as loop()
// runs, command() per input line. Pure C++ over dl::Pins, store::Store and a
// Sink for output lines, so test/test_logic.cpp runs the firmware end to end
// on a laptop. The sketch only wires the real pins, flash and Serial in.
#pragma once
#include <stdint.h>

#include "config.h"
#include "door_ldr.h"
#include "proto.h"
#include "store.h"

namespace door {

struct Sink {
  virtual void line(const char* s) = 0;
  virtual ~Sink() {}
};

// The onboard NeoPixel: purple fault, blue until the host has spoken once,
// then green shut / amber open.
enum Status { kFault, kWaiting, kShut, kOpen };

class Engine {
 public:
  Engine(dl::Pins& pins, store::Store& st, Sink& out, bool sense)
      : pins_(pins), store_(st), out_(out), sense_(sense) {}

  void begin(uint32_t now) {
    hasStored_ = store_.load(stored_);
    s_ = hasStored_ ? stored_ : dl::Settings();
    restart(now);
    hello();
  }

  void tick(uint32_t now) {
    dl::Frame f;
    if (sampler_.tick(pins_, now, f)) frame(f, now);
    if (seen_ && (uint32_t)(now - lastLine_) >= REPORT_MS) report(now);
  }

  void command(const char* raw, bool tooLong, uint32_t now) {
    char cmd[proto::kCmd + 1];
    proto::trimmed(raw, cmd, sizeof cmd);
    if (!cmd[0] && !tooLong) return;
    spoke_ = true;
    if (tooLong) return err("line too long", cmd);
    proto::Command c = proto::parse(cmd);
    switch (c.kind) {
      case proto::kPing: {
        char l[proto::kLine];
        proto::pong(now, l, sizeof l);
        return out_.line(l);
      }
      case proto::kVersion: return hello();
      case proto::kGet: return cfg(hasStored_ && stored_ == s_);
      case proto::kCalClosed:
      case proto::kCalOpen:
        if (avg_.running) return err("cal busy", cmd);
        if (health_.fault()) return err("sensor fault", cmd);
        calClosed_ = c.kind == proto::kCalClosed;
        snprintf(calCmd_, sizeof calCmd_, "%s", cmd);
        avg_.begin(now);
        return;
      case proto::kSetClose:
      case proto::kSetOpen: {
        if (!dl::validLevel(c.value)) return err("out of range", cmd);
        bool close = c.kind == proto::kSetClose;
        long open = close ? s_.open : c.value, shut = close ? c.value : s_.close;
        if (open >= shut) return err("open must be below close", cmd);
        s_.open = (uint16_t)open;
        s_.close = (uint16_t)shut;
        s_.cal = false;
        return ok(cmd);
      }
      case proto::kSetMode: {
        dl::Mode m;
        if (!dl::parseMode(c.word, m)) return err("bad mode", cmd);
        s_.mode = m;
        restart(now);
        return ok(cmd);
      }
      case proto::kSetSettle:
        if (!dl::validSettle(c.value)) return err("out of range", cmd);
        s_.settle = (uint16_t)c.value;
        restart(now);
        return ok(cmd);
      case proto::kSave:
        if (!store_.save(s_)) return err("flash write failed", cmd);
        stored_ = s_;
        hasStored_ = true;
        return cfg(true);
      case proto::kReset:
        s_ = dl::Settings();
        refOpen_ = refClosed_ = -1;
        restart(now);
        return ok(cmd);
      case proto::kBadValue: return err("bad value", cmd);
      default: return err("unknown command", cmd);
    }
  }

  Status status() const {
    if (seen_ && health_.fault()) return kFault;
    if (!spoke_ || !seen_) return kWaiting;
    return open() ? kOpen : kShut;
  }
  dl::Mode mode() const { return mode_; }
  const dl::Settings& settings() const { return s_; }
  bool open() const { return health_.fault() != nullptr || cls_.open; }
  bool calibrating() const { return avg_.running; }

 private:
  dl::Pins& pins_;
  store::Store& store_;
  Sink& out_;
  bool sense_;

  dl::Settings s_, stored_;
  bool hasStored_ = false;
  dl::Mode mode_ = dl::kSteady;
  dl::Sampler sampler_;
  dl::Classifier cls_;
  dl::Health health_;
  dl::Averager avg_;
  bool calClosed_ = false;
  char calCmd_[proto::kCmd + 1] = "";
  int refOpen_ = -1, refClosed_ = -1;

  bool seen_ = false, spoke_ = false;
  dl::Frame last_;
  unsigned long seq_ = 0;
  uint32_t lastLine_ = 0;
  bool sentOpen_ = true;
  const char *sentFault_ = nullptr, *sentWarn_ = nullptr;

  // A new mode or settle: probe if asked, and start sampling afresh (levels
  // in `mod` and `steady` mean different things, so the state is relearnt).
  void restart(uint32_t now) {
    mode_ = s_.mode == dl::kAuto ? dl::probe(pins_, s_.settle) : s_.mode;
    sampler_.begin(mode_, s_.settle, sense_, pins_, now);
    cls_.reset();
    health_.reset();
    avg_.running = false;
    seen_ = false;
  }

  void frame(const dl::Frame& f, uint32_t now) {
    last_ = f;
    health_.update(f, mode_, now);
    cls_.update(f.level, s_, now);
    uint16_t mean;
    if (avg_.feed(f.level, now, mean)) calibrated(mean);
    bool changed = !seen_ || open() != sentOpen_ || health_.fault() != sentFault_ || health_.warn() != sentWarn_;
    seen_ = true;
    if (changed) report(now);
  }

  void calibrated(uint16_t ref) {
    int o = calClosed_ ? refOpen_ : ref, c = calClosed_ ? ref : refClosed_;
    if (o >= 0 && c >= 0) {
      uint16_t open, close;
      if (!dl::calThresholds(o, c, open, close)) return err("cal span too small", calCmd_);
      s_.open = open;
      s_.close = close;
      s_.cal = true;
    }
    (calClosed_ ? refClosed_ : refOpen_) = ref;
    char l[proto::kLine];
    proto::cal(calClosed_ ? "closed" : "open", ref, s_.close, s_.open, l, sizeof l);
    out_.line(l);
  }

  void report(uint32_t now) {
    sentOpen_ = open();
    sentFault_ = health_.fault();
    sentWarn_ = health_.warn();
    lastLine_ = now;
    char l[proto::kLine];
    proto::door(++seq_, sentOpen_, last_.level, last_.lit, last_.dark, sentFault_, sentWarn_, l, sizeof l);
    out_.line(l);
  }

  proto::Info info() const {
    return proto::Info{DOOR_FW, dl::modeName(mode_), s_.mode == dl::kAuto, s_.close, s_.open, s_.settle, s_.cal,
                       sense_};
  }
  void hello() {
    char l[proto::kLine];
    proto::hello(info(), l, sizeof l);
    out_.line(l);
  }
  void cfg(bool saved) {
    char l[proto::kLine];
    proto::cfg(info(), saved, l, sizeof l);
    out_.line(l);
  }
  void ok(const char* cmd) {
    char l[proto::kLine];
    proto::ok(cmd, l, sizeof l);
    out_.line(l);
  }
  void err(const char* e, const char* cmd) {
    char l[proto::kLine];
    proto::err(e, cmd, l, sizeof l);
    out_.line(l);
  }
};

}  // namespace door
