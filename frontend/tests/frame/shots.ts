/**
 * Screenshots of a frame test, to look at by eye (#472).
 *
 * Every shot is taken, and its width answered, so a run without
 * `VITE_KASTEN_SHOTS` still proves the picture comes out the size asked for.
 * Only with it set does the picture land on disk.
 */

import { page } from "vitest/browser";

// Relative to the calling test file, which vite's `server.fs` lets the browser
// write under, and in a folder git ignores.
const DIR = "../../node_modules/.cache/kasten-shots";

/** Screenshot `element` as `name`.png and answer the picture's width in pixels. */
export async function shot(element: Element, name: string): Promise<number> {
  // A picture taken before the web font swaps in shows the fallback face (#866).
  await document.fonts.ready;
  const png = import.meta.env.VITE_KASTEN_SHOTS
    ? (await page.screenshot({ element, path: `${DIR}/${name}.png`, base64: true })).base64
    : await page.screenshot({ element, save: false });
  // A PNG opens with its 8-byte signature and then the IHDR chunk, whose data
  // starts with the width as a big-endian uint32 at byte 16.
  const bytes = atob(png.slice(0, 32));
  return new DataView(Uint8Array.from(bytes, (c) => c.charCodeAt(0)).buffer).getUint32(16);
}
