/**
 * Turns a web page into a note: its title, path and frontmatter. The reading is defuddle's,
 * the extractor behind Obsidian's clipper, so a page looks as it would in Obsidian. It runs
 * in the browser because defuddle needs a DOM; the backend only does the fetch.
 */

// `/full` adds the markdown conversion the note needs. It doubles the route chunk (203 to
// 407 kB gzipped); a dynamic import would avoid that, but this repo bans them for this.
import Defuddle from "defuddle/full";
import { createNote, fetchPage, type Note } from "@/lib/api";
import { INBOX } from "@/lib/layout";
import { safeName } from "@/lib/note-path";

/** What the note is called, off the page's title, with the site as the fallback. */
function noteName(title: string, url: string): string {
  const name = safeName(title);

  return name === "" ? new URL(url).hostname : name;
}

/** One frontmatter line, or nothing at all where the page named no such thing. */
function field(name: string, value: string): string {
  // JSON quoting is valid YAML double-quoted, so a colon in a title cannot end the value.
  return value === "" ? "" : `${name}: ${JSON.stringify(value)}\n`;
}

/** Where a clipped page belongs in the vault, and the note it becomes. */
export interface Clipping {
  path: string;
  body: string;
}

/**
 * Reads one page's markup into the note it should become. `url` is the final URL after
 * redirects, since relative links resolve against it. It is written as `resource`, the
 * field Open Knowledge Format reads as a note's address. Older clippings carry `source`.
 * The title is also the heading: defuddle keeps it out of the content.
 */
export function clipPage(html: string, url: string): Clipping {
  const parsed = new Defuddle(new DOMParser().parseFromString(html, "text/html"), {
    url,
    markdown: true,
  }).parse();

  const name = noteName(parsed.title, url);
  // Plain, not via field(): every clipping is a Source, whatever the page holds.
  const front = `---\ntype: Source\n${field("resource", url)}${field(
    "author",
    parsed.author,
  )}${field("published", parsed.published)}---\n`;

  return {
    path: `${INBOX}/${name}.md`,
    body: `${front}\n# ${parsed.title || name}\n\n${parsed.content}\n`,
  };
}

/**
 * Reads a page off the internet into the inbox. `paths` is the vault listing the caller
 * read: a page already there is not clipped again, and `made` is null. Errors propagate.
 */
export async function importPage(
  url: string,
  paths: string[],
): Promise<{ path: string; made: Note | null }> {
  const page = await fetchPage(url);
  const { path, body } = clipPage(page.html, page.url);
  const made = paths.includes(path) ? null : await createNote(path, body);

  return { path: made?.path ?? path, made };
}
