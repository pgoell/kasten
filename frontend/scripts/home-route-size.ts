/**
 * The home route's size in a `vite build --manifest --sourcemap` output:
 * `index.html`'s entry and the `src/routes/index.tsx` chunk with their static
 * imports, raw and gzip at level 9, summed per file as
 * docs/reference/phone-performance.md "The bundle" counts it: js in the total,
 * css apart. gzip comes from Python's zlib, which made the doc's numbers: node's
 * and bun's zlib pack the same file into other byte counts (#1828).
 *
 *   node scripts/home-route-size.ts dist
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

type Chunk = {
  file: string;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
};
export type Manifest = Record<string, Chunk>;
export type Size = { raw: number; gzip: number; files: number };

const ENTRY = "index.html";
const ROUTE = "src/routes/index.tsx";

/** The js and css files the home route loads before it renders, each once. */
export function homeRouteFiles(manifest: Manifest): { js: string[]; css: string[] } {
  const routes = Object.keys(manifest).filter((key) => key.split("?")[0] === ROUTE);
  const seen = new Set<string>();
  const js = new Set<string>();
  const css = new Set<string>();
  const queue = [ENTRY, ...(routes.length > 0 ? routes : [ROUTE])];
  for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
    if (seen.has(key)) continue;
    seen.add(key);
    const chunk = manifest[key];
    if (chunk === undefined) throw new Error(`the manifest lacks ${key}: was it renamed?`);
    if (chunk.file.endsWith(".js")) js.add(chunk.file);
    for (const file of chunk.css ?? []) css.add(file);
    queue.push(...(chunk.imports ?? []));
  }
  return { js: [...js].sort(), css: [...css].sort() };
}

const GZIP =
  "import gzip,sys\nfor p in sys.argv[1:]: print(len(gzip.compress(open(p,'rb').read(),9)))";

function sizeOf(dist: string, files: string[]): Size {
  const paths = files.map((file) => join(dist, file));
  const raw = paths.reduce((sum, path) => sum + statSync(path).size, 0);
  const gzips =
    files.length === 0 ? "" : execFileSync("python3", ["-c", GZIP, ...paths], { encoding: "utf8" });
  const gzip = gzips.split("\n").reduce((sum, line) => sum + Number(line), 0);
  return { raw, gzip, files: files.length };
}

export function homeRouteSize(dist: string): { js: Size; css: Size } {
  const manifest: Manifest = JSON.parse(readFileSync(join(dist, ".vite/manifest.json"), "utf8"));
  const { js, css } = homeRouteFiles(manifest);
  return { js: sizeOf(dist, js), css: sizeOf(dist, css) };
}

if (import.meta.main) {
  const { js, css } = homeRouteSize(process.argv[2] ?? "dist");
  const n = (value: number) => value.toLocaleString("en-US");
  const line = (size: Size) => `${n(size.raw)} B raw, ${n(size.gzip)} B gzip, ${size.files} files`;
  console.log(`Home route js: ${line(js)}`);
  console.log(`Home route css: ${line(css)}`);
}
