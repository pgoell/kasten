/**
 * The deck parse's worker as the production build emits it (#1359). A worker
 * has no `document`, and a bundle that touches one at load throws, which leaves
 * every deck's open on the main thread. The frame tests run vite's dev server,
 * which never meets this.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "vite";

it("#1359 the built deck worker loads without a document and answers with the deck's cards", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const out = mkdtempSync(path.join(tmpdir(), "deck-worker-"));
  const entry = path.join(out, "entry.ts");
  writeFileSync(
    entry,
    `new Worker(new URL(${JSON.stringify(path.join(root, "src/lib/review/deck-parse/worker.ts"))}, import.meta.url), { type: "module" });\n`,
  );
  await build({
    configFile: path.join(root, "vite.config.ts"),
    root,
    logLevel: "silent",
    build: { outDir: out, emptyOutDir: false, rollupOptions: { input: entry } },
  });
  const assets = path.join(out, "assets");
  const worker = readdirSync(assets).find((name) => /^worker-.*\.js$/.test(name));
  expect(worker).toBeDefined();

  // A bare node is a worker's scope as far as this goes: a `self`, a `postMessage`, no `document`.
  const answer = execFileSync(
    "node",
    [
      "--input-type=module",
      "-e",
      `globalThis.self = globalThis;
globalThis.postMessage = (message) => console.log(JSON.stringify(message));
await import(${JSON.stringify(path.join(assets, worker ?? ""))});
self.onmessage({ data: { deck: { name: "big", whole: false },
  texts: [["decks/big.md", "#flashcards/big\\n\\nQ::A <!--SR:!2026-08-20,4,270-->\\n"]] } });`,
    ],
    { encoding: "utf8" },
  );
  expect(JSON.parse(answer)).toEqual([
    ["decks/big.md", [expect.objectContaining({ from: 2, to: 2, front: "Q", back: "A" })]],
  ]);
}, 120_000);
