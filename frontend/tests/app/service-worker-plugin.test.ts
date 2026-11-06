import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "vite";
import { renderServiceWorker, serviceWorker } from "../../sw/plugin";

const ASSETS = ["/assets/index-abc.js", "/assets/index-def.css"];

/** A rollup output chunk with the fields `precached` reads. */
function chunk(
  fileName: string,
  more: { code?: string; imports?: string[]; dynamicImports?: string[]; own?: boolean } = {},
) {
  return {
    type: "chunk",
    fileName,
    isEntry: fileName.includes("index-"),
    code: more.code ?? "",
    imports: more.imports ?? [],
    dynamicImports: more.dynamicImports ?? [],
    moduleIds: [more.own === false ? "/app/node_modules/x/index.js" : "/app/src/x.ts"],
  };
}

function asset(fileName: string, source = "") {
  return { type: "asset", fileName, source };
}

/** The precache list of the worker the plugin emits for `bundle`. */
function emittedList(bundle: Record<string, unknown>): string[] {
  const plugin = serviceWorker();
  const emitFile = vi.fn();
  // biome-ignore lint/complexity/noBannedTypes: rollup's hook, called the way rollup calls it
  (plugin.generateBundle as Function).call({ emitFile }, {}, bundle);
  const source: string = emitFile.mock.lastCall?.[0]?.source ?? "";
  return JSON.parse(/const PRECACHE = (\[.*\]);/.exec(source)?.[1] ?? "null");
}

