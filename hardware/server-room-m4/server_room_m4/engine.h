// The whole board behind three calls: begin(), tick() as often as loop()
// runs, command() per input line. The door sensor and (wave 22) the patch
// bay share the loop: each tick runs whichever of the two is due, and
// neither blocks. Pure C++ over dl::Pins, pb::Pins, store::Store and a Sink
// for output lines, so test/test_logic.cpp runs the firmware end to end on a
// laptop. The sketch only wires the real pins, flash and Serial in.
#pragma once
#include <stdint.h>

#include "config.h"
#include "door_ldr.h"
#include "patch.h"
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
  // `build`: the mode a blank board and `reset` run (config.h LED_MODE; the
  // tests pass each wiring's). `bay`: the patch bay's inputs, or null for a
  // board with none (hello / cfg say pbv 0, pbd 0; no `patch` line).
  Engine(dl::Pins& pins, store::Store& st, Sink& out, bool sense, dl::Mode build = dl::kBuildMode,
         pb::Pins* bay = nullptr)
      : pins_(pins), store_(st), out_(out), sense_(sense), build_(build), bay_(pb::kInputs > 0 ? bay : nullptr) {}

  void begin(uint32_t now) {
    hasStored_ = store_.load(stored_);
    s_ = hasStored_ ? stored_ : defaults();
    if (bay_ != nullptr) {
      hasPStored_ = store_.loadBay(pstored_);
      ps_ = hasPStored_ ? pstored_ : pb::Settings();
      scan_.begin(now);
      plast_ = now;
    }
    restart(now);
    hello();
  }

  void tick(uint32_t now) {
    dl::Frame f;
    if (sampler_.tick(pins_, now, f)) frame(f, now);
    if (seen_ && ready() && (uint32_t)(now - lastLine_) >= REPORT_MS) report(now);
    if (bay_ != nullptr) bayTick(now);
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
        // The terminal re-sends both on every connect: only a new value
        // makes the thresholds hand-set.
        if (open != s_.open || shut != s_.close) s_.cal = false;
        s_.open = (uint16_t)open;
        s_.close = (uint16_t)shut;
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
        s_ = defaults();
        refOpen_ = refClosed_ = -1;
        restart(now);
        return ok(cmd);
      case proto::kPbLearn:
        if (bay_ == nullptr) return err("pb: no bay", cmd);
        if (learn_.running) return err("pb busy", cmd);
        if (c.value < 1 || c.value > pb::kSources) return err("bad value", cmd);
        snprintf(learnCmd_, sizeof learnCmd_, "%s", cmd);
        learn_.begin((int)c.value, now);
        return;
      case proto::kPbGet:
        if (bay_ == nullptr) return err("pb: no bay", cmd);
        patchLine(now);
        return pbcal(0, 0);
      case proto::kPbSave:
        if (bay_ == nullptr) return err("pb: no bay", cmd);
        if (!store_.saveBay(ps_)) return err("flash write failed", cmd);
        pstored_ = ps_;
        hasPStored_ = true;
        return pbcal(0, 0);
      case proto::kPbReset:
        if (bay_ == nullptr) return err("pb: no bay", cmd);
        if (learn_.running) return err("pb busy", cmd);
        ps_ = pb::Settings();
        return pbcal(0, 0);
      case proto::kPbFloor:
      case proto::kPbTol: {
        if (bay_ == nullptr) return err("pb: no bay", cmd);
        if (learn_.running) return err("pb busy", cmd);
        pb::Settings next = ps_;
        (c.kind == proto::kPbFloor ? next.floor : next.tol) = (uint16_t)(c.value > 0xFFFF ? 0xFFFF : c.value);
        if (!pb::valid(next)) return err("out of range", cmd);
        ps_ = next;
        return pbcal(0, 0);
      }
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
  const pb::Settings& baySettings() const { return ps_; }
  const pb::Scanner& scanner() const { return scan_; }
  bool learning() const { return learn_.running; }
  bool open() const { return health_.fault() != nullptr || cls_.open; }
  bool calibrating() const { return avg_.running; }

 private:
  dl::Pins& pins_;
  store::Store& store_;
  Sink& out_;
  bool sense_;
  dl::Mode build_;
  pb::Pins* bay_;

  dl::Settings defaults() const {
    dl::Settings d;
    d.mode = build_;
    return d;
  }

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

  // The patch bay.
  pb::Settings ps_, pstored_;
  bool hasPStored_ = false;
  pb::Scanner scan_;
  pb::Learner learn_;
  char learnCmd_[proto::kCmd + 1] = "";
  unsigned long pseq_ = 0;
  uint32_t plast_ = 0;

  // A scan when one is due; a `patch` line on every settled change and at
  // least every PB_REPORT_MS (from the first scan on, settled or not, so ⚙'s
  // live readings show from boot).
  void bayTick(uint32_t now) {
    if (scan_.tick(*bay_, ps_, now)) {
      switch (learn_.feed(scan_, ps_, now)) {
        case pb::Learner::kDone:
          ps_.level[learn_.source - 1] = learn_.mean;
          pbcal(learn_.source, learn_.mean);
          break;
        case pb::Learner::kFailed: err(learn_.error, learnCmd_); break;
        default: break;
      }
      if (scan_.takeChange()) return patchLine(now);
    }
    if (scan_.scanned() && (uint32_t)(now - plast_) >= PB_REPORT_MS) patchLine(now);
  }

  void patchLine(uint32_t now) {
    plast_ = now;
    char pairs[64];
    int count = pb::pairsText(scan_.bay(), pairs, sizeof pairs);
    pb::Summary sum = pb::summarise(scan_.bay());
    uint16_t raw[pb::kMaxInputs];
    for (int i = 0; i < pb::kInputs; i++) raw[i] = scan_.raw(i);
    char l[proto::kLine];
    proto::patch(++pseq_, pairs, count, scan_.settled() && sum.complete, raw, scan_.live().src, pb::kInputs,
                 scan_.stable(), l, sizeof l);
    out_.line(l);
  }

  void pbcal(int src, unsigned raw) {
    char l[proto::kLine];
    proto::pbcal(src, raw, ps_.level, pb::kSources, ps_.floor, ps_.tol, hasPStored_ && pstored_ == ps_, l, sizeof l);
    out_.line(l);
  }

  // A new mode or settle: probe if asked, and start sampling afresh (levels
  // in `mod` and `steady` mean different things, so the state is relearnt).
  // A calibration in progress is answered, never dropped: the terminal's
  // Calibrate button waits for its `cal` or `err` line.
  void restart(uint32_t now) { start(s_.mode == dl::kAuto ? dl::probe(pins_, s_.settle) : s_.mode, now); }

  void start(dl::Mode m, uint32_t now) {
    if (avg_.running) err("cal cancelled", calCmd_);
    mode_ = m;
    sampler_.begin(mode_, s_.settle, sense_, pins_, now);
    cls_.reset();
    health_.reset();
    avg_.running = false;
    seen_ = false;
  }

  // The door is known: the classifier has decided, or a fault forces open.
  bool ready() const { return cls_.known || health_.fault() != nullptr; }

  void frame(const dl::Frame& f, uint32_t now) {
    last_ = f;
    health_.update(f, mode_, now);
    // Under a fault the levels mean nothing: relearn from the first clean
    // frame. While one is building, hold: neither the classifier nor a
    // calibration sees those frames, and after a restart nothing is
    // reported until a clean frame decides (or the fault latches), so a
    // light flash never reads {"open":true,"fault":null}.
    bool hold = health_.rising();
    bool closed = false;
    if (health_.fault()) cls_.reset();
    else if (!hold)
      closed = cls_.update(f.level, s_, now, mode_ == dl::kMod ? 2u * s_.settle : (uint32_t)STEADY_FRAME_MS) && !cls_.open;
    uint16_t mean;
    if (avg_.running && health_.fault()) {
      // A fault mid-average: its frames would poison the reference.
      avg_.running = false;
      err("sensor fault", calCmd_);
    } else if (!hold && avg_.feed(f.level, now, mean)) {
      calibrated(mean);
    }
    if (!ready()) return;
    bool changed = !seen_ || open() != sentOpen_ || health_.fault() != sentFault_ || health_.warn() != sentWarn_;
    seen_ = true;
    if (changed) report(now);
    // `auto` probed with the door open: the beam was blocked, so an LED on
    // D2 looked like none and `steady` won. Probe again each time the door
    // reads shut, and move to `mod` once the LED shows.
    if (closed && s_.mode == dl::kAuto && mode_ == dl::kSteady && dl::probe(pins_, s_.settle) == dl::kMod)
      start(dl::kMod, now);
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
    unsigned pbv = bay_ != nullptr ? (unsigned)pb::kSources : 0u, pbd = bay_ != nullptr ? (unsigned)pb::kInputs : 0u;
    return proto::Info{DOOR_FW, dl::modeName(mode_), s_.mode == dl::kAuto, s_.close, s_.open, s_.settle, s_.cal,
                       sense_, pbv, pbd};
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
