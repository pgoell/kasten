/**
 * `![](word.mp3)`, the sound an Anki import writes for `[sound:]`. An image, because that is
 * the one markdown form that loads a file in place. The editor plays it, and so does the review.
 */

import { imageSource } from "@/lib/notes/embeds/image";

/** The suffixes that make an `![](path)` a sound, held here for both readers. */
export const AUDIO_SUFFIXES = [".mp3", ".ogg", ".m4a", ".wav"];

/** Every `![alt](address)` in a run of markdown, the address in the group. */
const IMAGE = /!\[[^\]\n]*\]\(\s*<?([^\s()<>]+)>?[^)\n]*\)/g;

/** Whether an `![](address)` names a sound, by the suffix of its decoded path. */
export function isAudio(address: string): boolean {
  return endsIn(address, AUDIO_SUFFIXES);
}

/** Whether an address's decoded path ends in one of `suffixes`, any case, query and hash left off. */
export function endsIn(address: string, suffixes: string[]): boolean {
  const path = address.replace(/[?#].*$/, "");
  let name = path;
  try {
    name = decodeURIComponent(path);
  } catch (error: unknown) {
    // A stray `%` is a path nobody encoded, and its suffix reads as written.
    if (!(error instanceof URIError)) throw error;
  }
  const lower = name.toLowerCase();
  return suffixes.some((suffix) => lower.endsWith(suffix));
}

/**
 * The sound URLs one side of a card names, in order. Anki plays them in that order.
 */
export function soundsIn(markdown: string): string[] {
  return [...markdown.matchAll(IMAGE)]
    .map((match) => match[1] ?? "")
    .filter(isAudio)
    .map(imageSource)
    .filter((source) => source !== null);
}
