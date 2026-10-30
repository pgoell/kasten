/**
 * The commit `vite.config.ts` stamps into the bundle, empty without a repo.
 * Declared here, not in `lib/build.ts`: esbuild refuses to substitute an identifier
 * its own file declares, so the browser would throw a `ReferenceError` on `__BUILD__`.
 */
declare const __BUILD__: string;
