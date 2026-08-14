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

const YOUTUBE =
  /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^\s)]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/;

/**
 * The player URL for the first YouTube link in a note, or null for a note with none.
 *
 * The first and not the one under the cursor: a note is about one video, and a
 * rule that reads the cursor would start the video over every time the pane
 * re-rendered against a different line.
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
 * ponytail: the timestamp in `?t=90` is dropped, so a link to a moment opens at
 * the start. Carry it into the embed's own `start=` if that starts costing you
 * the scroll.
 */
export function noteVideo(text: string): string | null {
  const id = text.match(YOUTUBE)?.[1];
  return id === undefined ? null : `${PLAYER}/embed/${id}?enablejsapi=1`;
}
