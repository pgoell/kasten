import { client, postFile, reason, refused } from "@/lib/api-client";
import type { components } from "@/lib/api-types";
import { applyLayout, type Layout } from "@/lib/layout";
import { noteBase } from "@/lib/note-base";
import { pressWrote } from "@/lib/todo/todo-press-echo";

/** One note as the vault holds it: where it lives, and what is in it. */
export type Note = components["schemas"]["Note"];

/** One line of one note, and where to find it. */
export type LineHit = components["schemas"]["LineHit"];

/** One line of one note that matched a search, with the date and tags of that note. */
export type SearchHit = components["schemas"]["SearchHit"];

/** One todo or session line, and the project folder the backend files it under. */
export type TodoHit = components["schemas"]["TodoHit"];

/** One web page the backend read for us: where it came from, and its markup. */
export type Page = components["schemas"]["Page"];

/** One video's captions, the track they came from, and when each one appears. */
export type Transcript = components["schemas"]["Transcript"];

/** One town's day of weather, hour by hour, as Open-Meteo forecast it. */
export type Forecast = components["schemas"]["Forecast"];

/** The backend's release, or its commit in development; the frontend's half is a build-time constant in `build.ts`. */
export async function fetchVersion(): Promise<string> {
  const { data, response } = await client.GET("/api/version");

  if (!data) {
    throw new Error(`GET /api/version failed with ${response.status}`);
  }

  return data.backend;
}

