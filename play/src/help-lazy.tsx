//! The Help sheet, loaded when it is opened (wave 13 fix round): its
//! articles (`docs/help/play/*.md`, bundled raw) are the largest text in the
//! app and a guest rarely opens them, so they stay out of the first load.

import { Suspense, lazy, type ComponentProps } from "react";
import type { HelpSheet as Sheet } from "./help.tsx";

const Help = lazy(() => import("./help.tsx").then((m) => ({ default: m.HelpSheet })));

/** `HelpSheet`, fetched on first open (nothing shows for the moment it takes). */
export function LazyHelpSheet(props: ComponentProps<typeof Sheet>) {
  return (
    <Suspense fallback={null}>
      <Help {...props} />
    </Suspense>
  );
}
