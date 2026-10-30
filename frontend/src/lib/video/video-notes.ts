/**
 * What a video's note says: its chapters, transcript and the takes that point back into it. Pure,
 * so the note's text is the only input. Times are read as the note writes them, so links and highlights agree.
 */

import { highlightBlocks } from "@/lib/highlight";
import { TRANSCRIPT_HEADING, timestamp } from "@/lib/video/transcript";
import { PLAYER } from "@/lib/video/video";

/** A time in a video and the words at it: a chapter, or a transcript paragraph. */
export interface Timed {
  seconds: number;
  text: string;
}

/** One take of this video, as the note holds it. */
export interface VideoTake {
  /** The take's anchor id, `hl-` and six hex, which is what the take is known by in the note. */
  id: string;
  seconds: number;
  quote: string;
}

const CHAPTERS_HEADING = "## Chapters";

/** A heading at the level a section runs to, or above it: `# ` or `## `. */
const SECTION_END = /^#{1,2} /;

/**
 * A list marker, then the stamp. The stamp must end on a digit, so a colon
 * that is the separator (`12:34: Intro`) is not read into the time.
 */
const CHAPTER_LINE = /^(?:(?:[-*+]|\d+\.) )?(\[\d[\d:]*\]|\d+(?::\d+)+)(.*)$/;

/** What sits between a stamp and its title: a dash with spaces, a colon, or spaces. */
const SEPARATOR = /^(?:\s+[-–—]\s+|:\s*|\s+)/;

/** A paragraph's opening stamp, the way `timestamp` writes it, then its first words. */
const OPENING = /^(\[\d[\d:]*\]) (.*)$/;

/** A take's anchor line: a time link to a YouTube video, with `&t=` for the second when there is one. */
const VIDEO_LINK = /^\[[\d:]+\]\(https:\/\/www\.youtube\.com\/watch\?v=([^&)\s]+)(?:&t=(\d+)s)?\)/;

/** The lines under `heading`, up to the next heading at its level or above. None when there is no such heading. */
function sectionLines(note: string, heading: string): string[] {
  const lines = note.split("\n");
  const at = lines.indexOf(heading);
  if (at === -1) return [];

  const rest = lines.slice(at + 1);
  const end = rest.findIndex((line) => SECTION_END.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * `[mm:ss]`, `mm:ss`, `[h:mm:ss]` or `h:mm:ss` (YouTube's `0:00` too) to
 * seconds, or null for anything else. The brackets are optional and must come
 * in a pair. Minutes and seconds take two digits after the first field, and the
 * minutes are below an hour only when hours are given.
 */
export function parseTime(stamp: string): number | null {
  const inner = stamp.startsWith("[") && stamp.endsWith("]") ? stamp.slice(1, -1) : stamp;

  const hms = /^(\d+):(\d{2}):(\d{2})$/.exec(inner);
  if (hms !== null) {
    const [, h = "0", m = "0", s = "0"] = hms;
    if (Number(m) >= 60 || Number(s) >= 60) return null;
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
  }

  const ms = /^(\d+):(\d{2})$/.exec(inner);
  if (ms === null) return null;
  const [, m = "0", s = "0"] = ms;
  if (Number(s) >= 60) return null;
  return Number(m) * 60 + Number(s);
}

/**
 * The chapters the note lists under `## Chapters`, in the note's order. A line
 * that is not a chapter is skipped, and so is one with no title, which is what
 * a line half-typed in the editor looks like while it is being written.
 */
export function noteChapters(note: string): Timed[] {
  const chapters: Timed[] = [];
  for (const line of sectionLines(note, CHAPTERS_HEADING)) {
    const match = CHAPTER_LINE.exec(line);
    if (match === null) continue;
    const [, stamp = "", rest = ""] = match;
    const seconds = parseTime(stamp);
    const text = rest.replace(SEPARATOR, "").trim();
    if (seconds === null || text === "") continue;
    chapters.push({ seconds, text });
  }
  return chapters;
}

/**
 * The transcript's paragraphs under `## Transcript`, each with its opening second and its words.
 * A paragraph is what sits between blank lines, so a line break inside one is a word break here.
 */
export function transcriptParagraphs(note: string): Timed[] {
  const paragraphs: string[][] = [[]];
  for (const line of sectionLines(note, TRANSCRIPT_HEADING)) {
    const trimmed = line.trim();
    if (trimmed === "") paragraphs.push([]);
    else paragraphs[paragraphs.length - 1]?.push(trimmed);
  }

  const timed: Timed[] = [];
  for (const [head = "", ...tail] of paragraphs) {
    const opening = OPENING.exec(head);
    if (opening === null) continue;
    const [, stamp = "", first = ""] = opening;
    const seconds = parseTime(stamp);
    if (seconds === null) continue;
    timed.push({ seconds, text: [first, ...tail].join(" ").trim() });
  }
  return timed;
}

/**
 * The index of the last item that starts at or before `second`, or -1 before
 * the first. The list is in ascending order, which is how both readers above
 * build it, so the last match is the one on screen.
 */
export function currentAt(list: Timed[], second: number): number {
  let at = -1;
  for (const [index, item] of list.entries()) {
    if (item.seconds <= second) at = index;
  }
  return at;
}

/**
 * The address of a video, opened at the whole second when there is one to
 * open at. Below a second the bare address is the start, which is where the
 * link should go.
 */
export function watchUrl(id: string, seconds: number): string {
  const start = seconds >= 1 ? `&t=${Math.floor(seconds)}s` : "";
  return `${PLAYER}/watch?v=${id}${start}`;
}

/**
 * The link a take writes at the head of its anchor line: the time as the
 * transcript shows it, linked to that moment in the video.
 */
export function timeLink(id: string, seconds: number): string {
  return `[${timestamp(seconds).slice(1, -1)}](${watchUrl(id, seconds)})`;
}

/**
 * The takes in the note that point at `video`, in order: a highlight block whose anchor line opens
 * with a time link to it, where no `&t=` means second 0. The quote's escapes are read back.
 */
export function videoTakes(note: string, video: string): VideoTake[] {
  const lines = note.split("\n");
  const takes: VideoTake[] = [];
  for (const block of highlightBlocks(note)) {
    const link = VIDEO_LINK.exec(lines[block.to - 1] ?? "");
    if (link === null || link[1] !== video) continue;
    takes.push({
      id: block.id,
      seconds: Number(link[2] ?? "0"),
      quote: block.quote.join(" "),
    });
  }
  return takes;
}
