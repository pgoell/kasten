import createClient from "openapi-fetch";
import type { paths } from "@/lib/api-types";

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

/** Make an empty note, and answer with the path the vault gave it. */
export async function createNote(path: string): Promise<string> {
  const { data, response } = await client.POST("/api/files/{path}", {
    params: { path: { path } },
  });

  if (!data) {
    throw new Error(`POST /api/files/${path} failed with ${response.status}`);
  }

  // The vault's spelling, not the one that was typed. `daily/./note.md` comes
  // back as `daily/note.md`, and that is what belongs in `?note=`.
  return data.path;
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
