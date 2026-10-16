/**
 * Release N+1 for `e2e/release.ts`: the same app, every asset under a new name.
 *
 * Two plain builds of one tree would be byte-identical, so nothing would 404
 * after the flip. The `-b` marker gives every chunk the name a later release
 * would give it, and the worker's precache list follows, `sw/plugin.ts`
 * listing whatever lands under `assets/`.
 */
import { mergeConfig } from "vite";
import base from "../vite.config.ts";

export default mergeConfig(base, {
  build: {
    rolldownOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash]-b.js",
        chunkFileNames: "assets/[name]-[hash]-b.js",
        assetFileNames: "assets/[name]-[hash]-b[extname]",
      },
    },
  },
});
