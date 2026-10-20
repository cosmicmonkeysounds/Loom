//! Wave 13 Stage A: the cross-lane components plumbing creates (CONTRACTS
//! §5.3) — working, plain versions the owner lanes finish in Stage B.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Alerts } from "../src/alerts.ts";
import { CountdownTray } from "../src/chrome/countdown-tray.tsx";
import { FullPass } from "../src/chrome/pass.tsx";
import { isTextEntry } from "../src/chrome/keyboard.ts";
import { Taskbar, TrayItem } from "../src/chrome/taskbar.tsx";
import { TitleBar } from "../src/chrome/title-bar.tsx";
import { HostDock } from "../src/host/dock.tsx";
import { useHostView } from "../src/host/client.ts";
import { MissedTray, MomentsLayer, MomentsProvider, useMoments, type MomentsInput } from "../src/moments/provider.tsx";
import { PassSheet } from "../src/guest/sheets.tsx";
import type { ObjectiveView } from "../src/types.ts";
import { ObjectiveCard, checkCount } from "../src/ui/objective.tsx";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

const objective: ObjectiveView = {
  id: "clear_the_door",
  title: "Clear the door",
  brief: "Scan every program at the Optical Drive.",
  checklist: [
    { label: "Scan a pass", done: true },
    { label: "Mark the corrupted", done: false },
    { label: "Smile", done: null },
  ],
  buttons: ["scan", "mark", "greet", "extra"],
  act: "B",
};

describe("the taskbar", () => {
  it("has Start, the role's buttons and the tray, with the live dot on the tray's edge", () => {
    const out = html(
      createElement(Taskbar, {
        start: [{ id: "leave", label: "Leave", onClick: () => {}, confirm: "Leave the event?", danger: true }],
        buttons: [
          { id: "pass", label: "Pass", icon: "🎟", onClick: () => {}, primary: true, tour: "pass" },
          { id: "scan", label: "Scan", icon: "📷", onClick: () => {}, badge: 12 },
        ],
        tray: createElement(TrayItem, { icon: "⏳", text: "14:59", title: "Hunt 1" }),
        conn: "reconnecting",
      }),
    );
    expect(out).toContain("Start");
    expect(out).toContain('aria-label="Pass"');
    expect(out).toContain('class="w95-btn taskbar-btn primary"');
    expect(out).toContain('data-tour="pass"');
    expect(out).toContain("9+");
    expect(out).toContain('class="taskbar-tray reconnecting"');
    expect(out).toContain("14:59");
    expect(out).not.toContain("start-menu"); // closed until tapped
  });

  it("a tray item with an action is a button; without, a label", () => {
    expect(html(createElement(TrayItem, { text: "💰 120", onClick: () => {} }))).toMatch(/^<button/u);
    expect(html(createElement(TrayItem, { text: "💰 120", tone: "dim" }))).toMatch(/^<span class="tray-item dim"/u);
  });
});

describe("the NOW title bar", () => {
  it("shows the first objective, else the room name; a tone marks it", () => {
    expect(html(createElement(TitleBar, { objectives: [objective], fallback: "Lobby", onOpen: () => {}, sub: "📍 The Desktop" }))).toContain("▣ NOW: Clear the door ›");
    const none = html(createElement(TitleBar, { objectives: [], fallback: "Lobby", onOpen: () => {} }));
    expect(none).toContain("Lobby");
    expect(none).not.toContain("NOW");
    expect(html(createElement(TitleBar, { objectives: undefined, fallback: "Lobby", onOpen: () => {}, tone: "alarm" }))).toContain('class="title-bar alarm"');
  });
});

describe("checkCount, the one checklist rule (guest card + booth NOW line)", () => {
  it("counts every to-do; ✓ only when all are done; done: null is never done", () => {
    expect(checkCount({ checklist: [] })).toBe("");
    expect(checkCount({ checklist: [{ label: "a", done: true }] })).toBe("1/1 ✓");
    expect(checkCount({ checklist: [{ label: "a", done: true }, { label: "b", done: null }] })).toBe("1/2");
    expect(checkCount({ checklist: [{ label: "a", done: null }] })).toBe("0/1");
    expect(checkCount({ checklist: [{ label: "a", done: true }, { label: "b", done: true }] })).toBe("2/2 ✓");
    expect(checkCount({ checklist: [{ label: "a", done: false }, { label: "b", done: true }] })).toBe("1/2");
  });
  it("the booth's nowCount is the same rule, with only the performer's own ticks folded in", async () => {
    const { nowCount } = await import("../src/booth/now-card.tsx");
    const { tickKey } = await import("../src/booth/ticks.ts");
    const o = { id: "o", title: "T", brief: "", buttons: [], act: null, checklist: [{ label: "a", done: true }, { label: "b", done: null }, { label: "c", done: false }] };
    expect(nowCount(o)).toBe(checkCount(o));
    expect(nowCount({ checklist: o.checklist })).toBe(checkCount(o));
    expect(nowCount(o, new Set([tickKey("o", "b")]))).toBe("2/3");
    expect(nowCount(o, new Set([tickKey("o", "c")]))).toBe("1/3"); // a story-tracked to-do is never ticked by hand
  });
});

