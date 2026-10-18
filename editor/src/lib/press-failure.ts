//! A director's press that failed, in the director's words (shared by the
//! Director page's result banner and the server store's error line).

/** What a press before the doors open reads as (the server's 409 says "no
 *  scenario loaded": no sim yet). */
export const DOORS_NOT_OPEN = "the doors aren't open yet — nothing fired"

/** A failed press's message, in the director's words. */
export function failureText(message: string): string {
  return message === 'no scenario loaded' ? DOORS_NOT_OPEN : message
}
