import { updateNote } from "@/lib/api";
import { addHighlight } from "@/lib/takes/highlight";
import { quoteParagraphs } from "@/lib/takes/html-take";
import { newId } from "@/lib/todo/todo";

/**
 * Writes a passage under `## Highlights` of a note. The caller picks `link`,
 * since pages and PDFs name their places differently.
 */
export function writePassage(notePath: string, text: string, link: string) {
  const highlight = {
    text: quoteParagraphs(text).join("\n"),
    chapter: link,
  };
  return updateNote(notePath, (note) => addHighlight(note, highlight, newId("hl-")));
}
