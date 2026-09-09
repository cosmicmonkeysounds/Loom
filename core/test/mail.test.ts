//! Outbound mail: the invite copy is pure, the transport is picked from the
//! environment, and a missing provider degrades to a logged message (so the
//! invite link still surfaces) rather than a failed request.

import { describe, expect, it } from "vitest";

import { ConsoleMailer, ResendMailer, escapeHtml, inviteEmail, mailerFromEnv } from "../server/mail.ts";

const base = {
  to: "friend@example.test",
  inviterName: "Ada",
  projectName: "Escape <the> Internet",
  url: "https://app.example.test/edit/?invite=abc123",
};

describe("inviteEmail", () => {
  it("names the inviter + project and carries the link in text and html", () => {
    const m = inviteEmail({ ...base, hasAccount: false });
    expect(m.to).toBe(base.to);
    expect(m.subject).toBe("Ada shared “Escape <the> Internet” with you on Loom");
    expect(m.text).toContain(base.url);
    expect(m.text).toContain("Create a free author account");
    expect(m.html).toContain(`href="${base.url}"`);
    // Project names are escaped in the HTML body, never injected raw.
    expect(m.html).toContain("Escape &lt;the&gt; Internet");
    expect(m.html).not.toContain("<the>");
  });

  it("tells an existing account to sign in instead of sign up", () => {
    const m = inviteEmail({ ...base, hasAccount: true });
    expect(m.text).toContain("Sign in");
    expect(m.text).not.toContain("Create a free author account");
  });

  it("escapeHtml covers the five specials", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });
});

describe("mailerFromEnv", () => {
  it("prefers SMTP, then Resend, then the console fallback", () => {
    expect(mailerFromEnv({ smtpUrl: "smtp://u:p@localhost:2525", resendApiKey: "re_x", from: "a@b" }).kind).toBe("smtp");
    expect(mailerFromEnv({ smtpUrl: "", resendApiKey: "re_x", from: "a@b" }).kind).toBe("resend");
    expect(mailerFromEnv({ smtpUrl: "", resendApiKey: "", from: "a@b" }).kind).toBe("none");
  });

  it("the console fallback logs the recipient, subject and body", async () => {
    const lines: string[] = [];
    await new ConsoleMailer((l) => lines.push(l)).send(inviteEmail({ ...base, hasAccount: false }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(base.to);
    expect(lines[0]).toContain(base.url);
  });

  it("Resend posts the message with the API key and surfaces HTTP errors", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = new ResendMailer("re_key", "Loom <no-reply@example.test>", (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response("{}", { status: 200 });
    }) as typeof fetch);
    await ok.send(inviteEmail({ ...base, hasAccount: false }));
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer re_key");
    const body = JSON.parse(calls[0]!.init.body as string) as { from: string; to: string[]; subject: string };
    expect(body.from).toBe("Loom <no-reply@example.test>");
    expect(body.to).toEqual([base.to]);

    const failing = new ResendMailer("re_key", "a@b", (async () => new Response("nope", { status: 422 })) as typeof fetch);
    await expect(failing.send(inviteEmail({ ...base, hasAccount: true }))).rejects.toThrow(/422/);
  });
});
