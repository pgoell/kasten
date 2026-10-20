import { client } from "@/lib/api-client";
import type { components } from "@/lib/api-types";

/** One deleted note or folder waiting in the trash, and the way back to it. */
export type TrashEntry = components["schemas"]["TrashEntry"];

/**
 * Take one note out of the vault, and answer with where it went.
 *
 * The note is not gone: it waits in the vault's trash for as long as the
 * backend's retention allows, and `restoreEntry` puts it back. Nothing lists,
 * searches or opens it in the meantime, so the vault reads as though it had
 * been deleted.
 */
export async function deleteNote(path: string): Promise<TrashEntry> {
  const { data, response } = await client.DELETE("/api/files/{path}", {
    params: { path: { path } },
  });

  if (!data) {
    throw new Error(`DELETE /api/files/${path} failed with ${response.status}`);
  }

  return data;
}

/**
 * The same for one image, which goes into the trash the way a note does.
 *
 * Images alone: the route refuses a book, a book travelling with the note beside
 * it and this deciding nothing about the pair.
 */
export async function deleteImage(path: string): Promise<TrashEntry> {
  const { data, response } = await client.DELETE("/api/assets/{path}", {
    params: { path: { path } },
  });

  if (!data) {
    throw new Error(`DELETE /api/assets/${path} failed with ${response.status}`);
  }

  return data;
}

/** The same for one folder, and every note under it, which go as one entry. */
export async function deleteFolder(path: string): Promise<TrashEntry> {
  const { data, response } = await client.DELETE("/api/folders/{path}", {
    params: { path: { path } },
  });

  if (!data) {
    throw new Error(`DELETE /api/folders/${path} failed with ${response.status}`);
  }

  return data;
}

/** Everything the trash is holding, newest first, as the backend sorted it. */
export async function fetchTrash(): Promise<TrashEntry[]> {
  const { data, response } = await client.GET("/api/trash");

  if (!data) {
    throw new Error(`GET /api/trash failed with ${response.status}`);
  }

  return data;
}

/**
 * Put one entry back where it was deleted from, and say where that was.
 *
 * The path is the backend's, read off the entry's own name, so the caller does
 * not work out where a restore lands: it opens what comes back.
 */
export async function restoreEntry(entry: string): Promise<string> {
  const { data, response } = await client.PATCH("/api/trash/{entry}", {
    params: { path: { entry } },
  });

  if (!data) {
    throw new Error(`PATCH /api/trash/${entry} failed with ${response.status}`);
  }

  return data.path;
}
