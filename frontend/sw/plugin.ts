import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

const SOURCE = path.join(import.meta.dirname, "sw.js");

/**
 * The worker's source with this build's precache list and version written in.
 *
 * The version is a hash of the list rather than the release tag, because the
 * build image has no tag to read, and the list already changes whenever a
 * byte of the bundle does: every asset name carries its content hash.
 */
export function renderServiceWorker(assets: string[]): string {
  const source = readFileSync(SOURCE, "utf8");
  if (!source.includes("__PRECACHE__") || !source.includes("__VERSION__")) {
    throw new Error("sw/sw.js no longer has the placeholders sw/plugin.ts writes into");
  }
  const list = ["/", ...[...assets].sort()];
  const version = createHash("sha256").update(JSON.stringify(list)).digest("hex").slice(0, 12);
  // Functions rather than strings, so a `$` in a name is not read as a pattern.
  return source
    .replace("__PRECACHE__", () => JSON.stringify(list))
    .replace("__VERSION__", () => JSON.stringify(version));
}

/**
 * Emit `/sw.js` beside `index.html`.
 *
 * Not in `public/`, which is copied as it stands and so could not carry the
 * list of hashed files only the bundle knows. `generateBundle` is the first
 * hook that sees every emitted name. The files `public/` holds are not in the
 * bundle and so not precached; the worker caches them on first use instead.
 */
export function serviceWorker(): Plugin {
  return {
    name: "kasten-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((name) => name.startsWith("assets/"))
        .map((name) => `/${name}`);
      this.emitFile({ type: "asset", fileName: "sw.js", source: renderServiceWorker(assets) });
    },
  };
}