/** Applied here, not by the caller, so the layout is in place before the answer reaches a renderer. */
export async function fetchLayout(): Promise<Layout> {
  const { data, response } = await client.GET("/api/layout");

  if (!data) {
    throw new Error(`GET /api/layout failed with ${response.status}`);
  }

  applyLayout(data);
  return data;
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
 * What the shell container's session directory holds, not what runs. Empty when that container is down; the prompt still takes a typed name.
 */
export async function fetchTerminals(): Promise<string[]> {
  const { data, response } = await client.GET("/api/terminals");

  if (!data) {
    throw new Error(`GET /api/terminals failed with ${response.status}`);
  }

  return data;
}

/**
 * Candidate lines, not todos. The backend matches the checkbox shape, and this side reads the state and dates with the same parser the editor draws with.
 */
export async function fetchTodos(archive = false): Promise<TodoHit[]> {
  const { data, response } = await client.GET("/api/todos", {
    params: { query: { archive } },
  });

  if (!data) {
    throw new Error(`GET /api/todos failed with ${response.status}`);
  }

  return data;
}

/**
 * Candidate lines in search's shape. `review.ts` picks the notes and `srs.ts` parses them, so nothing about the format is known here.
 */
export async function fetchCards(archive = false): Promise<LineHit[]> {
  const { data, response } = await client.GET("/api/cards", {
    params: { query: { archive } },
  });

  if (!data) {
    throw new Error(`GET /api/cards failed with ${response.status}`, {
      cause: response.status,
    });
  }

  return data;
}

/** The day each note counts on, from `from` to `to`: a `YYYY-MM-DD`, or an instant. */
export async function fetchWritten(from: string, to: string): Promise<string[]> {
  const { data, response } = await client.GET("/api/written", {
    params: { query: { from, to } },
  });

  if (!data) {
    throw new Error(`GET /api/written failed with ${response.status}`);
  }

  return data;
}

export type ReviewLimits = components["schemas"]["ReviewLimits"];

/** The daily limits a deck gets where `decks.md` names none, null for no limit. */
export async function fetchReviewLimits(): Promise<ReviewLimits> {
  const { data, response } = await client.GET("/api/review/limits");

  if (!data) {
    throw new Error(`GET /api/review/limits failed with ${response.status}`, {
      cause: response.status,
    });
  }

  return data;
}

/**
 * A literal match, unranked. The caller ranks, so a keystroke narrows the answer already in hand.
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

/** The ranked search's answer: notes best first, and how much of the index stood behind them. */
export type RankedAnswer = components["schemas"]["RankedAnswer"];
export type RankedHit = components["schemas"]["RankedHit"];

/** The notes best matching `query` by its words and its meaning, from the pieces index. */
export async function rankedSearch(query: string, archive = false): Promise<RankedAnswer> {
  const { data, response } = await client.GET("/api/ranked", {
    params: { query: { q: query, archive } },
  });

  if (!data) {
    throw new Error(`GET /api/ranked failed with ${response.status}`);
  }

  return data;
}

/**
 * A line naming a note in plain words. `start` and `end` count UTF-16 code units, as `slice` does.
 */
export type Mention = components["schemas"]["Mention"];

/**
 * Every line outside `path` naming it unlinked. The backend has already passed over links, code, frontmatter and the archive.
 */
export async function fetchMentions(path: string, archive = false): Promise<Mention[]> {
  const { data, response } = await client.GET("/api/mentions", {
    params: { query: { path, archive } },
  });

  if (!data) {
    throw new Error(`GET /api/mentions failed with ${response.status}`);
  }

  return data;
}

/**
 * A read refused because no note is there. The `## Done` log reads it as a day with no note yet.
 */
export class NoteMissing extends Error {
  constructor(path: string) {
    super(`GET /api/files/${path} failed with 404`);
  }
}

/** The text of one note, read straight off the vault. */
export async function fetchNote(path: string): Promise<string> {
  const { data, response } = await client.GET("/api/files/{path}", {
    params: { path: { path } },
  });

  if (response.status === 404) throw new NoteMissing(path);
  if (!data) {
    throw new Error(`GET /api/files/${path} failed with ${response.status}`, {
      cause: response.status,
    });
  }

  return data.content;
}

/**
 * A create refused because a note is already there. The `## Done` log writes into that note instead.
 */
export class NoteExists extends Error {
  constructor(path: string) {
    super(`POST /api/files/${path} failed with 409`);
  }
}

/**
 * `content` goes under the frontmatter, and is empty for a note the reader writes. Passing it here beats saving after: a second save is a second `/api/events` event, which reads as another writer.
 */
export async function createNote(path: string, content = ""): Promise<Note> {
  const { data, response } = await client.POST("/api/files/{path}", {
    params: { path: { path } },
    body: { content },
  });

  if (response.status === 409) throw new NoteExists(path);
  if (!data) {
    throw new Error(`POST /api/files/${path} failed with ${response.status}`);
  }

  // The whole note, so writers and movers seed one cache from one answer.
  // The path is the vault's spelling: `daily/./note.md` comes back as `daily/note.md`, which `?note=` takes.
  pressWrote(data.path, data.content);
  return data;
}

/** A save refused because someone wrote the note since its base. The autosave reads it as a conflict. */
export class ChangedOnDisk extends Error {
  constructor() {
    super("Changed on disk");
  }
}

/**
 * Answers the note as it landed: `PUT` stamps a fresh `modified`, so cache this copy, not the text sent.
 * `keepalive` is for a write on page exit. It caps the body at 64 KiB and rejects above, which the caller reads as not landed.
 * `base` (the sha256 of the text read) makes the write conditional: a vault past it refuses with `ChangedOnDisk`.
 * `restoredFrom` (a jj change id) comes only from the history restore, which keeps the replaced text in a change.
 */
export async function saveNote(
  path: string,
  content: string,
  keepalive = false,
  base?: string,
  restoredFrom?: string,
): Promise<Note> {
  const body: components["schemas"]["NoteSave"] = { content };
  if (base !== undefined) body.base = base;
  if (restoredFrom !== undefined) body.restored_from = restoredFrom;
  const { data, response } = await client.PUT("/api/files/{path}", {
    params: { path: { path } },
    body,
    keepalive,
  });

  if (response.status === 409) throw new ChangedOnDisk();
  if (!data) {
    throw new Error(`PUT /api/files/${path} failed with ${response.status}`, {
      cause: response.status,
    });
  }

  pressWrote(data.path, data.content);
  return data;
}

/**
 * Retries on `ChangedOnDisk` up to three tries, re-running `change` on the fresh text. `change` answering null means nothing to write.
 */
export async function updateNote(
  path: string,
  change: (text: string) => string | null,
): Promise<Note | null> {
  for (let tries = 1; ; tries++) {
    const text = await fetchNote(path);
    const next = change(text);
    if (next === null) return null;
    try {
      return await saveNote(path, next, false, noteBase(text));
    } catch (error) {
      if (!(error instanceof ChangedOnDisk) || tries === 3) throw error;
    }
  }
}

/**
 * Fetched by the backend, since the browser would refuse another origin's page. The failure is the backend's own sentence, which the asker reads.
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

/** Throws the backend's sentence (no transcript, or YouTube refused), which the asker reads. */
export async function fetchTranscript(id: string): Promise<Transcript> {
  const { data, error, response } = await client.GET("/api/transcripts/{video_id}", {
    params: { path: { video_id: id } },
  });

  if (!data) {
    throw new Error(reason(error) ?? `GET /api/transcripts/${id} failed with ${response.status}`);
  }

  return data;
}

/** Empty for a day Open-Meteo has nothing for: the backend answers 404, which is no failure. */
export async function fetchWeather(date: string): Promise<Forecast[]> {
  const { data, response } = await client.GET("/api/weather", {
    params: { query: { date } },
  });

  if (response.status === 404) return [];
  if (!data) throw new Error(`GET /api/weather failed with ${response.status}`);

  return data;
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

/** Vault-relative paths of every HTML page, sorted by the backend. */
export async function fetchHtml(): Promise<string[]> {
  const { data, response } = await client.GET("/api/html");

  if (!data) {
    throw new Error(`GET /api/html failed with ${response.status}`);
  }

  return data;
}

/** Vault-relative paths of every asset (books, pdfs, images), sorted by the backend. */
export async function fetchAssets(): Promise<string[]> {
  const { data, response } = await client.GET("/api/vault-assets");

  if (!data) {
    throw new Error(`GET /api/vault-assets failed with ${response.status}`);
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
 * Takes the note's path, since the backend resolves the file beside it. Plain `fetch`: FastAPI documents no body schema for this 200, so the generated client has nothing typed to return.
 * `encodeURIComponent` sends a slash as `%2F`, which the server unquotes before routing.
 */
export async function fetchBook(note: string): Promise<BookBeside> {
  const response = await fetch(`/api/books/${encodeURIComponent(note)}`);

  if (!response.ok) {
    throw new Error(`GET /api/books/${note} failed with ${response.status}`);
  }

  // Names the file from the header, not a guess: a missing header means the backend changed under this one.
  const named = response.headers.get("X-Book-Path");
  if (named === null) {
    throw new Error(`GET /api/books/${note} answered without naming the file`);
  }

  // Percent-encoded on the wire, since headers are latin-1 and vault names like `Grundzüge` are not.
  return { path: decodeURIComponent(named), blob: await response.blob() };
}

/**
 * Mirrors `UPLOAD_LIMIT_BYTES` in `backend/src/kasten_backend/files.py`, and must never exceed it. `api.test.ts` holds the two together.
 */
export const UPLOAD_LIMIT_BYTES = 1024 * 1024 * 1024;

/** Books and images share one endpoint, so one function. The backend's suffix table is the only copy of what is accepted. */
export async function uploadAsset(
  path: string,
  file: Blob,
  onProgress?: (sent: number, total: number) => void,
): Promise<void> {
  const response = await postFile(`/api/assets/${encodeURIComponent(path)}`, file, onProgress);
  if (!response.ok) throw await refused(response, `POST /api/assets/${path}`);
}
