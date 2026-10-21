//! The FIRE button's word, shared by the NEXT bar and the Cues tab's NEXT
//! box (wave 18): one file so neither imports the other.

/** The NEXT bar's call to action: ARM, then FIRE inside the window. */
export function fireLabel(armedHere: boolean, sending: boolean, subject: boolean): string {
  if (sending) return "Sending…";
  if (armedHere) return "FIRE";
  return subject ? "PICK" : "ARM";
}
