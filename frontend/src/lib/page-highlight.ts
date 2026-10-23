import { updateNote } from "@/lib/api";
import { addHighlight } from "@/lib/highlight";
import { type PagePassage, pageLink, quoteParagraphs } from "@/lib/html-take";
import { newId } from "@/lib/todo";

/**
 * Write a passage from a vault page under `## Highlights` of a note, in the
 * book's own format. The page's link is the chapter line, so the passage leads
 * back to where it sits on the page.
 */
export function writePassage(notePath: string, pagePath: string, passage: PagePassage) {
  const highlight = {
    text: quoteParagraphs(passage.text).join("\n"),
    chapter: pageLink(pagePath, passage),
  };
  return updateNote(notePath, (text) => addHighlight(text, highlight, newId("hl-")));
}
