import { client, postFile, reason, refused } from "@/lib/api-client";
import type { components } from "@/lib/api-types";
import { applyLayout, type Layout } from "@/lib/layout";
import { noteBase } from "@/lib/note-base";
import { pressWrote } from "@/lib/todo-press-echo";

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

/**
 * The folders this vault files into, which from here on every reader uses.
 *
 * Applied in here rather than by whoever asked, so the layout is in place
 * before the query hands the answer to anything that renders.
 */
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
 * reads only what the project needs, so reading the state, the dates and
 * whether a line is still open is this side's job, done by the same parser the
 * editor draws with.
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

/** What one imported `.apkg` turned into, and what the merge did to the deck notes. */
export type AnkiImport = components["schemas"]["AnkiImport"];

/**
 * Turn an Anki export into notes in the vault, merged into the ones it made before.
 *
 * `carry` asks for Anki's schedule to come along with the cards.
 */
export async function importAnki(
  file: Blob,
  carry: boolean,
  onProgress?: (sent: number, total: number) => void,
): Promise<AnkiImport> {
  const response = await postFile(carry ? "/api/anki?carry=true" : "/api/anki", file, onProgress);
  if (!response.ok) throw await refused(response, "POST /api/anki");
  return (await response.json()) as AnkiImport;
}

/**
 * The same import from a link: an AnkiWeb shared-deck page or a plain `.apkg`.
 *
 * The backend fetches it, so a phone never has to download the deck only to
 * upload it again, and the answer is the one `importAnki` gets.
 */
