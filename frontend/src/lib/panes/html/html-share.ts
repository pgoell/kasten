/**
 * A newspaper story saved to share later, as a `#share` todo in the store.
 * The page is not trusted, so the headline is escaped and the source must be http or https.
 */

import { aliasOf, fileOf, pageLink } from "@/lib/takes/html-take";

/** What the page script sends for a story. */
export interface Story {
  /** The story's own heading, the first in its article. */
  heading: string;
  /** The story id the paper prints as `a.sid`. */
  anchor: string;
  /** The address the story was written from, or "" where the page names none. */
  source: string;
}

/** Characters of address kept. A longer one is dropped, not cut, since a cut address leads nowhere. */
const SOURCE_CAP = 2000;

/** The script's limits on what it sends, in code points, held here too for a forged message. */
const HEADING_MAX = 300;
const ANCHOR_MAX = 200;

/** The tag every saved story carries, which the todo board filters on. */
export const SHARE_TAG = "#share";

/** The story in a `share` message, or null when the message is not one. */
export function storyOf(data: Record<string, unknown>): Story | null {
  const { heading, anchor, source } = data;
  if (typeof heading !== "string" || typeof anchor !== "string" || typeof source !== "string") {
    return null;
  }
  if (anchor === "") return null;
  return {
    heading: Array.from(heading).slice(0, HEADING_MAX).join(""),
    anchor: Array.from(anchor).slice(0, ANCHOR_MAX).join(""),
    source: sourceOf(source),
  };
}

/**
 * The address as a markdown link can hold it, or "" when it is not one to keep.
 * Only http and https: a `javascript:` or `data:` link would be clicked later. `URL` leaves a bracket, which would end the link early, so it is encoded here.
 */
export function sourceOf(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    if (error instanceof TypeError) return "";
    throw error;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  const href = url.href.replace(
    /[()<>[\]]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return href.length > SOURCE_CAP ? "" : href;
}

/** The new todo's words and description: what the todo view lists, and the two ways back to the story. */
export interface ShareTodo {
  words: string;
  description: string;
}

/**
 * The todo for a story: the headline in its words, plain so the table reads it, and the source
 * and the link to its place in the paper in its description, which the panel lists under Notes.
 * `from` is the note the todo lives in, which a markdown link to an odd page name is relative to.
 */
export function shareTodo(path: string, story: Story, from: string): ShareTodo {
  const headline = aliasOf(story.heading) || aliasOf(fileOf(path));
  const paper = pageLink(path, { text: "", anchor: story.anchor, heading: "in the paper" }, from);
  return {
    words: `share ${headline} ${SHARE_TAG}`,
    description: story.source === "" ? paper : `${story.source}\n${paper}`,
  };
}
