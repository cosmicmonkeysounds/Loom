// A tiny reader for the flat JSON objects stagehand publishes
// ({"state": "on", "seconds": 120}). No nesting, no escapes: enough for
// show/serverroom/* without pulling in ArduinoJson. A payload that is not an
// object counts as its own "state"/"mode" (handy for mosquitto_pub -m locked).
#pragma once
#include <ctype.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>

namespace msg {

inline const char* skipWs(const char* p) {
  while (*p && isspace((unsigned char)*p)) p++;
  return p;
}

inline bool isObject(const char* s) { return *skipWs(s) == '{'; }

// Copies the value of `key` (string unquoted, number/bool as written) into
// out. False when the key is absent.
inline bool field(const char* s, const char* key, char* out, size_t cap) {
  if (cap == 0) return false;
  size_t klen = strlen(key);
  for (const char* p = strchr(s, '"'); p; p = strchr(p + 1, '"')) {
    if (strncmp(p + 1, key, klen) != 0 || p[1 + klen] != '"') continue;
    const char* v = skipWs(p + 2 + klen);
    if (*v != ':') continue;
    v = skipWs(v + 1);
    size_t n = 0;
    if (*v == '"') {
      for (v++; *v && *v != '"' && n + 1 < cap; v++) out[n++] = *v;
    } else {
      for (; *v && *v != ',' && *v != '}' && !isspace((unsigned char)*v) && n + 1 < cap; v++) out[n++] = *v;
    }
    out[n] = 0;
    return true;
  }
  return false;
}

// The payload trimmed, for plain (non-JSON) payloads.
inline void plain(const char* s, char* out, size_t cap) {
  s = skipWs(s);
  size_t n = 0;
  while (s[n] && n + 1 < cap) {
    out[n] = s[n];
    n++;
  }
  while (n > 0 && isspace((unsigned char)out[n - 1])) n--;
  out[n] = 0;
}

// `key`'s value, or the whole plain payload when it is not an object.
inline bool text(const char* s, const char* key, char* out, size_t cap) {
  if (isObject(s)) return field(s, key, out, cap);
  plain(s, out, cap);
  return out[0] != 0;
}

inline long number(const char* s, const char* key, long fallback) {
  char buf[24];
  if (!isObject(s) || !field(s, key, buf, sizeof buf) || !buf[0]) return fallback;
  char* end = nullptr;
  long v = strtol(buf, &end, 10);
  return end == buf ? fallback : v;
}

}  // namespace msg
