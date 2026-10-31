#!/usr/bin/env node
// Serves ISRG Root X1 over plain http on the LAN, as a profile Safari on iOS 9
// will offer to install (docs/trapped/costume.md). The iPad can't reach
// letsencrypt.org to fetch it, because its root store is why it can't reach
// anything else. The certificate comes from this Mac's own system roots and its
// fingerprint is checked. No dependencies, macOS only.
//
//   COSTUME_LINK='<the link from Run → Terminals>' node scripts/house-macbook/costume-root.mjs [port]
//
// Open http://<this Mac>:<port>/ in Safari on the iPad and tap the first link.
// With COSTUME_LINK set the page offers the costume's link too, so nobody types
// it on an iPad 2, which has no AirDrop. That page holds the token: stop this
// once the iPad has it. The link is never printed.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";

const port = Number(process.argv[2] ?? 7109);
/** ISRG Root X1's SHA-256, as Let's Encrypt publishes it. */
const FINGERPRINT = "96bcec06264976f37460779acf28c5a7cfe8a3c0aae11a8ffcee05c0bddf08c6";
const KEYCHAIN = "/System/Library/Keychains/SystemRootCertificates.keychain";

const pem = execFileSync("security", ["find-certificate", "-c", "ISRG Root X1", "-p", KEYCHAIN], { encoding: "utf8" });
const der = Buffer.from(pem.replace(/-----[A-Z ]+-----|\s/gu, ""), "base64");
if (createHash("sha256").update(der).digest("hex") !== FINGERPRINT) {
  console.error("That is not ISRG Root X1: its fingerprint doesn't match. Nothing served.");
  process.exit(1);
}

const link = process.env.COSTUME_LINK ?? "";
const row = (href, text) => `<p style="font:32px Helvetica;margin:40px"><a href="${href}">${text}</a></p>`;
const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Root</title>${row("/isrg-root-x1.cer", "1. Install ISRG Root X1")}${link !== "" ? row(link.replace(/&/gu, "&amp;"), "2. Open the costume") : ""}`;

createServer((req, res) => {
  if (req.url === "/isrg-root-x1.cer") {
    res.writeHead(200, { "content-type": "application/x-x509-ca-cert", "content-length": der.length });
    res.end(der);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(PAGE);
}).listen(port, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i?.family === "IPv4" && !i.internal)
    .map((i) => `http://${i.address}:${port}/`);
  console.log(`ISRG Root X1 (${FINGERPRINT.slice(0, 16)}…): on the iPad open ${lan.join(" or ")}`);
});
