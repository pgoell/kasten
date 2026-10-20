/**
 * The one typed connection to the backend, how a refusal reads, and how a file
 * body gets there. Every module that calls the backend goes through `client`,
 * and the refusal and upload helpers are shared so each answers the same way.
 */

import createClient from "openapi-fetch";
import type { paths } from "@/lib/api-types";

/**
 * Calls into the backend, typed from its OpenAPI schema.
 *
 * Run `mise run fe:types` after changing a route to regenerate `api-types.ts`.
 */
export const client = createClient<paths>();

/**
 * What the backend said went wrong, or nothing where it said nothing.
 *
 * Every other call here reports its own status code, which is all a reader of
 * the console needs. A clip and a transcript are the two whose failure is put
 * in front of the person who pressed the key, and `detail` is the sentence
 * written for them.
 */
export function reason(error: { detail?: unknown } | undefined): string | null {
  return typeof error?.detail === "string" ? error.detail : null;
}

/**
 * The error a refused upload throws, worded for the line that shows it.
 *
 * The content type asked rather than the parse wrapped in a `try`: an upload's
 * refusal can come from something other than kasten. Cloudflare sits in front
 * of production with a body limit of its own and answers an oversize request
 * with an HTML page, which `.json()` throws on and which names no limit.
 */
export async function refused(response: Response, label: string): Promise<Error> {
  const detail =
    response.headers.get("content-type")?.includes("json") === true
      ? reason(await response.json())
      : null;
  if (detail !== null) return new Error(detail);
  if (response.status === 413) {
    return new Error(
      "That file is over the upload limit of a proxy in front of kasten (100MB per request)",
    );
  }
  return new Error(`${label} failed with ${response.status}`);
}

/**
 * The most one request carries; a bigger file goes up in pieces this size.
 *
 * Cloudflare refuses a body over 100MB, and it drops a request it has not
 * answered within 100 seconds. 10 MiB clears both on a 1 Mbit/s phone link,
 * which sends it in about 84 seconds.
 */
const PIECE_BYTES = 10 * 1024 * 1024;

/** How often one piece is sent before the upload gives up, the first send included. */
const PIECE_TRIES = 3;

/** Send one piece, again on a dropped connection or a 5xx, and never the pieces before it. */
async function sendPiece(url: string, piece: Blob): Promise<void> {
  for (let tries = 1; ; tries++) {
    let response: Response;
    try {
      response = await fetch(url, { method: "PUT", body: piece });
    } catch (error: unknown) {
      // A `TypeError` is what `fetch` rejects with when the connection drops.
      if (!(error instanceof TypeError) || tries === PIECE_TRIES) throw error;
      continue;
    }
    if (response.ok) return;
    // A 4xx is the backend saying no, and asking again would get the same no.
    // The backend cuts a resent piece back, so a retry after a 5xx is safe.
    if (response.status < 500 || tries === PIECE_TRIES) {
      throw await refused(response, `PUT ${url}`);
    }
  }
}

/**
 * Send `file` to the backend in pieces, in order, and answer the upload's id.
 *
 * The id is what the route that uses the file is handed in place of a body.
 * `onProgress` hears how many bytes are in after each piece.
 */
async function uploadInParts(
  file: Blob,
  onProgress?: (sent: number, total: number) => void,
): Promise<string> {
  const opened = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ size: file.size }),
  });
  if (!opened.ok) throw await refused(opened, "POST /api/uploads");
  const { id } = (await opened.json()) as { id: string };

  onProgress?.(0, file.size);
  for (let n = 0; n * PIECE_BYTES < file.size; n++) {
    const end = Math.min((n + 1) * PIECE_BYTES, file.size);
    await sendPiece(`/api/uploads/${id}/${n}`, file.slice(n * PIECE_BYTES, end));
    onProgress?.(end, file.size);
  }
  return id;
}

/**
 * POST `file` to `url`: as the body when it fits one piece, else in pieces.
 *
 * Plain `fetch`, because the endpoints take raw bytes and the generated client
 * documents a body it will not let us send. The raw file rather than a
 * multipart part: one file and no fields, so nothing has to parse a boundary.
 */
export async function postFile(
  url: string,
  file: Blob,
  onProgress?: (sent: number, total: number) => void,
): Promise<Response> {
  if (file.size <= PIECE_BYTES) return fetch(url, { method: "POST", body: file });
  const id = await uploadInParts(file, onProgress);
  return fetch(`${url}${url.includes("?") ? "&" : "?"}upload=${id}`, { method: "POST" });
}
