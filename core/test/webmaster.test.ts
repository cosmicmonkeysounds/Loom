//! The webmaster outbox: recipient parsing, the text → HTML render, the
//! signed session cookie, and the routes over a fake sender.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { HTML_CSP } from "../server/routing.ts";
import { WebmasterPortal, parseRecipients, textToHtml, type Outgoing } from "../server/webmaster.ts";

function portal(sent: Outgoing[] = [], opts: { fail?: string; now?: () => number } = {}): WebmasterPortal {
  return new WebmasterPortal({
    password: "hunter2-but-longer",
    from: "Webmaster <webmaster@example.test>",
    secret: "s3cret",
    send: async (msg) => {
      if (opts.fail !== undefined && msg.to === opts.fail) throw new Error("bounced");
      sent.push(msg);
      return `id-${sent.length}`;
    },
    logPath: null,
    assetsDir: new URL("../server/webmaster/", import.meta.url),
    secure: false,
    now: opts.now,
  });
}

describe("parseRecipients", () => {
  it("splits on commas/semicolons/newlines, strips names, dedupes, flags junk", () => {
    const r = parseRecipients("a@x.test, Bob <b@x.test>;\nA@X.test\nnot-an-email,  ");
    expect(r.valid).toEqual(["a@x.test", "b@x.test"]);
    expect(r.invalid).toEqual(["not-an-email"]);
  });
});

describe("textToHtml", () => {
  it("escapes, paragraphs, line breaks, and links", () => {
    const html = textToHtml("Hi <you>,\nsee https://mapsandducks.com.\n\nBye");
    expect(html).toContain("<p>Hi &lt;you&gt;,<br>see <a href=\"https://mapsandducks.com\">https://mapsandducks.com</a>.</p>");
    expect(html).toContain("<p>Bye</p>");
  });
});

describe("session cookie", () => {
  it("validates its own cookie, rejects tampering and expiry", () => {
    let t = 1_000;
    const p = portal([], { now: () => t });
    const c = p.mintSession();
    expect(p.validSession(c)).toBe(true);
    expect(p.validSession(c.replace(/.$/, (ch) => (ch === "A" ? "B" : "A")))).toBe(false);
    expect(p.validSession(`${Number(c.split(".")[0]) + 1}.${c.split(".")[1]}`)).toBe(false);
    t += 13 * 60 * 60_000;
    expect(p.validSession(c)).toBe(false);
  });
});

describe("routes", () => {
  let server: Server | null = null;
  afterEach(() => server?.close());

  async function boot(p: WebmasterPortal): Promise<string> {
    server = createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      void p.handle(req, res, req.method ?? "GET", path, HTML_CSP).then((hit) => {
        if (!hit) {
          res.writeHead(404);
          res.end();
        }
      });
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  it("serves the page, gates the API, and sends one copy per recipient", async () => {
    const sent: Outgoing[] = [];
    const p = portal(sent, { fail: "c@x.test" });
    const base = await boot(p);

    const page = await fetch(`${base}/webmaster/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toBe(HTML_CSP);

    const post = (path: string, body: unknown, cookie?: string) =>
      fetch(`${base}/webmaster/api/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });

    expect((await post("send", { to: "a@x.test", subject: "s", body: "b" })).status).toBe(401);
    expect((await post("login", { password: "nope" })).status).toBe(401);

    const login = await post("login", { password: "hunter2-but-longer" });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/webmaster");
    const cookie = setCookie.split(";")[0]!;

    expect((await post("send", { to: "a@x.test, junk", subject: "s", body: "b" }, cookie)).status).toBe(400);
    expect((await post("send", { to: "a@x.test", subject: "s", body: "b", replyTo: "bad" }, cookie)).status).toBe(400);

    const res = await post("send", { to: "a@x.test, b@x.test, c@x.test", subject: "Party", body: "9pm" }, cookie);
    expect(res.status).toBe(200);
    const out = (await res.json()) as { results: { to: string; ok: boolean; error?: string }[] };
    expect(out.results.map((r) => [r.to, r.ok])).toEqual([
      ["a@x.test", true],
      ["b@x.test", true],
      ["c@x.test", false],
    ]);
    expect(sent.map((m) => m.to)).toEqual(["a@x.test", "b@x.test"]);
    expect(sent[0]!.from).toBe("Webmaster <webmaster@example.test>");
    expect(sent[0]!.replyTo).toBe("Webmaster <webmaster@example.test>");

    const log = (await (await fetch(`${base}/webmaster/api/sent`, { headers: { cookie } })).json()) as {
      sent: { to: string }[];
    };
    expect(log.sent.map((e) => e.to)).toEqual(["c@x.test", "b@x.test", "a@x.test"]);
  });

  it("throttles wrong passwords", async () => {
    const base = await boot(portal());
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (
        await fetch(`${base}/webmaster/api/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: "wrong" }),
        })
      ).status;
    }
    expect(last).toBe(429);
  });
});
