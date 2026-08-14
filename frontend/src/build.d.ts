/**
 * The commit `vite.config.ts` stamped into this bundle, empty without a repo.
 *
 * Declared here and not in `lib/build.ts`, which reads it. esbuild refuses to
 * substitute an identifier the file itself declares, so a `declare const`
 * beside the export leaves the literal `__BUILD__` in the served module and
 * the browser throws a `ReferenceError` on it.
 */
declare const __BUILD__: string;
