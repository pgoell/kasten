import { postFile, refused } from "@/lib/api-client";
import type { components } from "@/lib/api-types";

/** What one imported `.apkg` turned into, and what the merge did to the deck notes. */
export type AnkiImport = components["schemas"]["AnkiImport"];

/** How long between asks of an import that still runs. */
const POLL_MS = 2000;

/**
 * Asks of an import in a row that drop or fail before the line gives up. Each ask is 2 s apart, so
 * this is about 10 s of a dead connection, which a phone on a train passes through.
 */
const POLL_TRIES = 5;

const LOST_TOUCH = "Lost touch with the import; reload the deck list to see whether it landed";

/**
 * Uploads of imports that did not land, keyed by file name, size and date, so a retry sends
 * no piece again. A `Blob` is not keyed: it has no name to tell it from another of the same size.
 */
const keptUploads = new Map<string, string>();

/** The key `keptUploads` files a file under, or undefined for a blob that cannot have one. */
function keyOf(file: Blob): string | undefined {
  return file instanceof File
    ? JSON.stringify([file.name, file.size, file.lastModified])
    : undefined;
}

/** What one ask of a running import came back with, besides the counts and a refusal. */
const RUNNING = "running";

/**
 * The JSON body of an answer, or undefined when it has none that parses. A proxy's 401 or a
 * Cloudflare page is HTML, so neither is read as the import's answer.
 */
async function jsonOf(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.includes("json")) return undefined;
  try {
    return await response.json();
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

/**
 * One ask of an import: its counts, `RUNNING`, or undefined when the ask was lost. A refusal or
 * failure is the import's outcome only with a JSON `detail`. Anything else (a dropped connection, a
 * proxy's 401, a 429, a bare 5xx) says nothing about the import.
 */
async function askImport(url: string): Promise<AnkiImport | typeof RUNNING | undefined> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error: unknown) {
    // A `TypeError` is a dropped connection.
    if (error instanceof TypeError) return undefined;
    throw error;
  }
  if (response.status === 202) return RUNNING;
  const body = await jsonOf(response);
  if (response.ok) return body === undefined ? undefined : (body as AnkiImport);
  const detail = (body as { detail?: unknown } | undefined)?.detail;
  if (typeof detail === "string") throw new Error(detail);
  return undefined;
}

/** Ask the backend how an import that still runs has gone, until it has an answer. */
async function awaitImport(upload: string): Promise<AnkiImport> {
  const url = `/api/anki/imports/${upload}`;
  let lost = 0;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const asked = await askImport(url);
    if (asked === undefined) {
      if (++lost === POLL_TRIES) throw new Error(LOST_TOUCH);
      continue;
    }
    lost = 0;
    if (asked !== RUNNING) return asked;
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
 * Turn an Anki export into vault notes, merged into the ones made before. `carry` keeps the
 * schedule with the cards.
 */
export async function importAnki(
  file: Blob,
  carry: boolean,
  onProgress?: (sent: number, total: number) => void,
): Promise<AnkiImport> {
  const url = carry ? "/api/anki?carry=true" : "/api/anki";
  const key = keyOf(file);
  const kept = key === undefined ? undefined : keptUploads.get(key);
  // Kept as soon as the parts are in, so a lost finish still leaves the next try its upload.
  const onUploaded =
    key === undefined ? undefined : (upload: string) => keptUploads.set(key, upload);

  let response = await postFile(url, file, onProgress, kept, onUploaded);
  if (key !== undefined && kept !== undefined && response.status === 404) {
    // The backend has let the upload go, so the file has to go up again in full.
    keptUploads.delete(key);
    response = await postFile(url, file, onProgress, undefined, onUploaded);
  }

  const imported = await settle(response);
  // Only a landed import lets its upload go; a refused or lost one is kept for the retry.
  if (key !== undefined) keptUploads.delete(key);
  return imported;
}

/**
 * The same import from a link: an AnkiWeb shared-deck page or a plain `.apkg`. The backend fetches
 * it, so a phone never downloads the deck only to upload it again.
 */
export async function importAnkiLink(url: string, carry: boolean): Promise<AnkiImport> {
  // Plain fetch, as `importAnki` shares its refusal handling: the detail is what the line shows.
  const response = await fetch(carry ? "/api/anki/link?carry=true" : "/api/anki/link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) throw await refused(response, "POST /api/anki/link");
  return (await response.json()) as AnkiImport;
}
