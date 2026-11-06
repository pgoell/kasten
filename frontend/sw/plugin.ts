import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin, Rollup } from "vite";

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
 * The files `public/` holds at its top and in `icons/`, as the paths they are served at.
 *
 * The first offline start needs them before it has ever asked for one:
 * viewport-fit.js is a blocking script in the head (#364), and the manifest
 * and icons are what the installed app shows. `pdfjs/` is left out, being
 * megabytes a PDF fetches on first use, and so are dotfiles such as its stamp.
 * The lists app's files are left out too: they belong to the share host's own
 * app, and nginx answers 404 for them on the main host (#736), which would fail
 * the whole install.
 */
function publicFiles(publicDir: string): string[] {
  const listed = (folder: string) => {
    const full = path.join(publicDir, folder);
    if (!existsSync(full)) return [];
    return readdirSync(full, { withFileTypes: true })
      .filter(
        (entry) => entry.isFile() && !entry.name.startsWith(".") && !entry.name.startsWith("lists"),
      )
      .map((entry) => `/${path.posix.join(folder, entry.name)}`);
  };
  return [...listed(""), ...listed("icons")];
}

/** The `/src/` path in a module id, which marks kasten's own code. */
const OWN = `${path.sep}src${path.sep}`;

/** The files one emitted file leads the walk on to. */
function next(
  bundle: Rollup.OutputBundle,
  file: Rollup.OutputAsset | Rollup.OutputChunk,
  assets: string[],
): string[] {
  if (file.type === "asset") return named(String(file.source), assets);
  const own = file.dynamicImports.filter((target) => {
    const chunk = bundle[target];
    return chunk?.type === "chunk" && chunk.moduleIds.some((id) => id.includes(OWN));
  });
  return [
    ...named(file.code, assets),
    ...(file.viteMetadata?.importedCss ?? []),
    ...(file.viteMetadata?.importedAssets ?? []),
    ...file.imports,
    ...own,
  ];
}

/** The assets a file's text names, which is how workers, fonts and css are referenced. */
function named(text: string, assets: string[]): string[] {
  return assets.filter((asset) => text.includes(path.posix.basename(asset)));
}

/**
 * The emitted files the app needs before it has opened anything on demand: what the entry reaches
 * by static imports, and by dynamic imports of kasten's own code, such as a route. A dynamic import
 * of a third-party bundle alone (mermaid, KaTeX, elk, zxing, pdf.js) is left to the worker's
 * cache-on-first-use, with every file only it reaches: megabytes most starts never open.
 */
export function precached(bundle: Rollup.OutputBundle): string[] {
  const files = Object.values(bundle);
  const assets = files.filter((file) => file.type === "asset").map((file) => file.fileName);
  const todo = files.filter((file) => file.type === "chunk" && file.isEntry).map((f) => f.fileName);
  const reached = new Set<string>();
  for (let name = todo.pop(); name !== undefined; name = todo.pop()) {
    const file = bundle[name];
    if (file === undefined || reached.has(name)) continue;
    reached.add(name);
    todo.push(...next(bundle, file, assets));
  }
  return [...reached].filter((name) => name.startsWith("assets/")).map((name) => `/${name}`);
}

/**
 * Emit `/sw.js` beside `index.html`.
 *
 * Not in `public/`, which is copied as it stands and so could not carry the
 * list of hashed files only the bundle knows. `generateBundle` is the first
 * hook that sees every emitted name. `public/` never enters the bundle, so its
 * files are read from the folder itself.
 */
export function serviceWorker(): Plugin {
  let publicDir = "";
  return {
    name: "kasten-service-worker",
    apply: "build",
    // After vite:css-post, which drops the empty js chunk of a dynamic css import (#1619).
    enforce: "post",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_options, bundle) {
      const assets = precached(bundle);
      const files = publicDir === "" ? [] : publicFiles(publicDir);
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: renderServiceWorker([...assets, ...files]),
      });
    },
  };
}
