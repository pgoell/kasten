import { readField, setField } from "@/lib/note-frontmatter";
import { readVideoSettings } from "@/lib/video/video-settings";

/**
 * The video a note is written about, found in the note. YouTube only, since each other host needs its own
 * `frame-src` origin, a standing permission to frame. The link lives in the note, so nothing is stored on the pane.
 */

/**
 * The eleven characters YouTube names a video with, in each URL shape it writes. The `[^\s)]*&` before
 * `v=` takes a watch URL with a list or timestamp first; `)` is excluded since links arrive inside `[](...)`.
 */
/** The origin the frame is served from, which is also the only one it is spoken to on. */
export const PLAYER = "https://www.youtube.com";

const EVERY =
  /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^\s)]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/g;

/**
 * Every YouTube video a note links, in order, each once, since a course keeps a position per lecture.
 * `enablejsapi=1` lets the note drive the player. ponytail: a `?t=` start time is dropped.
 */
export function noteVideos(text: string): string[] {
  return [...new Set([...text.matchAll(EVERY)].map((match) => match[1] ?? ""))];
}

/**
 * The player URL for one video, starting at its second. Zero is left off, so an unwatched video has no position.
 * `cc_load_policy=1` sets captions at load only, so a running player keeps its own.
 */
export function playerUrl(id: string, start = 0): string {
  const captions = readVideoSettings().captions ? "&cc_load_policy=1" : "";
  return `${PLAYER}/embed/${id}?enablejsapi=1${start > 0 ? `&start=${Math.floor(start)}` : ""}${captions}`;
}

/**
 * The field a note keeps its positions in: one entry per video, in flow style, on one line.
 * `setField` works a line at a time, so a block mapping would be read as the field above. Keyed by video id, so reordering moves nothing.
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
 * The note with one video's position written in. The other videos' positions are read back and written again,
 * so two players in one note do not overwrite each other. Zero is dropped, as an unwatched video already means it.
 */
export function setWatched(text: string, id: string, seconds: number): string {
  const held = positions(text);
  const at = Math.floor(seconds);
  if (at > 0) held.set(id, at);
  else held.delete(id);

  const pairs = [...held].map(([video, second]) => `${video}: ${second}`);
  return setField(text, WATCHING, `{${pairs.join(", ")}}`);
}

/**
 * The video one address names, or null for anything that is not YouTube. The same reading `noteVideos`
 * gives one URL, so `![](link)` draws as a player only when the address is a shape the pane knows.
 */
export function videoId(url: string): string | null {
  return noteVideos(url)[0] ?? null;
}

/** A string the player sent, or undefined when it sent none or an empty one. */
export function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Which video a player is on, from one delivery's `videoData`. YouTube sends it once, when the video changes,
 * so the name is kept from the last one. Returns the name and whether it is another video than `own`.
 */
export function namedVideo(
  held: string | undefined,
  videoData: unknown,
  own: string | undefined,
): { named: string | undefined; elsewhere: boolean } {
  const named =
    nonEmpty((videoData as { video_id?: unknown } | null | undefined)?.video_id) ?? held;
  return { named, elsewhere: named !== undefined && named !== own };
}
