//! Wave 14 — the `/cards` page: every room check-in, codex fact, join and
//! invitation QR on one screen, made to be scanned off a laptop or the TV
//! with a phone (nothing is printed). Self-contained: one HTML page + one
//! script (`/cards.js`, since the CSP allows no inline script), no build
//! step. It holds no secrets: it asks for the moderator passcode, resolves
//! it (`/api/resolve-code`), signs in (`/e/:id/api/mod/login`) and reads
//! `GET /e/:id/api/mod/cards` (`routes/cards.ts`), whose SVGs it shows.

import type { ServerResponse } from "node:http";

const CSS = `
:root{--bg:#0d1016;--panel:#161b24;--line:#2a3140;--text:#eef2f8;--dim:#9aa6b8;--accent:#ffd34d;--ok:#3ddc84;--bad:#ff6b6b}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
button,input{font:inherit;color:inherit}
button{cursor:pointer}
.hidden{display:none!important}
header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center}
header h1{font-size:20px;margin:0;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tabs{display:flex;gap:6px}
.tab{background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:6px 14px;font-weight:600}
.tab[aria-selected=true]{background:var(--accent);color:#111;border-color:var(--accent)}
.tab span{opacity:.7;font-weight:500;margin-left:4px}
#q{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:7px 10px;min-width:0;width:220px;max-width:100%}
.tools{display:flex;gap:8px;align-items:center}
.ghost{background:none;border:1px solid var(--line);border-radius:8px;padding:6px 10px;color:var(--dim)}
.ghost:hover,.ghost:focus-visible{color:var(--text);border-color:var(--dim)}
main{padding:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:16px}
.group{grid-column:1/-1;margin:10px 0 -4px;color:var(--dim);font-size:13px;letter-spacing:.08em;text-transform:uppercase;display:flex;gap:8px;align-items:center}
.dot{width:12px;height:12px;border-radius:50%;display:inline-block;border:1px solid #0004}
.card{background:#fff;color:#111;border:0;border-radius:14px;padding:14px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px;position:relative;outline-offset:3px}
.card:focus-visible{outline:3px solid var(--accent)}
.card.done{opacity:.55}
.qr{width:240px;max-width:100%;aspect-ratio:1}
.qr svg{width:100%;height:100%;display:block;shape-rendering:crispEdges}
.card .t{font-weight:700;font-size:18px;line-height:1.2}
.card .s{font-size:13px;color:#555}
.code{font:700 22px/1.1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.06em;word-break:break-all}
.tag{position:absolute;top:8px;font-size:11px;font-weight:700;border-radius:6px;padding:2px 6px}
.tag.l{left:8px;background:#222;color:#fff}
.tag.r{right:8px;background:var(--ok);color:#042}
.empty{color:var(--dim);padding:40px 0;text-align:center}
#login{max-width:420px;margin:12vh auto;padding:24px;background:var(--panel);border:1px solid var(--line);border-radius:14px}
#login h1{margin:0 0 6px;font-size:24px}
#login p{color:var(--dim);margin:0 0 16px}
#login input{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;font-size:20px;letter-spacing:.08em}
#login button{margin-top:12px;width:100%;background:var(--accent);color:#111;border:0;border-radius:8px;padding:12px;font-weight:700;font-size:18px}
.err{color:var(--bad);margin-top:12px;min-height:1.4em;font-weight:600}
#status{padding:8px 16px;color:var(--bad);font-weight:600}
#show{position:fixed;inset:0;z-index:20;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2vh;padding:2vh 2vw;touch-action:pan-y}
#show .st{color:#fff;font-weight:800;font-size:clamp(20px,4vh,44px);text-align:center;line-height:1.15;max-width:92vw}
#show .ss{color:#bbb;font-size:clamp(14px,2.2vh,22px);text-align:center}
#show .bigqr{background:#fff;padding:2vmin;border-radius:12px;width:min(92vw,calc(100vh - 260px));height:min(92vw,calc(100vh - 260px));min-width:160px;min-height:160px}
#show .bigqr svg{width:100%;height:100%;display:block;shape-rendering:crispEdges;image-rendering:pixelated}
#show .code{color:#fff;font-size:clamp(24px,5vh,56px)}
#show .bar{display:flex;gap:12px;align-items:center;color:#ccc}
#show .bar button{background:#1d2330;border:1px solid #333c4d;border-radius:10px;padding:8px 14px;color:#fff;font-weight:600}
#show .bar button.on{background:var(--ok);color:#042;border-color:var(--ok)}
#show .nav{position:fixed;top:50%;transform:translateY(-50%);background:#ffffff14;border:0;color:#fff;font-size:40px;width:56px;height:96px;border-radius:12px}
#show .nav:hover{background:#ffffff2a}
#show .prev{left:8px}#show .next{right:8px}
#show .close{position:fixed;top:10px;right:12px;background:#ffffff14;border:0;color:#fff;font-size:26px;width:48px;height:48px;border-radius:50%}
@media (max-width:600px){header h1{flex-basis:100%}#q{flex:1 1 100%;width:auto;order:3}.grid{grid-template-columns:1fr}#show .nav{width:40px;height:72px;font-size:28px}}
`;

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>QR cards</title>
<style>${CSS}</style></head>
<body>
<section id="login" class="hidden">
  <h1>QR cards</h1>
  <p>Every room and fact QR, ready to scan off this screen. Enter the moderator passcode.</p>
  <form id="loginForm"><input id="pass" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Moderator passcode" aria-label="Moderator passcode">
  <button type="submit">Show the cards</button></form>
  <div class="err" id="loginErr" role="alert"></div>
