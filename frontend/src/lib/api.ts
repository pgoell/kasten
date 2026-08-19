import createClient from "openapi-fetch";
import type { components, paths } from "@/lib/api-types";

/** One note as the vault holds it: where it lives, and what is in it. */
export type Note = components["schemas"]["Note"];

/** One folder as the vault spells it. A folder is a path and nothing else. */
export type Folder = components["schemas"]["Folder"];

/** One line of one note that matched a search, and where to find it. */
export type SearchHit = components["schemas"]["SearchHit"];

/** One web page the backend read for us: where it came from, and its markup. */
export type Page = components["schemas"]["Page"];

/** One deleted note or folder waiting in the trash, and the way back to it. */
export type TrashEntry = components["schemas"]["TrashEntry"];

/** One agent token as the store may be read: a name and when it was made. */
export type Token = components["schemas"]["Token"];

/** One agent token as it is handed over, secret and all, exactly once. */
export type Minted = components["schemas"]["Minted"];

/**
 * Calls into the backend, typed from its OpenAPI schema.
 *
 * Run `mise run fe:types` after changing a route to regenerate `api-types.ts`.
 */
const client = createClient<paths>();

/**
 * What the backend said went wrong, or nothing where it said nothing.
 *
 * Every other call here reports its own status code, which is all a reader of
 * the console needs. A clip is the one whose failure is put in front of the
 * person who pressed the key, and `detail` is the sentence written for them.
 */
function reason(error: { detail?: unknown } | undefined): string | null {
  return typeof error?.detail === "string" ? error.detail : null;
}

/**
 * What the backend is running: the release, or its commit in development.
 *
 * The frontend's own half of the reading is a build-time constant in
 * `build.ts`, so this is the one call the status bar needs.
 */
export async function fetchVersion(): Promise<string> {
  const { data, response } = await client.GET("/api/version");

  if (!data) {
    throw new Error(`GET /api/version failed with ${response.status}`);
  }

  return data.backend;
}

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
export async function fetchTodos(archive = false): Promise<SearchHit[]> {
  const { data, response } = await client.GET("/api/todos", {
    params: { query: { archive } },
  });

  if (!data) {
    throw new Error(`GET /api/todos failed with ${response.status}`);
  }

  return data;
}

/** What one imported `.apkg` turned into. */
export type AnkiImport = components["schemas"]["AnkiImport"];

/**
 * Turn an Anki export into notes in the vault.
 *
 * The file's own bytes as the body, not a form: the request carries one file
 * and nothing beside it, the way an asset upload does.
 */
export async function importAnki(file: Blob): Promise<AnkiImport> {
  // Plain `fetch` for the reason `uploadAsset` uses one: the endpoint takes raw
  // bytes, so the generated client documents a body it will not let us send.
  const response = await fetch("/api/anki", { method: "POST", body: file });

  if (!response.ok) {
    const detail =
      response.headers.get("content-type")?.includes("json") === true
        ? reason(await response.json())
        : null;
    throw new Error(detail ?? `POST /api/anki failed with ${response.status}`);
  }

  return (await response.json()) as AnkiImport;
}

/**
 * Every line in the vault that could be part of a flashcard.
 *
 * Candidate lines, in search's shape. `review.ts` groups them into decks and
 * `srs.ts` parses the ones a session actually asks, so nothing about the format
 * is known on this side of the wire.
 */
