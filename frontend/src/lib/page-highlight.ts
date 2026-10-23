import { updateNote } from "@/lib/api";
import { addHighlight } from "@/lib/highlight";
import { quoteParagraphs } from "@/lib/html-take";
import { newId } from "@/lib/todo";

/**
 * Write a passage from a vault page under `## Highlights` of a note, in the
 * book's own format. The link is the chapter line, so the passage leads back to
 * where it sits on the page. The link is the caller's, since a page and a PDF
 * name their places differently.
 */
export function writePassage(notePath: string, text: string, link: string) {
  const highlight = {
    text: quoteParagraphs(text).join("\n"),
    chapter: link,
  };
  return updateNote(notePath, (note) => addHighlight(note, highlight, newId("hl-")));
}
