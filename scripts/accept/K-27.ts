// K-27 + N-06 acceptance helper (wave 7): the door code, the server-room
// cutscene and the patch-bay alarm — on the bench door with its keypad lock
// and wire-loop contact.
//
// Drives a REHEARSAL event (never the live show) with the mod code. The door
// itself is the real contact through stagehand; see K-27.md. The keypad lock
// is standalone (its code is set by hand): this helper never touches it.
//
//   node --experimental-strip-types scripts/accept/K-27.ts <cmd> --base https://app.mapsandducks.com --code <MOD CODE>
//   (or `npx tsx scripts/accept/K-27.ts …`)
//
//   setup                walk the cue chain to y2k_clock on a fresh rehearsal
//                        (Night.step 14: chess wins give the code from here)
//   persona [--name N]   add a test persona to play the winner (prints its name)
//   chess [--who N]      fire chess_won for that guest / persona (what ♟ They beat
//                        the machine does) → The Door Code in their Codex. With no
//                        --who it has no subject: # hosts says to use ♟ on a card.
//   door                 fire server_door_opened (the director's 🚪 fallback; the
//                        real path is the contact through stagehand)
//   wrong                fire patch_rejected (a wrong combo, if the bay isn't wired)
//   reset                fire reset_server_room (clears wrong_combos + both latches)
//   stay | leave         fire force_majority_stay / _leave (N-06)
//   room [--room R]      what the server-room terminal sees (wave 7): asks
//                        /api/screen/state?room=R (default The Server Room)
//                        with no terminal name — so it adds no Terminals row —
//                        and prints {id, open}; exits 1 when the room is
//                        unknown: a typo in the terminal's room= (a wave 8
//                        server resolves a declared room before the doors
//                        too; an older one reads "" until they open).
//   visit --who N [--close] [--room R]
//                        what a scan at the server-room terminal posts: fire
//                        `terminal opened` (or `terminal closed`) for that
//                        guest with at: R → at_the_heart / heart_holder
//   watch                print the server-room state every 2 s until Ctrl+C
//                        (incl. heart_holder, who is at_the_heart, the 🕊
//                        stand-down offer and talked_down)

import { TO_Y2K, pressChain } from "./chains.ts";
import { rehearsalGuard } from "./guard.ts";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name: string): string => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : undefined;
  if (v === undefined) throw new Error(`missing --${name}`);
  return v;
};
const maybe = (name: string): string | undefined => (args.includes(`--${name}`) ? opt(name) : undefined);
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
await rehearsalGuard(base, ev, token, args);
console.log(`event ${String(hit["eventId"])} · ${String(hit["title"])}`);

const SIGNALS: Record<string, string> = {
  chess: "chess_won",
  door: "server_door_opened",
  wrong: "patch_rejected",
  reset: "reset_server_room",
  stay: "force_majority_stay",
  leave: "force_majority_leave",
};

/** The server-room terminal's LOCATION (its `room=`), as the show names it. */
const HEART_ROOM = "The Server Room";

/** The Door Code's codex entry (secret; generated from facts.json). */
const DOOR_CODE = "the door code";

interface ModState {
  world: Array<{ path: string; value: string }>;
  roster: Array<{ id: string; name: string }>;
  codex?: Array<{ title: string; holders: string[] }>;
}

async function state(): Promise<ModState> {
  const r = await fetch(`${base}${ev}/api/state?role=mod&token=${encodeURIComponent(token)}`);
  if (!r.ok) throw new Error(`mod state → ${r.status}`);
  return (await r.json()) as ModState;
}

/** A guest / persona id from a name or an id (exact, then case-folded). */
async function guestId(who: string): Promise<string> {
  const { roster } = await state();
  const fold = (s: string): string => s.trim().toLowerCase();
  const row = roster.find((g) => g.id === who) ?? roster.find((g) => fold(g.name) === fold(who));
  if (row === undefined) {
    console.error(`no guest called ${who} (roster: ${roster.map((g) => g.name).join(", ") || "empty"}) — add one with: persona`);
    process.exit(1);
  }
  return row.id;
}

