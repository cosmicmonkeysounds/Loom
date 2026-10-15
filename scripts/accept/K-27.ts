// K-27 + N-06 acceptance helper: the Cold Lock (chess disarm window),
// re-arm, and the forced majorities — on the 10-22 bench reed.
//
// Drives a REHEARSAL event (never the live show) with the mod code. The
// door itself is the real reed through stagehand; see K-27.md.
//
//   node --experimental-strip-types scripts/accept/K-27.ts <cmd> --base https://app.mapsandducks.com --code <MOD CODE>
//   (or `npx tsx scripts/accept/K-27.ts …`)
//
//   setup   fire y2k_clock (Night.step 14: the door is armed from here)
//   chess   fire chess_won (what ♟ They beat the machine does) → 90 s window
//   rearm   fire rearm_server_room (locked, latch cleared, window closed)
//   stay    fire force_majority_stay   (N-06)
//   leave   fire force_majority_leave  (N-06)
//   watch   print the door state every 2 s until Ctrl+C

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name: string): string => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : undefined;
  if (v === undefined) throw new Error(`missing --${name}`);
  return v;
};
const base = opt("base").replace(/\/$/u, "");
const code = opt("code");

async function post(path: string, body: Record<string, unknown>, token?: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-loom-token": token } : {}) },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}

const hit = await post("/api/resolve-code", { code });
if (hit["role"] !== "mod") throw new Error("that is not the event's mod code");
const ev = `/e/${String(hit["eventId"])}`;
const { token } = (await post(`${ev}/api/mod/login`, { passcode: code })) as { token: string };
console.log(`event ${String(hit["eventId"])} · ${String(hit["title"])}`);

const SIGNALS: Record<string, string> = {
  setup: "y2k_clock",
  chess: "chess_won",
  rearm: "rearm_server_room",
  stay: "force_majority_stay",
  leave: "force_majority_leave",
};

async function door(): Promise<string> {
  const r = await fetch(`${base}${ev}/api/state?role=mod&token=${encodeURIComponent(token)}`);
  const s = (await r.json()) as { world: Array<{ path: string; value: string }> };
  const w = new Map(s.world.map((e) => [e.path, e.value]));
  const now = Number(w.get("Time.elapsed") ?? NaN);
  const until = Number(w.get("Kernel.disarmed_until") ?? 0);
  const left = until <= 0 ? "closed" : Number.isFinite(now) ? `${Math.max(0, Math.round(until - now))} s left` : `open (until t=${until})`;
  return [
    `step ${w.get("Night.step")}`,
    `window ${left}`,
    `unlocked ${w.get("Kernel.server_unlocked")}`,
    `alarm_on ${w.get("Night.alarm_on")}`,
    `alarms ${w.get("Night.alarms")}`,
    `majority ${w.get("Kernel.majority")}`,
    `lights ${w.get("Night.lights")}`,
  ].join(" · ");
}

if (cmd !== undefined && cmd in SIGNALS) {
  await post(`${ev}/api/mod/signal`, { name: SIGNALS[cmd] }, token);
  console.log(`  fired ${SIGNALS[cmd]}`);
  console.log(`  ${await door()}`);
} else if (cmd === "watch") {
  for (;;) {
    console.log(`${new Date().toLocaleTimeString()}  ${await door()}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
} else {
  console.log("usage: K-27.ts setup|chess|rearm|stay|leave|watch --base <url> --code <mod code>");
}
