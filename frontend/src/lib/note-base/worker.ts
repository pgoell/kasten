/** The base of a note, hashed off the main thread (#1384). */

import { noteBase } from "@/lib/note-base";

self.onmessage = ({ data }: MessageEvent<{ id: number; text: string }>) => {
  self.postMessage({ id: data.id, base: noteBase(data.text) });
};
