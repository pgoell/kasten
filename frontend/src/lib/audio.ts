/**
 * `![](word.mp3)`, the sound an Anki import writes where the deck said `[sound:]`.
 *
 * Written as an image because that is the one markdown construct that names a
 * file to load in place, and an image whose suffix is a sound's is no picture
 * anybody could mean. The editor draws it as a player and the review plays it.
 */

import { imageSource } from "@/lib/image";

/** The suffixes that make an `![](path)` a sound, held here for both readers. */
export const AUDIO_SUFFIXES = [".mp3", ".ogg", ".m4a", ".wav"];

/** Every `![alt](address)` in a run of markdown, the address in the group. */
const IMAGE = /!\[[^\]\n]*\]\(\s*<?([^\s()<>]+)>?[^)\n]*\)/g;

/**
 * Whether an `![](address)` names a sound.
 *
 * The path alone, off the query and the fragment, and decoded, so the suffix is
 * read as the file is named rather than as the link spells it.
 */
export function isAudio(address: string): boolean {
  const path = address.replace(/[?#].*$/, "");
  let name = path;
  try {
    name = decodeURIComponent(path);
  } catch (error: unknown) {
    // A stray `%` is a path nobody encoded, and its suffix reads as written.
    if (!(error instanceof URIError)) throw error;
  }
  const lower = name.toLowerCase();
  return AUDIO_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/**
 * The sounds one side of a card names, as URLs a player loads, in order.
 *
 * In order because Anki plays a side's sounds one after the other, and a card
 * written as a word and then its sentence is asked in that order.
 */
export function soundsIn(markdown: string): string[] {
  return [...markdown.matchAll(IMAGE)]
    .map((match) => match[1] ?? "")
    .filter(isAudio)
    .map(imageSource)
    .filter((source) => source !== null);
}
