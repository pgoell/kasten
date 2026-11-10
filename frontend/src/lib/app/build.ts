import { useQuery } from "@tanstack/react-query";
import { fetchVersion } from "@/lib/core/api";

/**
 * The commit this bundle was built from, or empty where there was no repo. `vite.config.ts` stamps
 * it from the build machine's `.git`. Empty in production, whose image carries no `.git`.
 */
export const BUILD: string = __BUILD__;

/** The pair as a person reads it, `build` being `BUILD`: the release alone in production, both commits in development. */
export function versionText(backend: string, build: string): string {
  return build === "" ? backend : `be ${backend} fe ${build}`;
}

/** Whether this tab's bundle and the backend were built from different commits, as after a rebase. */
export function outOfStep(backend: string, build: string): boolean {
  return build !== "" && build !== backend;
}

/** The backend's version, asked once: the bundle's stamp is from tab load, and a newer backend would mix versions. */
export function useVersion(): string | undefined {
  return useQuery({
    queryKey: ["version"],
    queryFn: fetchVersion,
    staleTime: Number.POSITIVE_INFINITY,
  }).data;
}