export async function importAnkiLink(url: string, carry: boolean): Promise<AnkiImport> {
  // Plain `fetch` to match `importAnki`, whose refusal handling this shares:
  // the detail is the sentence the import line shows.
  const response = await fetch(carry ? "/api/anki/link?carry=true" : "/api/anki/link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) throw await refused(response, "POST /api/anki/link");
  return (await response.json()) as AnkiImport;
}

/**
 * Every line in the vault that could be part of a flashcard.
 *
 * Candidate lines, in search's shape. `review.ts` picks the notes worth reading
 * off them and `srs.ts` parses those notes, so nothing about the format is
 * known on this side of the wire.
 */
export async function fetchCards(archive = false): Promise<LineHit[]> {
  const { data, response } = await client.GET("/api/cards", {
    params: { query: { archive } },
  });

  if (!data) {
    throw new Error(`GET /api/cards failed with ${response.status}`);
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
    throw new Error(`GET /api/review/limits failed with ${response.status}`);
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

/**
 * A line naming a note in plain words, and where on the line the words are.
 *
 * `start` and `end` count UTF-16 code units into `text`, which is what
 * `slice` counts, so the backend's offsets need no translating here. `name` is
 * the title or alias of the note that matched.
 */
export type Mention = components["schemas"]["Mention"];

/**
 * Every line outside `path` naming it without linking to it.
 *
 * The backend has already passed over links, code, frontmatter, the note
 * itself and the archive, so what comes back is each candidate for a link.
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
 * A read refused because no note is at that path.
 *
 * A class of its own, because the `## Done` log reads it as a day with no note
 * yet, which holds no line to drop. The message is the one every other failed
 * read says, so a notice reads the same.
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
    throw new Error(`GET /api/files/${path} failed with ${response.status}`);
  }

  return data.content;
}

/**
 * A create refused because a note is already at that path.
 *
 * A class of its own, because the `## Done` log reads it as a press just before
 * having made today's note, and writes into that note instead. The message is
 * the one every other failed create says, so a notice reads the same.
 */
export class NoteExists extends Error {
  constructor(path: string) {
    super(`POST /api/files/${path} failed with 409`);
  }
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

  if (response.status === 409) throw new NoteExists(path);
  if (!data) {
    throw new Error(`POST /api/files/${path} failed with ${response.status}`);
  }

  // The whole note rather than the path alone, so a caller that writes and one
  // that moves seed their cache from the same answer. The path in it is the
  // vault's spelling, not the one that was typed: `daily/./note.md` comes back
  // as `daily/note.md`, and that is what belongs in `?note=`.
  pressWrote(data.path, data.content);
  return data;
}

/**
 * A save refused because somebody else wrote the note since its base.
 *
 * A class of its own, because the autosave reads it as a conflict and every
 * other failure as a write to try again.
 */
export class ChangedOnDisk extends Error {
  constructor() {
    super("Changed on disk");
  }
}

/**
 * Write one note back to the vault, over the note that is already there.
 *
 * The note that comes back is what landed on disk, not what was sent: `PUT`
 * stamps a fresh `modified` on the way through. Callers that cache the text
 * have to cache this one, or their copy is a stamp behind the vault from the
 * moment the write returns.
 *
 * `keepalive` is for the write on the way out of the page, which the browser
 * would otherwise cancel with the page. It caps the body at 64 KiB and rejects
 * above that, which the caller has to read as a write that did not land.
 *
 * `base` is the sha256 of the text the caller believes is on disk, `modified`
 * set aside (`unstamped`), and makes the write conditional: a vault that has
 * moved past it refuses with `ChangedOnDisk`. Without one the write lands
 * whatever is there.
 *
 * `restoredFrom` is the jj change id the text was read from, which only the
 * history pane's restore sends: the backend then records the write as a change
 * of its own, so the text it replaced stays in the change below.
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
    throw new Error(`PUT /api/files/${path} failed with ${response.status}`);
  }

  pressWrote(data.path, data.content);
  return data;
}

/**
 * Read one note, change it, and write it back over exactly the text read.
 *
 * The write names what it read as its base, so a save landing between the read
 * and the write is refused rather than written over. On a refusal the note is
 * read again and `change` runs again on the new text: it checks its own
 * preconditions, and answers null where there is now nothing to write. Three
 * tries, then the last `ChangedOnDisk` goes to the caller, a note somebody is
 * typing into being one this write should not chase.
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
 * Read one web page through the backend, which is the only thing that can.
 *
 * The browser will ask another origin for a page and refuse to let a script
 * read the answer, so the request goes out from the server. What comes back is
 * markup and the address it finally came from; making a note of it happens
 * here, in `clip.ts`.
 *
 * The message is the backend's own words rather than a status code: this is
 * one of the two calls whose failure is read by the person who asked for it.
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
 * The captions of one YouTube video, read by the backend off YouTube.
 *
 * The other call whose failure is read by the person who asked, so it throws
 * the backend's sentence: that the video has no transcript, or that YouTube
 * would not hand it over.
 */
export async function fetchTranscript(id: string): Promise<Transcript> {
  const { data, error, response } = await client.GET("/api/transcripts/{video_id}", {
    params: { path: { video_id: id } },
  });

  if (!data) {
    throw new Error(reason(error) ?? `GET /api/transcripts/${id} failed with ${response.status}`);
  }

  return data;
}

/**
 * The weather on one day for every town the backend names.
 *
 * Empty for a day Open-Meteo has nothing for, which the backend answers with a
 * 404: a daily note that old draws no card, and that is not a failure.
 */
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
 * The other copy is `UPLOAD_LIMIT_BYTES` in
 * `backend/src/kasten_backend/files.py`, and the direction is what matters:
 * this one must never exceed that one, because a client that lets through what
 * the server refuses sends a gigabyte to be told no. `api.test.ts` reads the
 * backend's copy off disk and holds the two together.
 */
export const UPLOAD_LIMIT_BYTES = 1024 * 1024 * 1024;

/**
 * Put one book or image at `path`, which is the file's path and not the note's.
 *
 * One function for both, the endpoint being one endpoint: what the vault will
 * take is a table of suffixes on the backend, and a second copy of it here
 * would be a second place to edit when a format arrives.
 */
export async function uploadAsset(
  path: string,
  file: Blob,
  onProgress?: (sent: number, total: number) => void,
): Promise<void> {
  const response = await postFile(`/api/assets/${encodeURIComponent(path)}`, file, onProgress);
  if (!response.ok) throw await refused(response, `POST /api/assets/${path}`);
}
