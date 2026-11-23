/** The links between todos and notes: the notes a todo's text names, and the todos naming a note. */

import type { TodoRow } from "@/lib/core/api";
import { noteName } from "@/lib/notes/links/note-path";
import { wikiLinkPath, wikiLinkTargets } from "@/lib/notes/links/wikilink";

/** Every note a todo's text links to, once each, in order, whether or not it is written yet. */
export function linkedNotes(text: string, files: string[]): string[] {
  return [...new Set(wikiLinkTargets(text).map((target) => wikiLinkPath(target, files)))].filter(
    Boolean,
  );
}

/**
 * The todos whose words or description link to the note at `path`, open ones first. A todo
 * living in the note is left out: the note already draws it where it sits.
 */
export function todosLinking(rows: TodoRow[], path: string, files: string[]): TodoRow[] {
  const linking = rows.filter(
    (row) =>
      row.state !== "rejected" &&
      row.round_of === null &&
      row.note !== path &&
      linkedNotes(`${row.words}\n${row.description ?? ""}`, files).includes(path),
  );
  const closed = (row: TodoRow) => (row.state === "done" ? 1 : 0);
  return linking.sort((a, b) => closed(a) - closed(b) || a.position - b.position);
}

/** The link to a note: its bare name where no other note shares it, else its path, as `index` notes need. */
export function linkTo(path: string, files: string[]): string {
  const name = noteName(path);
  const alike = files.filter((each) => noteName(each).toLowerCase() === name.toLowerCase());
  return `[[${alike.length <= 1 ? name : path.replace(/\.md$/, "")}]]`;
}
