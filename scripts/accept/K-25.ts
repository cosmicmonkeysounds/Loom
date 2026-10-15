// K-25 acceptance helper: the awards ceremony as story beats.
//
// Drives a REHEARSAL event (never the live show) with the mod code. The
// lines land in The Desktop room (watch on a phone / Run → Chat); the TV
// speaks Trabolta's (K-18) and shows the award slide (K-17). See K-25.md.
//
//   node --experimental-strip-types scripts/accept/K-25.ts <cmd> --base https://app.mapsandducks.com --code <MOD CODE>
//
//   end <ending>             rehearsal shortcut: Night.ended = true, Night.ending = <ending>,
//                            Night.ceremony = false (so G1 can run again for another host)
//                            (song · song_pickup · help · hand_jive · disabled → Trabolta hosts;
//                             destroyed · rave → Clippy hosts)
//   start                    fire start_the_ceremony
//   award <name> <who> [v]   fire award_<name> for <who> (a guest's name or id), value v optional
//                            names: most_trusted least_trusted frequent_flyer lore_hoarder
//                                   truthcoin_tycoon best_liar duck_speedrun quest_completionist
//   three                    most_trusted / frequent_flyer / best_liar (value 2) on the first
//                            three guests in the roster
//   status                   print the ceremony state

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name: string): string => {
  const i = args.indexOf(`--${name}`);
  const v = i >= 0 ? args[i + 1] : undefined;
  if (v === undefined) throw new Error(`missing --${name}`);
  return v;
};
const positional = args.slice(1).filter((a, i, all) => !a.startsWith("--") && !(all[i - 1] ?? "").startsWith("--"));
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

interface ModState {
  world: Array<{ path: string; value: string }>;
  roster: Array<{ id: string; name: string }>;
}
async function state(): Promise<ModState> {
  const r = await fetch(`${base}${ev}/api/state?role=mod&token=${encodeURIComponent(token)}`);
  return (await r.json()) as ModState;
}
async function status(): Promise<string> {
  const w = new Map((await state()).world.map((e) => [e.path, e.value]));
  return ["ended", "ending", "ceremony", "ceremony_host", "award", "award_winner", "award_value", "awards_given", "screen"]
    .map((k) => `${k} ${w.get(`Night.${k}`)}`)
    .join(" · ");
}
async function who(name: string): Promise<string> {
  const { roster } = await state();
  const f = name.trim().toLowerCase();
  const row = roster.find((r) => r.id === name || r.name.toLowerCase() === f);
  if (row === undefined) throw new Error(`no guest "${name}" — roster: ${roster.map((r) => r.name).join(", ")}`);
  return row.id;
}
async function award(name: string, subject: string, value?: string): Promise<void> {
  const v = value === undefined ? undefined : /^-?\d+(\.\d+)?$/u.test(value) ? Number(value) : value;
  await post(`${ev}/api/mod/signal`, { name: `award_${name}`, subject, ...(v === undefined ? {} : { args: { value: v } }) }, token);
  console.log(`  fired award_${name} for ${subject}${v === undefined ? "" : ` (value ${v})`}`);
}

if (cmd === "end") {
  const ending = positional[0];
  if (ending === undefined) throw new Error("end <ending>");
  await post(`${ev}/api/mod/var`, { path: "Night.ending", value: ending }, token);
  await post(`${ev}/api/mod/var`, { path: "Night.ended", value: "true" }, token);
  await post(`${ev}/api/mod/var`, { path: "Night.ceremony", value: "false" }, token);
  console.log(`  ${await status()}`);
} else if (cmd === "start") {
  await post(`${ev}/api/mod/signal`, { name: "start_the_ceremony" }, token);
  console.log(`  ${await status()}`);
} else if (cmd === "award") {
  const [name, person, value] = positional;
  if (name === undefined || person === undefined) throw new Error("award <name> <who> [value]");
  await award(name, await who(person), value);
  console.log(`  ${await status()}`);
} else if (cmd === "three") {
  const { roster } = await state();
  if (roster.length < 3) throw new Error(`need 3 guests joined, have ${roster.length}`);
  await award("most_trusted", roster[0]!.id);
  await award("frequent_flyer", roster[1]!.id);
  await award("best_liar", roster[2]!.id, "2");
  console.log(`  ${await status()}`);
} else if (cmd === "status") {
  console.log(`  ${await status()}`);
} else {
  console.log("usage: K-25.ts end <ending>|start|award <name> <who> [value]|three|status --base <url> --code <mod code>");
}
