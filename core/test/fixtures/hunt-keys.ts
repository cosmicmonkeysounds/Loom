//! The judge's tests and the night's tests need questions judged, and they pin
//! how a key is judged, never what the show's key is. So they run on these
//! made-up keys, whatever the show's are: no test waits for a real answer or
//! spells one. H1 to H6 here; F1 and F2 take the kept documents' guarded words, read
//! from the file, and F3 stays the show's.

import type { Question } from "../../src/facts.ts";

const KEYS: Record<string, Pick<Question, "answer" | "accept">> = {
  H1: { answer: "Eleven years", accept: ["11 years", "eleven", "11"] },
  H2: { answer: "Mister Pickles", accept: ["pickles", "harbour tabby", "tabby"] },
  H3: { answer: "9:00 a.m.", accept: ["9am", "9 am", "9 a.m.", "9:00", "9:00am", "9:00 am", "nine a.m.", "nine am", "9 o'clock", "nine o'clock", "nine in the morning"] },
  H4: { answer: "1978", accept: ["ext 1978", "ext. 1978", "nineteen seventy eight", "nineteen seventy-eight"] },
  H5: { answer: "Hopelessly Devoted to You", accept: ["hopelessly devoted"] },
  H6: { answer: "Appendix Z: Loose Ends (Do Not Print)", accept: ["appendix z", "appendix", "loose ends", "do not print", "appendix z loose ends"] },
};

/** A facts.json's text with H1–H3 on the made-up keys. */
export function withTestKeys(text: string): string {
  const f = JSON.parse(text) as { questions: Array<Question & Record<string, unknown>>; documents?: Array<{ was: string; guard?: string[] }> };
  for (const q of f.questions) {
    const guard = f.documents?.find((d) => d.was === q.id)?.guard;
    const key = KEYS[q.id] ?? (guard === undefined ? undefined : { answer: guard[0]!, accept: guard.slice(1) });
    if (key === undefined) continue;
    q.answer = key.answer;
    q.accept = key.accept;
    delete q.placeholder;
  }
  return JSON.stringify(f);
}
