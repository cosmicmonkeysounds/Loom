// Scratch driver for the cguest lane's look (delete after).
import { chromium } from "@playwright/test";
import fs from "node:fs";
const T = "/private/tmp/claude-501/-Users-jjm-Documents-prism-root-packages-loom/48531eda-f103-4eaa-b0ab-f01b11605d66/scratchpad/w13/int/cguest-tools/";
const SHOTS = "/private/tmp/claude-501/-Users-jjm-Documents-prism-root-packages-loom/48531eda-f103-4eaa-b0ab-f01b11605d66/scratchpad/w13/int/shots-cguest/";
const lib = await import(T + "lib.mjs");
const [script, guestName, w, h] = process.argv.slice(2);
const c = lib.cfg();
const g = c.guests[guestName];
const browser = await chromium.launch();
const phone = Number(w) < 700;
const ctx = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, isMobile: phone, hasTouch: phone, deviceScaleFactor: 2 });
await ctx.addInitScript((me) => {
  try { if (!localStorage.getItem("loom.guest")) localStorage.setItem("loom.guest", JSON.stringify(me)); } catch {}
}, { id: g.id, name: g.name, token: g.token, eventId: "default", title: "Trapped in the Internet" });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
const log = [];
page.on("console", (m) => { if (m.type() === "error") log.push(m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { await page.screenshot({ path: SHOTS + name + ".png" }); console.log("shot", name); };
const tap = async (sel) => { const el = page.locator(sel).first(); if (phone) await el.tap(); else await el.click(); };
await page.goto(lib.B + "/");
await sleep(2500);
const steps = (await import(T + script)).default;
try {
  await steps({ page, lib, c, g, sleep, shot, tap, phone });
} catch (e) {
  console.log("ERR", e.message);
  await shot("zz-error-" + script.replace(/\W/g, ""));
}
if (log.length) console.log("console errors:", log.slice(0, 5).join(" | "));
await browser.close();
