/**
 * The commit this bundle was built from, or nothing where there was no repo.
 *
 * Stamped in by `vite.config.ts`, which reads `.git` on the machine doing the
 * building. The browser has no repo of its own, and the reading is about which
 * code the bundle came from rather than which code is checked out now. Empty
 * in production, whose image carries no `.git`. Declared in `build.d.ts`.
 */
export const BUILD: string = __BUILD__;