async function door(): Promise<string> {
  const s = await state();
  const w = new Map(s.world.map((e) => [e.path, e.value]));
  const names = new Map(s.roster.map((g) => [g.id, g.name]));
  const entry = s.codex?.find((c) => c.title.trim().toLowerCase() === DOOR_CODE);
  const holders = entry === undefined ? "(no Door Code entry — wave 7 story not loaded?)" : entry.holders.filter((h) => names.has(h)).map((h) => names.get(h)).join(", ") || "nobody";
  // A program's own var is `<id>.at_the_heart` (`<name>.` on an older journal).
  const atHeart = s.world.filter((e) => e.path.endsWith(".at_the_heart") && e.value === "true").map((e) => {
    const head = e.path.slice(0, -".at_the_heart".length);
    return names.get(head) ?? head;
  });
  return [
    `step ${w.get("Night.step")}`,
    `heart_opened ${w.get("Night.heart_opened")}`,
    `heart_holder ${w.get("Night.heart_holder")}`,
    `at_the_heart ${atHeart.join(", ") || "nobody"}`,
    `stand_down_by ${w.get("Night.stand_down_by")}`,
    `talked_down ${w.get("Night.talked_down")}`,
    `wrong_combos ${w.get("Night.wrong_combos")}`,
    `alarm_on ${w.get("Night.alarm_on")}`,
    `alarms ${w.get("Night.alarms")}`,
    `majority ${w.get("Kernel.majority")}`,
    `lights ${w.get("Night.lights")}`,
    `code holders: ${holders}`,
  ].join(" · ");
}

if (cmd === "setup") {
  // y2k_clock alone is refused on a fresh night (wave 9): walk the whole chain.
  const walked = await pressChain(TO_Y2K, (name) => post(`${ev}/api/mod/signal`, { name }, token));
  if (!walked.ok) {
    console.error("✘ the story refused a cue: this rehearsal is not on a fresh night. Restart it (Run → header → Restart) and run setup again.");
    process.exit(1);
  }
  console.log(`  ${await door()}`);
} else if (cmd === "persona") {
  const name = maybe("name") ?? "K-27 Winner";
  const r = (await post(`${ev}/api/mod/persona`, { name }, token)) as { guest?: { id: string; name: string } };
  console.log(`  persona ${r.guest?.name ?? name} (${r.guest?.id ?? "?"}) — use: chess --who "${r.guest?.name ?? name}"`);
} else if (cmd !== undefined && cmd in SIGNALS) {
  const who = cmd === "chess" ? maybe("who") : undefined;
  const subject = who === undefined ? undefined : await guestId(who);
  const r = await post(`${ev}/api/mod/signal`, { name: SIGNALS[cmd], ...(subject ? { subject } : {}) }, token);
  console.log(`  ${r["refused"] === true ? "refused (# hosts says why)" : "fired"} ${SIGNALS[cmd]}${who ? ` for ${who}` : ""}`);
  console.log(`  ${await door()}`);
} else if (cmd === "room") {
  const room = maybe("room") ?? HEART_ROOM;
  const r = await fetch(`${base}${ev}/api/screen/state?room=${encodeURIComponent(room)}`, { headers: { "x-loom-token": token } });
  if (!r.ok) throw new Error(`screen state → ${r.status}`);
  const got = ((await r.json()) as { room?: { id: string; open: boolean } }).room;
  if (got === undefined) throw new Error("no room in the screen state — the server predates wave 7");
  if (got.id === "") {
    console.error(`  room "${room}": unknown — a typo in the terminal's room= (on a server older than wave 8, also before the doors)`);
    process.exit(1);
  }
  console.log(`  room ${got.id} · open ${got.open} — ${got.open ? "the terminal is awake: it speaks this room's lines" : "the terminal sleeps on its screensaver until the room opens to everyone"}`);
} else if (cmd === "visit") {
  const who = opt("who");
  const room = maybe("room") ?? HEART_ROOM;
  const name = args.includes("--close") ? "terminal closed" : "terminal opened";
  await post(`${ev}/api/mod/signal`, { name, subject: await guestId(who), args: { at: room }, label: "K-27 visit" }, token);
  console.log(`  fired ${name} for ${who} at ${room}`);
  console.log(`  ${await door()}`);
} else if (cmd === "watch") {
  for (;;) {
    console.log(`${new Date().toLocaleTimeString()}  ${await door()}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
} else {
  console.log("usage: K-27.ts setup|persona|chess|door|wrong|reset|stay|leave|room|visit|watch --base <url> --code <mod code> [--who <guest>] [--name <persona>] [--room <location>] [--close]");
}
