import createClient from "openapi-fetch";
import type { components, paths } from "@/lib/api-types";

/** One note as the vault holds it: where it lives, and what is in it. */
export type Note = components["schemas"]["Note"];

/** One folder as the vault spells it. A folder is a path and nothing else. */
export type Folder = components["schemas"]["Folder"];

/** One line of one note that matched a search, and where to find it. */
export type SearchHit = components["schemas"]["SearchHit"];

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

/**
 * Every herdr session a terminal pane could attach to, named and sorted.
 *
 * A listing of the shell container's session directory, so it says what exists
 * rather than what is running. Empty when that container is not up, or when
 * the backend was started without its volume, and the prompt still takes a
 * name typed by hand.
 */
export async function fetchTerminals(): Promise<string[]> {
  const { data, response } = await client.GET("/api/terminals");

  if (!data) {
    throw new Error(`GET /api/terminals failed with ${response.status}`);
  }

  return data;
}

/**
 * Every todo line and every time session line the vault holds.
 *
 * Candidate lines, not todos. The backend matches the shape of a checkbox and
 * nothing more, so reading the state, the dates and whether a line is still
 * open is this side's job, done by the same parser the editor draws with.
 */
export async function fetchTodos(): Promise<SearchHit[]> {
  const { data, response } = await client.GET("/api/todos");

  if (!data) {
    throw new Error(`GET /api/todos failed with ${response.status}`);
  }

  return data;
}

/**
 * Every line in the vault holding `query`, as the backend found them.
 *
 * A literal match and nothing more. Ranking these is the caller's job, which
 * is what lets a keystroke narrow the answer already in hand rather than wait
 * for the next one.
 */
export async function searchNotes(query: string): Promise<SearchHit[]> {
  const { data, response } = await client.GET("/api/search", {
    params: { query: { q: query } },
  });

  if (!data) {
    throw new Error(`GET /api/search failed with ${response.status}`);
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

/**
 * Make a note, and answer with the note the vault wrote.
 *
 * `content` is what goes under the frontmatter block, and it is empty for every
 * note a reader is about to write themselves. A caller that already knows the
 * text passes it here rather than saving over the note it just made: that save
 * is a second event on `/api/events`, and one arriving into an editor already
 * being typed into reads as another writer.
 */
export async function createNote(path: string, content = ""): Promise<Note> {
  const { data, response } = await client.POST("/api/files/{path}", {
    params: { path: { path } },
    body: { content },
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

/**
 * Write one note back to the vault, over the note that is already there.
 *
 * The note that comes back is what landed on disk, not what was sent: `PUT`
 * stamps a fresh `modified` on the way through. Callers that cache the text
 * have to cache this one, or their copy is a stamp behind the vault from the
 * moment the write returns.
 */
export async function saveNote(path: string, content: string): Promise<Note> {
  const { data, response } = await client.PUT("/api/files/{path}", {
    params: { path: { path } },
    body: { content },
  });

  if (!data) {
    throw new Error(`PUT /api/files/${path} failed with ${response.status}`);
  }

  return data;
}
