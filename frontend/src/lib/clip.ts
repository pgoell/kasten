/**
 * Turning a web page into a note.
 *
 * The reading is defuddle's, kepano's own extractor and the one behind
 * Obsidian's web clipper, so a page arrives in the vault looking the way the
 * same page would arriving in an Obsidian vault. This module does the rest:
 * what the note is called, where it lives and what its frontmatter says.
 *
 * It runs here rather than on the backend because defuddle reads a DOM and the
 * browser is where the DOM is. The backend's part is the fetch alone, which
 * cannot happen here: a page from another origin is one the browser will ask
 * for and refuse to let a script read.
 */

// `/full` rather than the bare import, which is the extractor without the
// markdown conversion: the browser build leaves that out and the note wants it.
//
// ponytail: it doubles the route chunk, 203 kB gzipped to 407 kB, for a key
// most sessions never press. A dynamic import would keep it off the first
// load, and this repo does not take those. Split the route if the first paint
// starts to hurt.
import Defuddle from "defuddle/full";

/** Where a clipping lands. The one folder in the vault for things not yet filed. */
const INBOX = "00 Inbox";

/**
 * What a note's name may not carry.
 *
 * The first eight are the characters a path or a filesystem refuses, `/`
 * above all: a title holding one would file the note in a folder nobody asked
 * for. The last four are legal in a filename and illegal inside a `[[link]]`,
 * so a note carrying one could not be linked to by name.
 */
const ILLEGAL = /[/\\:*?"<>|#^[\]]/g;

/** The longest a clipped name gets. Headlines run long; a filename should not. */
const NAME_LIMIT = 80;

/** What the note is called, off the page's title, with the site as the fallback. */
function noteName(title: string, url: string): string {
  const name = title
    .replace(ILLEGAL, " ")
    .replace(/\s+/g, " ")
    .slice(0, NAME_LIMIT)
    // Trailing dots and spaces after the leading ones, because the cut above
    // can leave either, and a leading dot is a name the vault will not take.
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");

  return name === "" ? new URL(url).hostname : name;
}

/** One frontmatter line, or nothing at all where the page named no such thing. */
function field(name: string, value: string): string {
  // JSON's own quoting is YAML's double-quoted scalar, which is what keeps a
  // colon in a title or an author from ending the value early.
  return value === "" ? "" : `${name}: ${JSON.stringify(value)}\n`;
}

/** Where a clipped page belongs in the vault, and the note it becomes. */
export interface Clipping {
  path: string;
  body: string;
}

/**
 * Read one page's markup into the note it should become.
 *
 * `url` is where the page was finally read from, redirects followed, because
 * that is what its relative links are relative to. It is written into the
 * frontmatter as `source`, which is the one field of the three that is always
 * there: a clipping that cannot say where it came from is a quotation with no
 * citation.
 *
 * The title is the note's name and its heading both. defuddle leaves it out of
 * the content it extracts, holding it as metadata instead, so a note without
 * this line would open on its first paragraph.
 */
export function clipPage(html: string, url: string): Clipping {
  const parsed = new Defuddle(new DOMParser().parseFromString(html, "text/html"), {
    url,
    markdown: true,
  }).parse();

  const name = noteName(parsed.title, url);
  const front = `---\n${field("source", url)}${field("author", parsed.author)}${field(
    "published",
    parsed.published,
  )}---\n`;

  return {
    path: `${INBOX}/${name}.md`,
    body: `${front}\n# ${parsed.title || name}\n\n${parsed.content}\n`,
  };
}
