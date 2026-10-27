// Types for the editor's Playwright, imported by path (`…/@playwright/test/index.mjs`)
// so the runner and the specs share one install: that file ships no `.d.mts`,
// so this hands it the package's own types (tsconfig maps `@playwright/test`
// to the editor's copy). Typecheck only: never loaded at run time.
declare module "*/@playwright/test/index.mjs" {
  export * from "@playwright/test";
  export { default } from "@playwright/test";
}
