import type { QueryClient } from "@tanstack/react-query";
import { moveFolder, renameNote } from "@/lib/api";

/** What a move carries: one note, or a folder and every note under it. */
export type MoveMode = "rename" | "folder";

/**
 * Move a note or a folder, leave the cache holding what the vault does, and
 * answer with the path it landed on.
 *
 * One function for the two places a move starts, the prompt and a drop in the
 * tree, so the cache cannot be kept one way after a rename and another way
 * after a drag.
 */
export async function moveAndCache(
  queryClient: QueryClient,
  mode: MoveMode,
  from: string,
  to: string,
): Promise<string> {
  if (mode === "folder") {
    const folder = await moveFolder(from, to);
    // Every note under the folder is at a new path, and the answer carries no
    // text to move with them. They are dropped rather than remapped: the vault
    // is the only thing that knows what is in a note, and a copy left stale by
    // a write outside kasten must not survive the move.
    const moved = `${from}/`;
    queryClient.removeQueries({
      queryKey: ["note"],
      predicate: ({ queryKey }) => typeof queryKey[1] === "string" && queryKey[1].startsWith(moved),
    });
    return folder.path;
  }

  const note = await renameNote(from, to);
  // The text comes from the answer rather than from the cache, so the rename
  // carries the note across without trusting a copy that may be stale.
  queryClient.setQueryData(["note", note.path], note.content);
  // The note is not at the old path any more, so a cache entry there would
  // answer for a note the vault no longer has.
  queryClient.removeQueries({ queryKey: ["note", from] });
  return note.path;
}

/**
 * Where a drop of `path` on folder `folder` puts it, `""` being the vault root,
 * or undefined when the drop moves nothing.
 *
 * Nothing for a drop where it already sits, and nothing for a folder dropped
 * on itself or on a folder inside it, which the vault would refuse anyway.
 */
export function dropTarget(path: string, mode: MoveMode, folder: string): string | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const target = folder ? `${folder}/${name}` : name;
  if (target === path) return undefined;
  if (mode === "folder" && (folder === path || folder.startsWith(`${path}/`))) return undefined;
  return target;
}