</section>
<div id="app" class="hidden">
  <header>
    <h1 id="title">QR cards</h1>
    <div class="tabs" role="tablist" id="tabs"></div>
    <input id="q" type="search" placeholder="Search title, code, stack" aria-label="Search">
    <div class="tools"><button class="ghost" id="refresh" title="Refetch">↻</button><button class="ghost" id="forget">Forget passcode</button></div>
  </header>
  <div id="status" class="hidden" role="alert"></div>
  <main><div class="grid" id="grid"></div></main>
</div>
<div id="show" class="hidden" role="dialog" aria-modal="true">
  <button class="close" id="sClose" aria-label="Close">✕</button>
  <button class="nav prev" id="sPrev" aria-label="Previous">‹</button>
  <button class="nav next" id="sNext" aria-label="Next">›</button>
  <div class="st" id="sTitle"></div>
  <div class="ss" id="sSub"></div>
  <div class="bigqr" id="sQr"></div>
  <div class="code" id="sCode"></div>
  <div class="bar"><span id="sCount"></span><button id="sDone">✓ scanned</button></div>
</div>
<script src="/cards.js"></script>
</body></html>`;

const JS = `(() => {
"use strict";
const KEY = "loom.cards", DONE = "loom.cards.done";
const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
let done = {};
try { done = JSON.parse(store.get(DONE) || "{}") || {}; } catch { done = {}; }
const saveDone = () => store.set(DONE, JSON.stringify(done));
const TABS = [["rooms", "Rooms", ["rooms"]], ["facts", "Facts", ["facts"]], ["other", "Other", ["join", "invitations"]]];
let auth = null; // {eventId, token, passcode}
let data = null;
let tab = "rooms";
let list = []; // the current filtered items
let showing = -1;

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function api(path, body, token) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers["x-loom-token"] = token;
  let res;
  try {
    res = await fetch(path, { method: body !== undefined ? "POST" : "GET", headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: "no-store" });
  } catch {
    throw Object.assign(new Error("Can't reach the server. Is it running? Check the Wi-Fi and try ↻."), { status: 0 });
  }
  let json = {};
  try { json = await res.json(); } catch {}
  if (!res.ok) throw Object.assign(new Error(json.error || ("HTTP " + res.status)), { status: res.status });
  return json;
}

async function signIn(passcode) {
  let hit;
  try { hit = await api("/api/resolve-code", { code: passcode }); }
  catch (e) {
    if (e.status === 404 || e.status === 403) throw new Error("That passcode isn't right. Use the moderator (director) passcode.");
    if (e.status === 429) throw new Error("Too many tries — wait a minute, then try again.");
    throw e;
  }
  if (hit.role !== "mod") throw new Error("That's the " + (hit.role === "guest" ? "guest" : "performer") + " code. These cards need the moderator passcode.");
  const login = await api("/e/" + encodeURIComponent(hit.eventId) + "/api/mod/login", { passcode });
  auth = { eventId: hit.eventId, token: login.token, passcode };
}

async function load(retry) {
  setStatus("");
  try {
    data = await api("/e/" + encodeURIComponent(auth.eventId) + "/api/mod/cards", undefined, auth.token);
  } catch (e) {
    if (!retry && (e.status === 401 || e.status === 403 || e.status === 404)) {
      // A restarted server forgets tokens: sign in again once.
      try { await signIn(auth.passcode); return load(true); } catch (e2) { return fail(e2); }
    }
    return fail(e);
  }
  document.title = (data.title || "Loom") + " — QR cards";
  $("title").textContent = (data.title || "Loom") + " · QR cards";
  render();
}

function fail(e) {
  if (data) setStatus(e.message);
  else { showLogin(); $("loginErr").textContent = e.message; }
}
function setStatus(msg) { $("status").textContent = msg; $("status").classList.toggle("hidden", !msg); }

function itemsFor(id) {
  const kinds = TABS.find((t) => t[0] === id)[2];
  return (data ? data.sections : []).filter((s) => kinds.includes(s.kind)).flatMap((s) => s.items.map((it) => Object.assign({ section: s.label }, it)));
}

function matches(it, q) {
  if (!q) return true;
  return [it.title, it.code, it.stack, it.sub, it.section].some((v) => v && String(v).toLowerCase().includes(q));
}

function render() {
  $("tabs").innerHTML = TABS.map(([id, label]) => '<button class="tab" role="tab" data-tab="' + id + '" aria-selected="' + (id === tab) + '">' + label + "<span>" + itemsFor(id).length + "</span></button>").join("");
  const q = $("q").value.trim().toLowerCase();
  list = itemsFor(tab).filter((it) => matches(it, q));
  if (list.length === 0) { $("grid").innerHTML = '<div class="empty">' + (q ? "Nothing matches “" + esc(q) + "”." : "No cards here.") + "</div>"; return; }
  let html = "", group = null;
  list.forEach((it, i) => {
    const g = tab === "facts" ? (it.stack || "not on a stack") : tab === "other" ? it.section : null;
    if (g !== null && g !== group) {
      group = g;
      html += '<div class="group">' + (it.colour ? '<span class="dot" style="background:' + esc(cssColour(it.colour)) + '"></span>' : "") + esc(g) + "</div>";
    }
    const tags = (it.secret ? '<span class="tag l">secret</span>' : it.hidden ? '<span class="tag l">opens later</span>' : "") + (done[it.ref] ? '<span class="tag r">✓ scanned</span>' : "");
    html += '<button class="card' + (done[it.ref] ? " done" : "") + '" data-i="' + i + '">' + tags + '<div class="qr">' + it.svg + '</div><div class="t">' + esc(it.title) + "</div>" + (it.sub ? '<div class="s">' + esc(it.sub) + "</div>" : "") + (it.code ? '<div class="code">' + esc(it.code) + "</div>" : "") + "</button>";
  });
  $("grid").innerHTML = html;
}

function cssColour(c) {
  return ({ gold: "#e5b100", silver: "#c0c6cf", green: "#33b864", blue: "#3b82f6", red: "#ef4444" })[c] || (/^[a-z]+$/i.test(c) ? c : "#888");
}

function present(i) {
  if (list.length === 0) return;
  showing = (i + list.length) % list.length;
  const it = list[showing];
  $("sTitle").textContent = it.title;
  $("sSub").textContent = [it.secret ? "secret" : "", it.sub || ""].filter(Boolean).join(" · ");
  $("sQr").innerHTML = it.svg;
  $("sCode").textContent = it.code || "";
  $("sCount").textContent = (showing + 1) + " of " + list.length;
  $("sDone").classList.toggle("on", !!done[it.ref]);
  $("sDone").textContent = done[it.ref] ? "✓ scanned" : "mark scanned";
  $("show").classList.remove("hidden");
}
function closeShow() {
  if (showing < 0) return;
  const was = showing;
  showing = -1;
  $("show").classList.add("hidden");
  render();
  const el = document.querySelector('.card[data-i="' + was + '"]');
  if (el) el.focus();
}
function toggleDone() {
  const it = list[showing];
  if (!it) return;
  if (done[it.ref]) delete done[it.ref]; else done[it.ref] = Date.now();
  saveDone();
  present(showing);
}

function showLogin() {
  $("app").classList.add("hidden");
  $("login").classList.remove("hidden");
  $("pass").focus();
}
function showApp() {
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
}

$("loginForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const pass = $("pass").value.trim();
  $("loginErr").textContent = "";
  if (!pass) { $("loginErr").textContent = "Type the moderator passcode."; return; }
  const btn = ev.target.querySelector("button");
  btn.disabled = true;
  try {
    await signIn(pass);
    store.set(KEY, pass);
    showApp();
    await load(true);
  } catch (e) { $("loginErr").textContent = e.message; }
  finally { btn.disabled = false; }
});
$("forget").addEventListener("click", () => { store.del(KEY); auth = null; data = null; $("pass").value = ""; showLogin(); });
$("refresh").addEventListener("click", () => auth && load(false));
$("q").addEventListener("input", render);
$("tabs").addEventListener("click", (ev) => { const b = ev.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; render(); } });
$("grid").addEventListener("click", (ev) => { const c = ev.target.closest(".card"); if (c) present(Number(c.dataset.i)); });
$("sClose").addEventListener("click", closeShow);
$("sPrev").addEventListener("click", () => present(showing - 1));
$("sNext").addEventListener("click", () => present(showing + 1));
$("sDone").addEventListener("click", toggleDone);
document.addEventListener("keydown", (ev) => {
  if (showing < 0) return;
  if (ev.key === "Escape") { ev.preventDefault(); closeShow(); }
  else if (ev.key === "ArrowRight" || ev.key === "PageDown") { ev.preventDefault(); present(showing + 1); }
  else if (ev.key === "ArrowLeft" || ev.key === "PageUp") { ev.preventDefault(); present(showing - 1); }
  else if (ev.key === " " || ev.key === "Enter") { if (ev.target === document.body || ev.target.id === "sDone") return; }
});
let touchX = null;
$("show").addEventListener("touchstart", (ev) => { touchX = ev.touches.length === 1 ? ev.touches[0].clientX : null; }, { passive: true });
$("show").addEventListener("touchend", (ev) => {
  if (touchX === null) return;
  const dx = ev.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) present(showing + (dx < 0 ? 1 : -1));
});

const saved = store.get(KEY);
if (saved) {
  $("pass").value = saved;
  signIn(saved).then(() => { showApp(); return load(true); }).catch((e) => { showLogin(); $("loginErr").textContent = e.message; });
} else showLogin();
})();
`;

export const CARDS_HTML = HTML;
export const CARDS_JS = JS;

/** `GET /cards`, `/cards/` → the page; `GET /cards.js` → its script. False = not ours. */
export function serveCardsPage(method: string, path: string, res: ServerResponse, csp: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (path === "/cards" || path === "/cards/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": csp, "cache-control": "no-cache" });
    res.end(method === "HEAD" ? undefined : CARDS_HTML);
    return true;
  }
  if (path === "/cards.js") {
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
    res.end(method === "HEAD" ? undefined : CARDS_JS);
    return true;
  }
  return false;
}
