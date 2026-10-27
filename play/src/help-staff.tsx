//! The performers' Help (wave 26, integration): every article, the
//! `role: performer` ones (07 performers, 13 the director phone, 14 hosts,
//! 19 how the house works, 20 the Desk) included. Only the booth and the
//! director import this file, so its articles never reach a guest's
//! download; the guests' Help is `help.tsx` alone (`help-lazy.tsx`).

import { buildHelp, type HelpArticle } from "../../docs/help/helpdoc.ts";
import { GUEST_FILES, HelpWindow, guestArticles } from "./help.tsx";

/** The performer-only articles, raw. Keep in step with `help.tsx`'s negatives. */
export const STAFF_FILES = import.meta.glob(
  [
    "../../docs/help/play/07-performers.md",
    "../../docs/help/play/13-director-phone.md",
    "../../docs/help/play/14-hosts.md",
    "../../docs/help/play/19-house-workings.md",
    "../../docs/help/play/20-house-desk.md",
  ],
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
) as Record<string, string>;

const STAFF_ARTICLES = buildHelp({ ...GUEST_FILES, ...STAFF_FILES }).articles.filter((a) => !a.role || a.role === "performer");

/** The articles an audience sees: performers get everything. */
export function articlesFor(role: "guest" | "performer"): HelpArticle[] {
  return role === "guest" ? guestArticles() : STAFF_ARTICLES;
}

/** The booth's and the director's Help window. */
export function StaffHelpSheet({ onClose }: { onClose: () => void }) {
  return <HelpWindow articles={articlesFor("performer")} onClose={onClose} />;
}
