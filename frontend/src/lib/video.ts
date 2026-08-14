import { readField, setField } from "@/lib/note-frontmatter";

/**
 * The video a note is written about, found in the note.
 *
 * YouTube alone. Every other host would want its own origin in `frame-src`,
 * and the policy is the expensive half of this: a directive is a standing
 * permission for a page to frame you, so it is worth one host at a time and
 * only the host you actually watch.
 *
 * The note is the handle, the way a literature note is the handle on its book.
 * Nothing here is stored on the pane: the link lives in the note you are
 * writing, so moving the note moves the video with it and there is no second
 * place for the two to disagree.
 */

/**
 * The eleven characters YouTube names a video with, in the URL shapes it writes.
 *
 * `watch?v=`, the short host, an embed, a short and a livestream. The `[^\s)]*&`
 * before `v=` is for a watch URL that carries the list or the timestamp first,
 * which is what the share button writes out of a playlist. The closing paren is
 * excluded because the address usually arrives inside a `[](...)`.
 */
/** The origin the frame is served from, which is also the only one it is spoken to on. */
export const PLAYER = "https://www.youtube.com";

const EVERY =
  /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^\s)]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/g;

/**
 * Every YouTube video a note links, in the order the note links them.
 *
 * A list and not the first alone: a note about a course carries a lecture per
 * section, and each of them keeps a position of its own. The pane opens on the
 * first and steps through the rest.
 *
 * Each video once. A talk linked at the top and again where it is discussed is
 * one video, and two entries for it would step onto the same player twice and
 * give it two positions to disagree about.
 *
 * `youtube.com` and not `youtube-nocookie.com`. The privacy the nocookie host
 * buys is already yours behind oauth2-proxy on your own machine, and the
 * extensions worth having in the player, the blocker and the sponsor skipper,
 * are the ones whose match lists name the ordinary host first.
 *
 * `enablejsapi=1` is what lets the note drive the player. Without it the frame
 * answers no `postMessage` at all, and pausing would mean clicking into it and
 * losing the cursor, which is the one thing this pane exists to avoid.
 *
 * ponytail: the timestamp in `?t=90` is dropped, so a link to a moment is one
 * more video to start from the beginning. The position the note remembers is
 * where you actually got to, which is the number worth having.
 */
export function noteVideos(text: string): string[] {
  return [...new Set([...text.matchAll(EVERY)].map((match) => match[1] ?? ""))];
}

/**
 * The player URL for one video, opening at the second it names.
 *
 * `start` is whole seconds, which is all the parameter takes. A zero is left
 * off rather than written, so a video nobody has watched carries no position.
 */
export function playerUrl(id: string, start = 0): string {
  return `${PLAYER}/embed/${id}?enablejsapi=1${start > 0 ? `&start=${Math.floor(start)}` : ""}`;
}

/**
 * The field a note keeps its positions in, one entry per video.
 *
 * A mapping and not a number, because a note may be about a course: `watching:
 * {iDulhoQ2pro: 312}` is lecture one at five minutes and lecture two has an
 * entry of its own beside it. Keyed by the video's own id rather than by where
 * the link sits, so reordering the note moves nothing.
 *
 * Flow style, on one line, because `setField` is a line at a time: a block
 * mapping would be indented lines under the key, which that function reads as
 * belonging to the field above and carries through untouched. Flow is ordinary
 * YAML and `frontmatter.py` reads it as the same mapping.
 */
const WATCHING = "watching";

/** One `id: seconds` pair inside the flow mapping. */
const PAIR = /([\w-]{11})\s*:\s*(\d+)/g;

/** Every position a note holds, by video id. */
function positions(text: string): Map<string, number> {
  const held = readField(text, WATCHING) ?? "";
  return new Map([...held.matchAll(PAIR)].map((pair) => [pair[1] ?? "", Number(pair[2])]));
}

/** How far into that video the note says you got, or zero for one it has never held. */
export function watchedAt(text: string, id: string): number {
  return positions(text).get(id) ?? 0;
}

/**
 * The note with one video's position written into it.
 *
 * The other videos' positions are read back out and written again, which is
 * what keeps two players in one note from overwriting each other. A position of
 * zero is dropped rather than stored: it is what a video that has never been
 * watched already means, and storing it would grow the line for nothing.
 */
export function setWatched(text: string, id: string, seconds: number): string {
  const held = positions(text);
  const at = Math.floor(seconds);
  if (at > 0) held.set(id, at);
  else held.delete(id);

  const pairs = [...held].map(([video, second]) => `${video}: ${second}`);
  return setField(text, WATCHING, `{${pairs.join(", ")}}`);
}
