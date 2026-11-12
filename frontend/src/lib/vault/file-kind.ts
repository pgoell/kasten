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

/** What a video file's name ends in, as the backend's `CLIP_SUFFIXES`. */
export const CLIP_SUFFIXES = [".mp4", ".webm"];

/** Whether a vault path names a video file, by its suffix in any case. Raw: a `#` is part of the name. */
export function isClip(path: string): boolean {
  const lower = path.toLowerCase();
  return CLIP_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/** Whether a file is a video the vault takes: by its suffix, or by its type for a name with none. */
export function isClipFile(file: { name: string; type: string }): boolean {
  return (
    isClip(file.name) || CLIP_SUFFIXES.some((suffix) => file.type === `video/${suffix.slice(1)}`)
  );
}

/** What an image the vault takes ends in, as the backend's `IMAGE_SUFFIXES`. */
export const IMAGE_SUFFIXES = [".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"];

/** What the image's pane draws a vault file as: a csv as a table, a video file as a player. */
export function paneKind(path: string): "table" | "clip" | "image" {
  if (path.toLowerCase().endsWith(".csv")) return "table";
  return isClip(path) ? "clip" : "image";
}

/** Whether a file no note owns, beside the pictures, opens in the image's pane: a csv or a video. */
export function opensInFilePane(path: string): boolean {
  return paneKind(path) !== "image";
}
