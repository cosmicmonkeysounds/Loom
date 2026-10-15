// The Director's broadcast cue. A cue starting with `!` is an **alert**
// (server `splitAlert`, core/server/chat.ts): every phone it reaches
// banners, chimes and buzzes. The form's "Alert" checkbox writes that
// marker so nobody has to know the prefix (SW-ADM-03).

/** The cue as sent: `!`-prefixed when `alert`, never double-marked; an
 *  unchecked box leaves a hand-typed `!` alone. */
export function alertCue(cue: string, alert: boolean): string {
  const t = cue.trim()
  if (!alert || t.startsWith('!') || t.startsWith('"!')) return t
  return `!${t}`
}
