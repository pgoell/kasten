import { postFile, refused } from "@/lib/api-client";
import type { components } from "@/lib/api-types";

/** What one imported `.apkg` turned into, and what the merge did to the deck notes. */
export type AnkiImport = components["schemas"]["AnkiImport"];

/** How long between asks of an import that still runs. */
const POLL_MS = 2000;

/**
 * Asks of an import in a row that drop or fail before the line gives up.
 *
 * Every ask is 2 s apart, so this is about 10 s of a dead connection, which a
 * phone on a train passes through and comes back from.
 */
const POLL_TRIES = 5;

const LOST_TOUCH = "Lost touch with the import; reload the deck list to see whether it landed";

/**
 * The uploads of files whose import did not land, keyed by the file's name, size and date.
 *
 * Kept so the next import of the same file finishes the upload already on the
 * backend and sends no piece again. A file is keyed only when it is a `File`,
 * since a `Blob` has no name to tell it from another of the same size.
 */
const keptUploads = new Map<string, string>();

/** The key `keptUploads` files a file under, or undefined for a blob that cannot have one. */
function keyOf(file: Blob): string | undefined {
  return file instanceof File
    ? JSON.stringify([file.name, file.size, file.lastModified])
    : undefined;
}

/** The sentence a JSON body carries as `detail`, or undefined for a body that carries none. */
async function detailOf(response: Response): Promise<string | undefined> {
  if (!response.headers.get("content-type")?.includes("json")) return undefined;
  const { detail } = (await response.json()) as { detail?: unknown };
  return typeof detail === "string" ? detail : undefined;
}

/**
 * One ask of an import: its answer, or undefined when the ask was lost.
 *
 * A `TypeError` is a dropped connection, which says nothing about the import. A
 * 5xx is lost too unless it carries a JSON `detail`: a failed import answers 500
 * with its reason, while Cloudflare's own 502 or 524 is HTML and says nothing.
 */
async function askImport(url: string): Promise<Response | undefined> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error: unknown) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
  if (response.status < 500) return response;
  const reason = await detailOf(response);
  if (reason !== undefined) throw new Error(reason);
  return undefined;
}

/** Ask the backend how an import that still runs has gone, until it has an answer. */
async function awaitImport(upload: string): Promise<AnkiImport> {
  const url = `/api/anki/imports/${upload}`;
  let lost = 0;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const response = await askImport(url);
    if (response === undefined) {
      if (++lost === POLL_TRIES) throw new Error(LOST_TOUCH);
      continue;
    }
    lost = 0;
    if (response.status === 202) continue;
    if (!response.ok) throw await refused(response, `GET ${url}`);
    return (await response.json()) as AnkiImport;
  }
}

/** The import an answer to the finish describes: landed, still running, or refused. */
async function settle(response: Response): Promise<AnkiImport> {
  // A 202 names the import that still runs, and its answer comes from polling it.
  if (response.status === 202) {
    const { upload } = (await response.json()) as { upload: string };
    return awaitImport(upload);
  }
  if (!response.ok) throw await refused(response, "POST /api/anki");
  return (await response.json()) as AnkiImport;
}

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
  const url = carry ? "/api/anki?carry=true" : "/api/anki";
  const key = keyOf(file);
  const kept = key === undefined ? undefined : keptUploads.get(key);

  let posted = await postFile(url, file, onProgress, kept);
  if (key !== undefined && kept !== undefined && posted.response.status === 404) {
    // The backend has let the upload go, so the file has to go up again in full.
    keptUploads.delete(key);
    posted = await postFile(url, file, onProgress);
  }

  const { response, upload } = posted;
  const imported = await settle(response).catch((error: unknown) => {
    // Only a file that went through parts has an upload to keep.
    if (key !== undefined && upload !== undefined) keptUploads.set(key, upload);
    throw error;
  });
  if (key !== undefined) keptUploads.delete(key);
  return imported;
}

/**
 * The same import from a link: an AnkiWeb shared-deck page or a plain `.apkg`.
 *
 * The backend fetches it, so a phone never downloads the deck only to
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
