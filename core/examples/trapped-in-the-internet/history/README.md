# Build history

Contracts and sign-off sheets from past build waves. They record what was
decided and why. Nothing in the code or tests reads these files, so they
live here, out of the way of the night-of docs.

| File | What it is | Still open |
|---|---|---|
| [`CONTRACT-w20.md`](./CONTRACT-w20.md) | The wave 20 lane contract: Trabolta's heart, the door sensor, the house lights. Decisions D1–D29, §8 the integration notes. Code comments cite it as `CONTRACT-w20 §…`. | No. Wave 20 is merged on master (not yet shipped). |
| [`SIGNOFF-w18b.md`](./SIGNOFF-w18b.md) | The wave 18b sign-off sheet: decisions D1–D30 and every changed show line. | Yes: the show text awaits the user's sign-off, and O1 (the Bingo-card line). |
| [`readme-banner.md`](./readme-banner.md) | The show README's old top banner, moved verbatim: each wave's ship tag and status through wave 21. | No. |
| [`SIGNOFF-w20.md`](./SIGNOFF-w20.md) | The wave 20 sign-off sheet, with the user's wave 20b answers (Q1–Q10). | Partly: Q1 was "I will review - ship for now"; the persona's `outside:` list is still to review. |

The other sign-off sheets stay in the show folder because tests read them:
`SIGNOFF-w13.md` (`core/test/trapped-w13-objectives.test.ts`),
`SIGNOFF-w18.md` (`core/test/trapped-w13-integration.test.ts`) and
`SIGNOFF-w21.md` (`core/test/trapped-w21.test.ts`).

For the night itself, read [`../SHOWNIGHT.md`](../SHOWNIGHT.md) and
[`../TECH.md`](../TECH.md).
