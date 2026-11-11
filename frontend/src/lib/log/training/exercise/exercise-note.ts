/**
 * What an exercise note's frontmatter holds for its page: its kind, its muscles and its video.
 * docs/reference/training/exercise-page.md gives each field.
 */

import { closing, readField } from "@/lib/notes/text/note-frontmatter";
import { videoId } from "@/lib/panes/video/video";

export const KINDS = ["strength", "cardio", "mobility", "test"] as const;

/** The player YouTube serves without cookies, so a page view sets none. */
export const NOCOOKIE = "https://www.youtube-nocookie.com";

const FILE_VIDEO = /^https:\/\/[^\s"'<>]+\.(?:mp4|webm|mov|m4v)(?:[?#][^\s"'<>]*)?$/iu;

export interface ExerciseNote {
  kind: (typeof KINDS)[number];
  primary: string[];
  secondary: string[];
  video: string;
}

export type Video = { kind: "youtube"; src: string } | { kind: "file"; src: string };

function bare(value: string): string {
  return value.trim().replace(/^["']+|["']+$/gu, "");
}

/** A list field in flow style, `[chest, triceps]`, or as `- chest` lines under its key. */
export function listField(text: string, name: string): string[] {
  const value = readField(text, name);
  if (value === undefined) return [];
  if (value.trim() !== "") {
    return value
      .replace(/^\s*\[|\]\s*$/gu, "")
      .split(",")
      .map(bare)
      .filter((item) => item !== "");
  }
  const lines = text.split("\n");
  const end = closing(lines);
  const at = lines.findIndex((line, index) => index < end && line.startsWith(`${name}:`));
  const items: string[] = [];
  for (let index = at + 1; index < end; index += 1) {
    const item = /^\s+-\s+(.+)$/u.exec(lines[index] ?? "")?.[1];
    if (item === undefined) break;
    items.push(bare(item));
  }
  return items;
}

/** The note as an exercise page, or null when its `kind` names none. */
export function readExercise(text: string): ExerciseNote | null {
  const kind = bare(readField(text, "kind") ?? "").toLowerCase();
  const known = KINDS.find((each) => each === kind);
  if (known === undefined) return null;
  const primary = listField(text, "muscles_primary");
  return {
    kind: known,
    primary,
    secondary: listField(text, "muscles_secondary").filter((m) => !primary.includes(m)),
    video: bare(readField(text, "video") ?? ""),
  };
}

/** What plays a `video` link: YouTube's cookieless player, a video file, or null for anything else. */
export function videoOf(link: string): Video | null {
  const id = videoId(link);
  if (id !== null) return { kind: "youtube", src: `${NOCOOKIE}/embed/${id}` };
  return FILE_VIDEO.test(link) ? { kind: "file", src: link } : null;
}
