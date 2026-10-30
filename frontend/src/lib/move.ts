import type { QueryClient } from "@tanstack/react-query";
import { moveFolder, renameNote } from "@/lib/move-api";

/** What a move carries: one note, or a folder and every note under it. */
export type MoveMode = "rename" | "folder";

/**
 * Moves a note or folder and fixes the cache to match the vault, for the prompt and
 * tree drops alike. Returns the path it landed on.
 */
export async function moveAndCache(
  queryClient: QueryClient,
  mode: MoveMode,
  from: string,
  to: string,
): Promise<string> {
  if (mode === "folder") {
    const folder = await moveFolder(from, to);
    // The answer has no note text, so cached notes under the folder are dropped,
    // not remapped: a copy edited outside kasten must not survive the move.
    const moved = `${from}/`;
    queryClient.removeQueries({
      queryKey: ["note"],
      predicate: ({ queryKey }) => typeof queryKey[1] === "string" && queryKey[1].startsWith(moved),
    });
    return folder.path;
  }

  const note = await renameNote(from, to);
  // Take the text from the answer, not from a cached copy that may be stale.
  queryClient.setQueryData(["note", note.path], note.content);
  // The old path is gone; a cache entry there would answer for a missing note.
  queryClient.removeQueries({ queryKey: ["note", from] });
  return note.path;
}

/**
 * Where a drop of `path` on `folder` puts it (`""` is the vault root), or undefined
 * when it moves nothing. A folder dropped into itself is nothing; the vault refuses it.
 */
export function dropTarget(path: string, mode: MoveMode, folder: string): string | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const target = folder ? `${folder}/${name}` : name;
  if (target === path) return undefined;
  if (mode === "folder" && (folder === path || folder.startsWith(`${path}/`))) return undefined;
  return target;
}
