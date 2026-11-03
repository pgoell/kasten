/**
 * The files the finder lists beside notes. Decided by the suffix in any case, as the backend
 * matches a book's suffix.
 */

export type FileKind = "pdf" | "epub" | "html";

/** The file kind the finder lists a vault path as, or undefined for a note or anything else. */
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