describe("the service worker plugin", () => {
  it("leaves out a third-party bundle loaded on demand, and what only it reaches", () => {
    const list = emittedList({
      "assets/index-abc.js": chunk("assets/index-abc.js", {
        code: 'new Worker("/assets/clip-worker-1.js")',
        imports: ["assets/vendor-1.js"],
        dynamicImports: ["assets/route-1.js", "assets/mermaid-1.js"],
      }),
      "assets/vendor-1.js": chunk("assets/vendor-1.js", { own: false }),
      "assets/route-1.js": chunk("assets/route-1.js"),
      "assets/mermaid-1.js": chunk("assets/mermaid-1.js", {
        own: false,
        code: '"/assets/elk-worker-1.js"',
        imports: ["assets/d3-1.js"],
      }),
      "assets/d3-1.js": chunk("assets/d3-1.js", { own: false }),
      "assets/clip-worker-1.js": asset("assets/clip-worker-1.js"),
      "assets/elk-worker-1.js": asset("assets/elk-worker-1.js"),
      "assets/main-1.css": asset("assets/main-1.css", "url(/assets/font-1.woff2)"),
      "assets/font-1.woff2": asset("assets/font-1.woff2"),
      "assets/katex-1.woff2": asset("assets/katex-1.woff2"),
      "index.html": asset("index.html", '<link href="/assets/main-1.css">'),
    });
    expect(list.sort()).toEqual(
      [
        "/",
        "/assets/clip-worker-1.js",
        "/assets/index-abc.js",
        "/assets/route-1.js",
        "/assets/vendor-1.js",
      ].sort(),
    );
  });

  it("emits sw.js listing the shell and what the entry reaches", () => {
    const plugin = serviceWorker();
    const emitFile = vi.fn();
    const bundle = {
      "assets/index-abc.js": chunk("assets/index-abc.js", { code: '"/assets/index-def.css"' }),
      "assets/index-def.css": asset("assets/index-def.css"),
      "index.html": asset("index.html"),
    };
    // biome-ignore lint/complexity/noBannedTypes: rollup's hook, called the way rollup calls it
    (plugin.generateBundle as Function).call({ emitFile }, {}, bundle);
    expect(emitFile).toHaveBeenCalledTimes(1);
    expect(emitFile).toHaveBeenCalledWith(
      expect.objectContaining({ type: "asset", fileName: "sw.js" }),
    );
    const source: string = emitFile.mock.lastCall?.[0]?.source ?? "";
    const list = JSON.parse(/const PRECACHE = (\[.*\]);/.exec(source)?.[1] ?? "null");
    expect(list.sort()).toEqual(["/", ...ASSETS].sort());
  });

  it("lists the public files a first offline start needs, and not pdf.js", () => {
    const publicDir = mkdtempSync(path.join(tmpdir(), "kasten-public-"));
    for (const name of [
      "viewport-fit.js",
      "manifest.webmanifest",
      "favicon.svg",
      "icons/app-192.png",
      "pdfjs/pdf.worker.mjs",
      "pdfjs/.stamp",
    ]) {
      mkdirSync(path.dirname(path.join(publicDir, name)), { recursive: true });
      writeFileSync(path.join(publicDir, name), "");
    }
    const plugin = serviceWorker();
    const emitFile = vi.fn();
    // biome-ignore lint/complexity/noBannedTypes: rollup's hooks, called the way vite calls them
    (plugin.configResolved as Function)({ publicDir });
    // biome-ignore lint/complexity/noBannedTypes: as above
    (plugin.generateBundle as Function).call(
      { emitFile },
      {},
      { "assets/index-abc.js": chunk("assets/index-abc.js") },
    );
    const source: string = emitFile.mock.lastCall?.[0]?.source ?? "";
    const list = JSON.parse(/const PRECACHE = (\[.*\]);/.exec(source)?.[1] ?? "null");
    expect(list.sort()).toEqual(
      [
        "/",
        "/assets/index-abc.js",
        "/favicon.svg",
        "/icons/app-192.png",
        "/manifest.webmanifest",
        "/viewport-fit.js",
      ].sort(),
    );
  });

  it("leaves the lists app's files out of the precache", () => {
    const publicDir = mkdtempSync(path.join(tmpdir(), "kasten-public-"));
    for (const name of ["viewport-fit.js", "lists-sw.js", "lists.webmanifest"]) {
      writeFileSync(path.join(publicDir, name), "");
    }
    const plugin = serviceWorker();
    const emitFile = vi.fn();
    // biome-ignore lint/complexity/noBannedTypes: rollup's hooks, called the way vite calls them
    (plugin.configResolved as Function)({ publicDir });
    // biome-ignore lint/complexity/noBannedTypes: as above
    (plugin.generateBundle as Function).call(
      { emitFile },
      {},
      { "assets/index-abc.js": chunk("assets/index-abc.js") },
    );
    const source: string = emitFile.mock.lastCall?.[0]?.source ?? "";
    const list: string[] = JSON.parse(/const PRECACHE = (\[.*\]);/.exec(source)?.[1] ?? "null");
    expect(list.filter((url) => url.startsWith("/lists"))).toEqual([]);
  });

  // #1619: vite drops the pure-CSS chunk of a dynamic CSS import, and one listed
  // file that 404s fails the whole install. KaTeX's is the only one, loaded on demand.
  it("lists only files the build emits, and leaves a dynamic css import to first use", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "kasten-sw-build-"));
    mkdirSync(path.join(root, "src"));
    writeFileSync(
      path.join(root, "index.html"),
      '<!doctype html><script type="module" src="/src/main.js"></script>',
    );
    writeFileSync(path.join(root, "src/styles.css"), "body { color: red }");
    writeFileSync(path.join(root, "src/main.js"), 'import("./styles.css");');
    const outDir = path.join(root, "dist");
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      publicDir: false,
      plugins: [serviceWorker()],
      build: { outDir },
    });
    const source = readFileSync(path.join(outDir, "sw.js"), "utf8");
    const list: string[] = JSON.parse(/const PRECACHE = (\[.*\]);/.exec(source)?.[1] ?? "null");
    const missing = list.filter((url) => url !== "/" && !existsSync(path.join(outDir, url)));
    expect(missing).toEqual([]);
    expect(list.some((url) => /^\/assets\/styles-.*\.css$/.test(url))).toBe(false);
  }, 30_000);

  it("changes the version when the asset list changes", () => {
    const one = /const VERSION = "([^"]+)"/.exec(renderServiceWorker(ASSETS))?.[1];
    const two = /const VERSION = "([^"]+)"/.exec(renderServiceWorker(["/assets/other.js"]))?.[1];
    expect(one).toBeTruthy();
    expect(one).not.toBe(two);
  });
});
