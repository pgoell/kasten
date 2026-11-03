import { client } from "@/lib/api-client";
import type { components } from "@/lib/api-types";

/** One deleted note or folder waiting in the trash, and the way back to it. */
export type TrashEntry = components["schemas"]["TrashEntry"];

/** Moves a note to the trash, where `restoreEntry` can bring it back until retention ends. */
export async function deleteNote(path: string): Promise<TrashEntry> {
  const { data, response } = await client.DELETE("/api/files/{path}", {
    params: { path: { path } },
  });

  if (!data) {
    throw new Error(`DELETE /api/files/${path} failed with ${response.status}`);
  }

  return data;
}

/** Like `deleteNote`, for one image. The route refuses books. */
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

/** Puts an entry back where it was deleted from, and answers with the path it landed on. */
export async function restoreEntry(entry: string): Promise<string> {
  const { data, response } = await client.PATCH("/api/trash/{entry}", {
    params: { path: { entry } },
  });

  if (!data) {
    throw new Error(`PATCH /api/trash/${entry} failed with ${response.status}`);
  }

  return data.path;
}
