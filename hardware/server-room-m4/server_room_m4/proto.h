// The serial protocol (contract §2.9): one JSON object per output line,
// `\n`-terminated ASCII commands in. Pure C++, no Arduino include: the line
// formats are pinned byte for byte by test/fixtures/lines.jsonl, which the
// server-room terminal's parser is diffed against.
#pragma once
#include <ctype.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

namespace proto {

constexpr size_t kLine = 256;  // the longest output line, a full `patch`, is ≈ 210 bytes
constexpr size_t kCmd = 64;    // commands are short; a longer line is refused

// ── Output lines ───────────────────────────────────────────────────────────

// `s` as a JSON string body (quotes, backslashes and control characters
// escaped), cut to fit `cap`.
inline void escape(const char* s, char* out, size_t cap) {
  size_t n = 0;
  for (; *s && n + 7 < cap; s++) {
    unsigned char c = (unsigned char)*s;
    if (c == '"' || c == '\\') {
      out[n++] = '\\';
      out[n++] = (char)c;
    } else if (c < 0x20 || c > 0x7e) {
      n += (size_t)snprintf(out + n, cap - n, "\\u%04x", c);
    } else {
      out[n++] = (char)c;
    }
  }
  out[n] = 0;
}

inline const char* b(bool v) { return v ? "true" : "false"; }

// A `"key":"text"` or `"key":null` value.
inline void strOrNull(const char* s, char* out, size_t cap) {
  if (s == nullptr) {
    snprintf(out, cap, "null");
  } else {
    char e[48];
    escape(s, e, sizeof e);
    snprintf(out, cap, "\"%s\"", e);
  }
}

struct Info {
  const char* fw;
  const char* mode;  // the mode that runs: "mod" | "steady"
  bool autoMode;     // picked by the boot probe
  unsigned close, open, settle;
  bool cal, sense;
  // The patch bay's sources / inputs (wave 22): 0 / 0 in a build with none.
  unsigned pbv, pbd;
};

inline int hello(const Info& i, char* out, size_t cap) {
  return snprintf(out, cap,
                  "{\"t\":\"hello\",\"fw\":\"%s\",\"mode\":\"%s\",\"auto\":%s,\"close\":%u,\"open\":%u,"
                  "\"settle\":%u,\"cal\":%s,\"sense\":%s,\"pbv\":%u,\"pbd\":%u}",
                  i.fw, i.mode, b(i.autoMode), i.close, i.open, i.settle, b(i.cal), b(i.sense), i.pbv, i.pbd);
}

inline int cfg(const Info& i, bool saved, char* out, size_t cap) {
  return snprintf(out, cap,
                  "{\"t\":\"cfg\",\"fw\":\"%s\",\"mode\":\"%s\",\"auto\":%s,\"close\":%u,\"open\":%u,"
                  "\"settle\":%u,\"cal\":%s,\"sense\":%s,\"pbv\":%u,\"pbd\":%u,\"saved\":%s}",
                  i.fw, i.mode, b(i.autoMode), i.close, i.open, i.settle, b(i.cal), b(i.sense), i.pbv, i.pbd,
                  b(saved));
}

inline int door(unsigned long seq, bool open, unsigned level, unsigned lit, unsigned dark, const char* fault,
                const char* warn, char* out, size_t cap) {
  char f[48], w[48];
  strOrNull(fault, f, sizeof f);
  strOrNull(warn, w, sizeof w);
  return snprintf(out, cap,
                  "{\"t\":\"door\",\"seq\":%lu,\"open\":%s,\"level\":%u,\"lit\":%u,\"dark\":%u,\"fault\":%s,"
                  "\"warn\":%s}",
                  seq, b(open), level, lit, dark, f, w);
}

inline int pong(unsigned long up, char* out, size_t cap) {
  return snprintf(out, cap, "{\"t\":\"pong\",\"up\":%lu}", up);
}

inline int cal(const char* which, unsigned ref, unsigned close, unsigned open, char* out, size_t cap) {
  return snprintf(out, cap, "{\"t\":\"cal\",\"which\":\"%s\",\"ref\":%u,\"close\":%u,\"open\":%u}", which, ref,
                  close, open);
}

// `"key":[a,b,…]` bodies: unsigned levels, and signed decodes.
inline void list(const uint16_t* v, int n, char* out, size_t cap) {
  size_t len = 0;
  out[0] = 0;
  for (int i = 0; i < n && len + 1 < cap; i++) len += (size_t)snprintf(out + len, cap - len, i ? ",%u" : "%u", (unsigned)v[i]);
}
inline void list(const int8_t* v, int n, char* out, size_t cap) {
  size_t len = 0;
  out[0] = 0;
  for (int i = 0; i < n && len + 1 < cap; i++) len += (size_t)snprintf(out + len, cap - len, i ? ",%d" : "%d", (int)v[i]);
}

// The patch bay (wave 22): `pairs` / `count` / `complete` are the settled
// bay (the one the terminal posts); `raw` / `src` the latest scan per input
// (D1 first; `src` 0 empty, 1–8 a source, −1 between levels); `stable`
// whether the latest scan is the settled bay.
inline int patch(unsigned long seq, const char* pairs, int count, bool complete, const uint16_t* raw,
                 const int8_t* src, int inputs, bool stable, char* out, size_t cap) {
  char p[64], r[96], d[64];
  escape(pairs, p, sizeof p);
  list(raw, inputs, r, sizeof r);
  list(src, inputs, d, sizeof d);
  return snprintf(out, cap,
                  "{\"t\":\"patch\",\"seq\":%lu,\"pairs\":\"%s\",\"count\":%d,\"complete\":%s,\"raw\":[%s],"
                  "\"src\":[%s],\"stable\":%s}",
                  seq, p, count, b(complete), r, d, b(stable));
}

// The bay's levels: after `pb learn V<k>` (`src` k, `raw` what it read),
// and for `pb get` / `pb save` / `pb reset` / `pb floor` / `pb tol` (`src`
// 0, `raw` 0). `saved`: the live levels are the ones in flash.
inline int pbcal(int src, unsigned raw, const uint16_t* levels, int sources, unsigned floor, unsigned tol, bool saved,
                 char* out, size_t cap) {
  char l[96];
  list(levels, sources, l, sizeof l);
  return snprintf(out, cap,
                  "{\"t\":\"pbcal\",\"src\":%d,\"raw\":%u,\"levels\":[%s],\"floor\":%u,\"tol\":%u,\"saved\":%s}",
                  src, raw, l, floor, tol, b(saved));
}

inline int ok(const char* cmd, char* out, size_t cap) {
  char c[kCmd * 2];
  escape(cmd, c, sizeof c);
  return snprintf(out, cap, "{\"t\":\"ok\",\"cmd\":\"%s\"}", c);
}

inline int err(const char* error, const char* cmd, char* out, size_t cap) {
  char e[64], c[kCmd * 2];
  escape(error, e, sizeof e);
  escape(cmd, c, sizeof c);
  return snprintf(out, cap, "{\"t\":\"err\",\"error\":\"%s\",\"cmd\":\"%s\"}", e, c);
}

// ── Commands ───────────────────────────────────────────────────────────────

enum Kind {
  kPing,
  kVersion,
  kGet,
  kCalClosed,
  kCalOpen,
  kSetClose,
  kSetOpen,
  kSetMode,
  kSetSettle,
  kSave,
  kReset,
  kPbLearn,  // pb learn V<k>: value = k
  kPbGet,
  kPbSave,
  kPbReset,
  kPbFloor,  // pb floor <n>
  kPbTol,    // pb tol <n>
  kBadValue,  // a known `set` with a value that doesn't parse
  kUnknown,
};

struct Command {
  Kind kind = kUnknown;
  long value = 0;     // set close / open / settle, pb learn / floor / tol
  char word[8] = "";  // set mode
};

// Whitespace-separated words, exactly as written (lower case).
inline Command parse(const char* line) {
  char buf[kCmd + 1];
  size_t n = 0;
  for (; line[n] && n < kCmd; n++) buf[n] = line[n];
  buf[n] = 0;
  const char* w[4] = {nullptr, nullptr, nullptr, nullptr};
  int nw = 0;
  for (char* p = buf; *p && nw < 4;) {
    while (*p && isspace((unsigned char)*p)) *p++ = 0;
    if (!*p) break;
    w[nw++] = p;
    while (*p && !isspace((unsigned char)*p)) p++;
  }
  // No command has four words, so a long line stays unknown.
  Command c;
  auto is = [&](int i, const char* s) { return i < nw && strcmp(w[i], s) == 0; };
  if (nw == 1 && is(0, "ping")) c.kind = kPing;
  else if (nw == 1 && is(0, "version")) c.kind = kVersion;
  else if (nw == 1 && is(0, "get")) c.kind = kGet;
  else if (nw == 1 && is(0, "save")) c.kind = kSave;
  else if (nw == 1 && is(0, "reset")) c.kind = kReset;
  else if (nw == 2 && is(0, "cal") && is(1, "closed")) c.kind = kCalClosed;
  else if (nw == 2 && is(0, "cal") && is(1, "open")) c.kind = kCalOpen;
  else if (nw == 3 && is(0, "set") && (is(1, "close") || is(1, "open") || is(1, "settle"))) {
    c.kind = is(1, "close") ? kSetClose : is(1, "open") ? kSetOpen : kSetSettle;
    char* end = nullptr;
    long v = strtol(w[2], &end, 10);
    if (end == w[2] || *end != 0 || !isdigit((unsigned char)w[2][0])) c.kind = kBadValue;
    else c.value = v;
  } else if (nw == 2 && is(0, "pb") && (is(1, "get") || is(1, "save") || is(1, "reset"))) {
    c.kind = is(1, "get") ? kPbGet : is(1, "save") ? kPbSave : kPbReset;
  } else if (nw == 3 && is(0, "pb") && is(1, "learn")) {
    // `V3` (or `v3`): one source digit.
    const char* v = w[2];
    c.kind = kBadValue;
    if ((v[0] == 'V' || v[0] == 'v') && isdigit((unsigned char)v[1]) && v[2] == 0 && v[1] != '0') {
      c.kind = kPbLearn;
      c.value = v[1] - '0';
    }
  } else if (nw == 3 && is(0, "pb") && (is(1, "floor") || is(1, "tol"))) {
    c.kind = is(1, "floor") ? kPbFloor : kPbTol;
    char* end = nullptr;
    long v = strtol(w[2], &end, 10);
    if (end == w[2] || *end != 0 || !isdigit((unsigned char)w[2][0])) c.kind = kBadValue;
    else c.value = v;
  } else if (nw == 3 && is(0, "set") && is(1, "mode")) {
    c.kind = kSetMode;
    snprintf(c.word, sizeof c.word, "%s", w[2]);
  }
  return c;
}

// ── Input ──────────────────────────────────────────────────────────────────
// Collects bytes into lines: `\n` ends one, `\r` is ignored, a line longer
// than kCmd is kept as its first kCmd bytes and flagged.

struct LineReader {
  char buf[kCmd + 1];
  size_t n = 0;
  bool overflow = false;

  // True when a line is complete: `line` points at it until the next feed.
  bool feed(char c, const char*& line, bool& tooLong) {
    if (c == '\r') return false;
    if (c == '\n') {
      buf[n] = 0;
      line = buf;
      tooLong = overflow;
      n = 0;
      overflow = false;
      return true;
    }
    if (n < kCmd) buf[n++] = c;
    else overflow = true;
    return false;
  }
};

// The command text echoed in a reply: the line trimmed of surrounding
// whitespace.
inline void trimmed(const char* line, char* out, size_t cap) {
  while (*line && isspace((unsigned char)*line)) line++;
  size_t n = strlen(line);
  while (n > 0 && isspace((unsigned char)line[n - 1])) n--;
  if (n >= cap) n = cap - 1;
  memcpy(out, line, n);
  out[n] = 0;
}

}  // namespace proto
