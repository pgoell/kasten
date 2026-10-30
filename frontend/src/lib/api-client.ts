/**
 * The typed connection to the backend, the refusal reader and the file upload. Every module
 * calls the backend through `client`.
 */

import createClient from "openapi-fetch";
import type { paths } from "@/lib/api-types";

/** Typed from the OpenAPI schema; after a route changes, run `mise run fe:types`. */
export const client = createClient<paths>();

/**
 * What the backend said went wrong, or null. Only a clip and a transcript show this
 * sentence to the person; other calls report their status code.
 */
export function reason(error: { detail?: unknown } | undefined): string | null {
  if (typeof error?.detail === "string") return error.detail;
  // A coded refusal carries its sentence in `message`.
  const coded = error?.detail as { message?: unknown } | null | undefined;
  if (typeof coded?.message === "string") return coded.message;
  // FastAPI's validation list: its first entry says why.
  const first = Array.isArray(error?.detail) ? (error.detail[0] as { msg?: unknown }) : undefined;
  return typeof first?.msg === "string" ? first.msg.replace(/^Value error, /, "") : null;
}

/**
 * The error a refused upload throws. Cloudflare can answer an oversize body with an HTML
 * page, so the content type is checked rather than parsing inside a `try`.
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
 * The most one request carries; bigger files go up in pieces this size. Cloudflare refuses
 * a body over 100MB and drops one unanswered for 100 seconds. 10 MiB clears both on a phone.
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
    // A 4xx is a no that a retry repeats. A resent piece replaces the old, so a 5xx may retry.
    if (response.status < 500 || tries === PIECE_TRIES) {
      throw await refused(response, `PUT ${url}`);
    }
  }
}

/**
 * Sends `file` in pieces, in order, and answers the upload's id, which the route takes in place
 * of a body. `onProgress` hears the bytes in after each piece.
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

/** Finish an upload by its id: the route reads the file from the upload, not the body. */
function finish(url: string, upload: string): Promise<Response> {
  return fetch(`${url}${url.includes("?") ? "&" : "?"}upload=${upload}`, { method: "POST" });
}

/**
 * POSTs `file` to `url`: as the body if it fits one piece, else in pieces, with plain `fetch`
 * (the generated client will not send a raw body). `kept` is an upload that already holds the
 * whole file, so only the finish is sent. `onUploaded` gets a new id once its last piece is in.
 */
export async function postFile(
  url: string,
  file: Blob,
  onProgress?: (sent: number, total: number) => void,
  kept?: string,
  onUploaded?: (upload: string) => void,
): Promise<Response> {
  if (kept !== undefined) return finish(url, kept);
  if (file.size <= PIECE_BYTES) return fetch(url, { method: "POST", body: file });
  const upload = await uploadInParts(file, onProgress);
  onUploaded?.(upload);
  return finish(url, upload);
}
