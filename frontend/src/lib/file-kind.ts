/**
 * The files the finder lists beside the notes, and what each one opens as.
 *
 * Decided from the name alone, the way the backend picks a book: the suffix
 * matched in any case, so `PLAN.PDF` is a pdf and not a note nobody can open.
 */

export type FileKind = "pdf" | "epub" | "html";

/** What a vault path is as a file the finder lists, or undefined for a note and for anything else. */
export function fileKind(path: string): FileKind | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".epub")) return "epub";
  if (lower.endsWith(".html")) return "html";
  return undefined;
}

/** The note an epub is read through: `x.md` beside `x.epub`, in any case of suffix. */
export function bookNoteOf(epub: string): string {
  return epub.replace(/\.epub$/i, ".md");
}
