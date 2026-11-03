/**
 * The commit this bundle was built from, or empty where there was no repo. `vite.config.ts` stamps
 * it from the build machine's `.git`. Empty in production, whose image carries no `.git`.
 */
export const BUILD: string = __BUILD__;
