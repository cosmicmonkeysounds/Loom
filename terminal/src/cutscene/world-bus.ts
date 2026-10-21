//! Is a simulation view on this screen right now (wave 17)? The world view
//! and the raycaster celebrate a find themselves — Gerald lays his egg, or
//! GERALD CAN'T HELP — so the duck's cutscene must not cover them: it plays
//! a see-through take over the live find instead (`scenes/moments.tsx`).
//! They live in lazy chunks of their own, the cutscenes in another, so the
//! word travels here. Base bundle: a few lines.

let showing = 0;

/** A view that celebrates finds is on screen; returns its goodbye (call once). */
export function noteWorldShowing(): () => void {
  showing += 1;
  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    showing -= 1;
  };
}

/** Does a view on this screen celebrate a find itself? */
export function worldCelebratesFinds(): boolean {
  return showing > 0;
}