export async function fetchCards(archive = false): Promise<SearchHit[]> {
  const { data, response } = await client.GET("/api/cards", {
    params: { query: { archive } },
  });

  if (!data) {
    throw new Error(`GET /api/cards failed with ${response.status}`);
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
export async function searchNotes(query: string, archive = false): Promise<SearchHit[]> {
  const { data, response } = await client.GET("/api/search", {
    params: { query: { q: query, archive } },
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

/**
 * Read one web page through the backend, which is the only thing that can.
 *
 * The browser will ask another origin for a page and refuse to let a script
 * read the answer, so the request goes out from the server. What comes back is
 * markup and the address it finally came from; making a note of it happens
 * here, in `clip.ts`.
 *
 * The message is the backend's own words rather than a status code: this is
 * the one call whose failure is read by the person who asked for it.
 */
export async function fetchPage(url: string): Promise<Page> {
  const { data, error, response } = await client.GET("/api/fetch", {
    params: { query: { url } },
  });

  if (!data) {
    throw new Error(reason(error) ?? `GET /api/fetch failed with ${response.status}`);
  }

  return data;
}

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

/** Every tag written anywhere in the vault, once each, sorted by the backend. */
export async function fetchTags(): Promise<string[]> {
  const { data, response } = await client.GET("/api/tags");

  if (!data) {
    throw new Error(`GET /api/tags failed with ${response.status}`);
  }

  return data;
}

/** Vault-relative paths of every image, sorted by the backend. */
export async function fetchImages(): Promise<string[]> {
  const { data, response } = await client.GET("/api/images");

  if (!data) {
    throw new Error(`GET /api/images failed with ${response.status}`);
  }

  return data;
}

/** What sits beside a note, and which of the two formats it turned out to be. */
export interface BookBeside {
  /** The file's own path in the vault, which the note's does not spell. */
  path: string;
  blob: Blob;
}

/**
 * Read whatever the reader can open beside `note`, whole.
 *
 * The note's path and not the file's, because the file's is not a thing the
 * client knows: the pair is a convention, two suffixes now answer to it, and
 * the vault is what resolves which. A client probing instead would spend a 404
 * on every pdf it opened and would hold a second copy of an ordering the
 * backend already has.
 *
 * Plain `fetch` rather than the generated client, for the reason the route
 * opens its `EventSource` by hand: with `response_class=FileResponse` and no
 * hand written `responses={...}` block, FastAPI documents a 200 carrying no
 * content schema at all, so `openapi-fetch` has no typed body to hand back and
 * would buy nothing. Adding that block to please a client that wants bytes is
 * boilerplate in the endpoint.
 *
 * `encodeURIComponent` spells a slash `%2F`, which uvicorn unquotes before
 * starlette routes. Every note read in this app already relies on that, the
 * generated client encoding its path parameters the same way.
 */
export async function fetchBook(note: string): Promise<BookBeside> {
  const response = await fetch(`/api/books/${encodeURIComponent(note)}`);

  if (!response.ok) {
    throw new Error(`GET /api/books/${note} failed with ${response.status}`);
  }

  // The header and not a guess off the length or the bytes: the reader names
  // the file in its own failure message and downloads it under that name, and
  // both would otherwise be a second copy of the vault's ordering. A missing
  // header is a backend that changed under this one, so it reads as no book
  // rather than as a book called nothing.
  const named = response.headers.get("X-Book-Path");
  if (named === null) {
    throw new Error(`GET /api/books/${note} answered without naming the file`);
  }

  // Percent-encoded on the way out, because a header is latin-1 on the wire and
  // a vault holds notes called `Grundzüge`. The backend encodes; this is the
  // other half of that one rule.
  return { path: decodeURIComponent(named), blob: await response.blob() };
}

/**
 * The most this will send, checked before a byte goes out.
 *
 * The other copy is `ASSET_LIMIT_BYTES` in
 * `backend/src/kasten_backend/main.py`, and the direction is what matters:
 * this one must never exceed that one, because a client that lets through what
 * the server refuses turns a readable 413 into a network error. `api.test.ts`
 * reads the backend's copy off disk and holds the two together.
 */
export const ASSET_LIMIT_BYTES = 100 * 1024 * 1024;

/**
 * Put one book or image at `path`, which is the file's path and not the note's.
 *
 * Plain `fetch` for the reason `fetchBook` uses one, and the raw file as the
 * body rather than a multipart part: one file and no fields, so nothing has to
 * parse a boundary at either end.
 *
 * One function for both, the endpoint being one endpoint: what the vault will
 * take is a table of suffixes on the backend, and a second copy of it here
 * would be a second place to edit when a format arrives.
 */
export async function uploadAsset(path: string, file: Blob): Promise<void> {
  const response = await fetch(`/api/assets/${encodeURIComponent(path)}`, {
    method: "POST",
    body: file,
  });

  if (!response.ok) {
    // The content type asked rather than the parse wrapped in a `try`: this is
    // the one call whose refusal can come from something other than kasten.
    // Cloudflare sits in front of production with a body limit of its own and
    // answers an oversize upload with an HTML page, which `.json()` throws on.
    const detail =
      response.headers.get("content-type")?.includes("json") === true
        ? reason(await response.json())
        : null;
    throw new Error(detail ?? `POST /api/assets/${path} failed with ${response.status}`);
  }
}

/** Every agent token the vault holds. Never a digest and never a secret. */
export async function fetchTokens(): Promise<Token[]> {
  const { data, response } = await client.GET("/api/tokens");

  if (!data) {
    throw new Error(`GET /api/tokens failed with ${response.status}`);
  }

  return data;
}

/**
 * Mint one agent token and hand back the only copy of its secret.
 *
 * The refusal is put in front of the person who typed the name, the way a clip's
 * is: a taken name is the one failure here they can do something about.
 */
export async function createToken(name: string): Promise<Minted> {
  const { data, error, response } = await client.POST("/api/tokens", { body: { name } });

  if (!data) {
    throw new Error(reason(error) ?? `POST /api/tokens failed with ${response.status}`);
  }

  return data;
}

/** Revoke one agent token. The next request carrying it is refused. */
export async function revokeToken(name: string): Promise<void> {
  const { response } = await client.DELETE("/api/tokens/{name}", {
    params: { path: { name } },
  });

  if (!response.ok) {
    throw new Error(`DELETE /api/tokens/${name} failed with ${response.status}`);
  }
}
