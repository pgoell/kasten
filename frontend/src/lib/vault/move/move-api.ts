import type { Note } from "@/lib/api";
import { client } from "@/lib/api-client";
import type { components } from "@/lib/api-types";

/** One folder as the vault spells it. A folder is a path and nothing else. */
export type Folder = components["schemas"]["Folder"];

/** Move one note to another path, and answer with the note the vault now holds. */
export async function renameNote(from: string, to: string): Promise<Note> {
  const { data, response } = await client.PATCH("/api/files/{path}", {
    params: { path: { path: from } },
    body: { path: to },
  });

  if (!data) {
    throw new Error(`PATCH /api/files/${from} failed with ${response.status}`);
  }

  return data;
}

/** Move one folder, and every note under it, and answer with where it landed. */
export async function moveFolder(from: string, to: string): Promise<Folder> {
  const { data, response } = await client.PATCH("/api/folders/{path}", {
    params: { path: { path: from } },
    body: { path: to },
  });

  if (!data) {
    throw new Error(`PATCH /api/folders/${from} failed with ${response.status}`);
  }

  return data;
}

/**
 * Every file a move of `source` to `target` would rewrite, asked before the move. `source` may be a
 * note or a folder. Nothing is written: the tree's confirm counts these before a drop lands.
 */
export async function previewMove(source: string, target: string): Promise<string[]> {
  const { data, response } = await client.GET("/api/move-preview", {
    params: { query: { source, target } },
  });

  if (!data) {
    throw new Error(`GET /api/move-preview failed with ${response.status}`);
  }

  return data.rewrites;
}
