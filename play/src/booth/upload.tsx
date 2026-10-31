// Wave 53 (C1, C2): everyone uploads, so a booth has a stage too. While the
// story's `arrival:` holds for this part the booth reports in, and while the
// part stands in a `cutscene` location the booth is nothing but the guests'
// own arrival stage: what is said to the part, its cards, its menu. There is
// no pass to show: where My pass stands, a way out for a wrong part. When
// the story moves it on the stage waits for Continue, and the booth mounts.
// Fail-open: only `view.cutscene` holds the booth, so a report that never
// lands leaves a working booth, and an embedded pane (Run → Players, a
// director at the part) never goes on rails. Only the server's word moves it.

import { useEffect, useMemo, useRef, useState } from "react";
import { inWorldLabel } from "../../../core/src/in-world.ts";
import { CutsceneStage } from "../cutscene.tsx";
import { useCutscene } from "../guest/app.tsx";
import { usePlayHost } from "../host.ts";
import { useOfflineFor } from "../client.ts";
import { personalStream } from "../session/channels.ts";
import type { PrimeSession } from "../session/prime.ts";
import { useTheme } from "../session/shared.ts";
import type { WidgetHook } from "../stream/bubble.tsx";
import type { ChatMessage, Decision, PrimeView } from "../types.ts";

/** What the stage shows of a booth's rows (pure): what was said to the part,
 *  never its readouts (those wait in Readouts, for the booth). */
export function boothStaged(messages: ReadonlyMap<number, ChatMessage>, character: string): ChatMessage[] {
  return personalStream(messages, `@${character}`).filter((m) => m.readout !== true);
}

/** The menu waiting on the part, as the stage docks it (pure). */
export function boothDecision(view: Pick<PrimeView, "choices"> | null, choose: (index: number, menu: { id: number; text: string }) => void): Decision | null {
  const menu = view?.choices?.[0];
  if (menu === undefined || menu.options.length === 0) return null;
  return { title: "Your move…", options: menu.options.map((label, i) => ({ label, onClick: () => choose(i, { id: menu.id, text: label }) })) };
}

/** Is the booth on rails, and report it in while its arrival is due. A
 *  failed report is tried again on the next view. A booth signed out on the
 *  stage leaves it at once, for the sign-in that says why. */
export function useBoothRails(s: Pick<PrimeSession, "view" | "arrive"> & Partial<Pick<PrimeSession, "auth">>): { showing: boolean; over: boolean; leave: () => void } {
  const host = usePlayHost();
  const view = s.view;
  const cut = useCutscene(!host.embedded && view?.cutscene === true);
  const reporting = useRef(false);
  const report = s.arrive;
  useEffect(() => {
    if (host.embedded || view?.arrive !== true || report === undefined || reporting.current) return;
    reporting.current = true;
    void report()
      .catch(() => {})
      .finally(() => {
        reporting.current = false;
      });
  }, [host.embedded, view, report]);
  return s.auth === null ? { ...cut, showing: false } : cut;
}

/** The part's way out of a stage it should not be on: two taps. */
function WrongPart({ character, onLeave }: { character: string; onLeave: () => void }) {
  const [asking, setAsking] = useState(false);
  return (
    <button type="button" className="cut-pass" onClick={() => (asking ? onLeave() : setAsking(true))} title={`Sign out of ${character}`}>
      {asking ? "Tap to sign out" : "Not you?"}
    </button>
  );
}

export function BoothUploadStage({ s, over, onContinue, onLeave }: { s: PrimeSession; over: boolean; onContinue: () => void; onLeave: () => void }) {
  const character = s.auth?.character ?? "";
  const view = s.view;
  useTheme(view?.theme);
  const offline = useOfflineFor(s.connected);
  const staged = useMemo(() => boothStaged(s.messages, character), [s.messages, character]);
  const widgets: WidgetHook = { answer: (seq, r) => void s.answerWidget(seq, r).catch(() => {}), answered: s.widgetAnswers };
  const choose = s.choose;
  const decision = boothDecision(view, (i, menu) => void choose?.(i, menu).catch(() => {}));
  // The caption holds once the story moves the part on, as the guest's does.
  const where = useRef<string | null>(null);
  if (view?.location !== undefined) where.current = inWorldLabel(view.channels.find((c) => c.id === `loc:${view.location}`)?.title ?? view.location);
  return (
    <div className="root cut-root">
      <CutsceneStage
        messages={staged}
        title={view?.title ?? s.auth?.title}
        where={where.current}
        decision={decision}
        widgets={widgets}
        over={over}
        onContinue={onContinue}
        corner={<WrongPart character={character} onLeave={onLeave} />}
        offline={offline}
      />
    </div>
  );
}
