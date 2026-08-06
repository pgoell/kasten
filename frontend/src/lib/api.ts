import createClient from "openapi-fetch";
import type { components, paths } from "@/lib/api-types";

/** One note as the vault holds it: where it lives, and what is in it. */
export type Note = components["schemas"]["Note"];

/** One folder as the vault spells it. A folder is a path and nothing else. */
export type Folder = components["schemas"]["Folder"];

/**
 * Calls into the backend, typed from its OpenAPI schema.
 *
 * Run `mise run fe:types` after changing a route to regenerate `api-types.ts`.
 */
const client = createClient<paths>();

/** Vault-relative paths of every note, sorted by the backend. */
export async function fetchFiles(): Promise<string[]> {
  const { data, response } = await client.GET("/api/files");

  if (!data) {
    throw new Error(`GET /api/files failed with ${response.status}`);
  }

  return data;
}

/** The text of one note, read straight off the vault. */
export async function fetchNote(path: string): Promise<string> {
  const { data, response } = await client.GET("/api/files/{path}", {
    params: { path: { path } },
  });

  if (!data) {
    throw new Error(`GET /api/files/${path} failed with ${response.status}`);
  }

  return data.content;
}

/** Make an empty note, and answer with the note the vault wrote. */
export async function createNote(path: string): Promise<Note> {
  const { data, response } = await client.POST("/api/files/{path}", {
    params: { path: { path } },
  });

  if (!data) {
    throw new Error(`POST /api/files/${path} failed with ${response.status}`);
  }

  // The whole note rather than the path alone, so a caller that writes and one
  // that moves seed their cache from the same answer. The path in it is the
  // vault's spelling, not the one that was typed: `daily/./note.md` comes back
  // as `daily/note.md`, and that is what belongs in `?note=`.
  return data;
}

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

/** Write one note back to the vault, over the note that is already there. */
export async function saveNote(path: string, content: string): Promise<void> {
  const { data, response } = await client.PUT("/api/files/{path}", {
    params: { path: { path } },
    body: { content },
  });

  if (!data) {
    throw new Error(`PUT /api/files/${path} failed with ${response.status}`);
  }
}
