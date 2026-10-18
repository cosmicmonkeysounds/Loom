// A stand-in event server for the compose healthcheck test in run.sh:
//   node fake-loom.mjs <mode>     → prints "ready <port>" (a free port)
// mode `up` → /api/health 200 · `starting` → 503 · `old` → 404 there and
// the play shell at / answers 200 (an image older than the route) ·
// `dead` → 500 everywhere.
import { createServer } from "node:http";
const [mode] = process.argv.slice(2);
const server = createServer((req, res) => {
  const health = req.url === "/api/health";
  const code = mode === "dead" ? 500 : health ? { up: 200, starting: 503, old: 404 }[mode] ?? 500 : 200;
  res.writeHead(code, { "content-type": "application/json" }).end(health ? JSON.stringify({ ok: code === 200 }) : "<!doctype html>");
});
server.listen(0, "127.0.0.1", () => process.stdout.write(`ready ${server.address().port}\n`));
