/**
 * What the vault says happened, read off the wire. Kept apart from the `EventSource` so the
 * payload table tests without a DOM. The backend's `events.py` writes this shape.
 */

export interface VaultEvent {
  /** Vault-relative path, or "" on a `listing` event, which names none. */
  path: string;
  /** `page` is an html page written, which is not a note (#1277). */
  change: "written" | "removed" | "listing" | "page";
  digest: string | null;
}

/**
 * The sha256 of `text` as an event's `digest` spells it: lowercase hex over the UTF-8 bytes,
 * so a client can match what it wrote against what landed.
 */
export async function digestOf(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The kinds this build acts on. A backend saying anything else is ignored. */
const KINDS: ReadonlySet<string> = new Set(["written", "removed", "listing", "page"]);

/** One SSE payload, or null when it is not an event this build understands. */
export function parseVaultEvent(data: string): VaultEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch (error) {
    // A truncated payload is what throws a SyntaxError here; anything else is not ours to catch.
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }

  // Every field, not just the kind: a half-checked event hands callers a `path` that is no string.
  // The null check comes first, since reading a field off JSON `null` throws.
  const event = payload as VaultEvent | null;
  return event !== null &&
    typeof event.path === "string" &&
    KINDS.has(event.change) &&
    (event.digest === null || typeof event.digest === "string")
    ? event
    : null;
}
