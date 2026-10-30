/**
 * A newspaper story saved to share later, as the todo the page pane writes into today's `## Dump`.
 * The page is not trusted, so the headline is escaped and the source must be http or https.
 */

import { aliasOf, fileOf, pageLink } from "@/lib/html-take";

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

/**
 * The todo line for a story, with the headline inside the link so a date marker in it stays words.
 * `from` is the note the line is written into.
 */
export function shareLine(path: string, story: Story, from: string, date: string): string {
  const headline = aliasOf(story.heading) || aliasOf(fileOf(path));
  const passage = { text: "", anchor: story.anchor };
  const link =
    story.source === ""
      ? pageLink(path, { ...passage, heading: headline }, from)
      : `[${headline}](${story.source}) (${pageLink(path, { ...passage, heading: "in the paper" }, from)})`;
  return `- [ ] share ${link} ${SHARE_TAG} ➕ ${date}`;
}