describe("the objective card", () => {
  it("counts every to-do, shows the brief, the checklist and at most 3 buttons", () => {
    // the condition-less "Smile" (done: null) counts in the total and is never done
    expect(checkCount(objective)).toBe("1/3");
    const out = html(createElement(ObjectiveCard, { objective, renderButton: (id: string) => createElement("button", null, id) }));
    expect(out).toContain("Scan every program");
    expect(out).toContain("☑ Scan a pass");
    expect(out).toContain("☐ Mark the corrupted");
    expect(out.match(/<button>/gu)?.length).toBe(3);
  });

  it("compact: one line until tapped", () => {
    const out = html(createElement(ObjectiveCard, { objective, compact: true }));
    expect(out).toContain("Clear the door");
    expect(out).not.toContain("Scan every program");
  });
});

describe("the pass", () => {
  it("FullPass is the full-screen pass (the old pass sheet's barrel name renders it)", () => {
    const onClose = () => {};
    expect(html(createElement(FullPass, { guestId: "g-1a2b", name: "Winamp", onClose }))).toBe(html(createElement(PassSheet, { me: { id: "g-1a2b", name: "Winamp" }, onClose })));
    const out = html(createElement(FullPass, { guestId: "g-1a2b", name: "Winamp", onClose }));
    expect(out).toContain('class="fullpass"');
    expect(out).toContain("Hold this up to a performer");
    expect(out).toContain("brightness");
  });
});

describe("the moments layer (mounted in Stage A, filled by the moments lane)", () => {
  const alerts = (text: string | null): Alerts => ({
    alert: text === null ? null : { seq: 7, text, at: 0 } as unknown as Alerts["alert"],
    dismiss: () => {},
    raise: () => {},
    onHistory: () => {},
    rebase: () => {},
    mark: () => -1,
    settle: () => {},
    epoch: 0,
    recent: () => [],
  });
  const input = (text: string | null): MomentsInput => ({
    role: "guest",
    me: "g1",
    session: "tok",
    messages: new Map(),
    alerts: alerts(text),
    alertLevel: "dialog",
    objectives: [],
    phase: null,
    clock: 0,
    openRoom: () => {},
    sound: false,
  });
  function Probe() {
    const m = useMoments();
    return createElement("i", null, `${m.level} ${m.missed}`);
  }

  it("renders the session's feedback toast when there is one, nothing otherwise", () => {
    expect(html(createElement(MomentsProvider, { ...input("✔ Done."), children: createElement(MomentsLayer) }))).toContain('class="moments-toast"');
    expect(html(createElement(MomentsProvider, { ...input(null), children: createElement(MomentsLayer) }))).toBe("");
    expect(html(createElement(MomentsLayer))).toBe("");
  });

  it("nothing is missed yet; the level reads the view, sticky by default", () => {
    expect(html(createElement(MomentsProvider, { ...input(null), children: createElement(Probe) }))).toBe("<i>dialog 0</i>");
    expect(html(createElement(Probe))).toBe("<i>sticky 0</i>");
    expect(html(createElement(MissedTray))).toBe("");
  });
});

describe("the Stage B stubs render nothing", () => {
  // The card tray and the ticker are the stream lane's now (card-tray / ticker
  // tests); the booth NOW card is built (booth-now.test.tsx).
  it("tray clock, host dock", () => {
    expect(CountdownTray({})).toBeNull();
    expect(HostDock({ session: {} as never, wide: false, openCard: () => {} })).toBeNull();
    // useHostView holds state now (the host lane): read it inside a render.
    const HostProbe = () => createElement("i", null, JSON.stringify((({ view, error }) => ({ view, error }))(useHostView(null))));
    expect(html(createElement(HostProbe))).toBe("<i>{&quot;view&quot;:null,&quot;error&quot;:null}</i>");
  });
});

describe("the keyboard rule", () => {
  const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as unknown as Element;
  it("text fields open the keyboard; buttons, checkboxes and sliders don't", () => {
    expect(isTextEntry(el("TEXTAREA"))).toBe(true);
    expect(isTextEntry(el("INPUT", { type: "text" }))).toBe(true);
    expect(isTextEntry(el("INPUT", { type: "" }))).toBe(true);
    expect(isTextEntry(el("INPUT", { type: "password" }))).toBe(true);
    expect(isTextEntry(el("INPUT", { type: "range" }))).toBe(false);
    expect(isTextEntry(el("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isTextEntry(el("BUTTON"))).toBe(false);
    expect(isTextEntry(el("DIV", { isContentEditable: true }))).toBe(true);
    expect(isTextEntry(null)).toBe(false);
  });
});
