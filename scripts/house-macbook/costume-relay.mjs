#!/usr/bin/env node
// The costume's fallback (docs/trapped/costume.md, "If the iPad can't reach the
// site"): serves the Task Manager page over plain http on the LAN and forwards
// its two calls to the live server, for an iPad whose Safari can't complete the
// TLS handshake. No dependencies.
//
//   COSTUME_LINK='<the link from Run → Terminals>' node scripts/house-macbook/costume-relay.mjs [port]
//
// The link can also be the first argument, but then `ps` shows it. It holds the
// costume's token, so this never prints it, and the iPad never sees it: the page
// is served with no token and the relay adds it to each call. Only the page and
// its two calls pass through; it is no open proxy.

import { createServer } from "node:http";
import { networkInterfaces } from "node:os";

const args = process.argv.slice(2);
const raw = process.env.COSTUME_LINK ?? args.find((a) => a.includes("://")) ?? "";
const port = Number(args.find((a) => /^\d+$/u.test(a)) ?? 7108);

let link;
try {
  link = new URL(raw);
} catch {
  link = null;
}
const event = link?.searchParams.get("e");
const token = link?.searchParams.get("k");
if (!link || !event || !token) {
  console.error("Give it the link from Run → Terminals: COSTUME_LINK='…' node costume-relay.mjs [port]");
  process.exit(2);
}

const PAGE = new Map([
  ["/", "/costume"],
  ["/costume", "/costume"],
  ["/costume.js", "/costume.js"],
  ["/costume.css", "/costume.css"],
]);
const CALLS = new Set(["/api/costume/menu", "/api/costume/fire"]);
const BODY_MAX = 2048;

const relay = async (req, res) => {
  const path = new URL(req.url, "http://relay").pathname;
  if (req.method === "GET" && PAGE.has(path)) {
    const up = await fetch(`${link.origin}${PAGE.get(path)}`);
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "text/plain", "cache-control": "no-cache" });
    res.end(Buffer.from(await up.arrayBuffer()));
    return;
  }
  if (req.method !== "POST" || !CALLS.has(path)) {
    res.writeHead(404).end();
    return;
  }
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > BODY_MAX) {
      res.writeHead(413).end();
      return;
    }
  }
  const body = JSON.parse(text || "{}");
  const up = await fetch(`${link.origin}/e/${encodeURIComponent(event)}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, k: token }),
    signal: AbortSignal.timeout(4000),
  });
  res.writeHead(up.status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(await up.text());
};

createServer((req, res) => {
  relay(req, res).catch((err) => {
    console.error(`relay: ${req.method} ${new URL(req.url, "http://relay").pathname}: ${err?.name ?? "error"}`);
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
}).listen(port, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i?.family === "IPv4" && !i.internal)
    .map((i) => `http://${i.address}:${port}/`);
  console.log(`costume relay to ${link.origin}: on the iPad open ${lan.join(" or ") || `this Mac on port ${port}`}`);
});
