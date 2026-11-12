/**
 * `![](word.mp3)`, the sound an Anki import writes for `[sound:]`. An image, because that is
 * the one markdown form that loads a file in place. The editor plays it, and so does the review.
 */

import { imageSource } from "@/lib/notes/embeds/image";
import { endsIn } from "@/lib/notes/links/note-path";
import { SOUND_SUFFIXES } from "@/lib/vault/file-kind";

/** Every `![alt](address)` in a run of markdown, the address in the group. */
const IMAGE = /!\[[^\]\n]*\]\(\s*<?([^\s()<>]+)>?[^)\n]*\)/g;

/** Whether an `![](address)` names a sound, by the suffix of its decoded path. */
export function isAudio(address: string): boolean {
  return endsIn(address, SOUND_SUFFIXES);
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
